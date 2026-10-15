import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { startWebServer } from "./web-server.ts";

test("industry views share one page navigation while world and campus remain content entries", async () => {
  const calls: string[] = [];
  const api = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture");
    calls.push(url.pathname);
    response.setHeader("Content-Type", "application/json");
    const filters = { channel: "all", category: url.searchParams.get("category"), tag: null };
    if (url.pathname === "/api/site/meta") return response.end(JSON.stringify({}));
    if (url.pathname === "/api/site/timeline") return response.end(JSON.stringify({ filters, cards: [], nextCursor: null, hot: null, dayCounts: {} }));
    if (url.pathname === "/api/site/pool") return response.end(JSON.stringify({ filters: { ...filters, q: null, tab: "time" }, items: [], page: 1, pageCount: 1, total: 0, todayCount: 0, freshness: "2026-10-15T00:00:00Z" }));
    if (url.pathname === "/api/site/hot") return response.end(JSON.stringify({ entries: [], windowHours: 48, computedAt: null }));
    if (/^\/api\/site\/reports\/(daily|weekly|monthly)\/latest-page$/.test(url.pathname)) return response.end(JSON.stringify({ report: null, index: [] }));
    if (url.pathname === "/api/site/topics") return response.end(JSON.stringify({ groups: [], topics: [] }));
    response.statusCode = 404;
    response.end(JSON.stringify({ code: "not_found" }));
  });
  const web = await startWebServer(api);
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${web.origin}/`);
      const sidebar = page.locator('nav[aria-label="主导航"]');
      assert.deepEqual(await sidebar.locator("a").allTextContents(), ["行业信息", "世界新闻", "大学生竞赛", "收藏", "Agent 接入", "关于", "更新日志", "反馈"]);
      assert.equal(await sidebar.getByText("校园", { exact: true }).count(), 0);
      const content = sidebar.locator(":scope > div").first();
      assert.deepEqual(await content.locator("a").allTextContents(), ["行业信息", "世界新闻", "大学生竞赛", "收藏"]);
      const navigation = page.getByRole("navigation", { name: "行业信息切换" });
      await expect(navigation.getByRole("link")).toHaveCount(5);
      for (const [label, path] of [["全部 AI 动态", "/all"], ["热点榜", "/hot"], ["AI 日报", "/daily"], ["主题", "/topics"], ["精选", "/"]]) {
        await navigation.getByRole("link", { name: label, exact: true }).click();
        await expect(page).toHaveURL(web.origin + path);
        await expect(page.getByRole("heading", { name: "行业信息", exact: true })).toBeVisible();
        await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
        await expect(sidebar.locator('a[href="/"]')).toHaveAttribute("aria-current", "page");
        if (width === 390) {
          const bottom = page.getByRole("navigation", { name: "底部导航" });
          assert.deepEqual(await bottom.getByRole("link").allTextContents(), ["行业信息", "世界", "竞赛", "我的"]);
          await expect(bottom.getByRole("link", { name: "行业信息", exact: true })).toHaveAttribute("aria-current", "page");
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.goto(`${web.origin}/all?category=ai-models&page=2`);
      await navigation.getByRole("link", { name: "精选", exact: true }).click();
      await expect(page).toHaveURL(`${web.origin}/?category=ai-models`);
      await navigation.getByRole("link", { name: "全部 AI 动态", exact: true }).click();
      await expect(page).toHaveURL(`${web.origin}/all?category=ai-models`);
      await page.reload();
      await expect(navigation.getByRole("link", { name: "全部 AI 动态", exact: true })).toHaveAttribute("aria-current", "page");
      await page.goBack();
      await expect(navigation.getByRole("link", { name: "精选", exact: true })).toHaveAttribute("aria-current", "page");
      for (const path of ["/weekly", "/monthly"]) {
        await page.goto(web.origin + path);
        await expect(navigation.getByRole("link", { name: "AI 日报", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(sidebar.locator('a[href="/"]')).toHaveAttribute("aria-current", "page");
      }
      await page.screenshot({ path: `/tmp/industry-navigation-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
    assert(calls.includes("/api/site/timeline"));
    assert(calls.includes("/api/site/pool"));
    assert(calls.includes("/api/site/hot"));
    assert(calls.includes("/api/site/reports/daily/latest-page"));
    assert(calls.includes("/api/site/topics"));
    assert.equal(calls.some(path => path.includes("/admin/") || path.includes("/ingest/")), false);
  } finally {
    await browser.close();
    await web.stop();
  }
});
