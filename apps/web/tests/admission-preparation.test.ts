import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { startWebServer } from "./web-server.ts";
import { testNotices } from "../../../modules/admission/tests/fixtures.ts";
import { schools } from "../../../modules/admission/schools.ts";
import type { PublicNotice } from "@aihot/contracts/admission";

test("saved targets compare published notices, discard retired example bookmarks and preserve versioned preparation", async () => {
  const liveIds = [1, 2, 3, 4].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  let version = 1; let withdrawn = false; let unavailable = false; let writes = 0;
  const notice = (index: number): PublicNotice => ({ ...testNotices[index],
    id: liveIds[index], title: `测试项目${index + 1}`,
    version, updatedAt: "2026-10-17T00:00:00Z", status: "unknown",
    school: schools.find(s => s.id === testNotices[index].schoolId)!,
  });
  const api = createServer((req, res) => {
    if (req.method !== "GET") writes++;
    const path = new URL(req.url!, "http://fixture").pathname;
    const send = (body: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
    if (path === "/api/site/meta") return send({});
    const id = path.split("/").at(-1)!; const index = liveIds.indexOf(id);
    if (index >= 0) return send(notice(index), withdrawn && index === 0 ? 404 : unavailable && index === 1 ? 503 : 200);
    return send({}, 404);
  });
  const web = await startWebServer(api); const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      version = 1; withdrawn = false; unavailable = false;
      const page = await browser.newPage({ viewport: { width, height: 1000 } }); const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${web.origin}/admissions/saved`);
      await expect(page.getByRole("link", { name: "去机会看板", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "体验虚构示例", exact: true })).toHaveCount(0);
      await page.evaluate(ids => localStorage.setItem("admission-saved-v1", JSON.stringify([...ids, "demo-1"])), liveIds);
      await page.reload();
      await expect(page.locator("[data-admission-card]")).toHaveCount(4);
      await expect(page.getByRole("button", { name: "虚构演示 1", exact: true })).toHaveCount(0);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("admission-saved-v1")!)), liveIds);
      for (const n of [1, 2, 3]) await page.getByRole("button", { name: `加入对比：测试项目${n}`, exact: true }).click();
      await expect(page.getByRole("button", { name: "加入对比：测试项目4", exact: true })).toBeDisabled();
      await expect(page.getByText("所选公告的招生路径、年份或阶段不同，请先核对适用范围。", { exact: true })).toBeVisible();
      await expect(page.locator("[data-target-comparison]").getByText("尚未整理，不能理解为没有限制。", { exact: true })).toBeVisible();
      await expect(page.locator("[data-target-comparison]").getByText(/截止时间待确认/).first()).toBeVisible();
      await page.locator("#target-materials").getByRole("checkbox").first().check();
      await page.goto(`${web.origin}/admissions/${liveIds[0]}`);
      await expect(page.getByRole("checkbox").first()).toBeChecked();
      await page.goto(`${web.origin}/admissions/saved`);
      await page.getByRole("button", { name: "加入对比：测试项目1", exact: true }).click();
      await expect(page.locator("#target-materials").getByRole("checkbox").first()).toBeChecked();
      await page.getByRole("button", { name: "移出对比：测试项目1", exact: true }).first().click();
      await expect(page.getByText("已选 0/3 个目标", { exact: true })).toBeVisible();
      version = 2; await page.reload();
      await page.getByRole("button", { name: "加入对比：测试项目1", exact: true }).click();
      await expect(page.locator("#target-materials").getByRole("checkbox").first()).not.toBeChecked();
      await page.getByRole("button", { name: "加入对比：测试项目2", exact: true }).click();
      await page.locator(`[data-admission-card="${liveIds[0]}"]`).getByRole("button", { name: "取消收藏公告", exact: true }).click();
      await expect(page.locator("[data-target-comparison]").getByRole("link", { name: "测试项目1 ↗", exact: true })).toHaveCount(0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      // An unavailable or withdrawn publication must never retain its old comparison content.
      await page.evaluate(ids => localStorage.setItem("admission-saved-v1", JSON.stringify(ids)), liveIds);
      withdrawn = true; unavailable = true; await page.reload();
      await expect(page.getByText("公告已撤回或不存在", { exact: true })).toBeVisible();
      await expect(page.getByText("暂时无法读取这条公告", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "加入对比：测试项目1", exact: true })).toHaveCount(0);
      unavailable = false; await page.getByRole("button", { name: "重试", exact: true }).click();
      await expect(page.getByRole("button", { name: "加入对比：测试项目2", exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => localStorage.getItem("aihot-starred-items")), null);
      assert.equal(await page.evaluate(() => localStorage.getItem("competition-starred-editions-v1")), null);
      assert.deepEqual(errors, []); await page.close();
    }
    assert.equal(writes, 0, "preparation and comparison never submit jobs or call a model");
  } finally { await browser.close(); await web.stop(); }
});
