// HTTP/UI contract checks only: these responses do not simulate or call a model.
// Paid model acceptance is run separately against the owned real-material trial database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { startWebServer } from './web-server.ts';

test('world overview renders the published daily focus and briefs on desktop and mobile', async () => {
  const entry = { itemId: 'daily-focus', title: '当天重点新闻', summary: '已有合格摘要，不调用模型补写。', category: 'economy', sourceName: '日报测试来源', publishedAt: '2026-10-15T08:00:00Z' };
  const api = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture').pathname;
    res.setHeader('Content-Type', 'application/json');
    if (path === '/api/site/meta') return res.end('{}');
    if (path.startsWith('/api/v1/world/daily/')) return res.end(JSON.stringify({ focus: [entry], flashes: [{ ...entry, itemId: 'daily-brief', title: '当天速览新闻' }], status: 'ready' }));
    if (path === '/api/v1/world/highlights') return res.end(JSON.stringify({ status: 'calibration-required', categories: [] }));
    if (path === '/api/v1/world/items') return res.end(JSON.stringify({ items: [] }));
    res.statusCode = 404; res.end('{}');
  });
  const web = await startWebServer(api), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${web.origin}/world`);
      await expect(page.getByRole('heading', { name: entry.title })).toBeVisible();
      await expect(page.getByRole('link', { name: '当天速览新闻' })).toBeVisible();
      await expect(page.getByRole('link', { name: entry.title })).toHaveAttribute('href', '/world/items/daily-focus?from=%2Fworld');
      await expect(page.getByText('今日日报尚无已发布内容。')).toHaveCount(0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});

test('world reader handles pagination, unknown publication dates, errors and withdrawn bookmarks', async () => {
  let failure = '', withdrawn = false;
  const reads: string[] = [];
  const item = { id: 'world-reader-contract', title: '公开接口摘要', summary: '仅用于检查页面行为的摘要。', reason: '关注理由',
    category: 'economy', score: 70, selected: true, source: { name: '接口测试来源' }, links: { original: 'https://example.com/report' },
    publishedAt: null, timelineAt: '2026-10-11T16:30:00Z', storyPublicId: '00000000-0000-0000-0000-000000000001' };
  const api = createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture'); reads.push(url.pathname + url.search);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/site/meta') return res.end('{}');
    if (failure && url.pathname.includes(failure)) { res.statusCode = 503; return res.end('{}'); }
    if (url.pathname.startsWith('/api/v1/world/daily/')) { res.statusCode = 404; return res.end('{}'); }
    if (url.pathname === '/api/v1/world/highlights') return res.end(JSON.stringify({ status: 'calibration-required', categories: [{ key: 'economy', label: '经济与产业', lead: null, briefs: [item] }] }));
    if (url.pathname === '/api/v1/world/items') {
      const page = Number(url.searchParams.get('page') ?? 1);
      return res.end(JSON.stringify({ sectionId: 'world', items: [{ ...item, id: page === 1 ? item.id : 'page-two', title: page === 1 ? item.title : '第二页新闻' }], count: 1,
        pagination: { page, limit: 20, total: 21, hasMore: page === 1 }, days: [{ date: '2026-10-12', count: 21 }] }));
    }
    if (url.pathname === `/api/v1/world/items/${item.id}` && !withdrawn) return res.end(JSON.stringify({ sectionId: 'world', item }));
    if (url.pathname.startsWith('/api/v1/world/stories/')) return res.end(JSON.stringify({ story: { publicId: item.storyPublicId, title: '事件标题', digest: '有证据的事件综述', latestAt: item.timelineAt }, reports: [item] }));
    res.statusCode = 404; res.end('{}');
  });
  const web = await startWebServer(api), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${web.origin}/world/timeline?category=economy&q=摘要`);
    await expect(page.getByText('原文发布时间未知', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /10月12日.*21 条/ })).toBeVisible();
    await expect(page.getByText('00:30', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '下一页' }).click();
    await expect(page.getByRole('heading', { name: '第二页新闻' })).toBeVisible();
    assert.ok(reads.some(path => path.includes('page=2') && path.includes('category=economy') && path.includes('q=')));
    await page.getByRole('link', { name: '上一页' }).click();
    await page.getByRole('link', { name: item.title, exact: true }).click();
    await expect(page.getByText('有证据的事件综述', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
    withdrawn = true;
    await page.goto(`${web.origin}/starred`);
    await expect(page.getByText('这条内容已不再公开，收藏会保留直到你手动移除。')).toBeVisible();
    assert.ok(!reads.some(path => path.startsWith('/api/site/items/availability') && path.includes(item.id)));
    const response = await page.goto(`${web.origin}/world/items/${item.id}`);
    assert.equal(response?.status(), 404);
    await expect(page.getByRole('heading', { name: '这条新闻暂不可阅读' })).toBeVisible();
    failure = '/items';
    const failed = await page.goto(`${web.origin}/world/timeline`);
    assert.equal(failed?.status(), 503);
    await expect(page.getByRole('heading', { name: '世界新闻暂时无法加载' })).toBeVisible();
    await expect(page.getByRole('link', { name: '重新加载' })).toBeVisible();
    failure = '/highlights';
    await page.goto(`${web.origin}/world`);
    await expect(page.getByText('分类新闻获取失败，请刷新重试。')).toBeVisible();
    await expect(page.getByText('今日日报尚无已发布内容。')).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
