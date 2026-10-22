import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import type { AgentStatus, AgentTask } from "@aihot/contracts/admission-agent";
import { agentStatusLabels } from "@aihot/contracts/admission-agent";
import { schools } from "../../../modules/admission/schools.ts";
import { testNotices } from "../../../modules/admission/tests/fixtures.ts";
import { buildAgentBrief } from "../../../modules/admission/backend/agent-brief.ts";
import { startWebServer } from "./web-server.ts";

test("real task states, evidence and failed refreshes remain distinct from report availability", async () => {
  const id = "00000000-0000-4000-8000-000000000029", school = schools.find(s => s.id === "s002")!;
  const goal: AgentTask["goal"] = { schoolId: school.id, keywords: [], year: 2027, stages: ["pre"], urls: [] };
  let status: AgentStatus = "queued", readable = false, failedRead = false, submissions = 0;
  const notice = { ...testNotices[0], id: "status-fixture", school, version: 1, status: "unknown" as const, updatedAt: "2026-10-21T07:00:00Z", title: "【合成测试】状态回归用公告", source: { ...testNotices[0].source, verified: true } };
  const task = (): AgentTask => ({ id, school, goal, status, enabled: status !== "paused", cycle: 2,
    createdAt: "2026-10-19T00:00:00Z", checkedAt: "2026-10-21T07:00:00Z", nextCheckAt: "2026-10-21T08:00:00Z",
    stats: { pages: 20, candidates: 7, processed: 3, remaining: 51, failed: 6 },
    gaps: ["【合成测试】部分附件不可读。", "【合成测试】截止日期需要核对。", "【合成测试】保留未读入口。"],
    steps: [
      { id: 3, cycle: 2, stage: "validate", status: "needs-review", at: "2026-10-21T06:59:00Z", url: null, title: "【合成测试】核对记录", detail: "需要核对依据。" },
      { id: 2, cycle: 2, stage: "extract", status: "running", at: "2026-10-21T06:58:00Z", url: null, title: "提取", detail: "" },
      { id: 1, cycle: 1, stage: "read", status: "ready", at: "2026-10-20T06:58:00Z", url: null, title: "上轮读取", detail: "" },
    ], notices: readable ? [notice] : [], references: [], changes: [],
    brief: buildAgentBrief(goal, school.name, readable ? [notice] : [], "2026-10-21T07:00:00Z", status, new Date("2026-10-22T01:00:00Z")) });
  const api = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url!, "http://fixture");
    if (req.method !== "GET") { submissions++; res.statusCode = 405; res.end("{}"); return; }
    if (url.pathname === "/api/v1/admissions/schools") { res.end(JSON.stringify(schools)); return; }
    if (url.pathname === "/api/v1/admissions/agents") {
      if (failedRead) { res.statusCode = 503; res.end("{}"); return; }
      res.end(JSON.stringify({ items: [task()], budget: { limitCny: 10, accountedUpperCny: 5.561212 } })); return;
    }
    res.end("{}");
  });
  const web = await startWebServer(api), browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${web.origin}/admissions/agent?task=${id}`);
    await expect(page.locator("[data-agent-status-title]")).toHaveText("任务已保存，等待后台执行");
    // A saved goal only polls reads; a later backend state must replace it without a submission.
    status = "needs-review";
    await expect(page.locator("[data-agent-status-title]")).toHaveText("本轮已结束，部分内容需要核对", { timeout: 9000 });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const state of Object.keys(agentStatusLabels) as AgentStatus[]) {
        status = state; readable = false;
        await page.getByRole("button", { name: "刷新简报", exact: true }).click();
        await expect(page.locator("[data-agent-task] > header [role=status]")).toHaveText(agentStatusLabels[state]);
        await expect(page.getByText("尚无可阅读简报", { exact: true })).toBeVisible();
        await expect(page.getByText("简报正在准备中", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("list", { name: "本轮处理阶段" }).locator("li")).toHaveCount(4);
        // Counts and previous-cycle events do not fabricate a successful current-cycle read.
        await expect(page.locator("[data-agent-stage]").nth(1)).toContainText("暂无本轮记录");
        await expect(page.locator("[data-agent-stage]").nth(2)).toContainText("需要核对");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      status = "needs-review"; readable = true;
      await page.getByRole("button", { name: "刷新简报", exact: true }).click();
      await expect(page.locator("[data-brief-item]")).toHaveCount(1);
      await expect(page.locator("[data-agent-task] > header [role=status]")).toContainText("等待人工核对 · 已有简报");
      await expect(page.locator("[data-agent-blockers]")).toContainText("部分附件不可读");
      await page.getByRole("button", { name: "查看来源与处理记录（3项待核对）", exact: true }).click();
      await expect(page.locator("[data-agent-process]")).toHaveAttribute("open", "");
      await expect(page.locator("[data-agent-process] > summary")).toBeFocused();
      await expect(page.getByRole("link", { name: "补充官方公告", exact: true })).toHaveAttribute("href", "/admissions/sources");
      await page.locator("[data-agent-process] > summary").click();
      failedRead = true;
      await page.getByRole("button", { name: "刷新简报", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("保留上次成功读取的内容");
      await expect(page.locator("[data-brief-item]")).toHaveCount(1);
      failedRead = false;
      await page.getByRole("button", { name: "刷新简报", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.locator("[data-agent-read-at]")).toBeVisible();
      await page.screenshot({ path: `.data/agent-review/agent-status-review-${width}.png`, fullPage: true });
    }
    assert.equal(submissions, 0); assert.deepEqual(errors, []); await page.close();
  } finally { await browser.close(); await web.stop(); }
});
