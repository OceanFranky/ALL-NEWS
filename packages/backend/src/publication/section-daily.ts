// Public report citations are always revalidated against current publication scope, never raw JSON.
import { requireSectionId,type SectionId } from "@aihot/contracts/sections";
import { SectionDailyContent,SectionDailyDate,type SectionDailyEntryData } from "@aihot/contracts/section-daily";
import { addDays,beijingMidnight } from "@aihot/contracts/time";
import { sql,type Db } from "../db.ts";
import { listedCondition } from "./scope.ts";
import { publicSourceName } from "./rules.ts";

export async function sectionDailyCandidates(sectionId:SectionId,date:string,db:Db=sql):Promise<SectionDailyEntryData[]> {
  requireSectionId(sectionId);SectionDailyDate.parse(date);
  if(sectionId==='ai') throw new Error('use the legacy AI daily entry point');
  const start=beijingMidnight(date),end=beijingMidnight(addDays(date,1));
  const rows=await db<{ item_id:string;analysis_id:number;story_public_id:string|null;title:string;summary:string;reason:string|null;
    category:string;score:number|null;source_id:string;source_name:string;url:string;published_at:Date;section_admitted_at:Date }[]>`
    SELECT p.article_id AS item_id,p.analysis_id,st.public_id::text AS story_public_id,p.title,p.summary,p.reason,p.category,p.score,
      p.source_id,s.name AS source_name,p.url,p.published_at,p.section_admitted_at FROM publications p
    JOIN sources s ON s.id=p.source_id AND s.section_id=p.section_id
    LEFT JOIN stories st ON st.id=p.story_id AND st.section_id=p.section_id AND st.merged_into IS NULL
    WHERE ${listedCondition(new Date(),sectionId)} AND NOT p.backfill AND p.section_admitted_at>=${start} AND p.section_admitted_at<${end}
    ORDER BY p.score DESC NULLS LAST,p.published_at DESC,p.article_id`;
  return rows.map(r=>({ itemId:r.item_id,analysisId:r.analysis_id,storyPublicId:r.story_public_id,title:r.title,summary:r.summary,reason:r.reason,
    category:r.category,score:r.score,sourceId:r.source_id,sourceName:publicSourceName(r.source_name),originalUrl:r.url,
    publishedAt:r.published_at.toISOString(),admittedAt:r.section_admitted_at.toISOString() }));
}

/** Stale text, changed event identity or a withdrawn citation never survives a report read/review. */
export async function currentSectionDailyEntries(sectionId:SectionId,entries:SectionDailyEntryData[],db:Db=sql) {
  requireSectionId(sectionId);
  if(sectionId==='ai') throw new Error('use the legacy AI daily entry point');
  const ids=entries.map(e=>e.itemId);
  if(!ids.length) return [];
  const rows=await db<{ item_id:string;analysis_id:number;story_public_id:string|null;title:string;summary:string;
    source_name:string;url:string;category:string;reason:string|null }[]>`
    SELECT p.article_id AS item_id,p.analysis_id,st.public_id::text AS story_public_id,p.title,p.summary,s.name AS source_name,p.url,p.category,p.reason
    FROM publications p JOIN sources s ON s.id=p.source_id AND s.section_id=p.section_id
    LEFT JOIN stories st ON st.id=p.story_id AND st.section_id=p.section_id AND st.merged_into IS NULL
    WHERE p.article_id IN ${db(ids)} AND ${listedCondition(new Date(),sectionId)}`;
  const byId=new Map(rows.map(r=>[r.item_id,r]));
  return entries.flatMap(entry=>{
    const current=byId.get(entry.itemId);
    if(!current || current.analysis_id!==entry.analysisId || current.story_public_id!==entry.storyPublicId
      || current.title!==entry.title || current.summary!==entry.summary || current.reason!==entry.reason || current.category!==entry.category) return [];
    return [{ ...entry,sourceName:publicSourceName(current.source_name),originalUrl:current.url }];
  });
}

export async function sectionDaily(sectionId:SectionId,date:string) {
  requireSectionId(sectionId);SectionDailyDate.parse(date);
  if(sectionId==='ai') throw new Error('use the legacy AI daily entry point');
  // A withdrawn newer approved issue must not silently fall back to an earlier approved version.
  const [row]=await sql<{ revision:number;status:string;content:unknown;approved_at:Date }[]>`
    SELECT revision,status,content,approved_at FROM section_daily_revisions
    WHERE section_id=${sectionId} AND edition_date=${date} AND approved_at IS NOT NULL ORDER BY revision DESC LIMIT 1`;
  if(!row || row.status!=='approved') return null;
  const content=SectionDailyContent.parse(row.content);
  const current=await currentSectionDailyEntries(sectionId,[...content.focus,...content.flashes]);
  const byId=new Map(current.map(entry=>[entry.itemId,entry]));
  const focus=content.focus.flatMap(e=>byId.has(e.itemId) ? [byId.get(e.itemId)!] : []);
  const flashes=content.flashes.flatMap(e=>byId.has(e.itemId) ? [byId.get(e.itemId)!] : []);
  const publicEntry=({ analysisId:_analysisId,sourceId:_sourceId,...entry }:SectionDailyEntryData)=>entry;
  return { sectionId,date,revision:row.revision,approvedAt:row.approved_at.toISOString(),status:focus.length+flashes.length ? 'ready' : 'no-qualified-content',
    focus:focus.map(publicEntry),flashes:flashes.map(publicEntry) };
}
