import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { sql,closeDb } from '@aihot/backend/db';
import { paidRequest,ProviderRejectedError,releaseUnknownReceipt } from '@aihot/backend/providers/receipts';
import { reserveSectionModelCost } from '@aihot/backend/providers/section-money';
import { chatJson } from '@aihot/backend/providers/llm';
import { z } from 'zod';

const T=tag(),source=`money-world-${T}`,service=`money-${T}`;
const policy={ limitCny:0.15,startedAt:new Date(0).toISOString(),service,model:'local-model',endpointHost:'fixture.invalid',
  inputPerMillionCny:2,outputPerMillionCny:8,reference:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/' };
const req=(identity:string,reservedCostCny:number|undefined=0.1)=>({ sectionId:'world' as const,
  resource:{ kind:'source' as const,id:source },service,model:'local-model',purpose:'test',identity,reservedCostCny });
before(async()=>{
  await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world',${source},'World','rss',false)`;
  await sql`INSERT INTO section_budgets VALUES ('world',${service},100,100,100)`;
  await sql`INSERT INTO settings (key,value) VALUES ('sections.world.spend',${sql.json(policy)})`;
});
after(closeDb);

test('world calls reject extras overriding the bounded model messages or output limit before network access',async()=>{
  const keys=['LLM_MODEL','LLM_BASE_URL','LLM_API_KEY','LLM_EXTRA_JSON'] as const;
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    process.env.LLM_MODEL='local-model';process.env.LLM_BASE_URL='https://fixture.invalid/v1';process.env.LLM_API_KEY='test-key';
    for(const extra of [{ model:'another' },{ max_tokens:1000000 },{ messages:[] }]) {
      process.env.LLM_EXTRA_JSON=JSON.stringify(extra);
      await assert.rejects(chatJson({ sectionId:'world',resource:{ kind:'source',id:source },model:'default',purpose:'test',
        subject:source,promptVersion:'test',system:'test',user:'test',schema:z.object({}),maxTokens:512 }),/overrides unbounded/);
    }
    assert.equal((await sql`SELECT 1 FROM receipts`).length,0);
  } finally { for(const k of keys) { if(old[k]===undefined) delete process.env[k];else process.env[k]=old[k]; } }
});

test('monetary reservation uses peak uncached input and bounded output, rejects uncovered provider and preserves AI',async()=>{
  const input={ service,model:'local-model',endpoint:'https://fixture.invalid/v1',system:'规则',user:'中文材料',maxTokens:1800 };
  const expected=Math.ceil(((Buffer.byteLength(input.system)+Buffer.byteLength(input.user)+4096)*2+1800*8)/1e6*100)/100;
  assert.equal(await reserveSectionModelCost('world',input),expected);
  await assert.rejects(reserveSectionModelCost('world',{ ...input,model:'another-model' }),/does not cover/);
  await assert.rejects(reserveSectionModelCost('world',{ ...input,endpoint:'https://other.invalid' }),/does not cover/);
  assert.equal(await reserveSectionModelCost('ai',input),undefined);
});

test('concurrent paid attempts cannot exceed run-total ceiling, reused answers reserve nothing and AI stays independent',async()=>{
  let calls=0;
  const call=async()=>({ response:++calls });
  const results=await Promise.allSettled(Array.from({ length:12 },(_,i)=>paidRequest(req(`concurrent-${i}`),call)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);
  const success=results.findIndex(r=>r.status==='fulfilled');
  assert.equal((await paidRequest(req(`concurrent-${success}`),call)).reused,true);assert.equal(calls,1);
  await paidRequest({ service,model:'local-model',purpose:'ai',identity:'separate' },call);assert.equal(calls,2);
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.section_id='world'`)[0]!.n,1);
});

test('missing price bounds reject before sending; unknown and failed attempts retain conservative reservations',async()=>{
  let calls=0;
  await assert.rejects(paidRequest({ ...req('unbounded'),reservedCostCny:undefined },async()=>{ calls++;return { response:true }; }),/monetary/);
  assert.equal(calls,0);
  await sql`UPDATE settings SET value=jsonb_set(value,'{limitCny}','0.25'::jsonb) WHERE key='sections.world.spend'`;
  await assert.rejects(paidRequest(req('unknown'),async()=>{ calls++;throw new Error('lost reply'); }),/lost reply/);
  const [unknown]=await sql`SELECT id FROM receipts WHERE subject IS NULL AND section_id='world' AND status='unknown'`;
  assert.ok(unknown);
  await releaseUnknownReceipt(sql,Number(unknown!.id),'Local bill checked','world');
  await assert.rejects(paidRequest(req('unknown'),async()=>{ calls++;return { response:true }; }),/monetary ceiling/);
  assert.equal(calls,1,'an unknown result still counts after release');
  await assert.rejects(paidRequest(req('refused',0.04),async()=>{ calls++;throw new ProviderRejectedError('refused',400,false); }),/refused/);
  await assert.rejects(paidRequest(req('refused',0.04),async()=>{ calls++;return { response:true }; }),/monetary ceiling/);
  assert.equal(calls,2,'failed attempts cannot escape the run-total ceiling on retry');
});
