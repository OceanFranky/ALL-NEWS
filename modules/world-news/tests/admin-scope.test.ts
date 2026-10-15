import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { sql,closeDb } from '@aihot/backend/db';
import { installModules } from '@aihot/backend/modules';
import { getBoss,enqueueOn,enqueue,QUEUES,stopBoss } from '@aihot/backend/jobs/queue';
import { runsOverview } from '@aihot/backend/admin/runs';
import { navCounts } from '@aihot/backend/admin/navigation';
import { sectionRunsOverview } from '@aihot/backend/admin/section-runs';
import { sectionModelsOverview,switchSectionModel } from '@aihot/backend/admin/section-models';
import { modelsOverview,sectionModelUsage,switchModel } from '@aihot/backend/admin/models';
import { sectionModelFor,modelFor } from '@aihot/backend/editorial/models';
import { sectionContext } from '@aihot/backend/sections/context';
import { config } from '@aihot/backend/config';
import { worldNewsModule } from '../server.ts';
import { worldAnalysisQueue } from '../jobs.ts';
import { registerWorldAdmin } from '../api/admin.ts';
import { releaseReceipt,autoReleaseUnknownReceipts } from '@aihot/backend/operations/recover';
import { releaseUnknownReceipt } from '@aihot/backend/providers/receipts';

const T=tag(),actor='local-fixture',ids={ ai:`admin-ai-${T}`,world:`admin-world-${T}` };
const sources={ ai:`source-ai-${T}`,world:`source-world-${T}` };
before(async()=>{
  assert.match(sql.options.database,/_f\d+_(?:test|ci)$/);
  installModules([{ ...worldNewsModule,admin:{ counts:{ worldOnly:async()=>999 },runs:async()=>({ leak:'world' }) },
    schedules:[{ name:'world.fixture',cron:'0 0 * * *',run:async()=>null }] }]);await getBoss();
  for(const section of ['ai','world'] as const) {
    await sql`INSERT INTO sources (section_id,id,name,kind,enabled,health,last_error) VALUES (${section},${sources[section]},${sources[section]},'rss',true,'failing',${`${section}-source-failure`})`;
    await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,discovered_at,timeline_at,processing_state,processing_error,processing_attempts)
      VALUES (${section},${ids[section]},${sources[section]},${ids[section]},${`https://fixture.invalid/${ids[section]}`},${`${section} fixture`},now(),now(),'failed',${`${section}-processing-failure`},1)`;
    await sql`INSERT INTO fetch_runs (section_id,source_id,status,error) VALUES (${section},${sources[section]},'failed',${`${section}-fetch-failure`})`;
    await sql`INSERT INTO job_runs (section_id,job,status,error) VALUES (${section},${`${section}-job`},'failed',${`${section}-job-failure`})`;
    await receipt(section,'score_article','CNY',section==='world' ? 10 : 1);
  }
  await receipt('world','world.score-1','CNY',2);await receipt('world','world.score-1','USD',3);
  await enqueue(QUEUES.analyze,{ articleId:ids.ai });
  await enqueue(QUEUES.analyze,{ articleId:ids.world }); // forged legacy payload must not count as AI.
  await enqueueOn(worldAnalysisQueue,{ sectionId:'world',articleId:ids.world });
  await enqueueOn(worldAnalysisQueue,{ sectionId:'world',articleId:ids.ai }); // forged world payload must not count as world.
  await enqueue(QUEUES.fetchXShard,{ key:'forged-shard',sourceIds:[sources.ai,sources.world] });
  const boss=await getBoss();await boss.createQueue('cron.world.fixture');await boss.send('cron.world.fixture',{});
});
async function receipt(section:'ai'|'world',purpose:string,currency:string,cost:number) {
  const [r]=await sql<{ id:number }[]>`INSERT INTO receipts (section_id,logical_key,service,model,purpose,subject,status,request,attempts)
    VALUES (${section},${randomUUID()},'llm','local-model',${purpose},${ids[section]},'unknown',${sql.json({ promptVersion:'fixture-version' })},1) RETURNING id`;
  await sql`INSERT INTO receipt_attempts (receipt_id,attempt,service,model,status,usage,cost,currency,cost_basis)
    VALUES (${r!.id},1,'llm','local-model','received',${sql.json({ prompt_tokens:10,completion_tokens:20 })},${cost},${currency},'actual')`;
}
after(async()=>{ await stopBoss();await closeDb(); });

test('AI operations and navigation omit world sources, failures, queue payloads and receipts',async()=>{
  const runs=await runsOverview(),counts=await navCounts();
  assert.equal(runs.queues.find(q=>q.name===QUEUES.analyze)?.n,1);
  assert.ok(!runs.queues.some(q=>q.name==='world-news.analyze'));
  assert.ok(!runs.queues.some(q=>q.name===QUEUES.fetchXShard || q.name==='cron.world.fixture'));
  assert.ok(!('world-news' in runs.modules));assert.equal(counts.worldOnly,undefined);
  assert.deepEqual(runs.lagging.map(s=>s.id),[sources.ai]);
  assert.equal(runs.receipts.counts.unknown,1);assert.ok(runs.receipts.issues.every(r=>r.subject===ids.ai));
  assert.ok(runs.errors.every(e=>e.example===ids.ai));
  assert.ok(runs.timeline.every(r=>r.job!=='world-job'));
  assert.equal(counts.sources,1);assert.equal(counts.runs,1);
});
test('world operations expose only persisted world resources and keep missing budget separate from source failure',async()=>{
  const runs=await sectionRunsOverview('world');
  assert.equal(runs.queues.find(q=>q.name==='world-news.analyze')!.n,1);
  assert.equal(runs.sources.length,1);assert.equal(runs.sources[0]!.id,sources.world);
  assert.equal(runs.fetches[0]!.source_id,sources.world);assert.equal(runs.fetches[0]!.error,'world-fetch-failure');
  assert.equal(runs.timeline.length,1);assert.equal(runs.timeline[0]!.job,'world-job');
  assert.equal(runs.receipts.counts.unknown,3);assert.ok(runs.receipts.issues.every(r=>r.subject===ids.world));
  assert.equal(runs.counts!.articles,1);assert.equal(runs.processing.failed,1);assert.equal(runs.budgets.length,0);
  assert.equal(runs.budgetStatus,'not-configured');
  assert.match(runs.budgetMeaning,/not a monetary/);
});
test('world budget overview distinguishes missing configuration, stopped allowance and exhaustion without AI usage',async()=>{
  await sql`INSERT INTO section_budgets VALUES ('world','llm',0,100,100)`;
  assert.equal((await sectionRunsOverview('world')).budgets[0]!.status,'paused');
  await sql`UPDATE section_budgets SET per_minute=3 WHERE section_id='world'`;
  const exhausted=(await sectionRunsOverview('world')).budgets[0]!;
  assert.equal(exhausted.status,'exhausted');assert.equal(exhausted.minute,3);
  await sql`UPDATE section_budgets SET per_minute=4 WHERE section_id='world'`;
  assert.equal((await sectionRunsOverview('world')).budgets[0]!.status,'ready');
  await sql`DELETE FROM section_budgets WHERE section_id='world'`;
});
test('same-purpose receipts remain board-scoped and different currency costs never get added together',async()=>{
  const ai=await modelsOverview(1),world=await sectionModelsOverview('world',1);
  const usage=ai.capabilities.find(c=>c.key==='score')!.usage;
  assert.equal(usage.length,1);assert.equal(usage[0]!.calls,1);assert.equal(usage[0]!.actualCost,1);
  const currencies=world.usage.filter(u=>u.purpose==='world.score-1');
  assert.deepEqual(currencies.map(u=>[u.currency,u.actualCost]).sort(),[['CNY',2],['USD',3]]);
  assert.equal(world.usage.find(u=>u.purpose==='score_article')!.actualCost,10);
  await assert.rejects(sectionModelUsage('all' as never,new Date()),/invalid content section/);
});
test('switching world model changes only its namespace, supports reset and records section history',async()=>{
  await switchModel('score','deepseek-flash','AI fixture',actor);
  const ai=await modelFor('score');
  assert.equal(await sectionModelFor(sectionContext('world'),'score'),'default');
  await switchSectionModel('world','score',{ model:'qwen3.7-flash',reason:'World fixture' },actor);
  assert.equal(await sectionModelFor(sectionContext('world'),'score'),'qwen3.7-flash');
  assert.equal(await modelFor('score'),ai);
  const view=await sectionModelsOverview('world');
  assert.equal(view.capabilities.find(c=>c.key==='score')!.current.source,'admin');
  assert.ok(view.history.every(h=>h.subject==='world:model:score'));
  assert.ok((await modelsOverview()).history.every(h=>!h.subject?.startsWith('world:')));
  await switchSectionModel('world','score',{ model:null,reason:'Reset to world rule pack' },actor);
  assert.equal(await sectionModelFor(sectionContext('world'),'score'),'default');
  assert.equal(await modelFor('score'),ai);
  await assert.rejects(switchSectionModel('world','score',{ model:'missing-model',reason:'Invalid' },actor),/unknown model/);
  await assert.rejects(switchSectionModel('ai','score',{ model:null,reason:'Wrong entry' },actor),/legacy/);
});
test('legacy manual and automatic receipt release cannot mutate world receipts or attempts',async()=>{
  const rows=await sql<{ id:number }[]>`SELECT id FROM receipts WHERE section_id='world' ORDER BY id`;
  assert.equal(rows.length,3);
  for(const row of rows) assert.equal(await releaseReceipt(row.id,{ billed:false,note:'Wrong board fixture' },actor),null);
  for(const row of rows) assert.equal(await sql.begin(tx=>releaseUnknownReceipt(tx,row.id,'Wrong default section')),null);
  const before=await sql`SELECT id,status,error FROM receipts WHERE section_id='world' ORDER BY id`;
  const attempts=await sql`SELECT a.receipt_id,a.status,a.error FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.section_id='world' ORDER BY a.receipt_id`;
  await autoReleaseUnknownReceipts(Date.now()+3600000);
  assert.deepEqual(await sql`SELECT id,status,error FROM receipts WHERE section_id='world' ORDER BY id`,before);
  assert.deepEqual(await sql`SELECT a.receipt_id,a.status,a.error FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.section_id='world' ORDER BY a.receipt_id`,attempts);
});

test('world stats and model endpoints require login, strict filters and CSRF writes',async()=>{
  const app=Fastify();registerWorldAdmin(app);const old=config.devAdmin;
  try {
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/world/runs')).statusCode,401);
    config.devAdmin={ displayName:actor };
    assert.equal((await app.inject('/api/admin/world/runs?sectionId=ai')).statusCode,400);
    assert.equal((await app.inject('/api/admin/world/models?days=91')).statusCode,400);
    assert.equal((await app.inject('/api/admin/world/models')).json().sectionId,'world');
    const url='/api/admin/world/models/score',payload={ model:null,reason:'Local endpoint reset' };
    assert.equal((await app.inject({ method:'POST',url,payload })).statusCode,403);
    assert.equal((await app.inject({ method:'POST',url,payload,headers:{ 'x-csrf-token':'dev' } })).statusCode,200);
    assert.equal((await app.inject({ method:'POST',url:'/api/admin/world/models/translate',payload,headers:{ 'x-csrf-token':'dev' } })).statusCode,400);
  } finally { config.devAdmin=old;await app.close(); }
});
