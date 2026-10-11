import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('world source pages install paused sources, navigate within world and record/revoke a summary reference',async()=>{
  const commands:Array<{ path:string;body:any;csrf:unknown }>=[],reads:string[]=[];
  let installed=false,permission:any=null;
  const source={ id:'world-fixture',name:'World source fixture',kind:'rss',tier:'T2',participation_mode:'editorial',enabled:false,health:'paused',
    interval_minutes:30,config:{ feedUrl:'https://fixture.invalid/rss' },site_fulltext:false,syndicate_fulltext:false,last_fetch_at:null,updated_at:new Date().toISOString() };
  const api=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://fixture');res.setHeader('Content-Type','application/json');
    if(req.method==='POST' || req.method==='PATCH') {
      let text='';for await(const chunk of req) text+=String(chunk);const body=JSON.parse(text);
      commands.push({ path:url.pathname,body,csrf:req.headers['x-csrf-token'] });
      if(url.pathname==='/api/admin/world/sources/install') installed=true;
      else if(url.pathname==='/api/admin/world/sources/world-fixture/permission') permission={ summary_allowed:body.summaryAllowed,permission_reference:body.reference,reviewed_by:'Fixture',reviewed_at:new Date().toISOString() };
      else if(url.pathname==='/api/admin/world/sources/world-fixture' && req.method==='PATCH') { source.enabled=body.patch.enabled;source.interval_minutes=body.patch.interval_minutes; }
      else if(url.pathname==='/api/admin/world/sources/world-fixture/preview') return res.end(JSON.stringify({ ms:1,count:1,items:[{ title:'Local preview material',url:'https://fixture.invalid/item',excerpt:'Actual fixture RSS text',publishedAt:null }] }));
      else if(url.pathname==='/api/admin/world/sources/world-fixture/fetch') return res.end(JSON.stringify({ sectionId:'world',status:'queued',job:'local-fixture' }));
      else { res.statusCode=400;return res.end('{}'); }
      return res.end('{}');
    }
    reads.push(url.pathname);
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname==='/api/admin/world/sources') return res.end(JSON.stringify({ page:1,rows:installed?[source]:[],totals:{ total:installed?1:0,enabled:0,failing:0,degraded:0 } }));
    if(url.pathname==='/api/admin/world/sources/world-fixture') return res.end(JSON.stringify({ sectionId:'world',source,permission,runs:[],items:[],stats:{ total:0,last7d:0,selected:0 },history:[],republish:null }));
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    const page=await browser.newPage({ viewport:{ width:1365,height:900 } }),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{ if(['error','warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(`${web.origin}/admin/world/sources`);
    await expect(page.getByRole('heading',{ name:'世界新闻信源',exact:true })).toBeVisible();assert.match(await page.title(),/世界新闻信源/);
    await expect(page.getByText('尚未登记世界来源',{ exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'登记六个候选源',exact:true }).click();
    await expect(page.getByRole('cell',{ name:'暂停',exact:true })).toBeVisible();
    await page.getByRole('link',{ name:'World source fixture',exact:true }).click();
    await expect(page).toHaveURL(/\/admin\/world\/sources\/world-fixture$/);
    await expect(page.getByRole('heading',{ name:'World source fixture',exact:true })).toBeVisible();
    await expect(page.getByText('尚未记录许可',{ exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'记录许可依据',exact:true }).click();const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('button',{ name:'保存许可依据',exact:true })).toBeDisabled();
    await dialog.getByRole('combobox',{ name:'摘要使用状态' }).selectOption('true');
    await dialog.getByPlaceholder('为什么做这个改动').fill('Local fixture authorization only');
    await dialog.getByRole('button',{ name:'保存许可依据',exact:true }).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByText('已记录摘要许可',{ exact:true })).toBeVisible();
    await expect(page.getByText('Local fixture authorization only',{ exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'记录许可依据',exact:true }).click();
    await dialog.getByRole('combobox',{ name:'摘要使用状态' }).selectOption('false');
    await dialog.getByPlaceholder('为什么做这个改动').fill('Fixture revocation');
    await dialog.getByRole('button',{ name:'保存许可依据',exact:true }).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByText('摘要许可已撤销',{ exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'修改启停与频率',exact:true }).click();
    await dialog.getByRole('combobox',{ name:'来源状态' }).selectOption('true');
    await dialog.getByRole('spinbutton',{ name:'采集间隔（分钟）' }).fill('60');
    await dialog.getByPlaceholder('为什么做这个改动').fill('Enable local world source');
    await dialog.getByRole('button',{ name:'确认',exact:true }).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByText('启用',{ exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'只读试抓',exact:true }).click();
    await expect(page.getByRole('cell',{ name:'Local preview material',exact:true })).toBeVisible();
    await expect(page.getByRole('cell',{ name:'Actual fixture RSS text',exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'采集一次',exact:true }).click();
    await dialog.getByPlaceholder('为什么做这个改动').fill('Queue local world collection');
    await dialog.getByRole('button',{ name:'确认',exact:true }).click();await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width:390,height:844 });assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const screenshot=join(tmpdir(),`world-admin-source-${process.pid}.png`);await page.screenshot({ path:screenshot });console.log(`Source UI evidence: ${screenshot}`);
    assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
    assert.equal(commands.length,6);assert.ok(commands.every(c=>c.path.startsWith('/api/admin/world/sources') && c.csrf==='dev'));
    assert.deepEqual(commands.filter(c=>c.path.endsWith('/permission')).map(c=>c.body.summaryAllowed),[true,false]);
    assert.deepEqual(commands.find(c=>c.path==='/api/admin/world/sources/world-fixture')!.body.patch,{ enabled:true,interval_minutes:60 });
    assert.ok(!reads.includes('/api/admin/sources') && !reads.includes('/api/admin/nav-counts'));
  } finally { await browser.close();await web.stop(); }
});
