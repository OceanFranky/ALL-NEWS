import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import type { MaintenanceOverview, MaintenancePlan } from "@aihot/contracts/learning-resources";
import { startWebServer } from "./web-server.ts";

test("maintenance settings, preview, queued run and stop on desktop and phone", async () => {
  const overview: MaintenanceOverview = { collectionEnabled: true, settings: { version: 0, config: JSON.parse(readFileSync(new URL("../../../modules/learning-resources/seeds/maintenance-sources.json", import.meta.url), "utf8")) }, runs: [] };
  const api = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (path === "/api/site/meta" || path === "/api/admin/nav-counts") return send({});
    if (path === "/api/admin/me") return send({ name: "测试管理员", csrf: "test-csrf", dev: true });
    if (req.method === "GET" && path === "/api/admin/resources/maintenance") return send(overview);
    const plan: MaintenancePlan = { settings: overview.settings, collectionEnabled: true, sources: overview.settings.config.sources.filter(s => s.enabled).flatMap(s => s.urls.map(url => ({ ...s, url }))), resourceIds: ["test-resource"] };
    if (path.endsWith("/preview")) return send(plan);
    if (req.headers["x-csrf-token"] !== "test-csrf") return send({ detail: "CSRF mismatch" }, 403);
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method === "PUT") {
      const input = JSON.parse(body);
      assert.equal(input.expectedVersion, overview.settings.version);
      overview.settings = { version: overview.settings.version + 1, config: input.config };
      return send(overview.settings);
    }
    if (path.endsWith("/run")) {
      overview.runs = [{ id: "00000000-0000-4000-8000-000000000001", actor: "测试管理员", status: "queued", cancelRequested: false, plan, report: { requests: 0, created: 0, duplicates: 0, observations: [] }, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" }];
      return send({ id: overview.runs[0].id });
    }
    if (path.endsWith("/stop")) { overview.runs[0].status = "cancelled"; return send({ stopped: true }); }
    return send({}, 404);
  });
  const web = await startWebServer(api);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${web.origin}/admin/resources/maintenance`);
    await expect(page.getByRole("heading", { name: "资源自动维护", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "立即运行一次" })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "竞赛Agent运行时接入资源" })).toBeChecked();
    await page.getByRole("checkbox", { name: "竞赛Agent运行时接入资源" }).uncheck();
    await page.getByLabel("检查频率", { exact: true }).selectOption("7");
    await page.getByRole("checkbox", { name: "开启定时维护" }).check();
    await page.locator("details").first().locator("summary").click();
    await page.locator("details").first().getByRole("checkbox").check();
    await page.getByLabel("每次请求总上限").fill("5");
    await page.getByLabel("本次配置说明").fill("测试：每周检查一个来源，最多5次请求");
    await expect(page.getByRole("button", { name: "预览下一次计划" })).toBeDisabled();
    await page.getByRole("button", { name: "保存维护配置" }).click();
    await expect(page.getByText("定时维护已开启", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "预览下一次计划" }).click();
    await expect(page.getByRole("button", { name: "立即运行一次" })).toBeEnabled();
    await page.getByRole("button", { name: "立即运行一次" }).click();
    await expect(page.getByRole("button", { name: "停止本次任务" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "停止本次任务" }).click();
    await expect(page.getByRole("button", { name: /已停止/ })).toBeVisible();
    await expect(page.getByLabel("检查频率", { exact: true })).toHaveValue("7");
    assert.equal(overview.settings.config.maxRequests, 5);
    assert.equal(overview.settings.config.competitionAgentEnabled, false);
    assert.equal(overview.settings.config.sources.filter(s => s.enabled).length, 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
