import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import { sql,closeDb } from '@aihot/backend/db';
import { searchContent,contentChain,previewPublicationDateCorrection,correctPublicationDate,setVisibility,setSeoIndexed,overrideFields,rerun } from '@aihot/backend/admin/content';
import { candidateViews,relatedPosts } from '@aihot/backend/events/recall';
import { checkMpAccount } from '@aihot/backend/sources/mp';
import { settleNonEditorial } from '@aihot/backend/jobs/content';
import { detachFromFact,moveToFact,requestRegroup } from '@aihot/backend/events/corrections';
import Fastify from 'fastify';
import { config } from '@aihot/backend/config';
import { registerWorldAdmin } from '../api/admin.ts';
import { translateArticle,translatePending } from '@aihot/backend/editorial/translate';
import { composeStoryDigest } from '@aihot/backend/events/digest';

const T=tag(),world=`world-legacy-${T}`,ai=`ai-legacy-${T}`,url=`https://fixture.invalid/shared-${T}`;
let factId:number,storyId:number;
before(async()=>{
  for(const [id,section] of [[ai,'ai'],[world,'world']]) {
    await sql`INSERT INTO sources (section_id,id,name,kind,participation_mode,enabled)
      VALUES (${section},${id},${id},'mp_account','hot_signal',false)`;
    await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,published_at,processing_state,discovered_at,timeline_at)
      VALUES (${section},${id},${id},${id},${url},${`Boundary headline ${T}`},'2026-09-01T00:00:00Z','new',now(),now())`;
  }
  const [story]=await sql`INSERT INTO stories (section_id,public_id,title) VALUES ('world',gen_random_uuid(),'World event') RETURNING id`;
  storyId=Number(story!.id);
  const [fact]=await sql`INSERT INTO facts (section_id,public_id,story_id,title) VALUES ('world',${`world-fact-${T}`},${story!.id},'World occurrence') RETURNING id`;
  factId=Number(fact!.id);
  await sql`INSERT INTO fact_articles (section_id,fact_id,article_id,role) VALUES ('world',${factId},${world},'primary')`;
});
after(closeDb);

test('admin searches and chains default to AI and explicit world reads cannot reveal an AI resource',async()=>{
  for(const q of [url,`Boundary headline ${T}`,world]) {
    assert.ok((await searchContent(q)).every(r=>r.id!==world));
    assert.deepEqual((await searchContent(q,'world')).map(r=>r.id),[world]);
  }
  assert.equal(await contentChain(world),null);
  assert.equal(await contentChain(ai,'world'),null);
  assert.equal((await contentChain(world,'world'))?.article.id,world);
  await assert.rejects(searchContent(url,'all' as never),/section/);
});

test('legacy administrative writes cannot alter world visibility, fields, date, SEO or enqueue AI reprocessing',async()=>{
  const [before]=await sql`SELECT to_jsonb(a) AS value FROM articles a WHERE id=${world}`;
  assert.equal(await previewPublicationDateCorrection(world,'2026-09-02T00:00:00.000Z'),null);
  await assert.rejects(correctPublicationDate(world,{ version:1,hash:'0'.repeat(64),publishedAt:'2026-09-02T00:00:00.000Z',requestId:'boundary-date',reason:'test' },'test'),/不存在/);
  await assert.rejects(setVisibility(world,{ version:0,visibility:'withdrawn',reason:'test' },'test'),/不存在/);
  await assert.rejects(overrideFields(world,{ version:0,fields:{ title:'AI override' },reason:'test' },'test'),/不存在/);
  assert.equal(await setSeoIndexed(world,{ indexed:true,reason:'test' },'test'),null);
  assert.equal(await rerun(world,'analyze','boundary-rerun','test'),null);
  await assert.rejects(detachFromFact(world,'test','test'),/不存在/);
  assert.equal(await moveToFact(world,`world-fact-${T}`,'test','test'),null);
  await assert.rejects(moveToFact(ai,`world-fact-${T}`,'test','test'),/不存在/);
  assert.equal(await requestRegroup(world,'boundary-regroup'),null);
  assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${world}`).length,1);
  assert.deepEqual((await sql`SELECT to_jsonb(a) AS value FROM articles a WHERE id=${world}`)[0]!.value,before!.value);
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=${world}`).length,0);
});

test('legacy identity recall and non-editorial/WeChat execution exclude world records',async()=>{
  assert.deepEqual(await relatedPosts({ id:ai,url,x_post:null }),{ sameUrl:null,referenced:[] });
  assert.deepEqual(await candidateViews([{ factId,storyId:0,factTitle:'World occurrence',score:1 }]),[]);
  assert.equal((await checkMpAccount(world,'manual')).status,'missing');
  assert.deepEqual(await settleNonEditorial(world),{ group:false });
  assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${world}`)[0]!.processing_state,'new');
});

test('world admin source and content reads are authenticated, reject invalid scopes and never return AI resources',async()=>{
  const app=Fastify();registerWorldAdmin(app);
  const previous=config.devAdmin;
  try {
    config.devAdmin=null;
    assert.equal((await app.inject('/api/admin/world/sources')).statusCode,401);
    config.devAdmin={ displayName:'local-admin' };
    assert.equal((await app.inject({ method:'POST',url:'/api/admin/world/sources/install',payload:{} })).statusCode,403);
    assert.equal((await app.inject('/api/admin/world/sources?section=ai')).statusCode,400);
    assert.equal((await app.inject(`/api/admin/world/sources/${ai}`)).statusCode,404);
    assert.equal((await app.inject(`/api/admin/world/content/${ai}`)).statusCode,404);
    const rows=(await app.inject(`/api/admin/world/content?q=${encodeURIComponent(url)}`)).json().rows;
    assert.deepEqual(rows.map((r:{ id:string })=>r.id),[world]);
    assert.equal((await app.inject(`/api/admin/world/content/${world}`)).statusCode,200);
    const headers={ 'x-csrf-token':'dev' };
    const installed=await app.inject({ method:'POST',url:'/api/admin/world/sources/install',payload:{},headers });
    assert.equal(installed.statusCode,200);
    assert.equal(installed.json().results.filter((r:{ created:boolean })=>r.created).length,6);
    const sources=(await app.inject('/api/admin/world/sources')).json().rows;
    assert.ok(sources.every((r:{ id:string })=>r.id!==ai));
    const sourceView=(await app.inject('/api/admin/world/sources/world-un-zh')).json();
    assert.equal(sourceView.sectionId,'world');assert.equal(sourceView.permission,null);
    assert.equal(sourceView.source.enabled,false);
  } finally { config.devAdmin=previous;await app.close(); }
});

test('legacy translation sweeps and story digest cannot spend on or rewrite world resources',async()=>{
  await sql`INSERT INTO publications (section_id,article_id,source_id,title,url,channel,eligible,selected,visibility,body_mode,discovered_at,timeline_at,sort_at)
    VALUES ('world',${world},${world},'World title',${url},'news',true,true,'public','full',now(),now(),now())`;
  assert.equal((await translateArticle(world)).status,'skipped');
  assert.deepEqual(await translatePending(),{ done:[],quotes:0 });
  assert.equal((await sql`SELECT 1 FROM translation_attempts WHERE article_id=${world}`).length,0);
  await sql`UPDATE stories SET digest='World digest remains intact' WHERE id=${storyId}`;
  assert.deepEqual(await composeStoryDigest(storyId),{ updated:false });
  assert.equal((await sql`SELECT digest FROM stories WHERE id=${storyId}`)[0]!.digest,'World digest remains intact');
  assert.equal((await sql`SELECT 1 FROM receipts`).length,0);
});
