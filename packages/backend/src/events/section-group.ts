// Section-scoped occurrence/development grouping; no industry vocabulary or AI prompts are used.
import { z } from "zod";
import { requireSectionId, type SectionId } from "@aihot/contracts/sections";
import { sql } from "../db.ts";
import { sectionContext } from "../sections/context.ts";
import { assertSectionResource } from "../sections/resources.ts";
import { sectionModelFor } from "../editorial/models.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { newShortId, newUuid } from "../lib/ids.ts";
import { lexicalSimilarity } from "./relate.ts";

const Relation = z.strictObject({ a: z.string().max(500), b: z.string().max(500),
  relation: z.enum(["SAME_OCCURRENCE", "SAME_STORY", "UNRELATED", "ROUNDUP"]),
  confidence: z.number().min(0).max(1), note: z.string().max(600) });
interface Material {
  id: string; revision: number; source_id: string; title: string; excerpt: string | null; published_at: Date | null;
  analysis_id: number; title_zh: string | null; summary_zh: string | null; output: Record<string, any>;
}
interface Candidate extends Material { fact_id: number; story_id: number; root: boolean }
export interface SectionGroupResult { verdict: string; storyId?: number; factId?: number }

/** Serialise within a section across worker processes; model calls do not hold row transactions open. */
export async function groupSectionArticle(sectionId: SectionId, articleId: string): Promise<SectionGroupResult> {
  requireSectionId(sectionId);
  if (sectionId === "ai") throw new Error("use the legacy AI grouping entry point");
  const rules = sectionContext(sectionId);
  await sql.begin(tx => assertSectionResource(tx, sectionId, { kind: "article", id: articleId }));
  const lock = await sql.reserve();
  const key = `group-section:${sectionId}`;
  try {
    await lock`SELECT pg_advisory_lock(hashtextextended(${key},0))`;
    const [a] = await sql<Material[]>`
      SELECT a.id,a.revision,a.source_id,a.title,a.excerpt,a.published_at,an.id AS analysis_id,an.title_zh,an.summary_zh,an.output
      FROM articles a JOIN LATERAL (SELECT * FROM analyses WHERE article_id=a.id AND section_id=${sectionId}
        AND input_revision=a.revision ORDER BY id DESC LIMIT 1) an ON true
      WHERE a.id=${articleId} AND a.section_id=${sectionId} AND an.relevance='pass'`;
    if (!a) return { verdict: "waiting" };
    if ((await sql`SELECT 1 FROM grouping_overrides WHERE article_id=${articleId}`).length) return { verdict: "manual" };
    const [membership] = await sql<{ fact_id: number; story_id: number }[]>`
      SELECT fa.fact_id,f.story_id FROM fact_articles fa JOIN facts f ON f.id=fa.fact_id
      WHERE fa.section_id=${sectionId} AND fa.article_id=${articleId} AND fa.role<>'mention' LIMIT 1`;
    if (membership) return { verdict: "existing", storyId: membership.story_id, factId: membership.fact_id };
    const candidates = await sql<Candidate[]>`
      SELECT DISTINCT ON (f.id) b.id,b.revision,b.source_id,b.title,b.excerpt,b.published_at,
        an.id AS analysis_id,an.title_zh,an.summary_zh,an.output,f.id AS fact_id,f.story_id,
        (f.id=(SELECT r.id FROM facts r WHERE r.story_id=f.story_id AND r.section_id=${sectionId} ORDER BY r.created_at,r.id LIMIT 1)) AS root
      FROM facts f JOIN stories st ON st.id=f.story_id AND st.section_id=f.section_id AND st.merged_into IS NULL
      JOIN fact_articles fa ON fa.fact_id=f.id AND fa.section_id=f.section_id AND fa.role IN ('primary','report')
      JOIN articles b ON b.id=fa.article_id AND b.section_id=f.section_id
      JOIN LATERAL (SELECT * FROM analyses WHERE section_id=${sectionId} AND article_id=b.id AND input_revision=b.revision
        AND relevance='pass' ORDER BY id DESC LIMIT 1) an ON true
      WHERE f.section_id=${sectionId} AND b.id<>${articleId} AND b.discovered_at>now()-interval '14 days'
      ORDER BY f.id,(fa.role='primary') DESC,fa.created_at LIMIT 500`;
    const text = (row: Material) => `${row.title} ${row.title_zh ?? ""} ${row.summary_zh ?? ""} ${row.excerpt ?? ""}`;
    const recalled = candidates.map(c => ({ c, score: lexicalSimilarity(text(a), text(c)) }))
      .filter(r => r.score > 0).sort((x,y) => y.score-x.score || y.c.fact_id-x.c.fact_id).slice(0,10);
    let target: Candidate | null = null;
    let relation: z.infer<typeof Relation>["relation"] = "UNRELATED";
    const receiptIds: number[] = [];
    const decisions: Record<string, unknown>[] = [];
    for (const { c } of recalled) {
      const user = JSON.stringify({ A: { title: a.title, rssText: a.excerpt, publishedAt: a.published_at, structure: a.output },
        B: { title: c.title, rssText: c.excerpt, publishedAt: c.published_at, structure: c.output },
        inputRevision: a.revision, candidateRevision: c.revision, candidateFactId: c.fact_id });
      const ask = async (review: boolean) => {
        const prompt = review ? "group-review" : "group-pair";
        const result = await chatJson({ sectionId, resource: { kind: "article", id: articleId },
          model: await sectionModelFor(rules, review ? "groupReview" : "group"), purpose: `${sectionId}.${prompt}`,
          subject: articleId, promptVersion: rules.prompts.version(prompt), system: rules.prompts.text(prompt), user,
          schema: Relation, maxTokens: 900 });
        receiptIds.push(result.receiptId);
        return result.data;
      };
      const first = await ask(false);
      decisions.push({ factId: c.fact_id, first });
      if (first.relation === "UNRELATED" || first.relation === "ROUNDUP") continue;
      const review = await ask(true); // independent: the first verdict is not passed as evidence
      decisions.push({ factId: c.fact_id, review });
      if (review.relation !== first.relation) continue;
      if (review.relation === "SAME_STORY" && !c.root) continue; // no progress-chain expansion
      target = c;
      relation = review.relation;
      break;
    }
    return await sql.begin(async tx => {
      await assertSectionResource(tx, sectionId, { kind: "article", id: articleId });
      const [current] = await tx<{ revision: number }[]>`SELECT revision FROM articles WHERE id=${articleId} AND section_id=${sectionId} FOR UPDATE`;
      if (current!.revision !== a.revision) return { verdict: "stale" };
      const [latest] = await tx<{ id: number }[]>`SELECT id FROM analyses WHERE article_id=${articleId} AND section_id=${sectionId} ORDER BY input_revision DESC,id DESC LIMIT 1`;
      if (latest!.id !== a.analysis_id) return { verdict: "stale" };
      if ((await tx`SELECT 1 FROM grouping_overrides WHERE article_id=${articleId}`).length) return { verdict: "manual" };
      if (target) {
        await assertSectionResource(tx, sectionId, { kind: "story", id: target.story_id });
        const [live] = await tx`SELECT 1 FROM facts f JOIN stories st ON st.id=f.story_id
          WHERE f.section_id=${sectionId} AND f.id=${target.fact_id} AND f.story_id=${target.story_id} AND st.merged_into IS NULL FOR SHARE OF f,st`;
        if (!live) return { verdict: "stale" };
        const [unchanged]=await tx`SELECT 1 FROM articles b WHERE b.id=${target.id} AND b.section_id=${sectionId}
          AND b.revision=${target.revision} AND ${target.analysis_id}=(SELECT id FROM analyses an WHERE an.article_id=b.id AND an.section_id=b.section_id
            ORDER BY input_revision DESC,id DESC LIMIT 1) FOR SHARE OF b`;
        if (!unchanged) return { verdict:"stale" };
      }
      const fact = a.output.fact;
      const mention = a.output.scope !== "single" || a.output.contentType === "opinion_analysis" || !fact;
      let storyId = target?.story_id;
      let factId = target?.fact_id;
      if (!mention && !target) {
        const [st] = await tx<{ id: number }[]>`INSERT INTO stories (section_id,public_id,title,first_report_at,latest_at)
          VALUES (${sectionId},${newUuid()},${fact.title},${a.published_at},${a.published_at}) RETURNING id`;
        storyId = st!.id;
      }
      if (!mention && (!target || relation === "SAME_STORY")) {
        const [f] = await tx<{ id: number }[]>`INSERT INTO facts (section_id,public_id,story_id,title,subject,action,object,occurred_at,conditions)
          VALUES (${sectionId},${newShortId()},${storyId!},${fact.title},${fact.subject},${fact.action},${fact.object},
            ${fact.occurredAt ? new Date(fact.occurredAt) : null},${JSON.stringify(fact.conditions ?? [])}) RETURNING id`;
        factId = f!.id;
      }
      if (storyId && factId) {
        await tx`INSERT INTO fact_articles (section_id,fact_id,article_id,role,evidence)
          VALUES (${sectionId},${factId},${articleId},${mention ? "mention" : target && relation === "SAME_OCCURRENCE" ? "report" : "primary"},${fact?.evidence ?? null})
          ON CONFLICT (fact_id,article_id) DO NOTHING`;
        if (!mention && a.published_at) {
          await tx`INSERT INTO story_signals (section_id,story_id,article_id,source_id,participant_key,kind,observed_at)
            VALUES (${sectionId},${storyId},${articleId},${a.source_id},${`source:${a.source_id}`},'editorial',${a.published_at})
            ON CONFLICT (story_id,article_id) DO NOTHING`;
          await tx`UPDATE stories SET latest_at=greatest(latest_at,${a.published_at}),updated_at=now() WHERE id=${storyId} AND section_id=${sectionId}`;
        }
      }
      const verdict = mention ? target ? "mention" : "standalone-analysis" : target ? relation : "new";
      await tx`INSERT INTO grouping_decisions (article_id,fact_id,story_id,verdict,candidates,receipt_id)
        VALUES (${articleId},${factId ?? null},${storyId ?? null},${verdict},${tx.json(decisions as never)},${receiptIds.at(-1) ?? null})`;
      await tx`UPDATE articles SET grouping_status='complete',grouped_at=now(),grouping_error=NULL,grouping_receipt_id=${receiptIds.at(-1) ?? null}
        WHERE section_id=${sectionId} AND id=${articleId}`;
      for (const id of receiptIds) await completeReceipt(tx,id,sectionId);
      return { verdict, ...(storyId ? { storyId } : {}), ...(factId ? { factId } : {}) };
    });
  } catch (error) {
    await sql`UPDATE articles SET grouping_status='failed',grouping_error=${String(error).slice(0,1000)} WHERE id=${articleId} AND section_id=${sectionId}`;
    throw error;
  } finally {
    try { await lock`SELECT pg_advisory_unlock(hashtextextended(${key},0))`; } finally { lock.release(); }
  }
}
