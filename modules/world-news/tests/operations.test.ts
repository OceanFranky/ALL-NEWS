import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import Fastify from 'fastify';
import { sql,closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { installModules } from '@aihot/backend/modules';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { worldNewsModule } from '../server.ts';
import { rerunWorldAnalysis } from '../operations.ts';
import { registerWorldAdmin } from '../api/admin.ts';

const T=tag(),id=(key:string)=>`ops-${T}-${key}`;
const command=(key:string)=>({ revision:1,requestId:`request-${T}-${key}`,reason:'Local re-evaluation' });
before(async()=>{
  installModules([worldNewsModule]);
  for(const key of ['ai','world','valve','unknown','pending','rollback']) {
    const section=key==='ai'?'ai':'world';
    await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES (${section},${id(key)},${key},'rss',false)`;
    await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,processing_state,processing_error,discovered_at,timeline_at)
      VALUES (${section},${id(key)},${id(key)},${id(key)},${`https://fixture.invalid/${id(key)}`},'Original title','Actual list material','failed','old error',now(),now())`;
  }
});
after(async()=>{ await stopBoss();await closeDb(); });

test('world re-evaluation is durable idempotent and queues only its own analysis with a distinct paid attempt',async()=>{
  const input=command('world');
  const results=await Promise.all(Array.from({ length:5 },()=>rerunWorldAnalysis(id('world'),input,'fixture')));
  assert.ok(results[0]!.jobId);assert.ok(results.every(r=>r!.jobId===results[0]!.jobId));
  const [job]=await sql`SELECT name,data FROM pgboss.job WHERE id=${results[0]!.jobId}`;
  assert.equal(job!.name,'world-news.analyze');
  assert.deepEqual(job!.data,{ sectionId:'world',articleId:id('world'),attemptTag:`admin:${input.requestId}` });
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='section.content.rerun.analyze' AND subject=${`world:content:${id('world')}`}`).length,1);
  assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${id('world')}`)[0]!.processing_state,'new');
  await assert.rejects(rerunWorldAnalysis(id('world'),{ ...input,reason:'changed' },'fixture'),/同一请求/);
  await assert.rejects(rerunWorldAnalysis(id('world'),command('another'),'fixture'),/已有/);
  await sql`UPDATE articles SET revision=2 WHERE id=${id('world')}`;
  assert.equal((await rerunWorldAnalysis(id('world'),input,'fixture'))!.jobId,results[0]!.jobId,'acknowledge committed command after material changes');
  await assert.rejects(rerunWorldAnalysis(id('world'),command('stale'),'fixture'),/版本/);
  assert.equal(await rerunWorldAnalysis(id('ai'),command('ai'),'fixture'),null);
  assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${id('ai')}`)[0]!.processing_state,'failed');
  assert.equal((await sql`SELECT 1 FROM receipts`).length,0,'queueing is not a model call');
});

test('disabled models and unresolved world requests reject new paid attempts without changing material',async()=>{
  const old=process.env.MODEL_CALLS_ENABLED;
  try {
    process.env.MODEL_CALLS_ENABLED='false';
    await assert.rejects(rerunWorldAnalysis(id('valve'),command('valve'),'fixture'),/disabled/);
  } finally { process.env.MODEL_CALLS_ENABLED=old; }
  for(const status of ['unknown','pending']) {
    await sql`INSERT INTO receipts (section_id,logical_key,service,purpose,subject,status)
      VALUES ('world',${id(status)},'llm','world.prefilter',${id(status)},${status})`;
    await assert.rejects(rerunWorldAnalysis(id(status),command(status),'fixture'),/回执/);
    assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${id(status)}`)[0]!.processing_state,'failed');
    assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE data->>'articleId'=${id(status)}`).length,0);
  }
});

test('audit failure rolls back analysis queue and processing state together',async()=>{
  await sql`CREATE FUNCTION fail_world_rerun() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='section.content.rerun.analyze' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`;
  await sql`CREATE TRIGGER fail_world_rerun BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_world_rerun()`;
  try {
    await assert.rejects(rerunWorldAnalysis(id('rollback'),command('rollback'),'fixture'),/injected audit failure/);
    assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE data->>'articleId'=${id('rollback')}`).length,0);
    const [row]=await sql`SELECT processing_state,processing_error FROM articles WHERE id=${id('rollback')}`;
    assert.equal(row!.processing_state,'failed');assert.equal(row!.processing_error,'old error');
  } finally {
    await sql`DROP TRIGGER fail_world_rerun ON audit_log`;await sql`DROP FUNCTION fail_world_rerun()`;
  }
});

test('world rerun HTTP requires login CSRF strict body and matching material ownership',async()=>{
  const app=Fastify();registerWorldAdmin(app);const old=config.devAdmin;
  const path=`/api/admin/world/items/${id('valve')}/rerun`,payload=command('http'),headers={ 'x-csrf-token':'dev' };
  try {
    config.devAdmin=null;assert.equal((await app.inject({ method:'POST',url:path,payload })).statusCode,401);
    config.devAdmin={ displayName:'Fixture' };
    assert.equal((await app.inject({ method:'POST',url:path,payload })).statusCode,403);
    assert.equal((await app.inject({ method:'POST',url:path,payload:{ ...payload,sectionId:'ai' },headers })).statusCode,400);
    assert.equal((await app.inject({ method:'POST',url:`/api/admin/world/items/${id('ai')}/rerun`,payload,headers })).statusCode,404);
    assert.equal((await app.inject({ method:'POST',url:path,payload:{ ...payload,revision:2 },headers })).statusCode,409);
    const good=await app.inject({ method:'POST',url:path,payload,headers });
    assert.equal(good.statusCode,200,good.body);assert.equal(good.json().sectionId,'world');assert.ok(good.json().jobId);
  } finally { config.devAdmin=old;await app.close(); }
});
