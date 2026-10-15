import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('world admin navigation keeps its own stats and switches boards on desktop and phone',async()=>{
  const reads:string[]=[];
  const api=createServer((req,res)=>{
    const url=new URL(req.url!,'http://fixture');reads.push(url.pathname);
    res.setHeader('Content-Type','application/json');
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Local fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/admin/nav-counts') return res.end(JSON.stringify({ sources:777,runs:888 }));
    if(url.pathname==='/api/admin/sources') return res.end(JSON.stringify({ rows:[],totals:{ total:0,enabled:0,failing:0,degraded:0 },page:1 }));
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname==='/api/admin/world/runs') return res.end(JSON.stringify({ sectionId:'world',checkedAt:new Date().toISOString(),
      counts:{ sources:6,articles:12,events:3 },processing:{ new:2,done:10 },grouping:{ pending:2,grouped:10 },
      queues:[],failedJobs:[],sources:[{ id:'world-fixture',name:'World-only fixture source',enabled:false,health:null,fail_count:0,last_error:null,last_fetch_at:null }],
      timeline:[],fetches:[],receipts:{ counts:{},issues:[] },budgetStatus:'not-configured',budgets:[] }));
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    for(const viewport of [{ width:1365,height:900 },{ width:390,height:844 }]) {
      const page=await browser.newPage({ viewport }),errors:string[]=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',msg=>{ if(msg.type()==='error' || msg.type()==='warning') errors.push(msg.text()); });
      reads.length=0;
      await page.goto(`${web.origin}/admin/world/runs`);
      await expect(page.getByRole('heading',{ name:'世界新闻运行',exact:true })).toBeVisible();
      assert.match(await page.title(),/世界新闻运行/);
      await expect(page.getByText('World-only fixture source',{ exact:true })).toBeVisible();
      await expect(page.getByText('未配置 · 暂停调用',{ exact:true })).toBeVisible();
      await expect(page.getByRole('link',{ name:'内容诊断',exact:true })).toHaveCount(0);
      assert.ok(reads.includes('/api/admin/world/runs'));assert.ok(!reads.includes('/api/admin/nav-counts'));
      const boardNav=page.locator('nav[aria-label="后台板块"]:visible');
      await expect(boardNav.getByRole('link',{ name:'世界新闻',exact:true })).toHaveAttribute('aria-current','page');
      const refreshed=page.waitForResponse(r=>r.url().includes('/admin/world/runs.data'));
      await page.getByRole('button',{ name:'刷新状态',exact:true }).click();
      await refreshed;
      await expect(page.getByRole('button',{ name:'刷新状态',exact:true })).toBeEnabled();
      assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      const screenshot=join(tmpdir(),`world-admin-runs-${viewport.width}-${process.pid}.png`);
      await page.screenshot({ path:screenshot,fullPage:false });console.log(`World admin evidence: ${screenshot}`);
      await boardNav.getByRole('link',{ name:'AI 热点',exact:true }).click();
      await expect(page).toHaveURL(/\/admin\/sources$/);
      await expect(page.getByRole('heading',{ name:'信源',exact:true })).toBeVisible();
      await expect(page.getByRole('link',{ name:'内容诊断',exact:true }).filter({ visible:true })).toBeVisible();
      assert.ok(reads.includes('/api/admin/nav-counts'));
      await page.locator('nav[aria-label="后台板块"]:visible').getByRole('link',{ name:'世界新闻',exact:true }).click();
      await expect(page).toHaveURL(/\/admin\/world\/runs$/);
      await expect(page.getByRole('heading',{ name:'世界新闻运行',exact:true })).toBeVisible();
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close();await web.stop(); }
});
