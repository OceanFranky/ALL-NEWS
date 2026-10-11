import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium,expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebServer } from './web-server.ts';

test('world daily controls preserve revisions and exact dates; hotspots generate drafts through world endpoints',async()=>{
  const revisions:Array<Record<string,unknown>>=[],commands:Array<{ path:string;body:any;csrf:unknown }>=[];
  let hot=false;
  const api=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://fixture');res.setHeader('Content-Type','application/json');
    if(req.method==='POST') {
      let text='';for await(const chunk of req) text+=String(chunk);
      const body=JSON.parse(text);commands.push({ path:url.pathname,body,csrf:req.headers['x-csrf-token'] });
      if(url.pathname==='/api/admin/world/hot/generate') hot=true;
      else if(url.pathname==='/api/admin/world/daily/2026-10-11/generate') {
        const revision=revisions.length+1;
        revisions.unshift({ id:revision,revision,status:'draft',generated_by:'Fixture',generated_at:new Date().toISOString(),approved_by:null,approved_at:null,
          content:{ date:'2026-10-11',policy:{ focusLimit:6,flashLimit:6,maxFocusPerSource:2 },status:'ready',focus:[{
            itemId:`world-${revision}`,analysisId:revision,storyPublicId:'world-story',title:`World fixture revision ${revision}`,summary:'Only supplied material.',reason:'Fixture reason',
            category:'politics',score:80,sourceId:'world-source',sourceName:'World fixture',originalUrl:'https://fixture.invalid/world',publishedAt:new Date().toISOString(),admittedAt:new Date().toISOString() }],flashes:[] } });
      } else if(url.pathname==='/api/admin/world/daily/2026-10-11/review') {
        const row=revisions.find(r=>r.revision===body.revision)!;row.status=body.action==='approve'?'approved':'withdrawn';
        if(body.action==='approve') { row.approved_by='Fixture';row.approved_at=new Date().toISOString(); }
      } else { res.statusCode=400;return res.end('{}'); }
      return res.end('{}');
    }
    if(url.pathname==='/api/admin/me') return res.end(JSON.stringify({ name:'Fixture',csrf:'dev',dev:true }));
    if(url.pathname==='/api/site/meta') return res.end(JSON.stringify({ changelogVersion:'fixture' }));
    if(url.pathname.startsWith('/api/admin/world/daily/')) return res.end(JSON.stringify({ sectionId:'world',date:url.pathname.split('/').at(-1),revisions }));
    if(url.pathname==='/api/admin/world/hot') return res.end(JSON.stringify({ sectionId:'world',status:hot?'draft':'not-generated',items:hot?[{
      rank:1,storyId:1,storyPublicId:'world-story',title:'World hotspot fixture',representativeItemId:'world-1',importance:80,heat:1,sourceCount:1,reportCount:1,latestProgressAt:new Date().toISOString() }]:[] }));
    res.statusCode=404;res.end('{}');
  });
  const web=await startWebServer(api),browser=await chromium.launch({ headless:true });
  try {
    const page=await browser.newPage({ viewport:{ width:1365,height:900 } }),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{ if(['error','warning'].includes(m.type())) errors.push(m.text()); });
    await page.goto(`${web.origin}/admin/world/daily?date=2026-10-11`);
    await expect(page.getByRole('heading',{ name:'世界新闻日报',exact:true })).toBeVisible();assert.match(await page.title(),/世界新闻日报/);
    await expect(page.getByText('2026-10-11 尚未生成世界日报草稿。',{ exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'生成新草稿',exact:true }).click();
    await expect(page.getByRole('heading',{ name:'World fixture revision 1',exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'批准第1版',exact:true }).click();
    const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{ name:'确认',exact:true })).toBeDisabled();
    await dialog.getByPlaceholder('为什么做这个改动').fill('Approve fixture');await dialog.getByRole('button',{ name:'确认',exact:true }).click();
    await expect(dialog).toHaveCount(0);await expect(page.getByText('已批准',{ exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'生成新草稿',exact:true }).click();
    await expect(page.getByRole('heading',{ name:'World fixture revision 2',exact:true })).toBeVisible();
    await expect(page.getByRole('heading',{ name:'World fixture revision 1',exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'撤回第1版',exact:true }).click();
    await dialog.getByPlaceholder('为什么做这个改动').fill('Withdraw fixture');await dialog.getByRole('button',{ name:'确认',exact:true }).click();
    await expect(dialog).toHaveCount(0);await expect(page.getByText('已撤回',{ exact:true })).toBeVisible();
    await expect(page.getByText('待审草稿',{ exact:true })).toBeVisible();
    const screenshot=join(tmpdir(),`world-admin-daily-${process.pid}.png`);await page.screenshot({ path:screenshot });console.log(`Daily UI evidence: ${screenshot}`);
    await page.goto(`${web.origin}/admin/world/hot`);await expect(page.getByRole('heading',{ name:'世界新闻热点草稿',exact:true })).toBeVisible();
    await page.getByRole('button',{ name:'生成新快照',exact:true }).click();await expect(page.getByText('内部草稿',{ exact:true })).toBeVisible();
    await expect(page.getByRole('cell',{ name:'World hotspot fixture',exact:true })).toBeVisible();
    await page.setViewportSize({ width:390,height:844 });assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(errors,[]);
    assert.equal(commands.length,5);assert.ok(commands.every(c=>c.path.startsWith('/api/admin/world/') && c.csrf==='dev'));
    assert.deepEqual(commands.filter(c=>c.path.endsWith('/review')).map(c=>[c.body.revision,c.body.action]),[[1,'approve'],[1,'withdraw']]);
  } finally { await browser.close();await web.stop(); }
});
