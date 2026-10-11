import { requireSectionId,type SectionId } from '@aihot/contracts/sections';
import { sql } from '../db.ts';
import { sectionContext } from '../sections/context.ts';
import { sectionHotReports } from '../publication/section-hot.ts';
import { rankSectionHot } from './section-hot-rank.ts';
import { audit } from '../audit.ts';

export async function computeSectionHot(sectionId:SectionId,actor:string,at=new Date()) {
  requireSectionId(sectionId);
  if(sectionId==='ai') throw new Error('use the legacy AI hot entry point');
  if(!actor.trim() || !Number.isFinite(at.getTime())) throw new Error('invalid section hot generation');
  const rules=sectionContext(sectionId),policy=rules.hot;
  if(!policy) throw new Error('section hot policy is missing');
  const published=rules.selection.thresholds!==null && rules.selection.understandFloor!==null;
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`section-hot:${sectionId}`},0))`;
    const reports=await sectionHotReports(sectionId,at,tx),entries=rankSectionHot(reports,policy,at);
    const [saved]=await tx<{ id:number }[]>`INSERT INTO hot_rankings (section_id,computed_at,rule_version,entries,evidence,published)
      VALUES (${sectionId},${at},${policy.version},${tx.json(entries as never)},
        ${tx.json({ ...policy,readableEvidenceRows:reports.length,rankedReports:entries.reduce((sum,entry)=>sum+entry.reportCount,0),
          heatMeaning:'configured-source coverage, not whole-web popularity or independent confirmation' })},${published}) RETURNING id`;
    const result={ sectionId,id:Number(saved!.id),status:published ? 'ready' : 'draft',entries:entries.length };
    await audit(actor,'section.hot.generate',`${sectionId}:hot`,null,null,result,{ db:tx });
    return result;
  });
}
