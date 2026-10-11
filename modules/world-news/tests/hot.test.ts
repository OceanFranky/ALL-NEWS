import { tag } from '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,beforeEach,after,test } from 'node:test';
import Fastify from 'fastify';
import { sql,closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { installModules } from '@aihot/backend/modules';
import { freezeSectionRules } from '@aihot/backend/sections/rules';
import { computeSectionHot } from '@aihot/backend/events/section-hot';
import { currentSectionHot } from '@aihot/backend/publication/section-hot';
import { sectionHot } from '@aihot/backend/publication/sections';
import { reviewSectionPublication,reviewSectionSourcePermission } from '@aihot/backend/publication/section-publish';
import { worldNewsModule } from '../server.ts';
import { WORLD_RULES } from '../rules.ts';
import { registerWorldAdmin } from '../api/admin.ts';

const T=tag(),sources=[0,1,2].map(n=>`world-hot-${T}-${n}`),now=new Date(),actor='local-fixture';
let n=0;
before(async()=>{
  assert.match(sql.options.database,/_f\d+_test$/);installModules([worldNewsModule]);
  for(const source of sources) {
    await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world',${source},${source},'rss',false)`;
    await reviewSectionSourcePermission('world',source,{ summaryAllowed:true,reference:'Synthetic local fixture only',actor });
  }
  await sql`INSERT INTO hot_rankings (section_id,rule_version,entries,published) VALUES ('ai','existing-ai','[]',true)`;
});
beforeEach(async()=>{
  installModules([worldNewsModule]);
  await sql`DELETE FROM publications WHERE section_id='world'`;
  await sql`DELETE FROM hot_rankings WHERE section_id='world'`;
});
after(closeDb);
const time=(hours:number)=>new Date(now.getTime()-hours*3600000);
async function fixture(options:{ story?:number;fact?:number;source?:number;hours?:number;scores?:unknown;type?:string;role?:string }={}) {
  const id=`hot-${T}-${++n}`,source=sources[options.source ?? 0]!,at=time(options.hours ?? 1);
  let story=options.story,fact=options.fact;
  if(!story) story=Number((await sql`INSERT INTO stories (section_id,public_id,title) VALUES ('world',${randomUUID()},${`事件 ${n}`}) RETURNING id`)[0]!.id);
  if(!fact) fact=Number((await sql`INSERT INTO facts (section_id,public_id,story_id,title,occurred_at) VALUES ('world',${id},${story},'政策变化',${at}) RETURNING id`)[0]!.id);
  await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,published_at,discovered_at,timeline_at,grouping_status)
    VALUES ('world',${id},${source},${id},${`https://fixture.invalid/${id}`},'Policy announcement','Institution announced a policy.',${at},now(),${at},'complete')`;
  await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,category,title_zh,summary_zh,reason_zh,score,output)
    VALUES ('world',${id},1,'rule','pass','economy','机构公布政策','机构表示政策将在下周生效。','了解政策变化',80,
      ${sql.json({ scope:'single',scores:options.scores ?? [80,80],contentType:options.type ?? 'news_report' } as never)})`;
  await sql`INSERT INTO fact_articles (section_id,fact_id,article_id,role) VALUES ('world',${fact},${id},${options.role ?? 'primary'})`;
  await reviewSectionPublication('world',id,{ revision:1,action:'approve',reason:'Local fixture reviewed',actor });
  return { id,story,fact };
}
const calibrated=()=>installModules([{ ...worldNewsModule,sections:[freezeSectionRules({ ...WORLD_RULES,
  selection:{ thresholds:{ T1:0,T2:0 },understandFloor:0 } })] }]);

test('uncalibrated generation is a private draft and never overwrites or consumes AI rankings',async()=>{
  await fixture();const result=await computeSectionHot('world',actor,now);
  assert.equal(result.status,'draft');assert.equal(result.entries,1);
  assert.equal((await currentSectionHot('world',now,true)).items.length,1);
  assert.equal((await sectionHot('world')).status,'calibration-required');
  assert.equal((await sql`SELECT published FROM hot_rankings WHERE section_id='world'`)[0]!.published,false);
  assert.equal((await sql`SELECT 1 FROM hot_rankings WHERE section_id='ai' AND rule_version='existing-ai'`).length,1);
  await assert.rejects(computeSectionHot('ai',actor),/legacy/);
  assert.equal((await sql`SELECT 1 FROM receipts`).length,0);
});
test('current evidence ranking uses dual scores rather than projection score and declared source groups',async()=>{
  const high=await fixture({ scores:[92,90],hours:72 });
  await fixture({ story:high.story,source:1,scores:[60,60] });
  const lower=await fixture({ scores:[90,90],source:0 });
  await fixture({ story:lower.story,source:1,scores:[90,90] });
  await fixture({ story:lower.story,source:2,scores:[90,90] });
  await sql`UPDATE sources SET signal_group_id='declared-shared-publisher' WHERE id IN (${sources[1]!},${sources[2]!})`;
  await computeSectionHot('world',actor,now);
  const ranking=await currentSectionHot('world',now,true);
  assert.deepEqual(ranking.items.map(e=>e.storyId),[high.story,lower.story]);
  assert.equal(ranking.items[0]!.importance,91);assert.equal(ranking.items[1]!.sourceCount,2);
  await sql`UPDATE sources SET signal_group_id=NULL WHERE section_id='world'`;
});
test('withdrawal, material revision and permission revocation immediately remove stale heat and representatives',async()=>{
  const first=await fixture({ scores:[90,90] }),second=await fixture({ story:first.story,fact:first.fact,source:1,scores:[80,80] });
  calibrated();await computeSectionHot('world',actor,now);
  assert.equal((await currentSectionHot('world',now)).items[0]!.representativeItemId,first.id);
  await reviewSectionPublication('world',first.id,{ revision:1,action:'withdraw',reason:'Withdraw fixture',actor });
  const current=await currentSectionHot('world',now);
  assert.equal(current.items[0]!.representativeItemId,second.id);assert.equal(current.items[0]!.importance,80);
  assert.equal(current.items[0]!.sourceCount,1);
  assert.equal(current.items[0]!.latestProgressAt,time(1).toISOString());
  assert.equal((await sectionHot('world')).items[0]!.item.id,second.id);
  await reviewSectionSourcePermission('world',sources[1]!,{ summaryAllowed:false,reference:'Fixture permission revoked',actor });
  assert.equal((await currentSectionHot('world',now)).items.length,0);
  assert.equal((await sectionHot('world')).items.length,0);
  await reviewSectionSourcePermission('world',sources[1]!,{ summaryAllowed:true,reference:'Synthetic local fixture only',actor });
  assert.equal((await currentSectionHot('world',now)).items.length,1);
  await sql`UPDATE articles SET revision=2 WHERE id=${second.id}`;
  assert.equal((await currentSectionHot('world',now)).items.length,0);
});
test('concurrent generation appends isolated snapshots and exposes the meaning of coverage heat',async()=>{
  await fixture();calibrated();
  const results=await Promise.all(Array.from({ length:4 },()=>computeSectionHot('world',actor,now)));
  assert.equal(new Set(results.map(r=>r.id)).size,4);
  assert.equal((await sql`SELECT 1 FROM hot_rankings WHERE section_id='world'`).length,4);
  assert.equal((await sql`SELECT 1 FROM hot_rankings WHERE section_id='ai' AND rule_version='existing-ai'`).length,1);
  const result=await sectionHot('world');
  assert.equal(result.status,'ready');assert.equal(result.items.length,1);
  assert.match(result.heatMeaning!,/not whole-web popularity or independent confirmation/);
  assert.equal(result.computedAt,now.toISOString());
});
test('changed hot policy requires regeneration rather than reusing a previous version',async()=>{
  await fixture();calibrated();await computeSectionHot('world',actor,now);
  installModules([{ ...worldNewsModule,sections:[freezeSectionRules({ ...WORLD_RULES,
    selection:{ thresholds:{ T1:0,T2:0 },understandFloor:0 },hot:{ ...WORLD_RULES.hot!,version:'local-changed-policy' } })] }]);
  assert.equal((await currentSectionHot('world',now)).status,'regeneration-required');
  assert.deepEqual((await sectionHot('world')).items,[]);
  await computeSectionHot('world',actor,now);
  assert.equal((await currentSectionHot('world',now)).status,'ready');
});
test('comment-only membership, inadequate scoring and inactive events do not create heat',async()=>{
  await fixture({ type:'opinion_analysis',scores:[100,100],role:'mention' });
  await fixture({ scores:[90] });await fixture({ hours:49 });
  assert.equal((await computeSectionHot('world',actor,now)).entries,0);
  assert.equal((await currentSectionHot('world',now,true)).items.length,0);
});
test('admin preview/generation requires login and CSRF, rejects extra board arguments and keeps snapshots as revisions',async()=>{
  const app=Fastify();registerWorldAdmin(app);const old=config.devAdmin;
  try {
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/world/hot')).statusCode,401);
    config.devAdmin={ displayName:actor };
    const url='/api/admin/world/hot/generate';
    assert.equal((await app.inject({ method:'POST',url,payload:{} })).statusCode,403);
    const headers={ 'x-csrf-token':'dev' };
    assert.equal((await app.inject({ method:'POST',url,payload:{ sectionId:'ai' },headers })).statusCode,400);
    await fixture();
    for(let i=0;i<2;i++) assert.equal((await app.inject({ method:'POST',url,payload:{},headers })).statusCode,200);
    assert.equal((await sql`SELECT 1 FROM hot_rankings WHERE section_id='world'`).length,2);
    assert.equal((await app.inject('/api/admin/world/hot')).json().status,'draft');
  } finally { config.devAdmin=old;await app.close(); }
});
