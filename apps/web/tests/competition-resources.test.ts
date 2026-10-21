import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { startWebServer } from "./web-server.ts";

test("31 catalogue detail fixtures expose both resource areas; cards, empty, failure and platform return preserve context", async () => {
  const catalogue = JSON.parse(readFileSync(new URL("../../../modules/competition/catalogue.json", import.meta.url), "utf8")).entries as { id: string; name: string }[];
  const curated = JSON.parse(readFileSync(new URL("../../../modules/learning-resources/seeds/competition-resources.json", import.meta.url), "utf8")).resources as { key: string; decision: string; data: { kind: "experience" | "video"; title: string }; links: { competitionId: string }[] }[];
  const editionId = "00000000-0000-4000-8000-000000000001";
  const known = (value: unknown) => ({ value, status: "known", reason: "" });
  const unknown = { value: null, status: "unknown", reason: "待核验" };
  let mode: "populated" | "empty" | "failed" | "curated" = "populated";
  const api = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture");
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (url.pathname === "/api/site/meta") return send({});
    const id = url.pathname.match(/\/api\/v1\/competitions\/(competition-\d{3})\/editions\//)?.[1];
    const entry = catalogue.find(item => item.id === id);
    if (!entry) return send({}, 404);
    if (url.pathname.endsWith("/resources")) {
      if (mode === "failed") return send({ detail: "fixture failure" }, 503);
      if (mode === "empty") return send({ experience: [], video: [] });
      if (mode === "curated") {
        const items = curated.filter(item => item.decision === "publish" && item.links.some(link => link.competitionId === entry.id)).map(item => ({ id: item.key, data: { ...item.data, availabilityMessage: "" }, links: item.links.filter(link => link.competitionId === entry.id) }));
        return send({ experience: items.filter(item => item.data.kind === "experience"), video: items.filter(item => item.data.kind === "video") });
      }
      const data = { title: "测试夹具：入门经验", url: "https://example.org/experience", author: null, platform: "测试平台", contentType: "beginner", topic: "入门与工具", summary: "测试夹具，不是真实收录。", summaryBasis: "原文简介", official: false, verification: "verified", publishedDate: null, publishedYear: 2025, durationSeconds: null, coverUrl: null, availability: "available", availabilityMessage: "" };
      return send({ experience: [{ id: "experience-fixture", data: { ...data, kind: "experience" }, links: [{ competitionId: entry.id, editionId: null, year: null, scope: "初学者 · 工具准备" }] }], video: [{ id: "video-fixture", data: { ...data, kind: "video", title: "测试夹具：官方教学", url: "https://example.org/video", author: "测试官方", official: true, durationSeconds: 125, availability: "temporarily_unreachable", availabilityMessage: "暂时无法访问，稍后重试" }, links: [{ competitionId: entry.id, editionId, year: 2025, scope: "复赛 · 作品展示" }] }] });
    }
    const item = { competitionId: entry.id, catalogueName: entry.name, editionId, revisionId: "test", version: 1, publishedAt: "2026-10-17T00:00:00Z", name: known(entry.name), year: known({ primary: 2025, officialText: "2025年" }), promotionImage: unknown, categories: known(["软件开发"]), schoolRecognition: { schoolLevel: "A2", schoolLevelByScope: [], schoolRecognitionText: null }, participantLimit: unknown, teacherLimit: unknown, registrationTimes: unknown, competitionTimes: unknown, stages: unknown, officialWebsite: unknown, files: unknown, introduction: known("竞赛详情页面测试夹具"), sources: [], activity: [], nextNodes: [] };
    return send({ item, editions: [], computedAt: "2026-10-17T00:00:00Z" });
  });
  const web = await startWebServer(api);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.context().route("https://example.org/**", route => route.fulfill({ contentType: "text/html", body: "<title>原平台测试夹具</title>" }));
    const path = `/competitions/${catalogue[0].id}/editions/${editionId}`;
    const response = await page.goto(web.origin + path);
    assert.match(response?.headers()["cache-control"] ?? "", /(?:^|,\s*)no-store(?:,|$)/);
    await expect(page.getByRole("heading", { name: "经验帖", exact: true })).toBeVisible();
    await expect(page.getByText("作者未知 · 测试平台 · 2025年发布", { exact: true })).toBeVisible();
    await expect(page.getByText("跨届通用 · 初学者 · 工具准备", { exact: true })).toBeVisible();
    await expect(page.getByText("对应本届 · 2025年 · 复赛 · 作品展示", { exact: true })).toBeVisible();
    await expect(page.getByText("官方资源", { exact: true })).toBeVisible();
    await expect(page.getByText("暂时无法访问，稍后重试", { exact: true })).toBeVisible();
    const original = page.url();
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "到原平台观看" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), "https://example.org/video");
    await popup.close();
    assert.equal(page.url(), original);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    mode = "failed";
    await page.reload();
    await expect(page.getByRole("heading", { name: catalogue[0].name, exact: true })).toBeVisible();
    await expect(page.getByText("资源暂时无法加载，请稍后重试。", { exact: true })).toHaveCount(2);
    mode = "empty";
    await page.getByRole("button", { name: "重新加载资源", exact: true }).first().click();
    await expect(page.getByText("暂未收录可核实的经验帖。", { exact: true })).toBeVisible();
    assert.equal(catalogue.length, 31);
    mode = "curated";
    for (const entry of catalogue) {
      await page.goto(`${web.origin}/competitions/${entry.id}/editions/${editionId}`);
      await expect(page.getByRole("heading", { name: entry.name, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "经验帖", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "教学视频", exact: true })).toBeVisible();
      const expected = curated.filter(item => item.decision === "publish" && item.links.some(link => link.competitionId === entry.id));
      await expect(page.locator("article[data-learning-resource]")).toHaveCount(expected.length);
      for (const item of expected) await expect(page.getByRole("heading", { name: `${item.data.title} ↗`, exact: true })).toBeVisible();
      if (!expected.some(item => item.data.kind === "video")) await expect(page.getByText("暂未收录可核实的教学视频。", { exact: true })).toBeVisible();
      if (!expected.some(item => item.data.kind === "experience")) await expect(page.getByText("暂未收录可核实的经验帖。", { exact: true })).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), entry.id);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
