// Currency-separated backend totals need distinct React row identities on the existing AI page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('admin model usage renders separate currencies and preserves them when changing the time window',async()=>{
  const api=createServer((req,res)=>{
    const url=new URL(req.url!,'http://fixture');res.setHeader('Content-Type','application/json');
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Local fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/admin/nav-counts') return res.end('{}');
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname==='/api/admin/models') {
      const usage=['CNY','USD'].map((currency,i)=>({ purpose:'score_article',model:'fixture-model',promptVersion:'fixture-version',
        calls:1,ok:1,failed:0,unknown:0,p50:100,p95:100,tokensIn:10,tokensOut:20,actualCost:i+1,currency,estimate:null }));
      return res.end(JSON.stringify({ days:Number(url.searchParams.get('days') ?? 7),capabilities:[{
        key:'score',label:'Fixture 评分',env:'SCORE_MODEL',defaultModel:'default',vision:false,
        current:{ model:'fixture-model',source:'default' },usage }],choices:[],history:[],benches:[] }));
    }
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    const page=await browser.newPage({ viewport:{ width:1365,height:768 } });
    const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',msg=>{ if(msg.type()==='error' || msg.type()==='warning') errors.push(msg.text()); });
    await page.goto(`${web.origin}/admin/models`);
    await expect(page.getByRole('heading',{ name:'模型与评测',exact:true })).toBeVisible();
    assert.match(await page.title(),/模型/);
    const rows=page.locator('tbody tr').filter({ hasText:'score_article' });
    await expect(rows).toHaveCount(2);await expect(rows.filter({ hasText:'USD' })).toHaveCount(1);
    await expect(rows.filter({ hasText:'USD' })).toContainText('$2.00 USD');
    const updated=page.waitForResponse(r=>r.url().includes('/admin/models.data?days=1'));
    await page.getByRole('link',{ name:'24 小时',exact:true }).click();
    await updated;
    await expect(page).toHaveURL(/\/admin\/models\?days=1$/);
    await expect(page.getByRole('link',{ name:'24 小时',exact:true })).toHaveClass(/bg-ink/);
    await expect(rows).toHaveCount(2);await expect(rows.filter({ hasText:'USD' })).toHaveCount(1);
    assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
    assert.ok(!web.logs().includes('Encountered two children with the same key'));
    const screenshot=join(tmpdir(),`admin-model-currency-${process.pid}.png`);
    await page.screenshot({ path:screenshot,fullPage:false });console.log(`Currency UI evidence: ${screenshot}`);
  } finally { await browser.close();await web.stop(); }
});
