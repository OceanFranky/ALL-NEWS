import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import type { ManagedResource, ResourceHistory, ResourceWrite, ResourceReview } from "@aihot/contracts/learning-resources";
import { startWebServer } from "./web-server.ts";

test("resource administrator records, associates, reviews and withdraws on desktop and phone", async () => {
  let resource: ManagedResource | null = null;
  const history: ResourceHistory[] = [];
  const api = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture");
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (url.pathname === "/api/site/meta") return send({});
    if (url.pathname === "/api/admin/me") return send({ name: "本地测试管理员", csrf: "test-csrf", dev: true });
    if (url.pathname === "/api/admin/nav-counts") return send({});
    if (url.pathname === "/api/admin/resources/targets") return send([{ competitionId: "competition-007", name: "数媒竞赛测试夹具", editions: [] }]);
    if (url.pathname === "/api/admin/resources/coverage") return send([{ competitionId: "competition-007", name: "数媒竞赛测试夹具", experience: resource?.status === "published" ? 1 : 0, video: 0, reason: "视频待补充" }]);
    if (req.method === "GET" && url.pathname === "/api/admin/resources") return send({ items: resource ? [resource] : [], page: 1, total: resource ? 1 : 0 });
    if (req.method === "GET" && resource && url.pathname === `/api/admin/resources/${resource.id}`) return send({ resource, history });
    if (req.method === "POST" && url.pathname.startsWith("/api/admin/resources")) {
      if (req.headers["x-csrf-token"] !== "test-csrf") return send({ detail: "CSRF mismatch" }, 403);
      let body = "";
      for await (const chunk of req) body += chunk;
      if (url.pathname.endsWith("/review") && resource) {
        const input: ResourceReview = JSON.parse(body);
        resource = { ...resource, status: input.action === "publish" ? "published" : "withdrawn", version: resource.version + 1 };
        history.unshift({ version: resource.version, actor: "测试管理员", reason: input.reason, snapshot: resource, createdAt: resource.updatedAt });
      } else {
        const input: ResourceWrite = JSON.parse(body);
        resource = { id: "00000000-0000-4000-8000-000000000001", version: 1, status: "draft", data: input.data, links: input.links, updatedAt: "2026-10-17T00:00:00Z" };
        history.push({ version: 1, actor: "测试管理员", reason: input.reason, snapshot: resource, createdAt: resource.updatedAt });
      }
      return send(resource);
    }
    return send({}, 404);
  });
  const web = await startWebServer(api);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${web.origin}/admin/resources`);
    await page.getByRole("link", { name: "＋录入资源" }).click();
    await page.getByLabel("标题", { exact: true }).fill("测试夹具：数媒参赛经验");
    await page.getByLabel("原文／原视频链接").fill("https://example.org/resource-fixture");
    await page.getByLabel("平台", { exact: true }).fill("测试平台");
    await page.getByLabel("教学／经验主题").fill("作品准备");
    await page.getByLabel("简短介绍").fill("本地测试夹具，不是真实收录");
    await page.getByLabel("介绍依据").fill("测试原文");
    await page.getByLabel("核验状态").selectOption("verified");
    await page.getByRole("button", { name: "添加竞赛关联" }).click();
    await page.getByLabel("适用赛段／方向／范围").fill("跨届通用 · 作品准备");
    await page.getByLabel("关联理由（仅后台）").fill("测试关联依据");
    await page.getByLabel("本次操作说明").fill("本地测试录入");
    await page.getByRole("button", { name: "保存待审核" }).click();
    await expect(page.getByRole("heading", { name: "资源编辑与审核" })).toBeVisible();
    await page.getByLabel("本次操作说明").fill("核验后发布");
    await page.getByRole("button", { name: "审核发布", exact: true }).click();
    await expect(page.getByText("已发布 · 版本2", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await expect(page.getByLabel("适用赛段／方向／范围")).toHaveValue("跨届通用 · 作品准备");
    await page.getByLabel("本次操作说明").fill("撤回测试");
    await page.getByRole("button", { name: "撤回", exact: true }).click();
    await expect(page.getByText("已撤回 · 版本3", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "返回资源列表" }).click();
    await expect(page.getByRole("heading", { name: "经验帖与教学视频", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "测试夹具：数媒参赛经验" })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
