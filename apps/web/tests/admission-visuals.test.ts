import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { demoNotices } from "../../../modules/admission/backend/demo.ts";
import { schools } from "../../../modules/admission/schools.ts";
import type { PublicNotice } from "@aihot/contracts/admission";
import { startWebServer } from "./web-server.ts";

test("real date lanes and per-target material matrix stay truthful, accessible and in sync", async () => {
  const ids = [1, 2, 3].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  let version = 1; let writes = 0; let unknown = false;
  const notices = (): PublicNotice[] => ids.map((id, i) => ({ ...demoNotices[0], id, title: `可视化测试目标${i + 1}`,
    programme: `测试专业${i + 1}`, department: `测试院系${i + 1}`, demo: false, version, updatedAt: "2026-10-18T00:00:00Z",
    school: schools.find(s => s.id === demoNotices[0].schoolId)!, status: "unknown",
    opensOn: unknown ? null : i === 0 ? "2026-12-30" : null,
    deadline: unknown || i === 2 ? null : "2027-01-02", deadlineTime: i === 0 && !unknown ? "17:00" : null,
    dateNote: "本地假材料，仅作可视化验证。", materials: i === 0 ? ["成绩单", "个人陈述（1000字）"] : i === 1 ? ["成绩单", "个人陈述（2000字）"] : [],
  }));
  const api = createServer((req, res) => {
    if (req.method !== "GET") writes++;
    const path = new URL(req.url!, "http://fixture").pathname;
    const item = notices().find(item => path === `/api/v1/admissions/${item.id}`);
    const meta = path === "/api/site/meta";
    res.writeHead(item || meta ? 200 : 404, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(item ?? {}));
  });
  const web = await startWebServer(api); const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      version = 1; unknown = false;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: "America/Los_Angeles" });
      const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      await page.goto(`${web.origin}/admissions/saved`);
      await page.evaluate(ids => localStorage.setItem("admission-saved-v1", JSON.stringify(ids)), ids); await page.reload();
      for (let i = 1; i <= 3; i++) await page.getByRole("button", { name: `加入对比：可视化测试目标${i}`, exact: true }).click();
      const timeline = page.locator("[data-application-timeline]"); const matrix = page.locator("[data-material-matrix]");
      await expect(timeline.locator("[data-timeline-range]")).toHaveCount(1);
      await expect(timeline.locator("[data-timeline-deadline]")).toHaveCount(2);
      await expect(timeline.locator("[data-timeline-open]")).toHaveCount(1);
      await expect(timeline.getByText("2027-01-02 有2个目标同日截止，具体时刻与提交方式请分别核对。", { exact: true })).toBeVisible();
      await expect(timeline.locator("[data-timeline-axis]")).toContainText("2026-12-29 — 2027-01-03");
      assert.equal(await timeline.locator("[data-timeline-tick]").nth(1).evaluate(el => (el as HTMLElement).style.left), "40%");
      await timeline.getByRole("button", { name: "查看时间安排：可视化测试目标2", exact: true }).click();
      await expect(timeline.locator("[data-timeline-focus]")).toContainText("测试院系2 / 测试专业2");
      await expect(timeline.locator("[data-timeline-focus]")).toContainText("具体时刻未说明");
      await timeline.getByRole("button", { name: "查看时间安排：可视化测试目标3", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(timeline.locator("[data-timeline-focus]")).toContainText("材料尚未整理");
      await expect(matrix.getByText("1项相同条目被多个目标列出", { exact: true })).toBeVisible();
      await expect(matrix.getByText("个人陈述（1000字）", { exact: true })).toBeVisible();
      await expect(matrix.getByText("个人陈述（2000字）", { exact: true })).toBeVisible();
      const first = matrix.getByRole("checkbox", { name: "可视化测试目标1：成绩单", exact: true });
      const second = matrix.getByRole("checkbox", { name: "可视化测试目标2：成绩单", exact: true });
      await first.check(); await expect(second).not.toBeChecked();
      await expect(page.locator("[data-target-checklists]").getByRole("checkbox").first()).toBeChecked();
      await page.locator("[data-target-checklists]").getByRole("checkbox").first().uncheck(); await expect(first).not.toBeChecked();
      await timeline.getByRole("button", { name: "查看时间安排：可视化测试目标1", exact: true }).click();
      await first.check(); await expect(timeline.locator("[data-timeline-focus]")).toContainText("下一步核对材料：个人陈述（1000字）");
      await page.goto(`${web.origin}/admissions/${ids[0]}`); await expect(page.getByRole("checkbox").first()).toBeChecked();
      await page.goto(`${web.origin}/admissions/saved`);
      for (let i = 1; i <= 3; i++) await page.getByRole("button", { name: `加入对比：可视化测试目标${i}`, exact: true }).click();
      await expect(first).toBeChecked();
      // Storage rejection must not display a completed material.
      await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("blocked", "QuotaExceededError"); }; });
      await second.click(); await expect(second).not.toBeChecked(); await expect(matrix.getByRole("status")).toHaveText("保存失败");
      await page.reload();
      version = 2; unknown = true; await page.reload();
      for (let i = 1; i <= 3; i++) await page.getByRole("button", { name: `加入对比：可视化测试目标${i}`, exact: true }).click();
      await expect(timeline.locator("[data-timeline-axis]")).toHaveCount(0);
      await expect(timeline.getByText("所选目标还没有明确日期，暂不绘制时间刻度。可以点选目标回查原文。", { exact: true })).toBeVisible();
      await expect(first).not.toBeChecked();
      await timeline.getByRole("button", { name: "查看时间安排：可视化测试目标2", exact: true }).click();
      await page.getByRole("button", { name: "移出对比：可视化测试目标2", exact: true }).first().click();
      await expect(timeline.locator("[data-timeline-focus]")).toContainText("测试专业1");
      await expect(matrix.getByRole("checkbox", { name: "可视化测试目标2：成绩单", exact: true })).toHaveCount(0);
      for (const size of [width, 768, 375]) {
        await page.setViewportSize({ width: size, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      assert.deepEqual(errors, []); await page.close();
    }
    assert.equal(writes, 0);
  } finally { await browser.close(); await web.stop(); }
});
