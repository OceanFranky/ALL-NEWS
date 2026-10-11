import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('world recovery records explicit billing result and preserves command identity on rejection and retry',async()=>{
  const commands:Array<{ path:string;body:any;csrf:unknown;key:unknown }>=[],reads:string[]=[];
  let restored=false;
  const version='2026-10-11T12:00:00.000Z';
  const api=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://fixture');res.setHeader('Content-Type','application/json');
    if(req.method==='POST') {
      let text='';for await(const chunk of req) text+=String(chunk);
      commands.push({ path:url.pathname,body:JSON.parse(text),csrf:req.headers['x-csrf-token'],key:req.headers['idempotency-key'] });
      if(commands.length===1) { res.statusCode=409;return res.end(JSON.stringify({ detail:'Fixture operation rejected' })); }
      restored=true;return res.end(JSON.stringify({ sectionId:'world',receiptId:21,jobId:'world-job' }));
    }
    reads.push(url.pathname);
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname==='/api/admin/world/runs') return res.end(JSON.stringify({ sectionId:'world',checkedAt:version,
      counts:{ sources:0,articles:1,events:0 },processing:{ failed:1 },grouping:{ pending:1 },
      queues:[],failedJobs:[],sources:[],timeline:[],fetches:[],budgetStatus:'not-configured',budgets:[],
      receipts:{ counts:restored?{}:{ unknown:1 },issues:restored?[]:[{ id:21,service:'llm',purpose:'world.structure',status:'unknown',error:'Lost reply',updated_at:version }] } }));
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    const page=await browser.newPage({ viewport:{ width:1365,height:900 } }),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{ if(['error','warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(`${web.origin}/admin/world/runs`);
    await page.getByRole('button',{ name:'刷新状态',exact:true }).click();await expect(page.getByRole('button',{ name:'刷新状态',exact:true })).toBeEnabled();
    await page.getByRole('button',{ name:'核对并恢复',exact:true }).click();const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('button',{ name:'确认',exact:true })).toBeDisabled();
    await dialog.getByPlaceholder('为什么做这个改动').fill('Local bill checked');
    await dialog.getByRole('button',{ name:'确认',exact:true }).click();assert.equal(commands.length,0,'billing choice must not be inferred');
    await dialog.getByRole('combobox',{ name:'供应商账单核对' }).selectOption('yes');
    await page.setViewportSize({ width:390,height:844 });assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const screenshot=join(tmpdir(),`world-admin-recovery-${process.pid}.png`);await page.screenshot({ path:screenshot });console.log(`Recovery UI evidence: ${screenshot}`);
    await dialog.getByRole('button',{ name:'确认',exact:true }).click();
    await expect(page.getByText('Fixture operation rejected',{ exact:true })).toBeVisible();await expect(dialog).toBeVisible();
    await dialog.getByRole('button',{ name:'确认',exact:true }).click();await expect(dialog).toHaveCount(0);
    await expect(page.getByText('没有待核对回执',{ exact:true })).toBeVisible();
    assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);
    assert.equal(commands[0]!.path,'/api/admin/world/receipts/21/release');assert.equal(commands[0]!.csrf,'dev');
    assert.deepEqual({ ...commands[0]!.body,requestId:'stable' },{ version,billed:true,reason:'Local bill checked',requestId:'stable' });
    assert.ok(commands[0]!.body.requestId.length>=8);assert.ok(commands[0]!.key);
    assert.ok(!reads.includes('/api/admin/nav-counts') && !reads.includes('/api/admin/runs'));
    assert.equal(await page.locator('vite-error-overlay').count(),0);
    // Chromium logs the deliberately injected 409; any other browser error still fails the test.
    assert.ok(errors.every(e=>e==='Failed to load resource: the server responded with a status of 409 (Conflict)'),JSON.stringify(errors));
  } finally { await browser.close();await web.stop(); }
});
