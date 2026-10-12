// Explicit-section public DTOs: no model calls, no industry taxonomy, no cross-section fallback.
import { requireSectionId, type SectionId } from "@aihot/contracts/sections";
import { sql } from "../db.ts";
import { sectionContext } from "../sections/context.ts";
import { sectionSelectionThreshold } from "../sections/rules.ts";
import { listedCondition, evidenceCondition } from "./scope.ts";
import { currentSectionHot } from './section-hot.ts';

interface SectionItemRow { id: string; title: string; summary: string | null; reason: string | null; category: string | null;
  score: number | null; selected: boolean; url: string; published_at: Date | null; timeline_at: Date; source_name: string; story_public_id: string | null }
const columns = sql`p.article_id AS id,p.title,p.summary,p.reason,p.category,p.score,p.selected,p.url,p.published_at,p.timeline_at,
  s.name AS source_name,st.public_id::text AS story_public_id`;
const from = sql`FROM publications p JOIN sources s ON s.id=p.source_id AND s.section_id=p.section_id
  LEFT JOIN stories st ON st.id=p.story_id AND st.section_id=p.section_id AND st.merged_into IS NULL`;
const shape = (r: SectionItemRow) => ({ id:r.id,title:r.title,summary:r.summary,reason:r.reason,category:r.category,score:r.score,
  selected:r.selected,source:{ name:r.source_name },links:{ original:r.url },publishedAt:r.published_at?.toISOString() ?? null,
  timelineAt:r.timeline_at.toISOString(),storyPublicId:r.story_public_id });

export async function sectionItems(sectionId: SectionId, query: { limit?: number; category?: string; q?: string } = {}) {
  requireSectionId(sectionId);
  const rules = sectionContext(sectionId);
  if (query.category !== undefined && !rules.categories.some(c=>c.key===query.category)) throw new Error("invalid section category");
  const limit=query.limit ?? 40;
  if (!Number.isSafeInteger(limit) || limit<1 || limit>100) throw new Error("invalid section limit");
  if (query.q !== undefined && query.q.length>200) throw new Error("invalid section search");
  const term=query.q?.trim().replace(/[\\%_]/g,m=>`\\${m}`);
  const rows=await sql<SectionItemRow[]>`SELECT ${columns} ${from} WHERE ${listedCondition(new Date(),sectionId)}
    ${query.category ? sql`AND p.category=${query.category}` : sql``}
    ${term ? sql`AND (p.title ILIKE ${`%${term}%`} OR p.summary ILIKE ${`%${term}%`})` : sql``}
    ORDER BY p.timeline_at DESC,p.article_id DESC LIMIT ${limit}`;
  return { sectionId,items:rows.map(shape),count:rows.length };
}

export async function sectionItem(sectionId: SectionId,id:string) {
  requireSectionId(sectionId);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  const [row]=await sql<SectionItemRow[]>`SELECT ${columns} ${from}
    WHERE p.article_id=${id} AND ${listedCondition(new Date(),sectionId)}`;
  // The first world edition has summary/original links only; no unlicensed body or translation.
  return row ? { sectionId,item:shape(row) } : null;
}

export async function sectionStories(sectionId: SectionId,limit=40) {
  requireSectionId(sectionId);
  if (!Number.isSafeInteger(limit) || limit<1 || limit>100) throw new Error("invalid section limit");
  const rows=await sql<{ public_id:string;title:string;latest_at:Date|null;reports:number }[]>`
    SELECT st.public_id::text,st.title,st.latest_at,count(DISTINCT p.article_id)::int AS reports
    FROM stories st JOIN facts f ON f.story_id=st.id AND f.section_id=st.section_id
    JOIN fact_articles fa ON fa.fact_id=f.id AND fa.section_id=f.section_id
    JOIN publications p ON p.article_id=fa.article_id AND p.section_id=fa.section_id
    WHERE st.section_id=${sectionId} AND st.merged_into IS NULL AND ${listedCondition(new Date(),sectionId)} AND ${evidenceCondition()}
    GROUP BY st.id ORDER BY st.latest_at DESC NULLS LAST,st.id DESC LIMIT ${limit}`;
  return { sectionId,items:rows.map(r=>({ publicId:r.public_id,title:r.title,latestAt:r.latest_at?.toISOString() ?? null,reportCount:r.reports })) };
}

export async function sectionStory(sectionId:SectionId,publicId:string) {
  requireSectionId(sectionId);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(publicId)) return null;
  const [story]=await sql<{ id:number;public_id:string;title:string;latest_at:Date|null }[]>`
    SELECT st.id,st.public_id::text,st.title,st.latest_at FROM stories st
    WHERE st.section_id=${sectionId} AND st.merged_into IS NULL AND (st.public_id=${publicId}
      OR EXISTS (SELECT 1 FROM story_aliases alias WHERE alias.public_id=${publicId} AND alias.story_id=st.id))`;
  if (!story) return null;
  const rows=await sql<SectionItemRow[]>`SELECT DISTINCT ${columns} ${from}
    JOIN fact_articles fa ON fa.article_id=p.article_id AND fa.section_id=p.section_id
    JOIN facts f ON f.id=fa.fact_id AND f.section_id=fa.section_id
    WHERE f.story_id=${story.id} AND ${listedCondition(new Date(),sectionId)} AND ${evidenceCondition()}
    ORDER BY p.timeline_at DESC,p.article_id DESC LIMIT 100`;
  return rows.length ? { sectionId,story:{ publicId:story.public_id,title:story.title,latestAt:story.latest_at?.toISOString() ?? null },reports:rows.map(shape) } : null;
}

export async function sectionHot(sectionId:SectionId) {
  requireSectionId(sectionId);
  const rules=sectionContext(sectionId);
  // Uncalibrated world importance must not silently become an automatic recommendation.
  if (sectionSelectionThreshold(rules)===null) return { sectionId,status:"calibration-required",items:[] };
  const ranking=await currentSectionHot(sectionId);
  if(ranking.status!=='ready') return { sectionId,status:ranking.status,items:[] };
  const entries=ranking.items;
  const items=[];
  for (const entry of entries.slice(0,10)) {
    if (typeof entry.representativeItemId!=="string" || !Number.isSafeInteger(entry.storyId)) continue;
    const [row]=await sql<SectionItemRow[]>`SELECT ${columns} ${from}
      JOIN fact_articles fa ON fa.article_id=p.article_id AND fa.section_id=p.section_id
      JOIN facts f ON f.id=fa.fact_id AND f.section_id=fa.section_id
      WHERE p.article_id=${entry.representativeItemId} AND f.story_id=${entry.storyId as number}
        AND ${listedCondition(new Date(),sectionId)} AND ${evidenceCondition()} LIMIT 1`;
    if (row) items.push({ rank:items.length+1,item:shape(row),importance:entry.importance,heat:entry.heat,
      sourceCount:entry.sourceCount,reportCount:entry.reportCount,latestProgressAt:entry.latestProgressAt });
  }
  return { sectionId,status:"ready",computedAt:ranking.computedAt,heatMeaning:ranking.heatMeaning,items };
}
