import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('world content review and manual grouping submit fixed revision and independent world commands',async()=>{
  const commands:Array<{ path:string;body:any;csrf:unknown }>=[],reads:string[]=[];
  let visibility='private';
  const api=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://fixture');res.setHeader('Content-Type','application/json');
    if(req.method==='POST') {
      let text='';for await(const chunk of req) text+=String(chunk);const body=JSON.parse(text);
      commands.push({ path:url.pathname,body,csrf:req.headers['x-csrf-token'] });
      if(url.pathname==='/api/admin/world/items/world-item/review') visibility=body.action==='approve'?'public':'private';
      else if(url.pathname!=='/api/admin/world/items/world-item/grouping') { res.statusCode=400;return res.end('{}'); }
      return res.end('{}');
    }
    reads.push(url.pathname);
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname==='/api/admin/world/content') return res.end(JSON.stringify({ rows:[{ id:'world-item',title:'World content fixture',source:'World source',processing_state:'done',visibility,score:80,discovered_at:new Date().toISOString() }] }));
    if(url.pathname==='/api/admin/world/content/world-item') return res.end(JSON.stringify({ sectionId:'world',
      article:{ id:'world-item',source_id:'world-source',title:'World original fixture',revision:3,source_name:'World source',processing_state:'done',url:'https://fixture.invalid/news',published_at:null,backfill:false,processing_error:null },
      material:{ excerpt:'Actual RSS evidence, not invented background.',grouping_status:'complete' },
      publication:{ title:'World content fixture',summary:'World Chinese summary fixture',reason:'World reason',category:'politics',score:80,visibility },
      analyses:[{ id:5,input_revision:3,relevance:'pass',category:'politics',score:80,title_zh:'World content fixture',created_at:new Date().toISOString(),receipts:[] }],
      analysisDetails:[{ id:5,summary_zh:'World analysis summary',output:{ scores:[79,81] } }],membership:[],discoveries:[],revisions:[],decisions:[],history:[],deliveries:[],ledger:[],override:null }));
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    const page=await browser.newPage({ viewport:{ width:1365,height:900 } }),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{ if(['error','warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(`${web.origin}/admin/world/content`);await expect(page.getByRole('heading',{ name:'世界新闻内容',exact:true })).toBeVisible();
    await page.getByRole('link',{ name:'World content fixture',exact:true }).click();await expect(page).toHaveURL(/\/admin\/world\/content\/world-item$/);
    assert.match(await page.title(),/世界内容详情/);await expect(page.getByText('Actual RSS evidence, not invented background.',{ exact:true })).toBeVisible();
    await expect(page.getByText('World Chinese summary fixture',{ exact:true })).toBeVisible();
    for(const [label,action] of [['审核发布','approve'],['撤回内容','withdraw'],['移出事件','detach'],['改归属','move'],['重新归组','regroup']] as const) {
      await page.getByRole('button',{ name:label,exact:true }).click();const dialog=page.getByRole('dialog');
      await expect(dialog.getByRole('button',{ name:'确认',exact:true })).toBeDisabled();
      if(action==='move') await dialog.getByRole('textbox',{ name:'目标事实公开 ID' }).fill('world-target-fact');
      await dialog.getByPlaceholder('为什么做这个改动').fill(`Local ${action}`);
      await dialog.getByRole('button',{ name:'确认',exact:true }).click();await expect(dialog).toHaveCount(0);
      if(action==='approve') await expect(page.getByText('public',{ exact:true })).toBeVisible();
      if(action==='withdraw') await expect(page.getByText('private',{ exact:true })).toBeVisible();
    }
    await page.setViewportSize({ width:390,height:844 });assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const screenshot=join(tmpdir(),`world-admin-content-${process.pid}.png`);await page.screenshot({ path:screenshot });console.log(`Content UI evidence: ${screenshot}`);
    assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
    assert.equal(commands.length,5);assert.ok(commands.every(c=>c.path.startsWith('/api/admin/world/items/') && c.body.revision===3 && c.csrf==='dev'));
    assert.deepEqual(commands.map(c=>c.body.action),['approve','withdraw','detach','move','regroup']);
    assert.equal(commands[3]!.body.factPublicId,'world-target-fact');
    const ids=commands.slice(2).map(c=>c.body.requestId);assert.equal(new Set(ids).size,3);assert.ok(ids.every(id=>typeof id==='string' && id.length>=8));
    assert.ok(!reads.includes('/api/admin/content') && !reads.includes('/api/admin/nav-counts'));
  } finally { await browser.close();await web.stop(); }
});
