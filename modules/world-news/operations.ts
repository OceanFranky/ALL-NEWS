import { z } from 'zod';
import { sql } from '@aihot/backend/db';
import { audit,Conflict } from '@aihot/backend/audit';
import { enqueueOn,getBoss } from '@aihot/backend/jobs/queue';
import { worldAnalysisQueue } from './jobs.ts';

export const WorldAnalysisRerun=z.strictObject({ revision:z.number().int().min(1),
  requestId:z.string().regex(/^[\w-]{8,80}$/),reason:z.string().trim().min(1).max(1000) });

/** An explicit new evaluation; recovery of an unknown paid request is a separate operation. */
export async function rerunWorldAnalysis(articleId:string,raw:unknown,actor:string) {
  const input=WorldAnalysisRerun.parse(raw);
  await getBoss();
  return sql.begin(async tx=>{
    const [article]=await tx<{ revision:number }[]>`SELECT revision FROM articles
      WHERE section_id='world' AND id=${articleId} FOR UPDATE`;
    if(!article) return null;
    const subject=`world:content:${articleId}`,action='section.content.rerun.analyze';
    const [prior]=await tx<{ reason:string;after:{ revision:number;jobId:string|null } }[]>`
      SELECT reason,after FROM audit_log WHERE subject=${subject} AND action=${action}
        AND actor=${actor} AND request_id=${input.requestId} ORDER BY id DESC LIMIT 1`;
    if(prior) {
      if(prior.reason!==input.reason || prior.after.revision!==input.revision) throw new Conflict('同一请求不能更改材料版本或操作原因');
      return { sectionId:'world',articleId,...prior.after };
    }
    if(article.revision!==input.revision) throw new Conflict('材料版本已改变，请刷新后重新核对');
    if(process.env.MODEL_CALLS_ENABLED!=='true') throw new Conflict('model-calls-disabled');
    const [unresolved]=await tx`SELECT id FROM receipts WHERE section_id='world' AND subject=${articleId}
      AND status IN ('pending','unknown') LIMIT 1`;
    if(unresolved) throw new Conflict('存在执行中或结果未知的付费回执，请先核对恢复，不重复付费重跑');
    const [running]=await tx`SELECT id FROM pgboss.job WHERE name IN ('world-news.analyze','world-news.group')
      AND state IN ('created','retry','active') AND data->>'sectionId'='world' AND data->>'articleId'=${articleId} LIMIT 1`;
    if(running) throw new Conflict('当前材料已有待执行或执行中的分析／归组任务');
    const jobId=await enqueueOn(worldAnalysisQueue,{ sectionId:'world',articleId,attemptTag:`admin:${input.requestId}` },
      { singletonKey:`world:article:${articleId}:${input.revision}:admin:${input.requestId}` },tx);
    await tx`UPDATE articles SET processing_state='new',processing_error=NULL,processing_attempts=0,
      processing_retry_at=NULL,processing_queued_at=now() WHERE section_id='world' AND id=${articleId}`;
    const result={ revision:input.revision,jobId };
    await audit(actor,action,subject,input.reason,{ revision:article.revision },result,{ requestId:input.requestId,db:tx });
    return { sectionId:'world',articleId,...result };
  });
}
