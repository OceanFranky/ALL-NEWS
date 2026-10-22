import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { startWebServer } from "./web-server.ts";
import { schools } from "../../../modules/admission/schools.ts";
import { testNotices } from "../../../modules/admission/tests/fixtures.ts";

test("admission timeline orders current-page deadlines, keeps unknown dates separate and preserves filters", async () => {
  const items = [testNotices[2], testNotices[1], testNotices[0]].map(item => ({ ...item, school: schools.find(s => s.id === item.schoolId), version: 1, updatedAt: "2026-10-22T00:00:00Z", status: item.deadline ? "closed" : "unknown" }));
  const api = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture");
    const value = url.pathname === "/api/v1/admissions" ? { items, total: 25, page: 1, pages: 3, dataset: "live", now: "2026-10-22T00:00:00Z", departments: ["计算机学院"], programmes: [], schoolRules: [], directory: [], coverage: { schools: 112, entries: 116, schools985: 39, publishedSchools: 3, notices: 25 } }
      : url.pathname === "/api/v1/admissions/schools" ? schools : {};
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value));
  });
  const web = await startWebServer(api), browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${web.origin}/admissions?school=s002&q=计算机&department=计算机学院`);
      await expect(page.locator('select[name="department"]')).toBeVisible();
      await page.getByRole("button", { name: "申请时间轴", exact: true }).click();
      const timeline = page.getByRole("region", { name: "本页申请时间轴" });
      await expect(timeline).toBeVisible();
      assert.deepEqual(await timeline.locator('time').allTextContents(), ["2026-09-20", "2027-06-01"]);
      assert.deepEqual(await timeline.locator('[data-timeline-notice]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-timeline-notice'))), [testNotices[0].id, testNotices[2].id, testNotices[1].id]);
      await expect(timeline.getByText("截止日期待确认", { exact: false })).toBeVisible();
      await expect(timeline.getByText(/翻页可查看其他公告/)).toBeVisible();
      await expect(timeline.getByRole("link", { name: "官方原文 ↗" })).toHaveCount(3);
      const next = new URL(await page.getByRole("link", { name: "下一页", exact: true }).getAttribute("href") ?? "", web.origin);
      assert.equal(next.searchParams.get("school"), "s002"); assert.equal(next.searchParams.get("q"), "计算机"); assert.equal(next.searchParams.get("department"), "计算机学院"); assert.equal(next.searchParams.get("page"), "2");
      await page.getByRole("button", { name: "公告卡片", exact: true }).click();
      await expect(page.locator('[data-admission-card]')).toHaveCount(3);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
