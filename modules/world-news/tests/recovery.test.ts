import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import http from 'node:http';
import Fastify from 'fastify';
import { sql,closeDb } from '@aihot/backend/db';
import { installModules } from '@aihot/backend/modules';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { config } from '@aihot/backend/config';
import { worldNewsModule } from '../server.ts';
import { runWorldAnalysisTask } from '../jobs.ts';
import { releaseWorldReceipt } from '../operations.ts';
import { registerWorldAdmin } from '../api/admin.ts';

const T=tag(),source=`recover-world-${T}`,text='The central bank announced a rate cut of 0.25 percentage points, effective Monday.';
let failOnce=true,hits=0,n=0;
const structureInputs:string[]=[];
const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req) body+=String(chunk);
  hits++;
  const messages=JSON.parse(body).messages,system=messages[0].content;
  let result:unknown;
  if(system.includes('判定顺序')) result={ label:'PASS',reason:'Policy action' };
  else if(system.includes('材料充分性先于公开')) {
    structureInputs.push(messages[1].content);
    if(failOnce) { failOnce=false;res.destroy();return; }
    result={ scope:'single',category:'economy',contentType:'institutional_statement',materialSufficient:true,
      tags:[],subjects:['central bank'],fact:{ title:'央行宣布降息',subject:'central bank',action:'announced',object:'rate cut',
        occurredAt:null,evidence:text,conditions:[] } };
  } else if(system.includes('五轴：')) result={ attentionScore:80 };
  else result={ materialSufficient:true,titleZh:'央行宣布降息',summaryZh:'央行宣布降息 0.25 个百分点，下周一生效。',reasonZh:'提供政策幅度和生效时间。' };
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ choices:[{ message:{ content:JSON.stringify(result) } }],usage:{ prompt_tokens:100,completion_tokens:100 } }));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
process.env.LLM_BASE_URL=`http://127.0.0.1:${(server.address() as { port:number }).port}/v1`;
process.env.LLM_API_KEY='test-key';process.env.LLM_MODEL='local-model';
before(async()=>{
  installModules([worldNewsModule]);
  await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world',${source},'Local','rss',false)`;
  await sql`INSERT INTO section_budgets VALUES ('world','llm',100,100,100)`;
});
after(async()=>{ await stopBoss();await new Promise<void>(resolve=>server.close(()=>resolve()));await closeDb(); });
async function article() {
  const id=`recover-${T}-${++n}`;
  await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,discovered_at,timeline_at,processing_state)
    VALUES ('world',${id},${source},${id},${`https://fixture.invalid/${id}`},'Policy announcement',${text},now(),now(),'failed')`;
  return id;
}
async function receipt(articleId:string,purpose='world.structure',request:unknown={ resource:{ kind:'article',id:articleId },inputRevision:1,attemptTag:null },status='unknown',section='world') {
  const [r]=await sql`INSERT INTO receipts (section_id,logical_key,service,model,purpose,subject,status,request,attempts)
    VALUES (${section},${`recovery-${T}-${++n}`},'llm','local-model',${purpose},${articleId},${status},${sql.json(request as never)},1) RETURNING id,updated_at`;
  await sql`INSERT INTO receipt_attempts (receipt_id,attempt,service,model,status) VALUES (${r!.id},1,'llm','local-model',${status})`;
  return { id:Number(r!.id),version:r!.updated_at.toISOString() };
}
const input=(r:{ id:number;version:string })=>({ version:r.version,billed:true,reason:'Local supplier bill checked',requestId:`release-${T}-${r.id}` });

test('actual lost HTTP response is restored with original attempt identity and saved prefilter answer, not a new paid chain',async()=>{
  const id=await article(),task={ sectionId:'world' as const,articleId:id,attemptTag:'admin:original-request' };
  await assert.rejects(runWorldAnalysisTask(task),/unknown|socket|fetch failed/i);
  assert.equal(hits,2);
  const [unknown]=await sql`SELECT id,request,updated_at FROM receipts WHERE section_id='world' AND subject=${id} AND status='unknown'`;
  assert.ok(unknown);assert.equal(unknown!.request.inputRevision,1);assert.equal(unknown!.request.attemptTag,task.attemptTag);
  assert.deepEqual(unknown!.request.resource,{ kind:'article',id });
  const r={ id:Number(unknown!.id),version:unknown!.updated_at.toISOString() },command=input(r);
  const results=await Promise.all(Array.from({ length:5 },()=>releaseWorldReceipt(r.id,command,'fixture')));
  assert.ok(results[0]!.jobId);assert.ok(results.every(v=>v!.jobId===results[0]!.jobId));
  const [job]=await sql`SELECT name,data FROM pgboss.job WHERE id=${results[0]!.jobId}`;
  assert.equal(job!.name,'world-news.analyze');assert.deepEqual(job!.data,task);
  await assert.rejects(releaseWorldReceipt(r.id,{ ...command,billed:false },'fixture'),/同一恢复/);
  const completed=await runWorldAnalysisTask(job!.data);
  assert.equal(completed.relevance,'pass');assert.equal(hits,6,'only lost structure and subsequent work call the fake provider');
  assert.deepEqual(structureInputs,[structureInputs[0],structureInputs[0]],'original material and prompt input are reused');
  assert.equal((await sql`SELECT status,attempts FROM receipts WHERE id=${r.id}`)[0]!.attempts,2);
  assert.ok((await sql`SELECT status FROM receipts WHERE subject=${id}`).every(row=>row.status==='completed'));
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${id}`)[0]!.n,5);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='section.receipt.release' AND subject=${`world:receipt:${r.id}`}`).length,1);
});

test('grouping recovery queues world grouping; stale versions unsupported metadata and foreign resources stay untouched',async()=>{
  const id=await article(),group=await receipt(id,'world.group-pair');
  const result=await releaseWorldReceipt(group.id,input(group),'fixture');
  const [job]=await sql`SELECT name,data FROM pgboss.job WHERE id=${result!.jobId}`;
  assert.equal(job!.name,'world-news.group');assert.deepEqual(job!.data,{ sectionId:'world',articleId:id });
  const staleId=await article(),stale=await receipt(staleId);
  await sql`UPDATE articles SET revision=2 WHERE id=${staleId}`;
  await assert.rejects(releaseWorldReceipt(stale.id,input(stale),'fixture'),/材料身份或版本/);
  const unsupported=await receipt(await article(),'world.other');
  await assert.rejects(releaseWorldReceipt(unsupported.id,input(unsupported),'fixture'),/用途/);
  const missing=await receipt(await article(),'world.structure',{});
  await assert.rejects(releaseWorldReceipt(missing.id,input(missing),'fixture'),/材料身份或版本/);
  const wrong=await receipt(await article(),'world.structure',{ resource:{ kind:'article',id:'foreign' },inputRevision:1,attemptTag:null });
  await assert.rejects(releaseWorldReceipt(wrong.id,input(wrong),'fixture'),/材料身份或版本/);
  const old=await receipt(await article());
  await assert.rejects(releaseWorldReceipt(old.id,{ ...input(old),version:new Date(0).toISOString() },'fixture'),/状态已改变/);
  const foreign=await receipt('not-a-world-article','world.structure',{},'unknown','ai');
  assert.equal(await releaseWorldReceipt(foreign.id,input(foreign),'fixture'),null);
  for(const r of [stale,unsupported,missing,wrong,old,foreign]) assert.equal((await sql`SELECT status FROM receipts WHERE id=${r.id}`)[0]!.status,'unknown');
});

test('recovery refuses disabled models and pending outcomes; audit failure rolls back release attempts queue and state',async()=>{
  const id=await article(),r=await receipt(id),enabled=process.env.MODEL_CALLS_ENABLED;
  try { process.env.MODEL_CALLS_ENABLED='false';await assert.rejects(releaseWorldReceipt(r.id,input(r),'fixture'),/disabled/); }
  finally { process.env.MODEL_CALLS_ENABLED=enabled; }
  const pending=await receipt(await article(),'world.structure',{},'pending');
  await assert.rejects(releaseWorldReceipt(pending.id,input(pending),'fixture'),/只有结果未知/);
  await sql`CREATE FUNCTION fail_world_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='section.receipt.release' THEN RAISE EXCEPTION 'injected release audit failure'; END IF; RETURN NEW; END $$`;
  await sql`CREATE TRIGGER fail_world_release BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_world_release()`;
  try {
    await assert.rejects(releaseWorldReceipt(r.id,input(r),'fixture'),/injected release/);
    assert.equal((await sql`SELECT status FROM receipts WHERE id=${r.id}`)[0]!.status,'unknown');
    assert.equal((await sql`SELECT status FROM receipt_attempts WHERE receipt_id=${r.id}`)[0]!.status,'unknown');
    assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${id}`)[0]!.processing_state,'failed');
    assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE data->>'articleId'=${id}`).length,0);
  } finally { await sql`DROP TRIGGER fail_world_release ON audit_log`;await sql`DROP FUNCTION fail_world_release()`; }
});

test('world release endpoint checks admin CSRF strict command and receipt identity',async()=>{
  const app=Fastify();registerWorldAdmin(app);const old=config.devAdmin,r=await receipt(await article()),payload=input(r);
  const path=`/api/admin/world/receipts/${r.id}/release`,headers={ 'x-csrf-token':'dev' };
  try {
    config.devAdmin=null;assert.equal((await app.inject({ method:'POST',url:path,payload })).statusCode,401);
    config.devAdmin={ displayName:'Fixture' };
    assert.equal((await app.inject({ method:'POST',url:path,payload })).statusCode,403);
    assert.equal((await app.inject({ method:'POST',url:path,payload:{ ...payload,sectionId:'ai' },headers })).statusCode,400);
    assert.equal((await app.inject({ method:'POST',url:'/api/admin/world/receipts/0/release',payload,headers })).statusCode,400);
    const good=await app.inject({ method:'POST',url:path,payload,headers });assert.equal(good.statusCode,200,good.body);
    assert.equal(good.json().sectionId,'world');assert.ok(good.json().jobId);
  } finally { config.devAdmin=old;await app.close(); }
});
