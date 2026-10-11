import { tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { sectionItem, sectionItems } from "@aihot/backend/publication/sections";
import { projectSectionArticle, reviewSectionPublication, reviewSectionSourcePermission } from "@aihot/backend/publication/section-publish";
import { worldNewsModule } from "../server.ts";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { registerWorldAdmin } from "../api/admin.ts";

const T=tag(),source=`permission-${T}`;
before(async()=>{
  installModules([worldNewsModule]);
  await sql`INSERT INTO sources (section_id,id,name,kind,enabled,site_fulltext)
    VALUES ('world',${source},'Local world source','rss',false,true)`;
});
after(closeDb);
let n=0;
async function material(options:{ relevance?:string;category?:string;dated?:boolean;grouped?:boolean }={}) {
  const id=`projection-${T}-${++n}`;
  await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,published_at,discovered_at,timeline_at,grouping_status)
    VALUES ('world',${id},${source},${id},${`https://fixture.invalid/${id}`},'Bank announced policy','Evidence supplied by local fixture',
      ${options.dated===false ? null : new Date()},now(),now(),${options.grouped===false ? 'pending' : 'complete'})`;
  await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,category,title_zh,summary_zh,reason_zh,score)
    VALUES ('world',${id},1,'rule',${options.relevance ?? 'pass'},${options.category ?? 'economy'},'央行公布政策','机构表示新政策将于周一生效。','了解政策变化',90)`;
  return id;
}
const approve=(id:string,revision=1)=>reviewSectionPublication('world',id,{ revision,action:'approve',actor:'test-admin',reason:'Reviewed local fixture only' });
const permission=(allowed:boolean)=>reviewSectionSourcePermission('world',source,{ summaryAllowed:allowed,reference:'Local fixture license only',actor:'test-admin' });

test('uncalibrated results stay private; approval cannot bypass missing source permission',async()=>{
  const id=await material();
  assert.equal((await projectSectionArticle('world',id)).eligible,false);
  await assert.rejects(approve(id),/not ready/);
  assert.equal(await sectionItem('world',id),null);
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id=${id}`).length,0,'failed review rolls back');
});

test('reviewed summaries publish without exposing licensed full text, AI outputs, selection or sync',async()=>{
  await permission(true);
  const id=await material();
  assert.equal((await projectSectionArticle('world',id)).eligible,false,'permission alone is not rule calibration');
  const result=await approve(id);
  assert.equal(result.eligible,true);
  assert.equal(result.selected,false);
  const item=await sectionItem('world',id);
  assert.equal(item?.item.title,'央行公布政策');
  assert.equal(await sectionItem('ai',id),null);
  const [p]=await sql`SELECT body_mode,syndicate,indexable,selected FROM publications WHERE article_id=${id}`;
  assert.deepEqual(p,{ body_mode:'summary',syndicate:false,indexable:false,selected:false });
  assert.equal((await sql`SELECT 1 FROM selected_ledger WHERE article_id=${id}`).length,0);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject=${`world:content:${id}`}`).length,1);
});

test('withdrawal survives rebuild; source permission revocation hides already projected content immediately',async()=>{
  const id=await material();
  await approve(id);
  await reviewSectionPublication('world',id,{ revision:1,action:'withdraw',actor:'test-admin',reason:'Withdraw fixture' });
  await projectSectionArticle('world',id);
  assert.equal(await sectionItem('world',id),null);
  await approve(id);
  await permission(false);
  assert.equal(await sectionItem('world',id),null);
  assert.ok(!(await sectionItems('world')).items.some(x=>x.id===id));
  await permission(true);
});

test('material changes and new analysis invalidate old projection and revision-bound approval',async()=>{
  const id=await material();
  await approve(id);
  await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,category,title_zh,summary_zh)
    VALUES ('world',${id},1,'rule','pass','economy','政策更新','仅使用新增材料')`;
  assert.equal(await sectionItem('world',id),null,'latest analysis must be the projected analysis');
  assert.equal((await projectSectionArticle('world',id)).eligible,false,'approval does not carry to a different judgement');
  await approve(id);
  await sql`UPDATE articles SET revision=2 WHERE id=${id}`;
  assert.equal(await sectionItem('world',id),null,'no stale original is public between tasks');
  await assert.rejects(approve(id),/revision changed/);
  assert.equal((await projectSectionArticle('world',id)).eligible,false);
});

test('unknown, undated, ungrouped and out-of-section category remain private even with manual review',async()=>{
  for(const options of [{ relevance:'unknown' },{ dated:false },{ grouped:false },{ category:'model' }]) {
    const id=await material(options);
    await assert.rejects(approve(id),/not ready/);
    assert.equal(await sectionItem('world',id),null);
  }
});

test('wrong-section mutation is rejected without modifying AI projection or permissions',async()=>{
  const id=`ai-projection-${T}`;
  await sql`INSERT INTO sources (id,name,kind) VALUES (${id},'AI source','rss')`;
  await sql`INSERT INTO articles (id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES (${id},${id},${id},'https://fixture.invalid/ai','AI title',now(),now())`;
  await assert.rejects(projectSectionArticle('world',id),/mismatch/);
  await assert.rejects(reviewSectionSourcePermission('world',id,{ summaryAllowed:true,reference:'fixture',actor:'test' }),/mismatch/);
  await assert.rejects(approve(id),/mismatch/);
  await assert.rejects(projectSectionArticle('ai',id),/legacy/);
  assert.equal((await sql`SELECT 1 FROM publications WHERE article_id=${id}`).length,0);
});

test('world review endpoints reuse session and CSRF guards, reject invalid payloads and mismatched ownership',async()=>{
  const app=Fastify();
  registerWorldAdmin(app);
  const original=config.devAdmin;
  try {
    config.devAdmin=null;
    const url=`/api/admin/world/sources/${source}/permission`;
    const payload={ summaryAllowed:true,reference:'Local fixture only' };
    assert.equal((await app.inject({ method:'POST',url,payload })).statusCode,401);
    config.devAdmin={ displayName:'fixture admin' };
    assert.equal((await app.inject({ method:'POST',url,payload })).statusCode,403);
    const headers={ 'x-csrf-token':'dev' };
    assert.equal((await app.inject({ method:'POST',url,payload:{ ...payload,sectionId:'ai' },headers })).statusCode,400);
    assert.equal((await app.inject({ method:'POST',url,payload,headers })).statusCode,200);
    const id=await material();
    const reviewUrl=`/api/admin/world/items/${id}/review`;
    assert.equal((await app.inject({ method:'POST',url:reviewUrl,payload:{ revision:1,action:'approve',reason:'Fixture review' },headers })).statusCode,200);
    assert.equal((await app.inject({ method:'POST',url:reviewUrl,payload:{ revision:2,action:'withdraw',reason:'Stale fixture review' },headers })).statusCode,409);
    assert.equal((await app.inject({ method:'POST',url:`/api/admin/world/items/ai-projection-${T}/review`,payload:{ revision:1,action:'approve',reason:'Wrong board' },headers })).statusCode,404);
  } finally {
    config.devAdmin=original;
    await app.close();
  }
});

test('parallel rebuilds and review serialize without upgrading shared article locks',async()=>{
  const id=await material();
  await approve(id);
  const results=await Promise.all(Array.from({ length:12 },(_,i)=>i===0 ? approve(id) : projectSectionArticle('world',id)));
  assert.ok(results.every(r=>r.eligible));
  assert.ok(await sectionItem('world',id));
  assert.equal((await sql`SELECT 1 FROM publications WHERE article_id=${id}`).length,1);
});
