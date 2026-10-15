import { tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after,before,test } from "node:test";
import Fastify from "fastify";
import { sql,closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { config } from "@aihot/backend/config";
import { beijingDate,beijingMidnight,addDays } from "@aihot/contracts/time";
import { sectionDaily,sectionDailyCandidates } from "@aihot/backend/publication/section-daily";
import { projectSectionArticle,reviewSectionPublication,reviewSectionSourcePermission } from "@aihot/backend/publication/section-publish";
import { generateSectionDaily,listSectionDailyRevisions,reviewSectionDaily } from "@aihot/backend/reports/section-daily";
import { generateWorldDaily,refreshWorldDaily } from "../daily.ts";
import { WORLD_RULES } from "../rules.ts";
import { worldNewsModule } from "../server.ts";
import { registerWorldAdmin } from "../api/admin.ts";
import { registerWorldPublic } from "../api/public.ts";

const T=tag(),today=beijingDate(new Date()),date=addDays(today,-1),actor='local-reviewer';
const sources=Array.from({ length:4 },(_,i)=>`world-daily-${T}-${i}`);
let n=0;
before(async()=>{
  installModules([worldNewsModule]);
  for(const id of sources) {
    await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world',${id},${`Local ${id}`},'rss',false)`;
    await reviewSectionSourcePermission('world',id,{ summaryAllowed:true,reference:'Synthetic local fixture only',actor });
  }
});
after(closeDb);
async function fixture(options:{ date?:string;source?:number;score?:number;story?:number;admitted?:Date;old?:boolean;backfill?:boolean }={}) {
  const id=`daily-item-${T}-${++n}`,source=sources[options.source ?? 0]!;
  const pub=new Date(Date.now()-(options.old ? 72*3600*1000 : 1000));
  await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,published_at,discovered_at,timeline_at,grouping_status,backfill)
    VALUES ('world',${id},${source},${id},${`https://fixture.invalid/${id}`},${`Policy ${n}`},'Actual supplied text',${pub},now(),now(),'complete',${options.backfill ?? false})`;
  await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,category,title_zh,summary_zh,reason_zh,score)
    VALUES ('world',${id},1,'rule','pass','economy',${`政策 ${n}`},${`机构表示政策 ${n} 将生效。`},'了解政策变化',${options.score ?? 90})`;
  let story=options.story;
  if(!story) {
    const [row]=await sql`INSERT INTO stories (section_id,public_id,title) VALUES ('world',${randomUUID()},${`Event ${n}`}) RETURNING id`;
    story=Number(row!.id);
  }
  const [fact]=await sql`INSERT INTO facts (section_id,public_id,story_id,title) VALUES ('world',${`daily-fact-${id}`},${story},${`Fact ${n}`}) RETURNING id`;
  await sql`INSERT INTO fact_articles (section_id,fact_id,article_id,role) VALUES ('world',${fact!.id},${id},'primary')`;
  await reviewSectionPublication('world',id,{ revision:1,action:'approve',actor,reason:'Synthetic local fixture review' });
  if(options.date || options.admitted) await sql`UPDATE publications SET section_admitted_at=${options.admitted ?? beijingMidnight(options.date!)} WHERE article_id=${id}`;
  return { id,story };
}
const approve=(d:string,revision:number)=>reviewSectionDaily('world',d,{ revision,action:'approve',actor,reason:'Reviewed synthetic daily' });

test('first admission is stable across rebuild and withdrawal; old and backfill material is not today news',async()=>{
  const { id }=await fixture();
  const [first]=await sql`SELECT section_admitted_at FROM publications WHERE article_id=${id}`;
  assert.ok(first!.section_admitted_at instanceof Date);
  await projectSectionArticle('world',id);
  await reviewSectionPublication('world',id,{ revision:1,action:'withdraw',actor,reason:'Fixture withdrawal' });
  await reviewSectionPublication('world',id,{ revision:1,action:'approve',actor,reason:'Fixture restore' });
  const [again]=await sql`SELECT section_admitted_at FROM publications WHERE article_id=${id}`;
  assert.equal(again!.section_admitted_at.getTime(),first!.section_admitted_at.getTime());
  for(const options of [{ old:true },{ backfill:true }]) {
    const old=await fixture(options);
    const [p]=await sql`SELECT section_admitted_at,eligible FROM publications WHERE article_id=${old.id}`;
    assert.equal(p!.section_admitted_at,null);
    assert.equal(p!.eligible,true,'archived material can remain in its category');
  }
});

test('Beijing day includes midnight, excludes next midnight and does not use article publication day',async()=>{
  const d=addDays(today,-3),start=beijingMidnight(d),end=beijingMidnight(addDays(d,1));
  const before=await fixture({ admitted:new Date(start.getTime()-1) });
  const first=await fixture({ admitted:start });
  const last=await fixture({ admitted:new Date(end.getTime()-1) });
  const after=await fixture({ admitted:end });
  const ids=(await sectionDailyCandidates('world',d)).map(e=>e.itemId);
  assert.ok(ids.includes(first.id) && ids.includes(last.id));
  assert.ok(!ids.includes(before.id) && !ids.includes(after.id));
});

test('world draft caps six focus and six flashes, deduplicates events and limits each focus source to two',async()=>{
  const first=await fixture({ date,score:100 });
  await fixture({ date,score:99,story:first.story,source:1 });
  for(let i=0;i<18;i++) await fixture({ date,score:98-i,source:i%4 });
  const draft=await generateWorldDaily(date,actor);
  assert.equal(draft.status,'draft');
  assert.equal(draft.content.focus.length,6);assert.equal(draft.content.flashes.length,6);
  const entries=[...draft.content.focus,...draft.content.flashes];
  assert.equal(new Set(entries.map(e=>e.storyPublicId)).size,12);
  for(const source of sources) assert.ok(draft.content.focus.filter(e=>e.sourceId===source).length<=2);
  assert.equal(entries.filter(e=>e.itemId===first.id).length,1);
  assert.equal(await sectionDaily('world',date),null,'draft is not public');
  await approve(date,Number(draft.revision));
  const published=await sectionDaily('world',date);
  assert.equal(published!.focus.length,6);assert.equal(published!.flashes.length,6);
  assert.ok(!JSON.stringify(published).includes('generated_by'));
});

test('regeneration and concurrent drafts append versions without replacing the approved issue',async()=>{
  const before=await sectionDaily('world',date);
  const rows=await Promise.all(Array.from({ length:5 },()=>generateWorldDaily(date,actor)));
  assert.equal(new Set(rows.map(r=>r.revision)).size,5);
  assert.deepEqual(await sectionDaily('world',date),before);
  const revisions=await listSectionDailyRevisions('world',date);
  assert.equal(revisions.length,6);
  assert.equal(revisions.filter(r=>r.status==='approved').length,1);
  assert.deepEqual(revisions.at(-1)!.content,(await listSectionDailyRevisions('world',date)).at(-1)!.content);
});

test('withdrawn citations disappear immediately and stale drafts cannot be approved',async()=>{
  const publicIssue=await sectionDaily('world',date);
  const id=publicIssue!.focus[0]!.itemId;
  await reviewSectionPublication('world',id,{ revision:1,action:'withdraw',actor,reason:'Withdraw a cited fixture' });
  const current=await sectionDaily('world',date);
  assert.equal(current!.focus.length,5);
  assert.ok(!JSON.stringify(current).includes(id));
  await assert.rejects(approve(date,6),/withdrawn or changed/);
  assert.equal((await listSectionDailyRevisions('world',date))[0]!.status,'draft');
});

test('new approved revision is explicit; withdrawing it cannot expose an older approved issue',async()=>{
  const draft=await generateWorldDaily(date,actor);
  await approve(date,Number(draft.revision));
  assert.equal((await sectionDaily('world',date))!.revision,draft.revision);
  await assert.rejects(approve(date,2),/newer daily/);
  await reviewSectionDaily('world',date,{ revision:Number(draft.revision),action:'withdraw',actor,reason:'Withdraw issue' });
  assert.equal(await sectionDaily('world',date),null);
  assert.equal((await listSectionDailyRevisions('world',date)).find(r=>r.revision===1)!.status,'approved');
});

test('quiet days do not invent filler; alternate source can lead an event after the focus source cap',async()=>{
  const quiet=await generateWorldDaily(addDays(today,-10),actor);
  assert.deepEqual(quiet.content.focus,[]);assert.deepEqual(quiet.content.flashes,[]);
  assert.equal(quiet.content.status,'no-qualified-content');
  const d=addDays(today,-8);
  await fixture({ date:d,score:100 });await fixture({ date:d,score:99 });
  const capped=await fixture({ date:d,score:98 });
  const alternative=await fixture({ date:d,score:97,source:1,story:capped.story });
  const draft=await generateWorldDaily(d,actor);
  assert.equal(draft.content.focus.length,3);
  assert.equal(draft.content.focus[2].itemId,alternative.id);
  assert.equal(draft.content.flashes.length,0);
});

test('AI records and legacy report creation remain outside world drafts; malformed dates and sections reject',async()=>{
  const id=`ai-daily-${T}`;
  await sql`INSERT INTO sources (id,name,kind) VALUES (${id},'AI source','rss')`;
  await sql`INSERT INTO articles (id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES (${id},${id},${id},'https://fixture.invalid/ai','AI title',now(),now())`;
  await sql`INSERT INTO publications (article_id,source_id,title,summary,channel,url,eligible,discovered_at,timeline_at,sort_at,section_admitted_at)
    VALUES (${id},${id},'AI-only','AI-only','news','https://fixture.invalid/ai',true,now(),now(),now(),${beijingMidnight(date)})`;
  assert.ok(!(await sectionDailyCandidates('world',date)).some(e=>e.itemId===id));
  assert.equal((await sql`SELECT 1 FROM reports`).length,0,'world revisions do not overwrite legacy reports');
  await assert.rejects(generateWorldDaily('2026-02-30',actor),/calendar date/);
  await assert.rejects(generateSectionDaily('ai',date,{ focusLimit:6,flashLimit:6,maxFocusPerSource:2 },actor),/legacy/);
});

test('HTTP draft access is private, writes require CSRF and public daily only exposes approved versions',async()=>{
  const app=Fastify();registerWorldAdmin(app);registerWorldPublic(app);
  const old=config.devAdmin,d=addDays(today,-10);
  try {
    config.devAdmin=null;
    assert.equal((await app.inject(`/api/admin/world/daily/${d}`)).statusCode,401);
    assert.equal((await app.inject(`/api/v1/world/daily/${d}`)).statusCode,404);
    config.devAdmin={ displayName:'local-admin' };
    const url=`/api/admin/world/daily/${d}/generate`;
    assert.equal((await app.inject({ method:'POST',url })).statusCode,403);
    const headers={ 'x-csrf-token':'dev' };
    const draft=(await app.inject({ method:'POST',url,headers })).json();
    assert.equal(draft.status,'draft');
    const review=`/api/admin/world/daily/${d}/review`;
    assert.equal((await app.inject({ method:'POST',url:review,headers,payload:{ revision:draft.revision,action:'approve',reason:'Local review',sectionId:'ai' } })).statusCode,400);
    assert.equal((await app.inject({ method:'POST',url:review,headers,payload:{ revision:draft.revision,action:'approve',reason:'Local review' } })).statusCode,200);
    assert.equal((await app.inject(`/api/v1/world/daily/${d}`)).statusCode,200);
    assert.equal((await app.inject('/api/v1/world/daily/2026-02-30')).statusCode,400);
  } finally { config.devAdmin=old;await app.close(); }
});

test('automatic daily is opt-in and publishes scored deduplicated source-capped content without paid work',async()=>{
  const d=addDays(today,-5),now=beijingMidnight(d);
  assert.equal((await refreshWorldDaily(now)).status,'disabled');
  await sql`INSERT INTO settings (key,value) VALUES ('sections.world.daily','{"automatic":"true"}'::jsonb)`;
  assert.equal((await refreshWorldDaily(now)).status,'disabled');
  await sql`UPDATE settings SET value='{"automatic":true}'::jsonb WHERE key='sections.world.daily'`;
  const first=await fixture({ date:d,score:100 });
  await fixture({ date:d,score:99,story:first.story,source:1 });
  for(let index=0;index<18;index++) await fixture({ date:d,score:90-index,source:index%4 });
  const results=await Promise.all(Array.from({ length:5 },()=>refreshWorldDaily(now)));
  assert.equal(results.filter(result=>result.changed).length,1);
  const issue=await sectionDaily('world',d);
  assert.equal(issue!.focus.length,6);assert.equal(issue!.flashes.length,6);
  assert.equal(issue!.focus[0].itemId,first.id);
  const entries=[...issue!.focus,...issue!.flashes];
  assert.equal(new Set(entries.map(entry=>entry.storyPublicId)).size,12);
  for(const source of sources) assert.ok(issue!.focus.filter(entry=>entry.sourceName===`Local ${source}`).length<=2);
  assert.equal((await listSectionDailyRevisions('world',d)).length,1);
  assert.equal((await sql`SELECT 1 FROM receipts`).length,0);
  assert.equal((await sql`SELECT 1 FROM receipt_attempts`).length,0);
  assert.equal(WORLD_RULES.selection.thresholds,null);
  assert.equal((await sql`SELECT 1 FROM publications WHERE section_id='world' AND selected`).length,0);
  assert.equal(worldNewsModule.schedules!.find(schedule=>schedule.name==='world-news.daily')!.cron,'*/5 * * * *');
});

test('automatic updates append only changed issues without approving an administrator draft',async()=>{
  const d=addDays(today,-5),now=beijingMidnight(d);
  const before=await sectionDaily('world',d);
  const manual=await generateWorldDaily(d,actor);
  assert.equal((await refreshWorldDaily(now)).changed,false);
  assert.equal((await listSectionDailyRevisions('world',d))[0].status,'draft');
  const added=await fixture({ date:d,source:2,score:100 });
  const result=await refreshWorldDaily(now);
  assert.equal(result.changed,true);
  const issue=await sectionDaily('world',d);
  assert.ok(issue!.revision>before!.revision);
  assert.ok([...issue!.focus,...issue!.flashes].some(entry=>entry.itemId===added.id));
  const revisions=await listSectionDailyRevisions('world',d);
  assert.equal(revisions.find(row=>row.revision===manual.revision)!.status,'draft');
  assert.equal(revisions[0].generated_by,'worker.world-daily');
  assert.ok((await sql`SELECT 1 FROM audit_log WHERE action='section.daily.auto-publish'`).length>=2);
});

test('automatic daily removes revoked citations and respects explicit issue withdrawal',async()=>{
  const d=addDays(today,-5),now=beijingMidnight(d);
  const before=await sectionDaily('world',d),id=before!.focus[0].itemId;
  await reviewSectionPublication('world',id,{ revision:1,action:'withdraw',actor,reason:'Withdraw automatic citation' });
  assert.ok(!(await sectionDaily('world',d))!.focus.some(entry=>entry.itemId===id));
  await refreshWorldDaily(now);
  const current=await sectionDaily('world',d);
  assert.ok(!JSON.stringify(current).includes(id));
  await reviewSectionDaily('world',d,{ revision:current!.revision,action:'withdraw',actor,reason:'Stop automatic issue' });
  const count=(await listSectionDailyRevisions('world',d)).length;
  await fixture({ date:d,source:3,score:100 });
  assert.equal((await refreshWorldDaily(now)).status,'withdrawn');
  assert.equal(await sectionDaily('world',d),null);
  assert.equal((await listSectionDailyRevisions('world',d)).length,count);
});

test('quiet automatic days stay empty and rollover uses a separate Beijing edition',async()=>{
  const quiet=addDays(today,-15);
  assert.equal((await refreshWorldDaily(beijingMidnight(quiet))).status,'no-qualified-content');
  assert.deepEqual((await sectionDaily('world',quiet))!.focus,[]);
  assert.equal((await refreshWorldDaily(beijingMidnight(quiet))).changed,false);
  const next=addDays(quiet,1);
  assert.equal((await refreshWorldDaily(beijingMidnight(next))).changed,true);
  assert.equal((await listSectionDailyRevisions('world',next))[0].revision,1);
  assert.equal((await sql`SELECT 1 FROM receipts`).length,0);
});
