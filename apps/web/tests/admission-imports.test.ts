import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { startWebServer } from "./web-server.ts";
import { schools } from "../../../modules/admission/schools.ts";
import type { AdmissionImport } from "@aihot/contracts/admission";

test("personal sources submit, survive reload, expose processing errors and remove only local tracking", async () => {
  const item: AdmissionImport = { id: "00000000-0000-4000-8000-000000000010", school: schools[1], url: "https://yz.tsinghua.edu.cn/test.htm", kind: "notice", status: "ready", title: "测试学院招生公告", createdAt: new Date().toISOString(), checkedAt: new Date().toISOString(), nextCheckAt: new Date().toISOString(), enabled: true, stats: { documents: 1, characters: 2300, files: 1 }, documentStates: { "budget-paused": 1 }, notices: [], message: "来源已读取；本轮模型剩余额度不足，条件摘要等待后续处理。" };
  let writes = 0, adminWrites = 0, failure = false;
  const api = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture");
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (url.pathname === "/api/site/meta" || url.pathname === "/api/admin/nav-counts") return send({});
    if (url.pathname === "/api/admin/me") return send({ name: "Test", csrf: "source-csrf", dev: true });
    if (req.method === "POST") {
      let text = ""; for await (const chunk of req) text += String(chunk); const body = JSON.parse(text);
      if (url.pathname.startsWith("/api/admin/admissions/imports/")) { assert.equal(req.headers["x-csrf-token"], "source-csrf"); assert.equal(body.action, "retry"); adminWrites++; return send({ id: item.id }); }
      writes++; assert.equal(body.url, item.url); assert.equal(body.kind, "notice"); return send({ id: item.id, reused: writes > 1 }, 202);
    }
    if (url.pathname === "/api/admin/admissions/imports") return send({ items: [item], budget: { limitCny: 5, accountedUpperCny: 4.96 } });
    if (url.pathname === "/api/v1/admissions/imports") return send({ items: [item], budget: { limitCny: 5, accountedUpperCny: 4.96 } }, failure ? 503 : 200);
    return send({}, 404);
  });
  const web = await startWebServer(api), browser = await chromium.launch();
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(`${web.origin}/admissions/sources`);
      await expect(page.getByText("还没有关注的来源。", { exact: false })).toBeVisible();
      await page.getByRole("textbox", { name: "官方网页链接" }).fill(item.url);
      await page.getByRole("button", { name: "添加并读取", exact: true }).click();
      await expect(page.getByRole("heading", { name: item.title, exact: true })).toBeVisible();
      await expect(page.getByText(item.message, { exact: true })).toBeVisible();
      await page.reload(); await expect(page.getByRole("heading", { name: item.title, exact: true })).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      failure = true; await page.getByRole("button", { name: "刷新状态", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("暂时无法读取"); failure = false;
      await page.getByRole("button", { name: "刷新状态", exact: true }).click(); await expect(page.getByRole("alert")).toHaveCount(0);
      await page.getByRole("button", { name: "从本机移除", exact: true }).click();
      await expect(page.getByText("还没有关注的来源。", { exact: false })).toBeVisible();
      await page.reload(); await expect(page.getByText("还没有关注的来源。", { exact: false })).toBeVisible();
      assert.equal(adminWrites, 0, "local removal does not pause shared tasks");
    }
    await page.goto(`${web.origin}/admissions/sources?source=${item.id}`);
    await expect(page.getByRole("heading", { name: item.title, exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem("allnews-admission-sources-v1")), "[]");
    await page.goto(`${web.origin}/admin/admissions/imports`);
    await expect(page.getByRole("heading", { name: "升学来源处理", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "重新排队", exact: true }).click(); await expect.poll(() => adminWrites).toBe(1);
    assert.equal(writes, 2); assert.deepEqual(errors, []);
    // Damaged browser data stays recoverable, while a successful submission can still be tracked in memory.
    await page.evaluate(() => localStorage.setItem("allnews-admission-sources-v1", "broken-original"));
    await page.goto(`${web.origin}/admissions/sources`); await expect(page.getByRole("alert")).toContainText("未覆盖原数据");
    await page.getByRole("textbox", { name: "官方网页链接" }).fill(item.url); await page.getByRole("button", { name: "添加并读取", exact: true }).click();
    await expect(page.getByRole("heading", { name: item.title, exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem("allnews-admission-sources-v1")), "broken-original");
  } finally { await browser.close(); await web.stop(); }
});
