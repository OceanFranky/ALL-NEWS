import { requireSectionId,type SectionId } from '@aihot/contracts/sections';
import { z } from 'zod';
import { sql } from '../db.ts';
import { sectionContext } from '../sections/context.ts';
import { SECTION_MODEL_STEPS,type SectionModelStep } from '../sections/rules.ts';
import { sectionModelFor,invalidateModelCache } from '../editorial/models.ts';
import { MODELS } from '../providers/llm.ts';
import { sectionModelUsage } from './models.ts';
import { audit } from '../audit.ts';

export const SectionModelSwitch=z.strictObject({ model:z.string().min(1).max(100).nullable(),reason:z.string().trim().min(1).max(1000) });
function rulesFor(sectionId:SectionId) {
  requireSectionId(sectionId);
  if(sectionId==='ai') throw new Error('use the legacy AI model configuration entry point');
  return sectionContext(sectionId);
}
export async function sectionModelsOverview(sectionId:SectionId,days=7) {
  const rules=rulesFor(sectionId);
  if(!Number.isSafeInteger(days) || days<1 || days>90) throw new Error('invalid model usage days');
  const prefix=`sections.${sectionId}.models.`;
  const [settings,usage,history]=await Promise.all([
    sql<{ key:string }[]>`SELECT key FROM settings WHERE key LIKE ${prefix+'%'}`,
    sectionModelUsage(sectionId,new Date(Date.now()-days*86400000)),
    sql`SELECT created_at AS at,actor,subject,reason,before,after FROM audit_log WHERE action='section.models.switch'
      AND subject LIKE ${`${sectionId}:model:%`} ORDER BY created_at DESC,id DESC LIMIT 30`,
  ]);
  const capabilities=await Promise.all(SECTION_MODEL_STEPS.map(async step=>({ key:step,defaultModel:rules.models[step],
    current:{ model:await sectionModelFor(rules,step),source:settings.some(s=>s.key===prefix+step) ? 'admin' : 'section-default' } })));
  return { sectionId,days,capabilities,choices:Object.values(MODELS).map(m=>({ key:m.key,service:m.service,vision:!!m.vision })),
    usage:usage.map(u=>({ purpose:u.purpose,model:u.model,promptVersion:u.prompt_version,calls:u.calls,ok:u.ok,failed:u.failed,
      unknown:u.unknown,p50:u.p50,p95:u.p95,tokensIn:Number(u.tokens_in ?? 0),tokensOut:Number(u.tokens_out ?? 0),
      actualCost:u.actual_cost===null ? null : Number(u.actual_cost),currency:u.currency })),history };
}
export async function switchSectionModel(sectionId:SectionId,step:SectionModelStep,raw:z.infer<typeof SectionModelSwitch>,actor:string) {
  const rules=rulesFor(sectionId),input=SectionModelSwitch.parse(raw);
  z.enum(SECTION_MODEL_STEPS).parse(step);
  if(!actor.trim()) throw new Error('model switch requires actor');
  if(input.model!==null && !MODELS[input.model]) throw Object.assign(new Error('unknown model'),{ statusCode:400 });
  const key=`sections.${sectionId}.models.${step}`;
  const result=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const [before]=await tx<{ value:{ model:string } }[]>`SELECT value FROM settings WHERE key=${key}`;
    if(input.model===null) await tx`DELETE FROM settings WHERE key=${key}`;
    else await tx`INSERT INTO settings (key,value,updated_by) VALUES (${key},${tx.json({ model:input.model })},${actor})
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    const result={ sectionId,step,before:before?.value.model ?? rules.models[step],after:input.model ?? rules.models[step] };
    await audit(actor,'section.models.switch',`${sectionId}:model:${step}`,input.reason,before?.value ?? null,{ model:result.after },{ db:tx });
    return result;
  });
  invalidateModelCache();return result;
}
