import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { config } from "@aihot/backend/config";
import { buildApp } from "@aihot/api/app";
import competition from "../server.ts";
import { extractedSchema, type Extracted } from "../backend/schema.ts";
import { parseHtml } from "../backend/materials.ts";
import { saveCatalogue, saveMaterial, startRun, saveRevision } from "../backend/repository.ts";
import { candidateList, candidateDetail } from "../backend/candidates.ts";
import { addEdition, selectDisplay } from "../backend/display.ts";
import { initialDisplay } from "../backend/initial-display.ts";
import { competitionQuerySchema } from "../backend/query.ts";
import { publishedCompetitions, readCompetitionPublication } from "../backend/publication.ts";

installModules([competition]);
const app = await buildApp();
test.after(async () => { await app.close(); installModules([]); await closeDb(); });
const blank = () => extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, { value: null, status: "unknown", reason: "内部调试信息不公开", evidence: [] }])));

async function candidate(id: string, year: number | null = 2026, configure?: (data: Extracted) => void) {
  const entry = { id, name: `项目${id}`, schoolLevel: "A2", schoolLevelByScope: [{ scope: "专项", level: "B2" }] };
  await saveCatalogue(entry);
  const material = parseHtml(`https://example.org/${id}/${randomUUID()}`, `<body>${"竞赛正式通知2026程序设计与算法".repeat(30)}</body>`);
  await saveMaterial(id, material);
  const data = blank();
  const evidence = [{ materialId: material.id, blockId: material.blocks[0].id, quote: "竞赛正式通知" }];
  data.name = { value: `第九届${id}`, status: "known", reason: "", evidence };
  if (year !== null) data.year = { value: { primary: year, officialText: String(year) }, status: "known", reason: "", evidence };
  data.categories = { value: ["程序设计与算法", "软件开发"], status: "known", reason: "", evidence };
  configure?.(data);
  const revisionId = await saveRevision(entry, await startRun(id), data, [material], ["程序设计与算法", "软件开发"], null);
  return revisionId;
}

test("31项候选分页、详情缺口和来源可查；首次发布固定修订且不触发新闻或模型", async () => {
  const before = await sql`SELECT (SELECT count(*)::int FROM articles) AS news,(SELECT count(*)::int FROM receipts) AS receipts`;
  const entries = [];
  for (let index = 1; index <= 31; index++) {
    const id = `competition-${String(index).padStart(3, "0")}`;
    entries.push({ id, revisionId: await candidate(id) });
  }
  const list = await candidateList(competitionQuerySchema.parse({ page: "2", pageSize: "20" }));
  assert.equal(list.total, 31);
  assert.equal(list.items.length, 11);
  const detail = await candidateDetail(entries[0].id);
  assert.equal(detail?.revision?.validation.valid, true);
  assert.ok(detail?.revision?.validation.missing.includes("promotionImage:unknown"));
  assert.ok(detail!.materials[0].url.startsWith("https://example.org/"));
  assert.equal((await publishedCompetitions(new Date())).length, 0);
  assert.equal((await initialDisplay(entries, "test", false))[0].action, "planned");
  assert.equal((await publishedCompetitions(new Date())).length, 0);
  const published = await initialDisplay(entries, "test", true);
  assert.equal(published.length, 31);
  assert.ok(published.every(entry => entry.action === "published"));
  assert.equal((await initialDisplay(entries, "test", true))[0].action, "unchanged");
  const response = await app.inject("/api/v1/competitions?page=2&pageSize=20");
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().total, 31);
  assert.equal(response.json().items.length, 11);
  assert.equal(response.json().items[0].promotionImage.value, null);
  assert.ok(!response.body.includes("内部调试") && !response.body.includes("materialId") && !response.body.includes("receipt"));
  assert.equal(response.headers["cache-control"], "no-store");
  const after = await sql`SELECT (SELECT count(*)::int FROM articles) AS news,(SELECT count(*)::int FROM receipts) AS receipts`;
  assert.deepEqual(after, before);
});

test("公开搜索、多分类／专项级别／年份／状态筛选与稳定分页", async () => {
  const response = await app.inject(`/api/v1/competitions?${new URLSearchParams({ q: "competition-001", category: "程序设计与算法,软件开发", schoolLevel: "B2", year: "2026", activity: "unknown", sort: "year_desc" })}`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().total, 1);
  assert.equal(response.json().items[0].competitionId, "competition-001");
  assert.equal((await app.inject("/api/v1/competitions?year=2025")).json().total, 0);
  const first = (await app.inject("/api/v1/competitions?pageSize=1")).json().items[0];
  const second = (await app.inject("/api/v1/competitions?page=2&pageSize=1")).json().items[0];
  assert.notEqual(first.editionId, second.editionId);
  const filters = (await app.inject("/api/v1/competitions/filters")).json();
  assert.equal(filters.categories.length, 11);
  assert.deepEqual(filters.schoolLevels, ["A2", "B2"]);
  assert.deepEqual(filters.years, [2026]);
});

test("新候选不会自动覆盖；选择版本须匹配归属、年份及期望版本，撤回所有公开入口一致", async () => {
  const [initial] = (await readCompetitionPublication({ q: "competition-001" })).items;
  const replacement = await candidate("competition-001");
  assert.equal((await readCompetitionPublication({ q: "competition-001" })).items[0].revisionId, initial.revisionId);
  const input = { revisionId: replacement, expectedVersion: 1, reason: "核验后的修订" };
  const concurrent = await Promise.allSettled([selectDisplay(initial.competitionId, initial.editionId, input, "test"), selectDisplay(initial.competitionId, initial.editionId, input, "test")]);
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(result => result.status === "rejected").length, 1);
  assert.equal((await readCompetitionPublication({ q: "competition-001" })).items[0].revisionId, replacement);
  const other = (await readCompetitionPublication({ q: "competition-002" })).items[0];
  await assert.rejects(selectDisplay(initial.competitionId, initial.editionId, { ...input, revisionId: other.revisionId, expectedVersion: 2 }, "test"), /not found/);
  const nextYear = await candidate(initial.competitionId, 2027);
  await assert.rejects(selectDisplay(initial.competitionId, initial.editionId, { ...input, revisionId: nextYear, expectedVersion: 2 }, "test"), /Different competition year/);
  const separate = await addEdition(initial.competitionId, nextYear, "test", "新届");
  await selectDisplay(initial.competitionId, separate.editionId, { ...input, revisionId: nextYear, expectedVersion: 0 }, "test");
  const address = `/api/v1/competitions/${initial.competitionId}/editions/${initial.editionId}`;
  assert.equal((await app.inject(address)).json().editions.length, 2);
  await selectDisplay(initial.competitionId, initial.editionId, { revisionId: null, expectedVersion: 2, reason: "撤回" }, "test");
  assert.equal((await app.inject(address)).statusCode, 404);
  assert.equal((await app.inject("/api/v1/competitions?q=competition-001")).json().total, 1);
  await assert.rejects(initialDisplay([{ id: initial.competitionId, revisionId: initial.revisionId }], "test", true), /Latest revision differs/);
  const audits = await sql`SELECT action FROM audit_log WHERE subject='competition:competition-001'`;
  assert.ok(audits.some(row => row.action === "competition.display.withdraw"));
});

test("同年多届身份不依赖年份，候选不能误绑另一届", async () => {
  const id = "competition-003";
  const old = (await readCompetitionPublication({ q: id })).items[0];
  const revisionId = await candidate(id);
  const other = await addEdition(id, revisionId, "test", "同年另一届");
  assert.notEqual(other.editionId, old.editionId);
  await assert.rejects(selectDisplay(id, old.editionId, { revisionId, expectedVersion: 1, reason: "错误绑定" }, "test"), /different edition/);
});

test("公开参数非法、重复、未知以及详情归属错误均明确拒绝", async () => {
  for (const suffix of ["?category=不存在", "?schoolLevel=不存在", "?activity=不存在", "?page=0", "?pageSize=101", "?page=1&page=2", "?x=1", "?year=bad", "?sort=hot"]) {
    assert.equal((await app.inject(`/api/v1/competitions${suffix}`)).statusCode, 400, suffix);
  }
  assert.equal((await app.inject(`/api/v1/competitions/competition-031/editions/${randomUUID()}`)).statusCode, 404);
  assert.equal((await app.inject("/api/v1/competitions/competition-031/editions/bad")).statusCode, 400);
});

test("候选及写接口使用既有管理员鉴权和CSRF，过期版本返回409", async () => {
  assert.equal((await app.inject("/api/admin/competitions/candidates")).statusCode, 401);
  const principal = config.devAdmin;
  config.devAdmin = { displayName: "competition-test" };
  try {
    const me = (await app.inject("/api/admin/me")).json();
    assert.equal((await app.inject("/api/admin/competitions/candidates")).json().total, 31);
    assert.equal((await app.inject("/api/admin/competitions/candidates?year=2026")).statusCode, 400);
    const detail = (await app.inject("/api/admin/competitions/competition-031/candidate")).json();
    assert.ok(detail.revision.validation.missing.length);
    assert.equal((await app.inject(`/api/admin/competitions/competition-031/candidate?revisionId=${randomUUID()}`)).statusCode, 404);
    const item = (await readCompetitionPublication({ q: "competition-031" })).items[0];
    const url = `/api/admin/competitions/${item.competitionId}/editions/${item.editionId}/display`;
    const payload = { revisionId: null, expectedVersion: 999, reason: "stale" };
    assert.equal((await app.inject({ method: "POST", url, payload })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url, payload, headers: { "x-csrf-token": me.csrf } })).statusCode, 409);
  } finally { config.devAdmin = principal; }
});

test("状态筛选返回同时开放的报名和比赛，下一节点及来源按展示版本提供", async () => {
  const id = "competition-030";
  const current = (await readCompetitionPublication({ q: id })).items[0];
  const revisionId = await candidate(id, 2026, data => {
    const period = { scope: "专项", label: "预选", officialText: "预选时间", precision: "minute" as const, timezone: "UTC", start: new Date(Date.now() - 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"), end: new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z") };
    const evidence = data.name.evidence;
    data.registrationTimes = { value: [period], status: "known", reason: "", evidence };
    data.competitionTimes = { value: [period], status: "known", reason: "", evidence };
  });
  await selectDisplay(id, current.editionId, { revisionId, expectedVersion: current.version, reason: "验证时间状态" }, "test");
  for (const activity of ["registration_open", "competition_ongoing"]) {
    const response = await app.inject(`/api/v1/competitions?q=${id}&activity=${activity}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().total, 1);
    assert.equal(response.json().items[0].nextNodes.length, 2);
    assert.equal(response.json().items[0].sources.length, 1);
  }
});

test("无年份和无图片允许明确展示，校验失败或已拒绝候选不允许展示", async () => {
  const id = "competition-029";
  const revisionId = await candidate(id, null);
  const edition = await addEdition(id, revisionId, "test", "年份未核验，缺图保留");
  await selectDisplay(id, edition.editionId, { revisionId, expectedVersion: 0, reason: "允许明确缺失" }, "test");
  const unknown = await app.inject(`/api/v1/competitions?q=${id}&year=unknown`);
  assert.equal(unknown.json().total, 1);
  assert.equal(unknown.json().items[0].year.status, "unknown");
  const rejected = await candidate(id);
  await sql`UPDATE competition_revisions SET status='rejected' WHERE competition_id=${id} AND id=${rejected}`;
  await assert.rejects(addEdition(id, rejected, "test", "拒绝项"), /failed publication validation/);
  const invalid = await candidate(id, 2026, data => {
    data.name.evidence = [{ materialId: "nonexistent", blockId: "missing", quote: "错误依据" }];
  });
  await assert.rejects(addEdition(id, invalid, "test", "错误引用"), /failed publication validation/);
  assert.equal((await app.inject(`/api/v1/competitions?q=${id}&year=unknown`)).json().items[0].revisionId, revisionId);
});

test("总览与公开集合一致，重点依据固定方向，重要变更只取当前展示修订的已知事实变化", async () => {
  const response = await app.inject("/api/v1/competitions/overview");
  assert.equal(response.statusCode, 200);
  const overview = response.json();
  const records = (await readCompetitionPublication({ pageSize: "100" })).items;
  assert.equal(overview.total, records.length);
  assert.equal(overview.registrationOpen, records.filter(item => item.activity.some(entry => entry.status === "registration_open")).length);
  assert.ok(overview.active.every((item: { activity: Array<{ status: string }> }) => item.activity.some(entry => ["registration_open", "competition_ongoing"].includes(entry.status))));
  assert.equal(overview.featured.length, 3);
  assert.equal(overview.categories.length, 11);
  for (const category of overview.categories) assert.equal(category.count, records.filter(item => item.categories.value?.includes(category.name)).length);
  assert.equal(overview.changes.length, 0);
  assert.equal((await app.inject("/api/v1/competitions/overview?q=bad")).statusCode, 400);
  const current = records.find(item => item.competitionId === "competition-030")!;
  const revisionId = await candidate(current.competitionId, 2026, data => {
    data.registrationTimes = { value: current.registrationTimes.value!.map(time => ({ ...time, end: new Date(Date.parse(time.end!) + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z") })), status: "known", reason: "", evidence: data.name.evidence };
  });
  assert.equal((await app.inject("/api/v1/competitions/overview")).json().changes.length, 0);
  await selectDisplay(current.competitionId, current.editionId, { revisionId, expectedVersion: current.version, reason: "已核验报名延期" }, "test");
  const changes = (await app.inject("/api/v1/competitions/overview")).json().changes;
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].fields.map((field: { name: string }) => field.name), ["报名时间"]);
  assert.deepEqual(changes[0].fields[0].previous.value, current.registrationTimes.value);
  assert.equal(changes[0].item.revisionId, revisionId);
  await selectDisplay(current.competitionId, current.editionId, { revisionId: null, expectedVersion: current.version + 1, reason: "撤回" }, "test");
  assert.equal((await app.inject("/api/v1/competitions/overview")).json().changes.length, 0);
});
