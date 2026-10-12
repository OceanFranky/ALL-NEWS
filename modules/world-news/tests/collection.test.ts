import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after,before,test } from 'node:test';
import { sql,closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { installModules } from '@aihot/backend/modules';
import { collectSectionSource,previewSectionSource } from '@aihot/backend/sources/section-collect';
import Fastify from 'fastify';
import { registerWorldAdmin } from '../api/admin.ts';
import { getBoss,stopBoss } from '@aihot/backend/jobs/queue';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { installWorldSources,WORLD_SOURCES } from '../sources.ts';
import { worldNewsModule } from '../server.ts';
import { scheduleWorldCollections } from '../jobs.ts';

const T=tag();
let revision=0,fail=false;
const at=new Date(Date.now()-3600000).toISOString();
const server=http.createServer((req,res)=>{
  if(fail) { res.writeHead(404);res.end('Unavailable');return; }
  if(req.url==='/rss') {
    if(req.headers['if-none-match']==='"v1"') { res.writeHead(304);res.end();return; }
    res.setHeader('etag','"v1"');res.setHeader('content-type','application/rss+xml');
    res.end(`<rss version="2.0"><channel><title>Local</title><item><title>机构发布声明</title><link>https://fixture.invalid/rss-${T}</link><pubDate>${new Date(at).toUTCString()}</pubDate><description>机构宣布政策将于周一生效。</description><enclosure url="https://fixture.invalid/news-${T}.jpg" type="image/jpeg" length="0"/></item><item><title>只有标题</title><link>https://fixture.invalid/short-${T}</link></item></channel></rss>`);
  } else if(req.url==='/html') {
    res.setHeader('content-type','text/html');
    res.end(`<div class="news"><article><h2><a href="/html/one-${T}">政策声明 ${revision}</a></h2><p>机构宣布一项新的贸易政策。</p><time datetime="2026-10-11 09:00:00"></time></article><article><h2><a href="/html/two-${T}">谈判进展</a></h2><p>双方表示将在下周继续谈判。</p><time datetime="2026-10-11T10:00:00+08:00"></time></article></div>`);
  } else if(req.url==='/json') {
    res.setHeader('content-type','application/json');res.end(JSON.stringify({ data:{ items:[
      { title:'利率声明',url:`https://fixture.invalid/json-one-${T}`,summary:'央行宣布利率政策。',at:'2026-10-11 09:00:00' },
      { title:'贸易公告',url:`https://fixture.invalid/json-two-${T}`,summary:'机构公布贸易措施。',at:'2026-10-11T10:00:00+08:00' },
    ] } }));
  } else { res.writeHead(404);res.end('No original pages provided'); }
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${(server.address() as { port:number }).port}`;
const sid=(kind:string)=>`world-collect-${T}-${kind}`;
before(async()=>{
  installModules([worldNewsModule]);config.allowPrivateNetworkFetch=true;
  assert.match(sql.options.database,/_f\d+_test$/);
  // Exercise the shipped migrations, not a test-only identity cutover.
  assert.equal((await sql`SELECT 1 FROM pg_constraint WHERE conname='articles_identity_key_key' AND conrelid='articles'::regclass`).length,0);
  for(const [kind,cfg] of [
    ['rss',{ feedUrl:`${base}/rss` }],
    ['web_list',{ url:`${base}/html`,itemSelector:'.news article',linkSelector:'h2 a',titleSelector:'h2 a',summarySelector:'p',publishedAtSelector:'time',publishedAtUtcOffset:'+08:00' }],
    ['json_list',{ url:`${base}/json`,itemsPath:'data.items',titlePaths:['title'],summaryPaths:['summary'],urlTemplate:'{raw:url}',publishedAtPath:'at',publishedAtUtcOffset:'+08:00' }],
  ] as const) await sql`INSERT INTO sources (section_id,id,name,kind,config,enabled)
    VALUES ('world',${sid(kind)},${kind},${kind},${sql.json(cfg)},false)`;
});
after(async()=>{ await stopBoss();await new Promise<void>(resolve=>server.close(()=>resolve()));await closeDb(); });

test('six sources install separately and paused without modifying AI config or granting permissions',async()=>{
  assert.equal(WORLD_SOURCES.length,6);
  assert.equal((await installWorldSources('test')).results.filter(r=>r.created).length,6);
  assert.equal((await installWorldSources('test')).results.filter(r=>r.created).length,0);
  const sources=await sql`SELECT section_id,enabled,site_fulltext,syndicate_fulltext FROM sources WHERE id=ANY(${WORLD_SOURCES.map(s=>s.id)}::text[])`;
  assert.equal(sources.length,6);assert.ok(sources.every(s=>s.section_id==='world' && !s.enabled && !s.site_fulltext && !s.syndicate_fulltext));
  assert.equal((await sql`SELECT 1 FROM section_source_permissions`).length,0);
});

test('real HTML and JSON readers store two correct records each, including excerpts and source timezone',async()=>{
  for(const kind of ['web_list','json_list']) {
    const result=await collectSectionSource('world',sid(kind),{ force:true });
    assert.equal(result.status,'ok',result.error ?? 'collection should succeed');assert.equal(result.found,2);assert.equal(result.created,2);
    const rows=await sql`SELECT title,url,excerpt,published_at,section_id,body_text FROM articles WHERE source_id=${sid(kind)} ORDER BY published_at`;
    assert.equal(rows.length,2);assert.equal(rows[0]!.published_at.toISOString(),'2026-10-11T01:00:00.000Z');
    assert.equal(rows[1]!.published_at.toISOString(),'2026-10-11T02:00:00.000Z');
    assert.ok(rows.every(r=>r.excerpt && r.section_id==='world' && r.body_text===null));
    assert.ok(rows.every(r=>r.url.includes(kind==='web_list' ? '/html/' : 'fixture.invalid/json-')));
    const repeated=await collectSectionSource('world',sid(kind),{ force:true });
    assert.equal(repeated.created,0);assert.equal(repeated.revised,0);
  }
});

test('RSS missing text/date is retained pending, first recent import is not archived and 304 keeps queue recovery',async()=>{
  const queued:string[]=[];
  const result=await collectSectionSource('world',sid('rss'),{ force:true,onMaterial:async id=>{ queued.push(id); } });
  assert.equal(result.status,'ok',result.error ?? 'collection should succeed');assert.equal(result.created,2);assert.equal(queued.length,2);
  const rows=await sql`SELECT title,published_at,excerpt,backfill,media FROM articles WHERE source_id=${sid('rss')}`;
  const recent=rows.find(r=>r.title==='机构发布声明')!;assert.equal(recent.backfill,false);assert.ok(recent.excerpt);
  assert.equal(recent.media[0]?.url,`https://fixture.invalid/news-${T}.jpg`);
  const missing=rows.find(r=>r.title==='只有标题')!;assert.equal(missing.published_at,null);assert.equal(missing.excerpt,null);assert.equal(missing.backfill,true);
  await sql`UPDATE articles SET media='[]'::jsonb WHERE source_id=${sid('rss')} AND title='机构发布声明'`;
  assert.equal((await collectSectionSource('world',sid('rss'),{ force:true })).revised,0,'media enrichment is not a text revision');
  const [enriched]=await sql`SELECT media FROM articles WHERE source_id=${sid('rss')} AND title='机构发布声明'`;
  assert.equal(enriched!.media[0]?.url,`https://fixture.invalid/news-${T}.jpg`);
  await sql`UPDATE sources SET enabled=true WHERE id=${sid('rss')}`;
  const again=await collectSectionSource('world',sid('rss'),{ onMaterial:async id=>{ queued.push(id); } });
  assert.equal(again.found,0);assert.equal(again.created,0);assert.equal(queued.length,4);
});

test('material revision stays within world, same original in AI is independent and failed fetch does not advance cursor',async()=>{
  const [world]=await sql`SELECT * FROM articles WHERE source_id=${sid('web_list')} ORDER BY published_at LIMIT 1`;
  const ai=`ai-collect-${T}`;await sql`INSERT INTO sources (id,name,kind) VALUES (${ai},'AI','rss')`;
  const a=await upsertMaterial({ sourceId:ai,via:'fetch',url:world!.url,title:'Independent AI title',excerpt:'AI-specific',publishedAt:new Date(at) });
  revision++;
  assert.equal((await collectSectionSource('world',sid('web_list'),{ force:true })).revised,1);
  assert.equal((await sql`SELECT title FROM articles WHERE id=${a.articleId}`)[0]!.title,'Independent AI title');
  const [before]=await sql`SELECT cursor FROM sources WHERE id=${sid('web_list')}`;
  fail=true;const failed=await collectSectionSource('world',sid('web_list'),{ force:true });fail=false;
  assert.equal(failed.status,'failed');
  assert.deepEqual((await sql`SELECT cursor FROM sources WHERE id=${sid('web_list')}`)[0]!.cursor,before!.cursor);
  assert.equal((await collectSectionSource('world',sid('json_list'),{ force:true })).status,'ok','healthy source still runs');
  await assert.rejects(collectSectionSource('world',ai,{ force:true }),/not found/);
});

test('collection valve cannot be bypassed by force; fetch run relationships reject a different board',async()=>{
  const enabled=process.env.COLLECT_ENABLED;
  process.env.COLLECT_ENABLED='false';
  try {
    const result=await collectSectionSource('world',sid('rss'),{ force:true });
    assert.equal(result.status,'skipped');assert.equal(result.error,'collection-disabled');
  } finally { process.env.COLLECT_ENABLED=enabled; }
  await assert.rejects(sql`INSERT INTO fetch_runs (source_id) VALUES (${sid('rss')})`,/fetch_runs_section_source_fk/);
  const rows=await sql`SELECT section_id FROM fetch_runs WHERE source_id=${sid('rss')}`;
  assert.ok(rows.length>0 && rows.every(r=>r.section_id==='world'));
});

test('enabled due world sources are scheduled independently and advanced once',async()=>{
  const id=sid('schedule');
  await sql`INSERT INTO sources (section_id,id,name,kind,config,enabled,next_fetch_at)
    VALUES ('world',${id},'schedule','rss',${sql.json({ feedUrl:`${base}/rss` })},true,now()-interval '1 minute')`;
  await getBoss();
  const first=await scheduleWorldCollections();
  assert.equal(first.due,1);assert.equal(first.enqueued,1);
  const [job]=await sql`SELECT data FROM pgboss.job WHERE name='world-news.collect' AND data->>'sourceId'=${id} ORDER BY created_on DESC LIMIT 1`;
  assert.deepEqual(job!.data,{ sectionId:'world',sourceId:id });
  const [source]=await sql`SELECT next_fetch_at FROM sources WHERE id=${id}`;
  assert.ok(source!.next_fetch_at.getTime()>Date.now());
  assert.deepEqual(await scheduleWorldCollections(),{ due:0,enqueued:0 });
});

test('world listing previews use actual readers and never modify cursor, material or fetch history',async()=>{
  for(const kind of ['rss','web_list','json_list']) {
    const [before]=await sql`SELECT cursor FROM sources WHERE id=${sid(kind)}`;
    const runs=await sql`SELECT id FROM fetch_runs WHERE source_id=${sid(kind)} ORDER BY id`;
    const preview=await previewSectionSource('world',sid(kind));
    assert.equal(preview!.count,2);assert.equal(preview!.items.length,2);
    if(kind==='rss') assert.equal(preview!.items[1]!.excerpt,'');
    assert.deepEqual((await sql`SELECT cursor FROM sources WHERE id=${sid(kind)}`)[0]!.cursor,before!.cursor);
    assert.deepEqual(await sql`SELECT id FROM fetch_runs WHERE source_id=${sid(kind)} ORDER BY id`,runs);
  }
  const [before]=await sql`SELECT config FROM sources WHERE id=${sid('rss')}`;
  await sql`UPDATE sources SET config=${sql.json({ ...before!.config,detail:{ titleSelector:'h1' } })} WHERE id=${sid('rss')}`;
  await assert.rejects(previewSectionSource('world',sid('rss')),/detail pages/);
  await sql`UPDATE sources SET config=${sql.json(before!.config)} WHERE id=${sid('rss')}`;
});

test('world source controls check login CSRF ownership versions and collection valve before queueing',async()=>{
  const app=Fastify();registerWorldAdmin(app);const old=config.devAdmin,enabled=process.env.COLLECT_ENABLED;
  const path=`/api/admin/world/sources/${sid('rss')}`,headers={ 'x-csrf-token':'dev' };
  try {
    config.devAdmin=null;assert.equal((await app.inject({ method:'POST',url:`${path}/preview`,payload:{} })).statusCode,401);
    config.devAdmin={ displayName:'Fixture' };
    assert.equal((await app.inject({ method:'POST',url:`${path}/preview`,payload:{} })).statusCode,403);
    assert.equal((await app.inject({ method:'POST',url:`/api/admin/world/sources/ai-collect-${T}/preview`,payload:{},headers })).statusCode,404);
    const [s]=await sql`SELECT updated_at FROM sources WHERE id=${sid('rss')}`;
    const patch={ version:s!.updated_at.toISOString(),reason:'Local pause',patch:{ enabled:false } };
    assert.equal((await app.inject({ method:'PATCH',url:path,payload:patch,headers })).statusCode,200);
    assert.equal((await app.inject({ method:'PATCH',url:path,payload:patch,headers })).statusCode,409);
    assert.equal((await app.inject({ method:'PATCH',url:path,payload:{ ...patch,patch:{ section_id:'ai' } },headers })).statusCode,400);
    process.env.COLLECT_ENABLED='false';
    assert.equal((await app.inject({ method:'POST',url:`${path}/preview`,payload:{},headers })).statusCode,409);
    assert.equal((await app.inject({ method:'POST',url:`${path}/fetch`,payload:{ reason:'Local fetch' },headers })).statusCode,409);
    process.env.COLLECT_ENABLED='true';await getBoss();
    assert.equal((await app.inject({ method:'POST',url:`${path}/preview`,payload:{},headers })).json().count,2);
    const queued=await app.inject({ method:'POST',url:`${path}/fetch`,payload:{ reason:'Local fetch' },headers });
    assert.equal(queued.statusCode,200);assert.equal(queued.json().sectionId,'world');assert.equal(queued.json().status,'queued');
    const [job]=await sql`SELECT data FROM pgboss.job WHERE id=${queued.json().job}`;
    assert.deepEqual(job!.data,{ sectionId:'world',sourceId:sid('rss'),force:true });
    assert.equal((await app.inject({ method:'POST',url:`/api/admin/world/sources/ai-collect-${T}/fetch`,payload:{ reason:'Wrong board' },headers })).statusCode,404);
  } finally { config.devAdmin=old;process.env.COLLECT_ENABLED=enabled;await app.close(); }
});
