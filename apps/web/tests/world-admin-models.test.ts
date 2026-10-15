import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('world model controls switch and reset only world endpoints, preserving currency rows and time filters',async()=>{
  const overrides=new Map<string,string>(),history:unknown[]=[];
  const commands:Array<{ path:string;payload:{ model:string|null;reason:string };csrf:string|undefined;key:string|undefined }>=[];
  const reads:string[]=[];
  const steps=['prefilter','score','structure','understand','summarize','group','groupReview','digest'];
  const api=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://fixture');res.setHeader('Content-Type','application/json');
    if(req.method==='POST') {
      let body='';for await(const chunk of req) body+=String(chunk);
      const payload=JSON.parse(body);
      commands.push({ path:url.pathname,payload,csrf:req.headers['x-csrf-token'] as string|undefined,key:req.headers['idempotency-key'] as string|undefined });
      if(url.pathname!=='/api/admin/world/models/score') { res.statusCode=400;return res.end('{}'); }
      if(payload.model===null) overrides.delete('score');else overrides.set('score',payload.model);
      history.unshift({ at:new Date().toISOString(),actor:'Local fixture',subject:'world:model:score',reason:payload.reason,before:null,after:{ model:payload.model ?? 'default' } });
      return res.end(JSON.stringify({ sectionId:'world',after:payload.model ?? 'default' }));
    }
    reads.push(url.pathname);
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Local fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname==='/api/admin/world/models') return res.end(JSON.stringify({ sectionId:'world',days:Number(url.searchParams.get('days') ?? 7),
      capabilities:steps.map(key=>({ key,defaultModel:'default',current:{ model:overrides.get(key) ?? 'default',source:overrides.has(key)?'admin':'section-default' } })),
      choices:[{ key:'fixture-world-model',service:'llm',vision:false }],
      usage:['CNY','USD',null].map((currency,i)=>({ purpose:'world.score-1',model:'fixture-world-model',promptVersion:'fixture-version',
        calls:1,ok:1,failed:0,unknown:0,p50:100,p95:100,tokensIn:10,tokensOut:20,actualCost:currency===null?null:i+1,currency })),history }));
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    for(const viewport of [{ width:1365,height:900 },{ width:390,height:844 }]) {
      const page=await browser.newPage({ viewport }),errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',msg=>{ if(msg.type()==='error' || msg.type()==='warning') errors.push(msg.text()); });
      await page.goto(`${web.origin}/admin/world/models`);
      await expect(page.getByRole('heading',{ name:'世界新闻模型',exact:true })).toBeVisible();
      assert.match(await page.title(),/世界新闻模型/);
      const rows=page.locator('tbody tr').filter({ hasText:'world.score-1' });
      await expect(rows).toHaveCount(3);await expect(rows.filter({ hasText:'USD' })).toContainText('$2.00 USD');
      await expect(rows.filter({ hasText:'未报告' })).toHaveCount(1);
      await page.getByRole('button',{ name:'切换独立评分',exact:true }).click();
      const dialog=page.getByRole('dialog');
      await expect(dialog.getByRole('button',{ name:'确认',exact:true })).toBeDisabled();
      await dialog.getByRole('combobox',{ name:'世界步骤模型' }).selectOption('fixture-world-model');
      await dialog.getByPlaceholder('为什么做这个改动').fill('World-only fixture switch');
      await dialog.getByRole('button',{ name:'确认',exact:true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('world-model-score')).toHaveText('fixture-world-model');
      await expect(page.locator('tbody tr').filter({ hasText:'World-only fixture switch' }).first()).toBeVisible();
      const updated=page.waitForResponse(r=>r.url().includes('/admin/world/models.data?days=1'));
      await page.getByRole('link',{ name:'24 小时',exact:true }).click();await updated;
      await expect(page).toHaveURL(/\/admin\/world\/models\?days=1$/);
      await expect(page.getByRole('heading',{ name:'1 天世界模型用量',exact:true })).toBeVisible();
      await expect(rows).toHaveCount(3);
      await page.getByRole('button',{ name:'切换独立评分',exact:true }).click();
      await dialog.getByRole('combobox',{ name:'世界步骤模型' }).selectOption('');
      await dialog.getByPlaceholder('为什么做这个改动').fill('Restore world default');
      await dialog.getByRole('button',{ name:'确认',exact:true }).click();await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('world-model-score')).toHaveText('default');
      await expect(page.getByRole('heading',{ name:'1 天世界模型用量',exact:true })).toBeVisible();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
      const screenshot=join(tmpdir(),`world-admin-models-${viewport.width}-${process.pid}.png`);
      await page.screenshot({ path:screenshot,fullPage:false });console.log(`World model evidence: ${screenshot}`);
      await page.close();
    }
    assert.equal(commands.length,4);assert.ok(commands.every(c=>c.path==='/api/admin/world/models/score' && c.csrf==='dev' && !!c.key));
    assert.deepEqual(commands.map(c=>c.payload.model),['fixture-world-model',null,'fixture-world-model',null]);
    assert.ok(!reads.includes('/api/admin/models') && !reads.includes('/api/admin/nav-counts'));
    assert.ok(!web.logs().includes('Encountered two children with the same key'));
  } finally { await browser.close();await web.stop(); }
});
