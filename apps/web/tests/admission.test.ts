import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { startWebServer } from "./web-server.ts";
import { schools } from "../../../modules/admission/schools.ts";
import { testNotices } from "../../../modules/admission/tests/fixtures.ts";
import type { AdminNotice, AdmissionNotice } from "@aihot/contracts/admission";

test("admission reading, local preparation and admin form work independently on desktop and phone", async () => {
  const { id: _id, ...notice } = testNotices[0];
  let record: AdminNotice = { id: "00000000-0000-4000-8000-000000000001", version: 1, draft: notice, published: null, updatedAt: new Date().toISOString() };
  const writes: Array<{ path: string; csrf: string | string[] | undefined; body: { notice?: AdmissionNotice; expectedVersion?: number; reason?: string } }> = [];
  const api = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture");
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
    if (req.method === "POST") {
      let text = ""; for await (const chunk of req) text += String(chunk);
      const body = JSON.parse(text) as { notice?: AdmissionNotice; expectedVersion?: number; reason?: string };
      writes.push({ path: url.pathname, csrf: req.headers["x-csrf-token"], body });
      record = { ...record, draft: body.notice ?? record.draft, version: record.version + 1,
        published: url.pathname.endsWith("/publish") ? record.draft : url.pathname.endsWith("/withdraw") ? null : record.published };
      return send(record);
    }
    if (url.pathname === "/api/site/meta" || url.pathname === "/api/admin/nav-counts") return send({});
    if (url.pathname === "/api/admin/me") return send({ name: "Test", csrf: "admission-csrf", dev: true });
    if (url.pathname === "/api/admin/admissions") return send([record]);
    if (url.pathname === "/api/v1/admissions/schools") return send(schools);
    if (url.pathname === "/api/v1/admissions") return send({ items: [], total: 0, page: 1, pages: 1, dataset: "live", now: "2026-10-17T00:00:00Z",
      departments: url.searchParams.get("school") === "s002" ? [notice.department] : [], programmes: url.searchParams.get("school") === "s002" ? [notice.programme] : [], schoolRules: [],
      coverage: { schools: 112, entries: 116, schools985: 39, publishedSchools: 0, notices: 0 },
      directory: url.searchParams.get("school") ? [{ schoolId: "s002", url: "https://yz.tsinghua.edu.cn/catalogue.pdf", title: "测试专业目录入口", kind: "catalogue", parentUrl: "https://yz.tsinghua.edu.cn/", checkedAt: "2026-10-17T00:00:00Z" }] : [] });
    if (url.pathname === "/api/v1/admissions/daily") return send({ date: url.searchParams.get("date") ?? "2026-10-17", generatedAt: "2026-10-17T00:00:00Z", changes: [], deadlines: [] });
    if (url.pathname === "/api/v1/admissions/monitor") return send({ checkedAt: "2026-10-17T00:00:00Z", schools: schools.filter(s => s.tier === "985").map(school => ({ school, urls: [school.website], status: "pending", checkedAt: null, lastOkAt: null, candidates: 0, documents: {}, notices: 0, baoyan: 0, kaoyan: 0, errors: [] })) });
    if (url.pathname === `/api/v1/admissions/${testNotices[0].id}`) return send({ ...testNotices[0], version: 1, updatedAt: "2026-10-17T00:00:00Z", school: schools.find(s => s.id === notice.schoolId), status: "closed" });
    return send({}, 404);
  });
  const web = await startWebServer(api); const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${web.origin}/admissions/${testNotices[0].id}`);
      await expect(page.getByRole("heading", { name: notice.title, exact: true })).toBeVisible();
      await expect(page.getByText("流程演示 · 非真实招生信息", { exact: true })).toHaveCount(0);
      await page.getByRole("checkbox").first().check(); await page.reload();
      await expect(page.getByRole("checkbox").first()).toBeChecked();
      if (width === 1440) await page.getByRole("button", { name: "收藏公告", exact: true }).click();
      await expect(page.getByRole("button", { name: "取消收藏公告", exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => localStorage.getItem("aihot-starred-items")), null);
      assert.equal(await page.evaluate(() => localStorage.getItem("competition-starred-editions-v1")), null);
      await page.goto(`${web.origin}/admissions/saved`); await expect(page.locator("[data-admission-card]")).toHaveCount(1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.goto(`${web.origin}/admissions`);
      await expect(page.getByRole("link", { name: "体验示例", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "添加官网链接", exact: true })).toBeVisible();
      await expect(page.locator('select[name="department"]')).toBeDisabled();
      await page.locator('select[name="school"]').selectOption("s002");
      await expect(page.locator('select[name="department"]')).toBeEnabled();
      await page.locator('select[name="department"]').selectOption(notice.department);
      await expect(page).toHaveURL(/department=/);
      await page.locator('select[name="programme"]').selectOption(notice.programme);
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(page).toHaveURL(/programme=/);
      await page.locator('select[name="school"]').selectOption("s001");
      await expect(page.locator('select[name="department"]')).toHaveValue("");
      await expect(page.locator('select[name="programme"]')).toHaveValue("");
      await page.getByText("招生专业目录（1）", { exact: true }).click();
      await expect(page.getByRole("link", { name: "测试专业目录入口 ↗" })).toBeVisible();
      await expect(page.getByText(/入口已发现不代表目标网页已读取/)).toBeVisible();
      await page.getByRole("navigation", { name: "热门专业方向" }).getByRole("link", { name: "计算机", exact: true }).click();
      await expect(page.getByPlaceholder("搜索院校、院系、专业或公告", { exact: true })).toHaveValue("计算机");
      await expect(page.locator('select[name="school"]')).toHaveValue("s001");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.goto(`${web.origin}/admissions/updates`);
      await expect(page.getByRole("heading", { name: "升学动态与来源覆盖" })).toBeVisible();
      await expect(page.getByText("等待首次检查", { exact: true })).toHaveCount(39);
      await page.locator('input[name="date"]').fill("2026-10-16");
      await page.getByRole("button", { name: "查看", exact: true }).click();
      await expect(page.locator('input[name="date"]')).toHaveValue("2026-10-16");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.goto(`${web.origin}/admin/admissions`);
    await expect(page.getByRole("heading", { name: "升学公告", exact: true })).toBeVisible();
    await page.getByRole("button", { name: notice.title, exact: false }).click();
    const reason = page.locator("input[required]").last(); await reason.fill("测试人工核验录入");
    await page.locator('input[name="title"]').fill("测试更新后的公告标题");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByRole("button", { name: /测试更新后的公告标题/ })).toBeVisible();
    assert.equal(writes.length, 1); assert.equal(writes[0].csrf, "admission-csrf");
    assert.equal(writes[0].body.expectedVersion, 1); assert.equal(writes[0].body.notice?.track, "baoyan");
    assert.equal(writes[0].body.notice?.year, 2027);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
