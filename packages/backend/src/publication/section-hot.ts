// Evidence reads stay behind publication scope, including permission and current revision checks.
import { requireSectionId,type SectionId } from '@aihot/contracts/sections';
import { sql,type Db } from '../db.ts';
import { sectionContext } from '../sections/context.ts';
import { listedCondition,evidenceCondition } from './scope.ts';
import { rankSectionHot,type SectionHotReport,type SectionHotEntry } from '../events/section-hot-rank.ts';

export async function sectionHotReports(sectionId:SectionId,at:Date,db:Db=sql):Promise<SectionHotReport[]> {
  requireSectionId(sectionId);
  if(sectionId==='ai') throw new Error('use the legacy AI hot entry point');
  const policy=sectionContext(sectionId).hot;
  if(!policy) throw new Error('section hot policy is missing');
  const from=db`FROM publications p JOIN sources s ON s.id=p.source_id AND s.section_id=p.section_id
    JOIN analyses an ON an.id=p.analysis_id AND an.section_id=p.section_id
    JOIN fact_articles fa ON fa.article_id=p.article_id AND fa.section_id=p.section_id
    JOIN facts f ON f.id=fa.fact_id AND f.section_id=fa.section_id
    JOIN stories st ON st.id=f.story_id AND st.section_id=f.section_id AND st.merged_into IS NULL`;
  const scope=db`${listedCondition(at,sectionId)} AND ${evidenceCondition()} AND NOT p.backfill AND p.published_at<=${at}`;
  // The window selects active events, not their importance ceiling. Older qualified evidence
  // of those same events may still hold the highest dual-score average.
  const active=await db<{ id:number }[]>`SELECT DISTINCT st.id ${from} WHERE ${scope}
    AND p.published_at>=${new Date(at.getTime()-policy.windowHours*3600000)}`;
  if(!active.length) return [];
  const rows=await db<{ article_id:string;analysis_id:number;story_id:number;story_public_id:string;story_title:string;
    source_id:string;participant_key:string;published_at:Date;progress_at:Date;scores:unknown;content_type:string }[]>`
    SELECT p.article_id,p.analysis_id,st.id AS story_id,st.public_id::text AS story_public_id,st.title AS story_title,
      p.source_id,coalesce('group:'||s.signal_group_id,'source:'||s.id) AS participant_key,p.published_at,
      coalesce(f.occurred_at,(SELECT min(original.published_at) FROM fact_articles membership
        JOIN articles original ON original.id=membership.article_id AND original.section_id=membership.section_id
        WHERE membership.fact_id=f.id AND membership.section_id=f.section_id AND membership.role IN ('primary','report'))) AS progress_at,
      an.output->'scores' AS scores,an.output->>'contentType' AS content_type
    ${from} WHERE ${scope} AND st.id=ANY(${active.map(r=>r.id)}::bigint[])`;
  return rows.map(r=>({ articleId:r.article_id,analysisId:r.analysis_id,storyId:Number(r.story_id),storyPublicId:r.story_public_id,
    storyTitle:r.story_title,sourceId:r.source_id,participantKey:r.participant_key,publishedAt:r.published_at.toISOString(),
    progressAt:r.progress_at?.toISOString() ?? '',scores:r.scores,contentType:r.content_type }));
}

/** Re-rank still-readable evidence, so withdrawal cannot leave stale heat or a dead representative. */
export async function currentSectionHot(sectionId:SectionId,at=new Date(),includeDraft=false) {
  requireSectionId(sectionId);
  if(sectionId==='ai') throw new Error('use the legacy AI hot entry point');
  const rules=sectionContext(sectionId),policy=rules.hot;
  if(!policy) throw new Error('section hot policy is missing');
  const calibrated=rules.selection.thresholds!==null && rules.selection.understandFloor!==null;
  if(!calibrated && !includeDraft) return { sectionId,status:'calibration-required',items:[] as SectionHotEntry[] };
  const [snapshot]=await sql<{ id:number;rule_version:string;entries:SectionHotEntry[];computed_at:Date;published:boolean }[]>`
    SELECT id,rule_version,entries,computed_at,published FROM hot_rankings WHERE section_id=${sectionId}
      ${includeDraft ? sql`` : sql`AND published`} ORDER BY computed_at DESC,id DESC LIMIT 1`;
  if(!snapshot) return { sectionId,status:'not-generated',items:[] as SectionHotEntry[] };
  if(snapshot.rule_version!==policy.version) return { sectionId,status:'regeneration-required',items:[] as SectionHotEntry[] };
  const stories=new Set(snapshot.entries.map(e=>e.storyId));
  const reports=(await sectionHotReports(sectionId,at)).filter(r=>stories.has(r.storyId));
  return { sectionId,status:calibrated && snapshot.published ? 'ready' : 'draft',id:snapshot.id,
    computedAt:snapshot.computed_at.toISOString(),items:rankSectionHot(reports,policy,at),
    heatMeaning:'configured-source coverage, not whole-web popularity or independent confirmation' };
}
