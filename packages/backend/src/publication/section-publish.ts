// Non-legacy projections use their own rules and reviewed permissions. Rebuilds are model-free.
import { requireSectionId, type SectionId } from "@aihot/contracts/sections";
import { sql, type Tx } from "../db.ts";
import { audit, Conflict } from "../audit.ts";
import { assertSectionResource } from "../sections/resources.ts";
import { sectionContext } from "../sections/context.ts";
import { isPoolEligible } from "./rules.ts";

function nonLegacy(sectionId: SectionId) {
  requireSectionId(sectionId);
  if (sectionId === "ai") throw new Error("use the legacy AI publication entry point");
  return sectionContext(sectionId);
}

/** Permission review is an accountable operation, not an inference from HTTP 200 or source tier. */
export async function reviewSectionSourcePermission(sectionId: SectionId, sourceId: string,
  review: { summaryAllowed: boolean; reference: string; actor: string }) {
  nonLegacy(sectionId);
  if (typeof review.summaryAllowed !== "boolean" || !review.reference.trim() || !review.actor.trim()) throw new Error("permission review requires evidence and actor");
  return sql.begin(async tx => {
    await assertSectionResource(tx, sectionId, { kind: "source", id: sourceId });
    const [before] = await tx`SELECT * FROM section_source_permissions WHERE section_id=${sectionId} AND source_id=${sourceId} FOR UPDATE`;
    const [after] = await tx`INSERT INTO section_source_permissions (section_id,source_id,summary_allowed,permission_reference,reviewed_by,reviewed_at)
      VALUES (${sectionId},${sourceId},${review.summaryAllowed},${review.reference.trim()},${review.actor.trim()},now())
      ON CONFLICT (section_id,source_id) DO UPDATE SET summary_allowed=EXCLUDED.summary_allowed,
        permission_reference=EXCLUDED.permission_reference,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=EXCLUDED.reviewed_at RETURNING *`;
    await audit(review.actor,"section.source.permission",`${sectionId}:source:${sourceId}`,review.reference,before ?? null,after,{ db:tx });
    return after!;
  });
}

export async function projectSectionArticle(sectionId: SectionId, articleId: string) {
  nonLegacy(sectionId);
  return sql.begin(tx => projectSectionArticleTx(tx,sectionId,articleId));
}

export async function projectSectionArticleTx(tx: Tx, sectionId: SectionId, articleId: string) {
  const rules = nonLegacy(sectionId);
  // Serialize projection/review before ownership's shared lock: simultaneous lock upgrades deadlock.
  await tx`SELECT id FROM articles WHERE id=${articleId} FOR UPDATE`;
  await assertSectionResource(tx,sectionId,{ kind:"article",id:articleId });
  const [article] = await tx<{ source_id:string;revision:number;title:string;url:string;published_at:Date|null;
    discovered_at:Date;timeline_at:Date;backfill:boolean;grouping_status:string }[]>`
    SELECT source_id,revision,title,url,published_at,discovered_at,timeline_at,backfill,grouping_status
    FROM articles WHERE section_id=${sectionId} AND id=${articleId} FOR UPDATE`;
  const a=article!;
  const [source]=await tx<{ participation_mode:string;summary_allowed:boolean|null }[]>`
    SELECT s.participation_mode,sp.summary_allowed FROM sources s LEFT JOIN section_source_permissions sp
      ON sp.section_id=s.section_id AND sp.source_id=s.id WHERE s.section_id=${sectionId} AND s.id=${a.source_id} FOR SHARE OF s`;
  const [analysis]=await tx<{ id:number;relevance:string;category:string|null;title_zh:string|null;summary_zh:string|null;
    reason_zh:string|null;tags:string[];score:number|null }[]>`SELECT id,relevance,category,title_zh,summary_zh,reason_zh,tags,score
    FROM analyses WHERE section_id=${sectionId} AND article_id=${articleId} AND input_revision=${a.revision} ORDER BY id DESC LIMIT 1`;
  const [override]=await tx<{ visibility:string|null;fields:Record<string,unknown> }[]>`SELECT visibility,fields FROM editorial_overrides WHERE article_id=${articleId}`;
  const [membership]=await tx<{ fact_id:number;story_id:number }[]>`SELECT fa.fact_id,f.story_id FROM fact_articles fa
    JOIN facts f ON f.section_id=fa.section_id AND f.id=fa.fact_id JOIN stories st ON st.section_id=f.section_id AND st.id=f.story_id
    WHERE fa.section_id=${sectionId} AND fa.article_id=${articleId} AND fa.role IN ('primary','report') AND st.merged_into IS NULL
    ORDER BY (fa.role='primary') DESC,fa.created_at LIMIT 1`;
  const approved = override?.fields.sectionApprovedRevision === a.revision && override?.fields.sectionApprovedAnalysisId === analysis?.id;
  const calibrated = rules.selection.thresholds !== null;
  const eligible=!!analysis && isPoolEligible({ participationMode:source!.participation_mode,relevance:analysis.relevance,
    title:analysis.title_zh,summary:analysis.summary_zh }) && !!a.published_at && a.published_at<=new Date()
    && a.grouping_status==="complete" && source!.summary_allowed===true
    && rules.categories.some(c=>c.key===analysis.category) && (approved || calibrated);
  // Selection is intentionally separate: source-tier AI thresholds never nominate world news.
  const visibility=override?.visibility ?? "public";
  const [previous]=await tx<{ revision:number;section_admitted_at:Date|null }[]>`SELECT revision,section_admitted_at FROM publications WHERE section_id=${sectionId} AND article_id=${articleId}`;
  const now=new Date();
  const admittedAt=previous?.section_admitted_at ?? (eligible && visibility==='public' && !a.backfill
    && a.published_at!.getTime()>=now.getTime()-48*3600*1000 ? now : null);
  await tx`INSERT INTO publications (section_id,article_id,analysis_id,revision,source_id,title,original_title,summary,reason,category,tags,score,
    visibility,eligible,selected,selection_candidate,body_mode,syndicate,indexable,channel,url,published_at,discovered_at,timeline_at,sort_at,backfill,story_id,fact_id,section_admitted_at)
    VALUES (${sectionId},${articleId},${analysis?.id ?? null},${(previous?.revision ?? 0)+1},${a.source_id},${analysis?.title_zh ?? a.title},${a.title},
      ${analysis?.summary_zh ?? null},${analysis?.reason_zh ?? null},${analysis?.category ?? null},${analysis?.tags ?? []},${analysis?.score ?? null},
      ${visibility},${eligible},false,false,'summary',false,false,'news',${a.url},${a.published_at},${a.discovered_at},${a.timeline_at},${a.timeline_at},
      ${a.backfill},${membership?.story_id ?? null},${membership?.fact_id ?? null},${admittedAt})
    ON CONFLICT (article_id) DO UPDATE SET analysis_id=EXCLUDED.analysis_id,revision=EXCLUDED.revision,title=EXCLUDED.title,
      original_title=EXCLUDED.original_title,summary=EXCLUDED.summary,reason=EXCLUDED.reason,category=EXCLUDED.category,tags=EXCLUDED.tags,
      score=EXCLUDED.score,visibility=EXCLUDED.visibility,eligible=EXCLUDED.eligible,selected=false,selection_candidate=false,
      body_mode='summary',syndicate=false,indexable=false,published_at=EXCLUDED.published_at,timeline_at=EXCLUDED.timeline_at,
      sort_at=EXCLUDED.sort_at,backfill=EXCLUDED.backfill,story_id=EXCLUDED.story_id,fact_id=EXCLUDED.fact_id,
      section_admitted_at=EXCLUDED.section_admitted_at,updated_at=now()
    WHERE publications.section_id=${sectionId}`;
  return { sectionId,articleId,eligible,visibility,selected:false,calibrationRequired:!calibrated };
}

/** Manual review is revision-bound; reanalysis never grants approval to a changed original. */
export async function reviewSectionPublication(sectionId: SectionId,articleId:string,
  review:{ revision:number; action:"approve"|"withdraw";actor:string;reason:string }) {
  nonLegacy(sectionId);
  if (!Number.isSafeInteger(review.revision) || review.revision<1 || !["approve","withdraw"].includes(review.action)
    || !review.actor.trim() || !review.reason.trim()) throw new Error("invalid publication review");
  return sql.begin(async tx=>{
    await tx`SELECT id FROM articles WHERE id=${articleId} FOR UPDATE`;
    await assertSectionResource(tx,sectionId,{ kind:"article",id:articleId });
    const [a]=await tx<{ revision:number }[]>`SELECT revision FROM articles WHERE section_id=${sectionId} AND id=${articleId} FOR UPDATE`;
    if(a!.revision!==review.revision) throw new Conflict("article revision changed");
    const [before]=await tx<{ fields:Record<string,unknown> }[]>`SELECT * FROM editorial_overrides WHERE article_id=${articleId} FOR UPDATE`;
    const [analysis]=await tx<{ id:number }[]>`SELECT id FROM analyses WHERE section_id=${sectionId} AND article_id=${articleId}
      AND input_revision=${review.revision} ORDER BY id DESC LIMIT 1`;
    const fields={ ...before?.fields,sectionApprovedRevision:review.action==="approve" ? review.revision : null,
      sectionApprovedAnalysisId:review.action==="approve" ? analysis?.id ?? null : null };
    await tx`INSERT INTO editorial_overrides (article_id,fields,visibility,reason,updated_by)
      VALUES (${articleId},${tx.json(fields)},${review.action==="approve" ? "public" : "withdrawn"},${review.reason},${review.actor})
      ON CONFLICT (article_id) DO UPDATE SET fields=EXCLUDED.fields,visibility=EXCLUDED.visibility,reason=EXCLUDED.reason,
        updated_by=EXCLUDED.updated_by,version=editorial_overrides.version+1,updated_at=now()`;
    const result=await projectSectionArticleTx(tx,sectionId,articleId);
    if(review.action==="approve" && !result.eligible) throw new Conflict("article is not ready: check current analysis, grouping, date and source permission");
    await audit(review.actor,`section.publication.${review.action}`,`${sectionId}:content:${articleId}`,review.reason,before ?? null,result,{ db:tx });
    return result;
  });
}
