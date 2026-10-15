// Optional run-total monetary ceiling, independent of rolling request budgets.
import { z } from 'zod';
import { sql,type Db } from '../db.ts';
import type { SectionId } from '@aihot/contracts/sections';

export const SectionMoneyPolicy=z.strictObject({ limitCny:z.number().positive(),startedAt:z.iso.datetime(),
  service:z.string().min(1),model:z.string().min(1),endpointHost:z.string().min(1),
  inputPerMillionCny:z.number().positive(),outputPerMillionCny:z.number().positive(),reference:z.url() });

export async function sectionMoneyPolicy(sectionId:SectionId,db:Db=sql) {
  if(sectionId==='ai') return null;
  const [row]=await db<{ value:unknown }[]>`SELECT value FROM settings WHERE key=${`sections.${sectionId}.spend`}`;
  return row ? SectionMoneyPolicy.parse(row.value) : null;
}

export async function dailyMoneyPolicy(db:Db=sql) {
  const [row]=await db<{ value:unknown }[]>`SELECT value FROM settings WHERE key='providers.daily_spend'`;
  if(!row) return null;
  const policy=SectionMoneyPolicy.parse(row.value);
  if(Date.parse(policy.startedAt)>Date.now()) throw new Error('daily monetary policy cannot start in the future');
  return policy;
}

/** Text-only ceiling: count UTF-8 input bytes as tokens, plus chat framing overhead. */
export async function reserveSectionModelCost(sectionId:SectionId|undefined,
  input:{ service:string;model:string;endpoint:string;system:string;user:string;maxTokens:number }) {
  const policies=[await dailyMoneyPolicy(),await sectionMoneyPolicy(sectionId ?? 'ai')].filter(policy=>policy!==null);
  if(!policies.length) return undefined;
  if(!Number.isSafeInteger(input.maxTokens) || input.maxTokens<=0) throw new Error('monetary ceiling requires bounded output tokens');
  const inputCeiling=Buffer.byteLength(input.system,'utf8')+Buffer.byteLength(input.user,'utf8')+4096;
  return Math.max(...policies.map(policy=>{
    if(input.service!==policy.service || input.model!==policy.model || new URL(input.endpoint).hostname!==policy.endpointHost)
      throw new Error('section monetary policy does not cover this provider/model/endpoint');
    return Math.ceil((inputCeiling*policy.inputPerMillionCny+input.maxTokens*policy.outputPerMillionCny)/1e6*100)/100;
  }));
}

export async function dailyMoneyRetryAfter(db:Db,service:string,model:string|null|undefined,reservation:number|undefined) {
  const policy=await dailyMoneyPolicy(db);
  if(!policy) return null;
  await db`SELECT pg_advisory_xact_lock(hashtext('providers.daily_spend'))`;
  if(service!==policy.service || model!==policy.model || !Number.isFinite(reservation) || reservation!<=0)
    throw new Error('daily monetary ceiling requires a covered, bounded paid request');
  const [usage]=await db<{ reserved:number;unbounded:number;retry:number }[]>`
    SELECT coalesce(sum(CASE WHEN a.status='received' AND a.usage->>'prompt_tokens' ~ '^[0-9]+$'
      AND a.usage->>'completion_tokens' ~ '^[0-9]+$'
      THEN ceil((a.usage->>'prompt_tokens')::numeric*${policy.inputPerMillionCny}
        +(a.usage->>'completion_tokens')::numeric*${policy.outputPerMillionCny})/1000000
      ELSE (r.request->>'reservedCostCny')::numeric END),0)::float8 AS reserved,
      count(*) FILTER (WHERE r.request->>'reservedCostCny' IS NULL)::int AS unbounded,
      ceil(extract(epoch FROM ((date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 day')
        AT TIME ZONE 'Asia/Shanghai'-now())))::int AS retry
    FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
    WHERE a.origin='live' AND a.started_at>=greatest(${new Date(policy.startedAt)},
      date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')
      AND a.started_at<(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 day') AT TIME ZONE 'Asia/Shanghai'`;
  return usage!.unbounded || usage!.reserved+reservation!>policy.limitCny+1e-9 ? Math.max(1,usage!.retry) : null;
}

export async function checkSectionMoney(db:Db,sectionId:SectionId,service:string,model:string|null|undefined,reservation:number|undefined) {
  const policy=await sectionMoneyPolicy(sectionId,db);
  if(!policy) return;
  await db`SELECT pg_advisory_xact_lock(hashtext(${`section-money:${sectionId}`}))`;
  if(service!==policy.service || model!==policy.model || !Number.isFinite(reservation) || reservation!<=0)
    throw new Error('section monetary ceiling requires a covered, bounded paid request');
  const [usage]=await db<{ reserved:number;unbounded:number }[]>`
    SELECT coalesce(sum((r.request->>'reservedCostCny')::numeric),0)::float8 AS reserved,
      count(*) FILTER (WHERE r.request->>'reservedCostCny' IS NULL)::int AS unbounded
    FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
    WHERE r.section_id=${sectionId} AND a.origin='live' AND a.started_at>=${new Date(policy.startedAt)}`;
  if(usage!.unbounded || usage!.reserved+reservation!>policy.limitCny+1e-9)
    throw Object.assign(new Error(`Section ${sectionId} monetary ceiling exhausted or unbounded (${policy.limitCny} CNY)`),{ code:'conflict' });
}
