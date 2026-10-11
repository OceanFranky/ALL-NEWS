import { z } from 'zod';
import { sql } from '@aihot/backend/db';
import { audit,Conflict } from '@aihot/backend/audit';
import { enqueueOn,getBoss } from '@aihot/backend/jobs/queue';
import { worldAnalysisQueue,worldGroupQueue } from './jobs.ts';
import { releaseUnknownReceipt } from '@aihot/backend/providers/receipts';

export const WorldAnalysisRerun=z.strictObject({ revision:z.number().int().min(1),
  requestId:z.string().regex(/^[\w-]{8,80}$/),reason:z.string().trim().min(1).max(1000) });
export const WorldReceiptRelease=z.strictObject({ version:z.iso.datetime(),billed:z.boolean(),
  requestId:z.string().regex(/^[\w-]{8,80}$/),reason:z.string().trim().min(1).max(1000) });

/** Manual billing reconciliation; never release a world request through the legacy AI recovery. */
export async function releaseWorldReceipt(receiptId:number,raw:unknown,actor:string) {
  const input=WorldReceiptRelease.parse(raw);
  await getBoss();
  return sql.begin(async tx=>{
    const [identity]=await tx<{ subject:string|null }[]>`SELECT subject FROM receipts WHERE section_id='world' AND id=${receiptId}`;
    if(!identity?.subject) return null;
    const [article]=await tx<{ revision:number }[]>`SELECT revision FROM articles
      WHERE section_id='world' AND id=${identity.subject} FOR UPDATE`;
    if(!article) return null;
    const [receipt]=await tx<{ subject:string;purpose:string;status:string;updated_at:Date;
      request:{ resource?:{ kind:string;id:string };inputRevision?:number;attemptTag?:string|null } }[]>`
      SELECT subject,purpose,status,updated_at,request FROM receipts
      WHERE section_id='world' AND id=${receiptId} AND subject=${identity.subject} FOR UPDATE`;
    if(!receipt) return null;
    const subject=`world:receipt:${receiptId}`,action='section.receipt.release';
    const [prior]=await tx<{ reason:string;before:{ version:string;billed:boolean };after:{ jobId:string|null;queue:string } }[]>`
      SELECT reason,before,after FROM audit_log WHERE subject=${subject} AND action=${action}
      AND actor=${actor} AND request_id=${input.requestId} ORDER BY id DESC LIMIT 1`;
    if(prior) {
      if(prior.reason!==input.reason || prior.before.version!==input.version || prior.before.billed!==input.billed)
        throw new Conflict('同一恢复请求不能更改核对结果');
      return { sectionId:'world',receiptId,articleId:receipt.subject,...prior.after };
    }
    if(receipt.status!=='unknown') throw new Conflict('只有结果未知的回执需要人工核对');
    if(receipt.updated_at.toISOString()!==input.version) throw new Conflict('回执状态已改变，请刷新后核对');
    if(receipt.request.resource?.kind!=='article' || receipt.request.resource.id!==receipt.subject
      || receipt.request.inputRevision!==article.revision) throw new Conflict('回执缺少当前材料身份或版本，不能自动恢复此请求');
    const grouping=['world.group-pair','world.group-review'].includes(receipt.purpose);
    if(!grouping && !['world.prefilter','world.structure','world.score.1','world.score.2','world.understand'].includes(receipt.purpose))
      throw new Conflict('不支持的世界回执用途');
    const tag=receipt.request.attemptTag;
    if(tag!==null && (typeof tag!=='string' || !tag || tag.length>100)) throw new Conflict('回执缺少原始尝试身份');
    if(process.env.MODEL_CALLS_ENABLED!=='true') throw new Conflict('model-calls-disabled');
    const [running]=await tx`SELECT id FROM pgboss.job WHERE name IN ('world-news.analyze','world-news.group')
      AND state IN ('created','retry','active') AND data->>'sectionId'='world' AND data->>'articleId'=${receipt.subject} LIMIT 1`;
    if(running) throw new Conflict('原任务仍在排队或执行，请等待任务结束再核对恢复');
    await releaseUnknownReceipt(tx,receiptId,`人工核对：${input.billed?'供应商已计费但结果未取回':'供应商未计费'}。${input.reason}`,'world');
    const options={ singletonKey:`world:recover:${receiptId}:${input.requestId}` };
    const jobId=grouping ? await enqueueOn(worldGroupQueue,{ sectionId:'world',articleId:receipt.subject },options,tx)
      : await enqueueOn(worldAnalysisQueue,{ sectionId:'world',articleId:receipt.subject,...(tag ? { attemptTag:tag } : {}) },options,tx);
    if(!grouping) await tx`UPDATE articles SET processing_state='new',processing_error=NULL,processing_retry_at=NULL,
      processing_queued_at=now() WHERE section_id='world' AND id=${receipt.subject}`;
    const result={ jobId,queue:grouping?'world-news.group':'world-news.analyze' };
    await audit(actor,action,subject,input.reason,{ version:input.version,billed:input.billed,status:'unknown' },result,
      { requestId:input.requestId,db:tx });
    return { sectionId:'world',receiptId,articleId:receipt.subject,...result };
  });
}

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
