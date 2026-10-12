import { tag,stub,pointModels } from '../../../tests/setup.ts';
import { analysisStep,SELECTING_SCORE } from '../../../tests/analysis-steps.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { before,after,test } from 'node:test';
import { PRESETS } from '@aihot/site/models';
import { beijingDate } from '@aihot/contracts/time';
import { sql,closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { installModules } from '@aihot/backend/modules';
import { getBoss,workModuleQueues,stopBoss } from '@aihot/backend/jobs/queue';
import { registerContentJobs,queueProcessing } from '@aihot/backend/jobs/content';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { worldNewsModule } from '../server.ts';
import { queueWorldCollection } from '../jobs.ts';
import { buildApp } from '../../../apps/api/src/app.ts';
import { freezeSectionRules } from '@aihot/backend/sections/rules';
import { projectSectionArticle } from '@aihot/backend/publication/section-publish';
import { WORLD_RULES } from '../rules.ts';

const T=tag(),date=beijingDate(new Date()),at=`${date}T09:00:00+08:00`,actor='Workflow fixture';
const rate='The central bank announced a rate cut of 0.25 percentage points, effective Monday.';
const sanctions='The council imposed sanctions on named officials, effective tomorrow.';
const talks='The government announced a peace meeting next week at the capital.';
const requests:Array<{ section:string;system:string;user:string;model:string }>=[];
const provider=await stub((_hit,req)=>{
  const body=JSON.parse(req.body),system=String(body.messages[0]?.content ?? ''),user=String(body.messages.at(-1).content);
  let data:unknown,section:string;
  if(system.includes('世界新闻')) {
    section='world';
    if(system.includes('判定顺序')) data={ label:'PASS',reason:'Actual supplied policy or security action' };
    else if(system.includes('整理一件具体世界新闻事件')) data={ digest:'机构宣布了一项有材料依据的具体决定。',latest:'机构宣布决定。' };
    else if(system.includes('材料充分性先于公开')) {
      const input=JSON.parse(user),text=input.rssText,category=text===rate?'economy':'security';
      data={ scope:'single',category,contentType:'institutional_statement',materialSufficient:true,tags:[],subjects:[],
        fact:{ title:input.title,subject:text===rate?'central bank':'government',action:'announced',object:input.title,
          occurredAt:null,evidence:text,conditions:[] } };
    } else if(system.includes('五轴：')) data={ attentionScore:80 };
    else if(system.includes('SAME_OCCURRENCE')) {
      const input=JSON.parse(user);
      data={ a:input.A.title,b:input.B.title,relation:input.A.rssText===input.B.rssText?'SAME_OCCURRENCE':'UNRELATED',confidence:0.99,note:'Compare exact local occurrence evidence' };
    } else {
      const input=JSON.parse(user);
      data={ materialSufficient:true,titleZh:`世界：${input.title}`,summaryZh:`机构表示：${input.rssText}`,reasonZh:'提供明确政策动作和时间。' };
    }
  } else {
    section='ai';const step=analysisStep(req.body);
    if(step==='prefilter') data={ label:'PASS',reason:'Model release' };
    else if(step==='score') data={ attentionScore:SELECTING_SCORE };
    else if(step==='structure') data={ category:'ai-models',tags:['模型发布'],subjects:['anthropic'],scope:'single',
      fact:{ title:'Anthropic model release',subject:'Anthropic',action:'released',object:'model',occurredAt:null,evidence:'Anthropic released a model.',conditions:[] } };
    else if(step==='understand') data={ itemType:'model_release',authorRole:'principal',tags:['模型发布'],editorialJudgment:'AI fixture only',titleZh:'Anthropic 发布模型',summaryZh:'Anthropic 发布模型，提供定价和评测结果。' };
    else data='title_zh: Anthropic 发布模型\nsummary_zh: Anthropic 发布模型，提供定价和评测结果。';
  }
  requests.push({ section,system,user,model:body.model });
  return { choices:[{ message:{ content:typeof data==='string'?data:JSON.stringify(data) } }],usage:{ prompt_tokens:100,completion_tokens:100 } };
});
pointModels(provider.url,Object.keys(PRESETS));
process.env.LLM_BASE_URL=`${provider.url}/v1`;process.env.LLM_API_KEY='test-key';process.env.LLM_MODEL='world-local-model';
const listings=http.createServer((req,res)=>{
  if(req.url==='/rss') {
    res.setHeader('Content-Type','application/rss+xml');res.end(`<rss version="2.0"><channel><title>Local RSS</title>
      <item><title>Bank rate cut</title><link>https://fixture.invalid/${T}/rss-rate</link><pubDate>${new Date(at).toUTCString()}</pubDate><description>${rate}</description></item>
      <item><title>Title only</title><link>https://fixture.invalid/${T}/thin</link><pubDate>${new Date(at).toUTCString()}</pubDate></item></channel></rss>`);
  } else if(req.url==='/html') {
    res.setHeader('Content-Type','text/html');res.end(`<article><a href="https://fixture.invalid/${T}/html-rate">Bank rate cut</a><p>${rate}</p><time datetime="${date} 09:00:00"></time></article>
      <article><a href="https://fixture.invalid/${T}/sanctions">Council sanctions</a><p>${sanctions}</p><time datetime="${at}"></time></article>`);
  } else if(req.url==='/json') {
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ items:[
      { title:'Bank rate cut',url:`https://fixture.invalid/${T}/json-rate`,summary:rate,at },
      { title:'Peace meeting',url:`https://fixture.invalid/${T}/talks`,summary:talks,at },
    ] }));
  } else { res.statusCode=404;res.end('No full-text fixture'); }
});
await new Promise<void>(resolve=>listings.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${(listings.address() as { port:number }).port}`,sid=(kind:string)=>`workflow-${T}-${kind}`;
let app:Awaited<ReturnType<typeof buildApp>>,aiId:string;
const oldAdmin=config.devAdmin;
before(async()=>{
  installModules([worldNewsModule]);config.allowPrivateNetworkFetch=true;config.devAdmin={ displayName:actor };
  await sql`INSERT INTO section_budgets VALUES ('world','llm',200,200,200)`;
  for(const [kind,cfg] of [
    ['rss',{ feedUrl:`${base}/rss` }],
    ['web_list',{ url:`${base}/html`,itemSelector:'article',linkSelector:'a',titleSelector:'a',summarySelector:'p',publishedAtSelector:'time',publishedAtUtcOffset:'+08:00' }],
    ['json_list',{ url:`${base}/json`,itemsPath:'items',titlePaths:['title'],summaryPaths:['summary'],urlTemplate:'{raw:url}',publishedAtPath:'at',publishedAtUtcOffset:'+08:00' }],
  ] as const) await sql`INSERT INTO sources (section_id,id,name,kind,config,enabled) VALUES ('world',${sid(kind)},${kind},${kind},${sql.json(cfg)},false)`;
  await sql`INSERT INTO sources (id,name,kind,tier,enabled) VALUES (${sid('ai')},'AI fixture','rss','T1',false)`;
  aiId=(await upsertMaterial({ sourceId:sid('ai'),via:'fetch',url:`https://fixture.invalid/${T}/rss-rate`,
    title:'Anthropic model release',bodyText:'Anthropic released a model. Pricing and benchmarks are available. '.repeat(8),bodyStatus:'ok',publishedAt:new Date(at) })).articleId;
  const boss=await getBoss();await workModuleQueues(boss);await registerContentJobs(boss);
  app=await buildApp();
});
after(async()=>{ config.devAdmin=oldAdmin;await stopBoss();await app?.close();await provider.close();await new Promise<void>(resolve=>listings.close(()=>resolve()));await closeDb(); });

async function until(done:()=>Promise<boolean>,message:string) {
  const deadline=Date.now()+60000;
  while(Date.now()<deadline) { if(await done()) return;await setTimeout(200); }
  const jobs=await sql`SELECT name,state,output FROM pgboss.job ORDER BY created_on`;
  assert.fail(`${message}: ${JSON.stringify(jobs)}`);
}
const headers={ 'x-csrf-token':'dev' };
async function post(path:string,payload:Record<string,unknown>={}) {
  const result=await app.inject({ method:'POST',url:path,headers,payload });
  assert.equal(result.statusCode,200,`${path}: ${result.body}`);return result.json();
}

test('actual world queues connect RSS HTML JSON analysis grouping publication hot daily and withdrawal while AI analysis runs independently',async()=>{
  await Promise.all([queueProcessing(aiId,{ step:'analyze' }),...['rss','web_list','json_list'].map(kind=>queueWorldCollection({ sectionId:'world',sourceId:sid(kind),force:true }))]);
  await until(async()=>{
    const [counts]=await sql`SELECT (SELECT count(*) FROM analyses WHERE section_id='world')::int AS analyses,
      (SELECT count(*) FROM publications WHERE section_id='world')::int AS projected,
      (SELECT count(*) FROM analyses WHERE section_id='ai' AND article_id=${aiId})::int AS ai,
      (SELECT count(*) FROM pgboss.job WHERE name LIKE 'world-news.%' AND state IN ('created','retry','active'))::int AS pending`;
    return counts!.analyses===6 && counts!.projected===5 && counts!.ai===1 && counts!.pending===0;
  },'queue chain did not settle');
  const world=await sql`SELECT a.id,a.source_id,a.title,a.url,a.published_at,a.backfill,an.relevance,an.category
    FROM articles a JOIN analyses an ON an.article_id=a.id AND an.section_id=a.section_id WHERE a.section_id='world'`;
  assert.equal(world.length,6);assert.equal(world.filter(a=>a.relevance==='pass').length,5);
  assert.equal(world.find(a=>a.title==='Title only')!.relevance,'unknown');
  assert.ok(world.every(a=>a.published_at.toISOString()===new Date(at).toISOString() && !a.backfill));
  assert.notEqual(world.find(a=>a.url===`https://fixture.invalid/${T}/rss-rate`)!.id,aiId);
  const [ai]=await sql`SELECT category FROM analyses WHERE article_id=${aiId}`;assert.equal(ai!.category,'ai-models');
  assert.ok(world.filter(a=>a.relevance==='pass').every(a=>['economy','security'].includes(a.category)));
  const rateFacts=await sql`SELECT DISTINCT f.id FROM facts f JOIN fact_articles fa ON fa.fact_id=f.id AND fa.section_id=f.section_id
    JOIN articles a ON a.id=fa.article_id AND a.section_id=fa.section_id WHERE f.section_id='world' AND a.excerpt=${rate}`;
  assert.equal(rateFacts.length,1,'three independent reports of the same occurrence share one fact');
  assert.equal((await sql`SELECT 1 FROM stories WHERE section_id='world'`).length,3);
  assert.ok(requests.some(r=>r.section==='ai') && requests.some(r=>r.section==='world'));
  assert.ok(requests.filter(r=>r.section==='world').every(r=>r.model==='world-local-model'));
  assert.ok(requests.filter(r=>r.section==='ai').every(r=>r.model!=='world-local-model'));
  const receipts=await sql`SELECT r.section_id,r.subject,r.purpose FROM receipts r`;
  assert.ok(receipts.filter(r=>r.section_id==='world').every(r=>r.purpose.startsWith('world.')
    && (world.some(a=>a.id===r.subject) || r.purpose==='world.story-digest' && String(r.subject).startsWith('story:'))));
  assert.ok(receipts.filter(r=>r.section_id==='ai').every(r=>r.subject===`article:${aiId}@1` && !r.purpose.startsWith('world.')),JSON.stringify(receipts));
  assert.equal((await app.inject('/api/v1/world/items')).json().count,0,'uncalibrated/unreviewed is not publicly admitted');
  for(const kind of ['rss','web_list','json_list']) await post(`/api/admin/world/sources/${sid(kind)}/permission`,{ summaryAllowed:true,reference:'Synthetic local fixture permission only' });
  for(const a of world.filter(a=>a.relevance==='pass')) await post(`/api/admin/world/items/${a.id}/review`,{ revision:1,action:'approve',reason:'Review synthetic fixture only' });
  await until(async()=>{
    const [state]=await sql`SELECT (SELECT count(*)::int FROM stories WHERE section_id='world' AND digest IS NOT NULL) AS digests,
      (SELECT count(*)::int FROM pgboss.job WHERE name='world-news.digest' AND state IN ('created','retry','active')) AS pending`;
    return state!.digests===3 && state!.pending===0;
  },'world story digests did not settle');
  const beforeReads=provider.hits();
  const list=(await app.inject('/api/v1/world/items')).json();assert.equal(list.count,5);assert.ok(list.items.every((a:any)=>a.id!==aiId));
  assert.equal(list.pagination.total,5);
  assert.equal(list.days.reduce((sum:number,day:{ count:number })=>sum+day.count,0),5);
  const firstPage=(await app.inject('/api/v1/world/items?limit=2&page=1')).json();
  const secondPage=(await app.inject('/api/v1/world/items?limit=2&page=2')).json();
  const thirdPage=(await app.inject('/api/v1/world/items?limit=2&page=3')).json();
  assert.deepEqual([firstPage.count,secondPage.count,thirdPage.count],[2,2,1]);
  assert.deepEqual([firstPage.pagination.hasMore,secondPage.pagination.hasMore,thirdPage.pagination.hasMore],[true,true,false]);
  assert.equal(new Set([...firstPage.items,...secondPage.items,...thirdPage.items].map((item:any)=>item.id)).size,5);
  const economy=(await app.inject('/api/v1/world/items?category=economy&limit=1&page=2')).json();
  assert.equal(economy.pagination.total,3);
  assert.equal(economy.days.reduce((sum:number,day:{ count:number })=>sum+day.count,0),3);
  assert.equal(economy.count,1);
  const cards=(await app.inject('/api/v1/world/highlights')).json();
  assert.equal(cards.status,'calibration-required');
  assert.deepEqual(cards.categories.map((c:any)=>c.key),['politics','economy','security']);
  assert.ok(cards.categories.every((c:any)=>c.lead===null));
  assert.equal(cards.categories.find((c:any)=>c.key==='economy').briefs.length,3);
  const legacy=(await app.inject('/api/v1/items?mode=all')).json();assert.ok(legacy.items.every((a:any)=>!world.some(w=>w.id===a.id)));
  const events=(await app.inject('/api/v1/world/stories')).json();assert.equal(events.items.length,3);
  const story=(await app.inject(`/api/v1/world/stories/${events.items[0].publicId}`)).json();
  assert.match(story.story.digest,/具体决定/);
  assert.ok(requests.some(r=>r.section==='world' && r.system.includes('整理一件具体世界新闻事件')));
  await post('/api/admin/world/hot/generate');
  const hot=(await app.inject('/api/admin/world/hot')).json();assert.equal(hot.status,'draft');assert.equal(hot.items.length,3);
  assert.equal((await app.inject('/api/v1/world/hot')).json().status,'calibration-required');
  const daily=await post(`/api/admin/world/daily/${date}/generate`);
  assert.equal(daily.content.focus.length+daily.content.flashes.length,3,'daily deduplicates the same concrete event');
  assert.equal((await app.inject(`/api/v1/world/daily/${date}`)).statusCode,404,'draft is admin-only');
  await post(`/api/admin/world/daily/${date}/review`,{ revision:daily.revision,action:'approve',reason:'Review local draft' });
  const approved=(await app.inject(`/api/v1/world/daily/${date}`)).json();assert.equal(approved.focus.length+approved.flashes.length,3);
  const another=await post(`/api/admin/world/daily/${date}/generate`);assert.equal(another.revision,daily.revision+1);
  assert.deepEqual((await app.inject(`/api/v1/world/daily/${date}`)).json(),approved,'new draft does not replace the approved revision');
  const removed=daily.content.focus[0].itemId;
  await post(`/api/admin/world/items/${removed}/review`,{ revision:1,action:'withdraw',reason:'Withdraw local fixture' });
  assert.equal((await app.inject(`/api/v1/world/items/${removed}`)).statusCode,404);
  assert.equal((await app.inject('/api/v1/world/items')).json().count,4);
  assert.equal((await app.inject('/api/v1/world/items?limit=2&page=2')).json().pagination.total,4);
  assert.ok(!JSON.stringify((await app.inject('/api/admin/world/hot')).json()).includes(removed));
  assert.ok(!JSON.stringify((await app.inject(`/api/v1/world/daily/${date}`)).json()).includes(removed));
  assert.equal(provider.hits(),beforeReads,'review daily hot and all public reads do not invoke models');
  const rateStory=list.items.find((item:any)=>item.category==='economy')?.storyPublicId;
  assert.ok(rateStory);
  await post(`/api/admin/world/sources/${sid('rss')}/permission`,{ summaryAllowed:false,reference:'Synthetic fixture permission revoked' });
  const reduced=(await app.inject(`/api/v1/world/stories/${rateStory}`)).json();
  assert.equal(reduced.story.digest,null,'digest cannot survive loss of a cited public report');
  await post(`/api/admin/world/sources/${sid('rss')}/permission`,{ summaryAllowed:true,reference:'Synthetic local fixture permission only' });
  console.log(JSON.stringify({ evidence:'local queued workflow',worldMaterials:6,worldPass:5,worldPending:1,worldEvents:3,dailyEvents:3,
    aiConcurrentAnalysis:1,fakeProviderCalls:provider.hits(),realCalls:0 }));
});

test('the queued results support calibrated automatic publication, ordinary content and public hot without further model calls',async()=>{
  const before=provider.hits();
  installModules([{ ...worldNewsModule,sections:[freezeSectionRules({ ...WORLD_RULES,
    selection:{ thresholds:{ default:80 },understandFloor:null } })] }]);
  try {
    const rows=await sql`SELECT article_id FROM publications WHERE section_id='world' AND visibility='public' ORDER BY article_id`;
    assert.equal(rows.length,4);
    // Remove only the synthetic approvals: the next projection must use calibration, not manual approval.
    await sql`DELETE FROM editorial_overrides WHERE article_id=ANY(${rows.map(r=>r.article_id)}::text[])`;
    const ordinary=rows[0]!.article_id;
    await sql`UPDATE analyses SET output=jsonb_set(output,'{scores}','[79,80]'::jsonb)
      WHERE section_id='world' AND article_id=${ordinary}`;
    for(const row of rows) await projectSectionArticle('world',row.article_id);
    const list=(await app.inject('/api/v1/world/items')).json();
    assert.equal(list.count,4);assert.equal(list.items.filter((r:any)=>r.selected).length,3);
    assert.equal(list.items.find((r:any)=>r.id===ordinary).selected,false);
    await post('/api/admin/world/hot/generate');
    assert.equal((await app.inject('/api/v1/world/hot')).json().status,'ready');
    assert.ok((await app.inject('/api/v1/world/hot')).json().items.length>0);
    const cards=(await app.inject('/api/v1/world/highlights')).json();
    assert.equal(cards.status,'ready');
    assert.ok(cards.categories.some((c:any)=>c.lead));
    const daily=await post(`/api/admin/world/daily/${date}/generate`);
    assert.ok(daily.content.focus.length>0);
    assert.equal((await app.inject(`/api/admin/world/daily/${date}`)).json().revisions[0]?.status ?? daily.status,'draft');
    assert.equal(provider.hits(),before,'automatic projections and downstream compilation are model-free');
    assert.equal((await sql`SELECT 1 FROM selected_ledger l JOIN articles a ON a.id=l.article_id WHERE a.section_id='world'`).length,0);
  } finally { installModules([worldNewsModule]); }
});
