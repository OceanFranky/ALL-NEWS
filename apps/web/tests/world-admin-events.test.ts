import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('world event UI uses scoped targets and captures both versions for merge',async()=>{
  let merged=false;
  const commands:Array<{ path:string;body:any;csrf:unknown }>=[],reads:string[]=[];
  const rows=[{ id:1,public_id:'world-one',title:'World event one',version:4,fact_count:1,latest_at:null },{ id:2,public_id:'world-two',title:'World target two',version:7,fact_count:1,latest_at:null }];
  const api=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://fixture');res.setHeader('Content-Type','application/json');
    if(req.method==='POST') {
      let text='';for await(const chunk of req) text+=String(chunk);commands.push({ path:url.pathname,body:JSON.parse(text),csrf:req.headers['x-csrf-token'] });
      merged=true;return res.end('{}');
    }
    reads.push(url.pathname);
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname==='/api/admin/world/events') return res.end(JSON.stringify({ sectionId:'world',rows:rows.filter(r=>!merged || r.id!==1) }));
    if(url.pathname==='/api/admin/world/events/1') return res.end(JSON.stringify({ sectionId:'world',story:{ ...rows[0],merged_into:merged?2:null },
      facts:[{ id:11,public_id:'world-fact-one',title:'World fact fixture',occurred_at:null,version:1 }],
      reports:[{ fact_id:11,article_id:'world-item',role:'primary',manual:false,title:'World report fixture',revision:3,grouping_status:'complete' }] }));
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    const page=await browser.newPage({ viewport:{ width:1365,height:900 } }),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{ if(['error','warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(`${web.origin}/admin/world/events`);await expect(page.getByRole('heading',{ name:'世界新闻事件',exact:true })).toBeVisible();
    await page.getByRole('link',{ name:'World event one',exact:true }).click();await expect(page).toHaveURL(/\/admin\/world\/events\/1$/);
    assert.match(await page.title(),/世界新闻事件/);await expect(page.getByRole('cell',{ name:'world-fact-one',exact:true })).toBeVisible();
    await expect(page.getByRole('link',{ name:'World report fixture',exact:true })).toHaveAttribute('href','/admin/world/content/world-item');
    await page.getByRole('button',{ name:'合并到另一世界事件',exact:true }).click();const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('button',{ name:'确认',exact:true })).toBeDisabled();
    await expect(dialog.getByRole('combobox',{ name:'存续目标事件' }).locator('option')).toHaveCount(2);
    await dialog.getByRole('combobox',{ name:'存续目标事件' }).selectOption('2');
    await dialog.getByPlaceholder('为什么做这个改动').fill('Same concrete fixture event');
    await dialog.getByRole('button',{ name:'确认',exact:true }).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByText('已合并',{ exact:true })).toBeVisible();await expect(page.getByRole('link',{ name:'查看存续事件',exact:true })).toHaveAttribute('href','/admin/world/events/2');
    await page.setViewportSize({ width:390,height:844 });assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const screenshot=join(tmpdir(),`world-admin-event-${process.pid}.png`);await page.screenshot({ path:screenshot });console.log(`Event UI evidence: ${screenshot}`);
    assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
    assert.equal(commands.length,1);assert.equal(commands[0]!.path,'/api/admin/world/events/1/merge');assert.equal(commands[0]!.csrf,'dev');
    assert.deepEqual([commands[0]!.body.intoId,commands[0]!.body.fromVersion,commands[0]!.body.intoVersion],[2,4,7]);
    assert.match(commands[0]!.body.requestId,/^[\w-]{8,80}$/);
    assert.ok(!reads.includes('/api/admin/nav-counts'));
  } finally { await browser.close();await web.stop(); }
});
