import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import Fastify from 'fastify';
import { sql,closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { installModules } from '@aihot/backend/modules';
import { correctSectionGrouping,mergeSectionStories } from '@aihot/backend/events/section-corrections';
import { groupSectionArticle } from '@aihot/backend/events/section-group';
import { projectSectionArticle,reviewSectionPublication,reviewSectionSourcePermission } from '@aihot/backend/publication/section-publish';
import { sectionItem,sectionStory } from '@aihot/backend/publication/sections';
import { sectionEventDetail,listSectionEvents } from '@aihot/backend/admin/section-events';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { worldNewsModule } from '../server.ts';
import { registerWorldAdmin } from '../api/admin.ts';

const T=tag(),source=`correction-${T}`,actor='local-editor';let n=0;
before(async()=>{
  assert.match(sql.options.database,/_f\d+_test$/);installModules([worldNewsModule]);
  for(const section of ['ai','world']) await sql`INSERT INTO sources (section_id,id,name,kind,enabled)
    VALUES (${section},${`${source}-${section}`},'Synthetic fixture','rss',false)`;
  await reviewSectionSourcePermission('world',`${source}-world`,{ summaryAllowed:true,reference:'Synthetic local fixture only',actor });
});
after(async()=>{ await stopBoss();await closeDb(); });
async function fixture(section:'ai'|'world'='world',comment=false) {
  const id=`correct-${T}-${++n}`,publicId=randomUUID(),factPublicId=`fact-${id}`;
  const [story]=await sql<{ id:number }[]>`INSERT INTO stories (section_id,public_id,title,first_report_at,latest_at)
    VALUES (${section},${publicId},${`Event ${n}`},now(),now()) RETURNING id`;
  const [fact]=await sql<{ id:number }[]>`INSERT INTO facts (section_id,public_id,story_id,title,occurred_at)
    VALUES (${section},${factPublicId},${story!.id},'Policy announced',now()) RETURNING id`;
  await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,published_at,discovered_at,timeline_at,grouping_status)
    VALUES (${section},${id},${`${source}-${section}`},${id},${`https://fixture.invalid/${id}`},'Policy announcement',
      'Institution announced a policy effective Monday.',now(),now(),now(),'complete')`;
  const output={ scope:'single',contentType:comment ? 'opinion_analysis' : 'institutional_statement',scores:[80,80],
    fact:comment ? null : { title:'机构宣布政策',subject:'institution',action:'announced',object:'policy',occurredAt:null,conditions:[],evidence:'Institution announced a policy effective Monday.' } };
  await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,category,title_zh,summary_zh,reason_zh,score,output)
    VALUES (${section},${id},1,'rule','pass','economy','机构宣布政策','机构表示新政策将于周一生效。','了解政策变化',80,${sql.json(output)})`;
  await sql`INSERT INTO fact_articles (section_id,fact_id,article_id,role) VALUES (${section},${fact!.id},${id},${comment ? 'mention' : 'primary'})`;
  if(section==='world') await reviewSectionPublication('world',id,{ revision:1,action:'approve',reason:'Local fixture reviewed',actor });
  return { id,story:story!.id,fact:fact!.id,publicId,factPublicId };
}
const input=(action:'detach'|'regroup',requestId=randomUUID())=>({ action,revision:1,reason:'Correct local fixture',requestId });
const mergeInput=(intoId:number,fromVersion=1,intoVersion=1)=>({ intoId,fromVersion,intoVersion,reason:'Same concrete event confirmed by editor',requestId:randomUUID() });

test('detach atomically removes event evidence, updates projection and keeps a durable manual decision',async()=>{
  const a=await fixture(),command=input('detach');
  await correctSectionGrouping('world',a.id,command,actor);
  assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${a.id}`).length,0);
  assert.equal((await sectionItem('world',a.id))!.item.storyPublicId,null);
  assert.equal(await sectionStory('world',a.publicId),null);
  assert.equal((await sql`SELECT latest_at FROM stories WHERE id=${a.story}`)[0]!.latest_at,null);
  assert.equal((await groupSectionArticle('world',a.id)).verdict,'manual');
  await sql`UPDATE articles SET revision=2,grouping_status='pending' WHERE id=${a.id}`;
  await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,title_zh,summary_zh,output)
    SELECT section_id,article_id,2,origin,relevance,title_zh,summary_zh,output FROM analyses WHERE article_id=${a.id} AND input_revision=1`;
  assert.equal((await groupSectionArticle('world',a.id)).verdict,'manual');
  assert.equal((await sql`SELECT grouping_status FROM articles WHERE id=${a.id}`)[0]!.grouping_status,'complete');
  await correctSectionGrouping('world',a.id,command,actor);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${`world:content:${a.id}`} AND action='section.grouping.detach'`).length,1);
  await assert.rejects(correctSectionGrouping('world',a.id,{ ...command,reason:'Different request' },actor),/request id/);
});
test('move preserves manual ownership and comments stay mentions without evidence heat',async()=>{
  const a=await fixture(),target=await fixture(),comment=await fixture('world',true);
  const move={ revision:1,action:'move' as const,factPublicId:target.factPublicId,reason:'Correct target',requestId:randomUUID() };
  await correctSectionGrouping('world',a.id,move,actor);
  assert.equal((await sectionItem('world',a.id))!.item.storyPublicId,target.publicId);
  const [membership]=await sql`SELECT fact_id,role,manual FROM fact_articles WHERE article_id=${a.id}`;
  assert.equal(membership!.fact_id,target.fact);assert.equal(membership!.role,'report');assert.equal(membership!.manual,true);
  assert.equal((await sql`SELECT version FROM stories WHERE id=${target.story}`)[0]!.version,2);
  assert.equal((await groupSectionArticle('world',a.id)).verdict,'manual');
  await correctSectionGrouping('world',comment.id,{ ...move,requestId:randomUUID() },actor);
  assert.equal((await sql`SELECT role FROM fact_articles WHERE article_id=${comment.id}`)[0]!.role,'mention');
  assert.equal((await sql`SELECT 1 FROM story_signals WHERE article_id=${comment.id}`).length,0);
  assert.equal((await groupSectionArticle('world',comment.id)).verdict,'manual');
  const story=await sectionStory('world',target.publicId);
  assert.ok(story!.reports.some(r=>r.id===a.id));assert.ok(!story!.reports.some(r=>r.id===comment.id));
});
test('wrong-board corrections, targets and stale material revisions cannot mutate either section',async()=>{
  const ai=await fixture('ai'),world=await fixture();
  const before=await sql`SELECT to_jsonb(a) AS row FROM articles a WHERE id=${ai.id}`;
  await assert.rejects(correctSectionGrouping('world',ai.id,input('detach'),actor),/section mismatch/);
  await assert.rejects(correctSectionGrouping('ai',ai.id,input('detach'),actor),/legacy/);
  await assert.rejects(correctSectionGrouping('world',world.id,{ ...input('detach'),revision:2 },actor),/revision changed/);
  await assert.rejects(correctSectionGrouping('world',world.id,{ action:'move',revision:1,factPublicId:ai.factPublicId,
    requestId:randomUUID(),reason:'Invalid cross-board target' },actor),/outside this section/);
  assert.deepEqual(await sql`SELECT to_jsonb(a) AS row FROM articles a WHERE id=${ai.id}`,before);
  assert.equal((await sql`SELECT fact_id FROM fact_articles WHERE article_id=${world.id}`)[0]!.fact_id,world.fact);
});
test('regroup queue failure rolls back membership, projection and audit in the same transaction',async()=>{
  const a=await fixture(),before=await sql`SELECT to_jsonb(p) AS row FROM publications p WHERE article_id=${a.id}`;
  await assert.rejects(correctSectionGrouping('world',a.id,input('regroup'),actor,async()=>{ throw new Error('local queue failure'); }),/queue failure/);
  assert.equal((await sql`SELECT fact_id FROM fact_articles WHERE article_id=${a.id}`)[0]!.fact_id,a.fact);
  assert.deepEqual(await sql`SELECT to_jsonb(p) AS row FROM publications p WHERE article_id=${a.id}`,before);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${`world:content:${a.id}`} AND action='section.grouping.regroup'`).length,0);
});
test('regroup keeps manual reports and mentions, and never enqueues an automatic replacement',async()=>{
  const a=await fixture(),target=await fixture();
  await correctSectionGrouping('world',a.id,{ revision:1,action:'move',factPublicId:target.factPublicId,reason:'Manual target',requestId:randomUUID() },actor);
  let calls=0;
  const result=await correctSectionGrouping('world',a.id,input('regroup'),actor,async()=>{ calls++;return randomUUID(); });
  assert.equal(result.jobId,null);assert.equal(result.factId,target.fact);assert.equal(calls,0);
  assert.equal((await sectionItem('world',a.id))!.item.storyPublicId,target.publicId);
  const comment=await fixture('world',true);
  await correctSectionGrouping('world',comment.id,{ revision:1,action:'move',factPublicId:target.factPublicId,reason:'Manual mention',requestId:randomUUID() },actor);
  await correctSectionGrouping('world',comment.id,input('regroup'),actor,async()=>{ calls++;return randomUUID(); });
  assert.equal(calls,0);assert.equal((await groupSectionArticle('world',comment.id)).verdict,'manual');
});
test('event merges rebuild projections and resolve old aliases to a same-board readable survivor',async()=>{
  const a=await fixture(),b=await fixture(),c=await fixture();
  await sql`INSERT INTO story_links (section_id,story_id,other_id,relation) VALUES ('world',${a.story},${c.story},'related'),('world',${a.story},${b.story},'related')`;
  const command=mergeInput(b.story);
  await Promise.all([mergeSectionStories('world',a.story,command,actor),projectSectionArticle('world',a.id)]);
  assert.equal((await sectionItem('world',a.id))!.item.storyPublicId,b.publicId);
  assert.equal((await sectionStory('world',a.publicId))!.story.publicId,b.publicId);
  assert.equal((await sql`SELECT 1 FROM story_links WHERE story_id=${a.story} OR other_id=${a.story}`).length,0);
  assert.equal((await sql`SELECT 1 FROM story_links WHERE story_id=${b.story} AND other_id=${c.story}`).length,1);
  assert.equal((await mergeSectionStories('world',a.story,command,actor)).moved,1);
  assert.equal((await sql`SELECT version FROM stories WHERE id=${b.story}`)[0]!.version,2);
  await mergeSectionStories('world',b.story,mergeInput(c.story,2,1),actor);
  assert.equal((await sectionStory('world',a.publicId))!.story.publicId,c.publicId);
  assert.equal((await sectionStory('world',b.publicId))!.story.publicId,c.publicId);
  assert.equal((await sql`SELECT 1 FROM receipts`).length,0);
});
test('automatic grouping and simultaneous manual detach finish without restoring removed membership',async()=>{
  const a=await fixture();
  await Promise.all([groupSectionArticle('world',a.id),correctSectionGrouping('world',a.id,input('detach'),actor)]);
  assert.equal((await sql`SELECT 1 FROM fact_articles WHERE article_id=${a.id}`).length,0);
  assert.equal((await groupSectionArticle('world',a.id)).verdict,'manual');
  assert.equal((await sectionItem('world',a.id))!.item.storyPublicId,null);
});
test('projection failure during merge rolls back facts, aliases, versions and audit',async()=>{
  const a=await fixture(),b=await fixture(),command=mergeInput(b.story);
  await sql`CREATE FUNCTION reject_fixture_projection() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'local projection failure'; END $$`;
  await sql`CREATE TRIGGER reject_fixture_projection BEFORE UPDATE ON publications FOR EACH ROW EXECUTE FUNCTION reject_fixture_projection()`;
  try {
    await assert.rejects(mergeSectionStories('world',a.story,command,actor),/projection failure/);
    assert.equal((await sql`SELECT story_id FROM facts WHERE id=${a.fact}`)[0]!.story_id,a.story);
    assert.equal((await sql`SELECT version FROM stories WHERE id=${b.story}`)[0]!.version,1);
    assert.equal((await sql`SELECT merged_into FROM stories WHERE id=${a.story}`)[0]!.merged_into,null);
    assert.equal((await sql`SELECT 1 FROM story_aliases WHERE public_id=${a.publicId}`).length,0);
    assert.equal((await sql`SELECT 1 FROM audit_log WHERE request_id=${command.requestId}`).length,0);
  } finally {
    await sql`DROP TRIGGER reject_fixture_projection ON publications`;
    await sql`DROP FUNCTION reject_fixture_projection()`;
  }
});
test('cross-board merges and obsolete versions are rejected, competing merges serialize',async()=>{
  const ai=await fixture('ai'),a=await fixture(),b=await fixture();
  await assert.rejects(mergeSectionStories('world',a.story,mergeInput(ai.story),actor),/section mismatch/);
  await assert.rejects(mergeSectionStories('world',ai.story,mergeInput(a.story),actor),/section mismatch/);
  await assert.rejects(mergeSectionStories('world',a.story,mergeInput(b.story,2,1),actor),/changed/);
  const results=await Promise.allSettled([mergeSectionStories('world',a.story,mergeInput(b.story),actor),
    mergeSectionStories('world',b.story,mergeInput(a.story),actor)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await sql`SELECT merged_into,version FROM stories WHERE id=${ai.story}`)[0]!.merged_into,null);
  assert.equal(await sectionEventDetail('world',ai.story),null);
  assert.ok((await listSectionEvents('world')).rows.every(r=>r.id!==ai.story));
  assert.equal(await sectionStory('world',ai.publicId),null);
});
test('world admin event operations enforce login, CSRF, strict inputs, and durable queue replay',async()=>{
  const app=Fastify();registerWorldAdmin(app);const old=config.devAdmin;
  try {
    const a=await fixture(),ai=await fixture('ai');
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/world/events')).statusCode,401);
    config.devAdmin={ displayName:actor };
    assert.equal((await app.inject(`/api/admin/world/events/${ai.story}`)).statusCode,404);
    assert.equal((await app.inject('/api/admin/world/events?sectionId=ai')).statusCode,400);
    const url=`/api/admin/world/items/${a.id}/grouping`,payload=input('regroup');
    assert.equal((await app.inject({ method:'POST',url,payload })).statusCode,403);
    const headers={ 'x-csrf-token':'dev' };
    assert.equal((await app.inject({ method:'POST',url,headers,payload:{ ...payload,sectionId:'ai' } })).statusCode,400);
    const first=await app.inject({ method:'POST',url,headers,payload });assert.equal(first.statusCode,200,first.body);
    const jobId=first.json().jobId;assert.ok(jobId);
    const [job]=await sql`SELECT name,data FROM pgboss.job WHERE id=${jobId}`;
    assert.equal(job!.name,'world-news.group');assert.equal(job!.data.sectionId,'world');assert.equal(job!.data.articleId,a.id);
    assert.equal(await sectionItem('world',a.id),null);
    await sql`UPDATE articles SET grouping_status='complete' WHERE id=${a.id}`;
    const second=await app.inject({ method:'POST',url,headers,payload });assert.equal(second.json().jobId,jobId);
    assert.equal((await sql`SELECT grouping_status FROM articles WHERE id=${a.id}`)[0]!.grouping_status,'complete');
    assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE data->>'articleId'=${a.id}`).length,1);
    assert.equal((await app.inject(`/api/admin/world/events/${a.story}`)).statusCode,200);
  } finally { config.devAdmin=old;await app.close(); }
});
