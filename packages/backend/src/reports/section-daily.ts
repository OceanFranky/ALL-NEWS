import { requireSectionId,type SectionId } from "@aihot/contracts/sections";
import { SectionDailyContent,SectionDailyDate,SectionDailyPolicy,type SectionDailyPolicyInput,type SectionDailyEntryData,type SectionDailyContentData } from "@aihot/contracts/section-daily";
import { sql } from "../db.ts";
import { audit,Conflict } from "../audit.ts";
import { sectionContext } from "../sections/context.ts";
import { sectionDailyCandidates,currentSectionDailyEntries } from "../publication/section-daily.ts";
import { stableJson } from "../lib/ids.ts";

interface DailyRevision {
  id:number;revision:number;status:'draft'|'approved'|'withdrawn';content:SectionDailyContentData;
  generated_by:string;generated_at:Date;approved_by:string|null;approved_at:Date|null;
}

function validate(sectionId:SectionId,date:string) {
  requireSectionId(sectionId);SectionDailyDate.parse(date);
  if(sectionId==='ai') throw new Error('use the legacy AI daily entry point');
  sectionContext(sectionId);
}
const eventKey=(entry:SectionDailyEntryData)=>entry.storyPublicId ? `story:${entry.storyPublicId}` : `article:${entry.itemId}`;

/** Keep the highest-scored report per event; an alternate source may lead when the first is capped. */
export function arrangeSectionDaily(entries:SectionDailyEntryData[],policy:SectionDailyPolicyInput) {
  SectionDailyPolicy.parse(policy);
  const groups=new Map<string,SectionDailyEntryData[]>();
  const ranked=[...entries].sort((a,b)=>(b.score ?? -1)-(a.score ?? -1) || b.publishedAt.localeCompare(a.publishedAt) || a.itemId.localeCompare(b.itemId));
  for(const entry of ranked) {
    const key=eventKey(entry);
    groups.set(key,[...groups.get(key) ?? [],entry]);
  }
  const focus:SectionDailyEntryData[]=[],flashes:SectionDailyEntryData[]=[];
  const used=new Set<string>(),sources=new Map<string,number>();
  for(const [key,reports] of groups) {
    if(focus.length>=policy.focusLimit) break;
    const entry=reports.find(e=>(sources.get(e.sourceId) ?? 0)<policy.maxFocusPerSource);
    if(!entry) continue;
    focus.push(entry);used.add(key);sources.set(entry.sourceId,(sources.get(entry.sourceId) ?? 0)+1);
  }
  for(const [key,reports] of groups) {
    if(flashes.length>=policy.flashLimit) break;
    if(!used.has(key)) flashes.push(reports[0]!);
  }
  return { focus,flashes };
}

export async function generateSectionDaily(sectionId:SectionId,date:string,policy:SectionDailyPolicyInput,actor:string) {
  validate(sectionId,date);SectionDailyPolicy.parse(policy);
  if(!actor.trim()) throw new Error('daily generation requires actor');
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`daily:${sectionId}:${date}`},0))`;
    const entries=await sectionDailyCandidates(sectionId,date,tx);
    const issue=arrangeSectionDaily(entries,policy);
    const content=SectionDailyContent.parse({ date,policy,...issue,status:issue.focus.length+issue.flashes.length ? 'ready' : 'no-qualified-content' });
    const [latest]=await tx<{ revision:number }[]>`SELECT coalesce(max(revision),0)::int AS revision FROM section_daily_revisions
      WHERE section_id=${sectionId} AND edition_date=${date}`;
    const [row]=await tx<DailyRevision[]>`INSERT INTO section_daily_revisions (section_id,edition_date,revision,content,generated_by)
      VALUES (${sectionId},${date},${latest!.revision+1},${tx.json(content)},${actor}) RETURNING *`;
    await audit(actor,'section.daily.generate',`${sectionId}:daily:${date}`,null,null,{ revision:row!.revision,entries:issue.focus.length+issue.flashes.length },{ db:tx });
    return row!;
  });
}

export async function listSectionDailyRevisions(sectionId:SectionId,date:string) {
  validate(sectionId,date);
  return sql<DailyRevision[]>`SELECT id,revision,status,content,generated_by,generated_at,approved_by,approved_at FROM section_daily_revisions
    WHERE section_id=${sectionId} AND edition_date=${date} ORDER BY revision DESC`;
}

export async function refreshSectionDaily(sectionId:SectionId,date:string,policy:SectionDailyPolicyInput,actor:string) {
  validate(sectionId,date);SectionDailyPolicy.parse(policy);
  if(!actor.trim()) throw new Error('daily generation requires actor');
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`daily:${sectionId}:${date}`},0))`;
    const [previous]=await tx<DailyRevision[]>`SELECT id,revision,status,content FROM section_daily_revisions
      WHERE section_id=${sectionId} AND edition_date=${date} AND approved_at IS NOT NULL ORDER BY revision DESC LIMIT 1`;
    if(previous?.status==='withdrawn') return { sectionId,date,status:'withdrawn' as const,revision:previous.revision,changed:false };
    const entries=await sectionDailyCandidates(sectionId,date,tx);
    const issue=arrangeSectionDaily(entries,policy);
    const content=SectionDailyContent.parse({ date,policy,...issue,status:issue.focus.length+issue.flashes.length ? 'ready' : 'no-qualified-content' });
    if(previous && stableJson(previous.content)===stableJson(content))
      return { sectionId,date,status:'unchanged' as const,revision:previous.revision,changed:false };
    const [latest]=await tx<{ revision:number }[]>`SELECT coalesce(max(revision),0)::int AS revision FROM section_daily_revisions
      WHERE section_id=${sectionId} AND edition_date=${date}`;
    const [row]=await tx<{ revision:number }[]>`INSERT INTO section_daily_revisions
      (section_id,edition_date,revision,status,content,generated_by,approved_by,approved_at)
      VALUES (${sectionId},${date},${latest!.revision+1},'approved',${tx.json(content)},${actor},${actor},now()) RETURNING revision`;
    await audit(actor,'section.daily.auto-publish',`${sectionId}:daily:${date}`,'Automatic model-free daily refresh',
      previous ? { revision:previous.revision } : null,
      { revision:row!.revision,focus:issue.focus.length,flashes:issue.flashes.length },{ db:tx });
    return { sectionId,date,status:content.status,revision:row!.revision,changed:true };
  });
}

export async function reviewSectionDaily(sectionId:SectionId,date:string,
  review:{ revision:number;action:'approve'|'withdraw';actor:string;reason:string }) {
  validate(sectionId,date);
  if(!Number.isSafeInteger(review.revision) || review.revision<1 || !['approve','withdraw'].includes(review.action)
    || !review.actor.trim() || !review.reason.trim()) throw new Error('invalid daily review');
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`daily:${sectionId}:${date}`},0))`;
    const [row]=await tx<{ id:number;status:string;content:unknown }[]>`SELECT id,status,content FROM section_daily_revisions
      WHERE section_id=${sectionId} AND edition_date=${date} AND revision=${review.revision} FOR UPDATE`;
    if(!row) throw new Conflict('daily revision not found');
    if(review.action==='approve') {
      if(row.status!=='draft') throw new Conflict('only a draft can be approved');
      const [later]=await tx`SELECT 1 FROM section_daily_revisions WHERE section_id=${sectionId} AND edition_date=${date}
        AND revision>${review.revision} AND approved_at IS NOT NULL LIMIT 1`;
      if(later) throw new Conflict('a newer daily revision was already approved');
      const content=SectionDailyContent.parse(row.content),entries=[...content.focus,...content.flashes];
      const current=await currentSectionDailyEntries(sectionId,entries,tx);
      if(current.length!==entries.length) throw new Conflict('daily contains withdrawn or changed material; regenerate the draft');
      await tx`UPDATE section_daily_revisions SET status='approved',approved_by=${review.actor},approved_at=now() WHERE id=${row.id} AND section_id=${sectionId}`;
    } else {
      await tx`UPDATE section_daily_revisions SET status='withdrawn' WHERE id=${row.id} AND section_id=${sectionId}`;
    }
    await audit(review.actor,`section.daily.${review.action}`,`${sectionId}:daily:${date}`,review.reason,
      { revision:review.revision,status:row.status },{ revision:review.revision,status:review.action==='approve' ? 'approved' : 'withdrawn' },{ db:tx });
    return { sectionId,date,revision:review.revision,status:review.action==='approve' ? 'approved' : 'withdrawn' };
  });
}
