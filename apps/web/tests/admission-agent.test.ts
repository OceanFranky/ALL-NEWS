import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { schools } from "../../../modules/admission/schools.ts";
import { testNotices } from "../../../modules/admission/tests/fixtures.ts";
import { startWebServer } from "./web-server.ts";
import type { PublicNotice } from "@aihot/contracts/admission";
import type { AgentTask, AgentGoal } from "@aihot/contracts/admission-agent";

test("brief-first flow submits names or URLs, keeps discovery collapsed, and links evidenced timeline to concise reports", async () => {
  const id = "00000000-0000-4000-8000-000000000019", school = schools.find(s => s.id === "s002")!;
  let submissions = 0, ready = false;
  let submitted: { source: string; keywords: string[]; track: string; searchWeb: boolean; stages: string[] } | null = null;
  const goal: AgentGoal = { schoolId: school.id, keywords: [], year: 2027, track: "baoyan", stages: ["pre"], urls: [] };
  const notice: PublicNotice = { ...testNotices[0], id: "fixture-brief", school, version: 1, status: "unknown", updatedAt: "2026-10-19T01:00:00Z", title: "【合成交互测试】计算机学院申请通知", department: "合成测试学院", programme: "合成计算机专业", summary: "【合成材料，非真实招生信息】这里用于验证简报阅读、时间轴联动与官方链接。", dateNote: "合成日期，不可据此申请", source: { ...testNotices[0].source, verified: true, url: "https://yz.tsinghua.edu.cn/fixture.htm" } };
  const task = (): AgentTask => ({ id, school, goal, status: ready ? "completed" : "awaiting-model", enabled: true, cycle: 1, createdAt: "2026-10-19T00:00:00Z", checkedAt: "2026-10-19T01:00:00Z", nextCheckAt: "2026-10-20T01:00:00Z",
    stats: { pages: 4, candidates: 1, processed: ready ? 1 : 0, remaining: 2, failed: 0 }, gaps: [], notices: ready ? [notice] : [], references: [], changes: [],
    search: { provider: "360搜索", checkedAt: "2026-10-19T01:00:00Z", queries: [], links: [{ title: "合成搜索线索", url: "https://www.cs.tsinghua.edu.cn/new.htm" }] },
    steps: [{ id: 1, cycle: 1, stage: "read", status: "ready", at: "2026-10-19T01:00:00Z", title: "合成读取记录", detail: "仅用于交互验证。", url: notice.source.url }],
    brief: { title: "清华大学 · 保研简报", state: ready ? "ready" : "waiting", overview: ready ? "【合成交互测试】按已核验摘要整理的阅读示例，非真实招生报告。" : "官网材料已保存，摘要整理尚未启用。", asOf: "2026-10-19", checkedAt: "2026-10-19T01:00:00Z", current: 0, closed: ready ? 1 : 0,
      items: ready ? [{ notice, reason: "已截止 · 政策回顾", action: "【合成提示】请关注后续批次。" }] : [], references: [], unknownDates: 0,
      timeline: ready ? [{ noticeId: notice.id, date: "2026-09-20", time: null, kind: "deadline", title: notice.programme, url: notice.source.url, past: true }] : [] } });
  const api = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url!, "http://fixture");
    if (req.method === "POST") { submissions++; const chunks: Buffer[] = []; req.on("data", chunk => chunks.push(chunk)); req.on("end", () => { submitted = JSON.parse(Buffer.concat(chunks).toString()); res.statusCode = 202; res.end(JSON.stringify({ id, reused: submissions > 1 })); }); return; }
    if (url.pathname === "/api/v1/admissions/schools") { res.end(JSON.stringify(schools)); return; }
    if (url.pathname === "/api/v1/admissions/agents") { res.end(JSON.stringify({ items: url.searchParams.get("ids")?.includes(id) ? [task()] : [], budget: { limitCny: 5, accountedUpperCny: 4.961002 } })); return; }
    res.end("{}");
  });
  const web = await startWebServer(api), browser = await chromium.launch();
  try {
    await mkdir(".data/agent-review", { recursive: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message)); ready = false;
      const before = submissions; await page.goto(`${web.origin}/admissions/agent`);
      await expect(page.getByRole("heading", { name: "学校动态，读这一份。" })).toBeVisible(); assert.equal(submissions, before);
      await page.getByLabel("学校名称或官网链接", { exact: true }).fill("清华大学");
      await page.getByRole("button", { name: "生成我的升学简报 →", exact: true }).click();
      await expect(page.locator("[data-agent-task]")).toHaveCount(1); assert.equal(submissions, before + 1);
      await expect(page).toHaveURL(`${web.origin}/admissions/agent?task=${id}`);
      assert.deepEqual(submitted!.keywords, []); assert.equal(submitted!.source, "清华大学"); assert.equal(submitted!.track, "baoyan"); assert.equal(submitted!.searchWeb, true);
      await expect(page.getByText("简报正在准备中", { exact: true })).toBeVisible();
      await expect(page.locator("[data-agent-process]")).not.toHaveAttribute("open", "");
      await expect(page.getByRole("link", { name: "合成搜索线索 ↗" })).not.toBeVisible();
      ready = true; await page.getByRole("button", { name: "刷新简报", exact: true }).click();
      await expect(page.locator("[data-brief-item]")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "[1] 官方原文 ↗", exact: true })).toHaveAttribute("href", notice.source.url);
      await page.locator("[data-brief-node]").click(); await expect(page.locator("[data-brief-node]")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-brief-item]")).toHaveClass(/ring-1/);
      await page.screenshot({ path: `.data/agent-review/brief-fixture-${width}.png`, fullPage: true });
      await page.evaluate(() => document.documentElement.dataset.theme = "dark"); await page.screenshot({ path: `.data/agent-review/brief-fixture-dark-${width}.png`, fullPage: true });
      await page.locator("[data-agent-process] > summary").click();
      await expect(page.getByRole("link", { name: "合成搜索线索 ↗" })).toBeVisible();
      await page.getByText("查看本轮执行记录 · 1条", { exact: true }).click(); await expect(page.getByRole("heading", { name: "合成读取记录", exact: true })).toBeVisible();
      await page.reload(); await expect(page.locator("[data-brief-item]")).toHaveCount(1); assert.equal(submissions, before + 1);
      await page.getByLabel("学校名称或官网链接", { exact: true }).fill("https://yz.tsinghua.edu.cn/");
      await page.getByLabel("升学方向", { exact: true }).selectOption("kaoyan");
      await page.getByText("年份与查找范围", { exact: true }).click();
      await expect(page.getByLabel("统考报名", { exact: true })).toBeChecked();
      await page.getByLabel("联网搜索新的官网入口", { exact: true }).uncheck();
      await page.getByLabel("专业方向（选填）", { exact: true }).fill("计算机、软件");
      await page.getByRole("button", { name: "生成我的升学简报 →", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "已打开相同目标" })).toBeVisible();
      assert.equal(submitted!.track, "kaoyan"); assert.equal(submitted!.source, "https://yz.tsinghua.edu.cn/"); assert.equal(submitted!.searchWeb, false); assert.deepEqual(submitted!.keywords, ["计算机", "软件"]); assert.ok(submitted!.stages.includes("exam"));
      await page.evaluate(() => localStorage.setItem("admission-agent-tasks-v1", "bad-json")); await page.reload();
      await expect(page.getByRole("alert")).toContainText("原数据已保留"); assert.equal(await page.evaluate(() => localStorage.getItem("admission-agent-tasks-v1")), "bad-json");
      for (const size of [width, 768, 375]) { await page.setViewportSize({ width: size, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); await web.stop(); }
});
