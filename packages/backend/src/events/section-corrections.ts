// Manual section changes share the automatic grouping lock and commit projection/audit atomically.
import { requireSectionId,type SectionId } from '@aihot/contracts/sections';
import { SectionGroupingCorrection,SectionStoryMerge,type SectionGroupingCorrectionInput,type SectionStoryMergeInput } from '@aihot/contracts/section-events';
import { sql,type Tx } from '../db.ts';
import { audit,Conflict } from '../audit.ts';
import { assertSectionResource } from '../sections/resources.ts';
import { sectionContext } from '../sections/context.ts';
import { projectSectionArticleTx } from '../publication/section-publish.ts';
import { stableJson } from '../lib/ids.ts';

function context(sectionId:SectionId,actor:string) {
  requireSectionId(sectionId);
  if(sectionId==='ai') throw new Error('use the legacy AI correction entry point');
  sectionContext(sectionId);
  if(!actor.trim()) throw new Error('correction requires actor');
}
export interface SectionCorrectionResult { sectionId:SectionId;articleId:string;action:string;jobId:string|null;factId:number|null;storyId:number|null }
type QueueGroup=(tx:Tx,articleId:string,requestId:string)=>Promise<string|null>;

export async function correctSectionGrouping(sectionId:SectionId,articleId:string,raw:SectionGroupingCorrectionInput,actor:string,queueGroup?:QueueGroup) {
  context(sectionId,actor);const input=SectionGroupingCorrection.parse(raw);
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`group-section:${sectionId}`},0))`;
    await tx`SELECT id FROM articles WHERE section_id=${sectionId} AND id=${articleId} FOR UPDATE`;
    await assertSectionResource(tx,sectionId,{ kind:'article',id:articleId });
    const subject=`${sectionId}:content:${articleId}`,action=`section.grouping.${input.action}`;
    const [prior]=await tx<{ after:{ input:SectionGroupingCorrectionInput;result:SectionCorrectionResult } }[]>`
      SELECT after FROM audit_log WHERE subject=${subject} AND action=${action} AND actor=${actor}
        AND request_id=${input.requestId} ORDER BY id LIMIT 1`;
    if(prior) {
      if(stableJson(prior.after.input)!==stableJson(input)) throw new Conflict('request id already used for another correction');
      return prior.after.result;
    }
    const [article]=await tx<{ revision:number;source_id:string;published_at:Date|null }[]>`
      SELECT revision,source_id,published_at FROM articles WHERE section_id=${sectionId} AND id=${articleId}`;
    if(article!.revision!==input.revision) throw new Conflict('article revision changed');
    const before=await tx`SELECT fact_id,role,manual FROM fact_articles WHERE section_id=${sectionId} AND article_id=${articleId}`;
    const previousStories=await tx<{ story_id:number }[]>`SELECT DISTINCT f.story_id FROM facts f JOIN fact_articles fa
      ON fa.fact_id=f.id AND fa.section_id=f.section_id WHERE fa.section_id=${sectionId} AND fa.article_id=${articleId} AND f.story_id IS NOT NULL`;
    let factId:number|null=null,storyId:number|null=null,jobId:string|null=null;
    if(input.action==='detach') {
      await tx`DELETE FROM fact_articles WHERE section_id=${sectionId} AND article_id=${articleId}`;
      await tx`DELETE FROM story_signals WHERE section_id=${sectionId} AND article_id=${articleId}`;
      await tx`INSERT INTO grouping_overrides (article_id,reason,actor) VALUES (${articleId},${input.reason},${actor})
        ON CONFLICT (article_id) DO UPDATE SET reason=EXCLUDED.reason,actor=EXCLUDED.actor,created_at=now()`;
    } else if(input.action==='move') {
      const [target]=await tx<{ id:number;story_id:number }[]>`SELECT f.id,f.story_id FROM facts f
        JOIN stories st ON st.id=f.story_id AND st.section_id=f.section_id
        WHERE f.section_id=${sectionId} AND f.public_id=${input.factPublicId} AND st.merged_into IS NULL FOR SHARE OF f,st`;
      if(!target) throw new Conflict('target fact is missing, outside this section or merged');
      const [analysis]=await tx<{ relevance:string;output:{ scope?:string;contentType?:string;fact?:unknown } }[]>`
        SELECT relevance,output FROM analyses WHERE section_id=${sectionId} AND article_id=${articleId}
          AND input_revision=${input.revision} ORDER BY id DESC LIMIT 1`;
      if(!analysis || analysis.relevance!=='pass') throw new Conflict('current analysis is not ready');
      const report=analysis.output.scope==='single' && !!analysis.output.fact
        && ['news_report','institutional_statement'].includes(analysis.output.contentType ?? '');
      // A comment can be attached as a mention, never promoted into proof of an occurrence.
      await tx`DELETE FROM fact_articles WHERE section_id=${sectionId} AND article_id=${articleId}
        AND (role IN ('primary','report') OR fact_id=${target.id})`;
      await tx`DELETE FROM grouping_overrides WHERE article_id=${articleId}`;
      await tx`INSERT INTO fact_articles (section_id,fact_id,article_id,role,manual,created_at)
        VALUES (${sectionId},${target.id},${articleId},${report ? 'report' : 'mention'},true,${article!.published_at ?? new Date()})`;
      await tx`DELETE FROM story_signals WHERE section_id=${sectionId} AND article_id=${articleId}`;
      if(report && article!.published_at) await tx`INSERT INTO story_signals (section_id,story_id,article_id,source_id,participant_key,kind,observed_at)
        VALUES (${sectionId},${target.story_id},${articleId},${article!.source_id},${`source:${article!.source_id}`},'editorial',${article!.published_at})`;
      factId=target.id;storyId=target.story_id;
    } else {
      if(!queueGroup) throw new Error('section grouping queue is missing');
      await tx`DELETE FROM grouping_overrides WHERE article_id=${articleId}`;
      await tx`DELETE FROM fact_articles WHERE section_id=${sectionId} AND article_id=${articleId} AND NOT manual`;
      await tx`DELETE FROM story_signals WHERE section_id=${sectionId} AND article_id=${articleId}
        AND NOT EXISTS (SELECT 1 FROM fact_articles fa JOIN facts f ON f.id=fa.fact_id AND f.section_id=fa.section_id
          WHERE fa.section_id=${sectionId} AND fa.article_id=${articleId} AND fa.manual AND fa.role IN ('primary','report')
            AND f.story_id=story_signals.story_id)`;
      const [manual]=await tx<{ fact_id:number;story_id:number }[]>`SELECT fa.fact_id,f.story_id FROM fact_articles fa
        JOIN facts f ON f.id=fa.fact_id AND f.section_id=fa.section_id
        WHERE fa.section_id=${sectionId} AND fa.article_id=${articleId} AND fa.manual ORDER BY fa.fact_id LIMIT 1`;
      if(manual) { factId=manual.fact_id;storyId=manual.story_id; }
      else jobId=await queueGroup(tx,articleId,input.requestId);
    }
    const pending=input.action==='regroup' && factId===null;
    await tx`UPDATE articles SET grouping_status=${pending ? 'pending' : 'complete'},grouped_at=${pending ? null : new Date()},
      grouping_receipt_id=NULL,grouping_error=NULL WHERE section_id=${sectionId} AND id=${articleId}`;
    const affected=[...new Set([...previousStories.map(r=>r.story_id),...(storyId ? [storyId] : [])])];
    if(affected.length) await tx`UPDATE stories st SET (first_report_at,latest_at)=(
      SELECT min(a.published_at),max(a.published_at) FROM facts f JOIN fact_articles fa ON fa.fact_id=f.id AND fa.section_id=f.section_id
        JOIN articles a ON a.id=fa.article_id AND a.section_id=fa.section_id
      WHERE f.section_id=st.section_id AND f.story_id=st.id AND fa.role IN ('primary','report')),
      version=version+1,updated_at=now() WHERE st.section_id=${sectionId} AND st.id=ANY(${affected}::bigint[])`;
    await projectSectionArticleTx(tx,sectionId,articleId);
    const result:SectionCorrectionResult={ sectionId,articleId,action:input.action,jobId,factId,storyId };
    await audit(actor,action,subject,input.reason,before,{ input,result },{ requestId:input.requestId,db:tx });
    return result;
  });
}

export async function mergeSectionStories(sectionId:SectionId,fromId:number,raw:SectionStoryMergeInput,actor:string) {
  context(sectionId,actor);const input=SectionStoryMerge.parse(raw);
  if(!Number.isSafeInteger(fromId) || fromId<=0 || fromId===input.intoId) throw new Conflict('invalid story merge');
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`group-section:${sectionId}`},0))`;
    const subject=`${sectionId}:story:${fromId}`;
    const [prior]=await tx<{ after:{ input:SectionStoryMergeInput;result:{ sectionId:SectionId;intoId:number;moved:number } } }[]>`
      SELECT after FROM audit_log WHERE subject=${subject} AND action='section.story.merge' AND actor=${actor}
        AND request_id=${input.requestId} ORDER BY id LIMIT 1`;
    // Revalidate both identities even when recovering an already committed request.
    for(const id of [fromId,input.intoId]) await assertSectionResource(tx,sectionId,{ kind:'story',id });
    if(prior) {
      if(stableJson(prior.after.input)!==stableJson(input)) throw new Conflict('request id already used for another merge');
      return prior.after.result;
    }
    const rows=await tx<{ id:number;public_id:string;version:number;merged_into:number|null }[]>`
      SELECT id,public_id,version,merged_into FROM stories WHERE section_id=${sectionId}
        AND id IN (${fromId},${input.intoId}) ORDER BY id`;
    const from=rows.find(r=>r.id===fromId)!,into=rows.find(r=>r.id===input.intoId)!;
    if(from.merged_into || into.merged_into || from.version!==input.fromVersion || into.version!==input.intoVersion)
      throw new Conflict('stories changed or already merged');
    const articles=await tx<{ id:string;moved:boolean }[]>`SELECT a.id,bool_or(f.story_id=${fromId}) AS moved FROM articles a JOIN fact_articles fa
      ON fa.article_id=a.id AND fa.section_id=a.section_id JOIN facts f ON f.id=fa.fact_id AND f.section_id=fa.section_id
      WHERE a.section_id=${sectionId} AND f.story_id IN (${fromId},${input.intoId}) GROUP BY a.id ORDER BY a.id`;
    await tx`SELECT id FROM articles WHERE section_id=${sectionId} AND id=ANY(${articles.map(r=>r.id)}::text[]) ORDER BY id FOR UPDATE`;
    // Projection locks articles before reading stories; retain that order here too.
    await tx`SELECT id FROM stories WHERE section_id=${sectionId} AND id IN (${fromId},${input.intoId}) ORDER BY id FOR UPDATE`;
    await tx`UPDATE facts SET story_id=${input.intoId},version=version+1,updated_at=now() WHERE section_id=${sectionId} AND story_id=${fromId}`;
    await tx`INSERT INTO story_signals (section_id,story_id,article_id,participant_key,source_id,kind,observed_at)
      SELECT section_id,${input.intoId},article_id,participant_key,source_id,kind,observed_at FROM story_signals
        WHERE section_id=${sectionId} AND story_id=${fromId} ON CONFLICT (story_id,article_id) DO NOTHING`;
    await tx`DELETE FROM story_signals WHERE section_id=${sectionId} AND story_id=${fromId}`;
    await tx`INSERT INTO story_links (section_id,story_id,other_id,relation)
      SELECT section_id,CASE WHEN story_id=${fromId} THEN ${input.intoId} ELSE story_id END,
        CASE WHEN other_id=${fromId} THEN ${input.intoId} ELSE other_id END,relation FROM story_links
      WHERE section_id=${sectionId} AND (story_id=${fromId} OR other_id=${fromId})
        AND NOT (story_id IN (${fromId},${input.intoId}) AND other_id IN (${fromId},${input.intoId}))
      ON CONFLICT (story_id,other_id) DO NOTHING`;
    await tx`DELETE FROM story_links WHERE section_id=${sectionId} AND (story_id=${fromId} OR other_id=${fromId})`;
    await tx`UPDATE stories SET merged_into=${input.intoId},origin='manual',version=version+1,updated_at=now()
      WHERE section_id=${sectionId} AND id=${fromId}`;
    await tx`UPDATE stories SET origin='manual',version=version+1,updated_at=now(),
      latest_at=greatest(latest_at,(SELECT latest_at FROM stories WHERE id=${fromId} AND section_id=${sectionId})),
      first_report_at=least(first_report_at,(SELECT first_report_at FROM stories WHERE id=${fromId} AND section_id=${sectionId}))
      WHERE section_id=${sectionId} AND id=${input.intoId}`;
    // Aliases inherit the destination's ownership; never resolve them without checking that story.
    await tx`UPDATE story_aliases SET story_id=${input.intoId} WHERE story_id=${fromId}`;
    await tx`INSERT INTO story_aliases (public_id,story_id) VALUES (${from.public_id},${input.intoId}) ON CONFLICT DO NOTHING`;
    for(const article of articles) await projectSectionArticleTx(tx,sectionId,article.id);
    const result={ sectionId,intoId:input.intoId,moved:articles.filter(r=>r.moved).length };
    await audit(actor,'section.story.merge',subject,input.reason,rows,{ input,result },{ requestId:input.requestId,db:tx });
    return result;
  });
}
