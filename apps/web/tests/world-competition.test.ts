import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chromium, expect } from "@playwright/test";
import { startWebServer } from "./web-server.ts";

test("world and competition navigation coexist with industry navigation and independent bookmarks", async () => {
  const known = (value: unknown) => ({ value, status: "known", reason: "" });
  const unknown = { value: null, status: "unknown", reason: "资料不足，待核验" };
  const competition = {
    competitionId: "competition-001", catalogueName: "集成竞赛", editionId: "00000000-0000-4000-8000-000000000001", revisionId: "fixture", version: 1,
    publishedAt: "2026-10-15T00:00:00Z", name: known("集成竞赛2026"), year: known({ primary: 2026, officialText: "2026年" }),
    promotionImage: unknown, categories: known(["软件开发"]), schoolRecognition: { schoolLevel: "A2", schoolLevelByScope: [], schoolRecognitionText: null },
    participantLimit: unknown, teacherLimit: unknown, registrationTimes: unknown, competitionTimes: unknown, stages: unknown,
    officialWebsite: unknown, files: unknown, introduction: known("软件实践方向的集成测试竞赛。"), sources: [],
    activity: [{ kind: "registration", scope: "", label: "", status: "unknown" }], nextNodes: [],
  };
  const world = { id: "world-integration", title: "世界集成新闻", summary: "仅用于本地联合验收的摘要。", reason: "测试", category: "economy", score: 70,
    selected: true, source: { name: "测试来源" }, links: { original: "https://example.org/world" }, publishedAt: null, timelineAt: "2026-10-15T00:00:00Z", storyPublicId: null };
  const api = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture");
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (url.pathname === "/api/site/meta") return send({});
    if (url.pathname.startsWith("/api/v1/world/daily/")) return send({}, 404);
    if (url.pathname === "/api/v1/world/highlights") return send({ status: "calibration-required", categories: [] });
    if (url.pathname === "/api/v1/world/items") return send({ sectionId: "world", items: [world], count: 1, pagination: { page: 1, limit: 20, total: 1, hasMore: false }, days: [{ date: "2026-10-15", count: 1 }] });
    if (url.pathname === "/api/v1/world/items/world-integration") return send({ sectionId: "world", item: world });
    if (url.pathname === "/api/v1/competitions/overview") return send({ total: 1, registrationOpen: 0, competitionOngoing: 0, active: [], featured: [{ item: competition, reason: "软件实践" }], upcoming: [], categories: [], changes: [], computedAt: competition.publishedAt });
    if (url.pathname === "/api/v1/competitions/filters") return send({ categories: ["软件开发"], schoolLevels: ["A2"], years: [2026], hasUnknownYear: false, activities: ["unknown"], sorts: ["catalogue"] });
    if (url.pathname === "/api/v1/competitions") return send({ items: [competition], total: 1, page: 1, pageSize: 12, computedAt: competition.publishedAt });
    if (url.pathname.includes("/api/v1/competitions/competition-001/editions/")) return send({ item: competition, editions: [], computedAt: competition.publishedAt });
    return send({}, 404);
  });
  const web = await startWebServer(api);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${web.origin}/world/timeline`);
    await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "世界新闻", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "大学生竞赛", exact: true })).toBeVisible();
    await page.getByRole("link", { name: world.title, exact: true }).click();
    await expect(page.getByRole("heading", { name: world.title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
    const newsStars = await page.evaluate(() => localStorage.getItem("aihot-starred-items"));
    await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "大学生竞赛", exact: true }).click();
    await expect(page.getByRole("heading", { name: "大学生竞赛", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "竞赛导航" }).getByRole("link", { name: "全部竞赛库" }).click();
    await page.locator("[data-competition-card] h3 a").click();
    await expect(page.getByRole("heading", { name: "集成竞赛2026", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "收藏竞赛", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toHaveAttribute("aria-pressed", "true");
    assert.equal(await page.evaluate(() => localStorage.getItem("aihot-starred-items")), newsStars);
    assert.ok((await page.evaluate(() => localStorage.getItem("competition-starred-editions-v1")))?.includes(competition.editionId));
    await page.screenshot({ path: "/tmp/world-competition-desktop.png", caret: "initial" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${web.origin}/world/timeline`);
    const navigation = page.getByRole("navigation", { name: "底部导航" });
    await expect(navigation.getByRole("link")).toHaveCount(5);
    const boxes = await navigation.getByRole("link").evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, left: rect.left, right: rect.right }; }));
    assert.ok(boxes.every(box => Math.abs(box.top - boxes[0].top) < 1 && box.left >= 0 && box.right <= 391));
    await navigation.getByRole("link", { name: "竞赛", exact: true }).click();
    await expect(page.getByRole("heading", { name: "大学生竞赛", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "竞赛", exact: true })).toHaveAttribute("aria-current", "page");
    await navigation.getByRole("link", { name: "世界", exact: true }).click();
    await expect(page.getByRole("heading", { name: "世界新闻", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "世界", exact: true })).toHaveAttribute("aria-current", "page");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "/tmp/world-competition-mobile.png", caret: "initial" });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
