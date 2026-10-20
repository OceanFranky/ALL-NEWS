import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { buildApp } from "@aihot/api/app";
import { resourceDataSchema, resourceWriteSchema, type ResourceData, type ResourceLink, type ManagedResource } from "@aihot/contracts/learning-resources";
import resources from "../server.ts";
import competition from "../../competition/server.ts";
import { saveCatalogue, saveMaterial, saveRevision, startRun } from "../../competition/backend/repository.ts";
import { parseHtml } from "../../competition/backend/materials.ts";
import { extractedSchema } from "../../competition/backend/schema.ts";
import { addEdition, selectDisplay } from "../../competition/backend/display.ts";
import { saveResource, reviewResource, resourceDetail } from "../backend/repository.ts";

installModules([competition, resources]);
const app = await buildApp();
test.after(async () => { await app.close(); installModules([]); config.devAdmin = null; await closeDb(); });
const data = (extra: Partial<ResourceData> = {}): ResourceData => ({ kind: "experience", title: "测试夹具：参赛复盘", url: `https://example.org/resource/${randomUUID()}`, author: null, platform: "本地测试夹具", contentType: "retrospective", topic: "测试关联", summary: "测试内容，不作为真实收录", summaryBasis: "本地测试夹具", official: false, verification: "verified", publishedDate: null, publishedYear: null, durationSeconds: null, coverUrl: null, coverPermission: null, availability: "available", availabilityReason: "", ...extra });
const link = (competitionId: string, editionId: string | null = null, year: number | null = null): ResourceLink => ({ competitionId, editionId, year, scope: editionId || year ? "限定测试届次" : "跨届通用", reason: "内部关联依据，不向读者公开" });
const save = (input: ResourceData, links: ResourceLink[], id: string | null = null, expectedVersion = 0) => saveResource(id, { data: input, links, expectedVersion, reason: "本地测试" }, "resource-test").then(value => value!);
const publish = (resource: ManagedResource) => reviewResource(resource.id, { expectedVersion: resource.version, action: "publish", reason: "核验测试夹具" }, "resource-test").then(value => value!);
const address = (id: string, edition: string) => `/api/v1/competitions/${id}/editions/${edition}/resources`;

async function edition(id: string, year: number) {
  const entry = { id, name: `测试竞赛${id}`, schoolLevel: "A2", schoolLevelByScope: [] };
  await saveCatalogue(entry);
  const material = parseHtml(`https://example.org/${randomUUID()}`, `<body>${"测试竞赛正式通知".repeat(30)}</body>`);
  await saveMaterial(id, material);
  const fields = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, { value: null, status: "unknown", reason: "本地测试", evidence: [] }])));
  const evidence = [{ materialId: material.id, blockId: material.blocks[0].id, quote: "测试竞赛正式通知" }];
  fields.name = { value: entry.name, status: "known", reason: "", evidence };
  fields.year = { value: { primary: year, officialText: String(year) }, status: "known", reason: "", evidence };
  const revisionId = await saveRevision(entry, await startRun(id), fields, [material], [], null);
  const target = await addEdition(id, revisionId, "test", "测试届次");
  await selectDisplay(id, target.editionId, { revisionId, expectedVersion: 0, reason: "测试公开" }, "test");
  return target.editionId;
}
let oldEdition: string;
let currentEdition: string;
let otherEdition: string;
test.before(async () => {
  oldEdition = await edition("competition-001", 2025);
  currentEdition = await edition("competition-001", 2026);
  otherEdition = await edition("competition-002", 2026);
});

test("管理员认证、CSRF、严格输入和未知对象处理", async () => {
  assert.equal((await app.inject("/api/admin/resources")).statusCode, 401);
  config.devAdmin = { displayName: "resource-test" };
  try {
    const payload = { data: data(), links: [link("competition-001")], expectedVersion: 0, reason: "人工录入" };
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/resources", payload })).statusCode, 403);
    const headers = { "x-csrf-token": "dev" };
    const created = await app.inject({ method: "POST", url: "/api/admin/resources", payload, headers });
    assert.equal(created.statusCode, 200, created.body);
    const item: ManagedResource = created.json();
    const review = await app.inject({ method: "POST", url: `/api/admin/resources/${item.id}/review`, headers, payload: { action: "publish", expectedVersion: item.version, reason: "已核验" } });
    assert.equal(review.statusCode, 200, review.body);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/resources", payload: { ...payload, extra: true }, headers })).statusCode, 400);
    assert.equal((await app.inject(`/api/admin/resources/${randomUUID()}`)).statusCode, 404);
    assert.equal((await app.inject("/api/admin/resources?unknown=1")).statusCode, 400);
    assert.equal((await app.inject("/api/admin/resources/targets")).json().length, 2);
  } finally { config.devAdmin = null; }
});

test("跨届通用、指定届次、旧年份、同资源多关联按身份隔离", async () => {
  const generic = await publish(await save(data(), [link("competition-001"), link("competition-002")]));
  const old = await publish(await save(data(), [link("competition-001", oldEdition, 2025)]));
  const yearOnly = await publish(await save(data({ kind: "video" }), [link("competition-001", null, 2025)]));
  const current = await publish(await save(data({ kind: "video" }), [link("competition-001", currentEdition, 2026)]));
  const oldPage = (await app.inject(address("competition-001", oldEdition))).json();
  const currentPage = (await app.inject(address("competition-001", currentEdition))).json();
  const otherPage = (await app.inject(address("competition-002", otherEdition))).json();
  assert.ok(oldPage.experience.some((item: { id: string }) => item.id === old.id));
  assert.ok(oldPage.video.some((item: { id: string }) => item.id === yearOnly.id));
  assert.ok(!currentPage.experience.some((item: { id: string }) => item.id === old.id));
  assert.deepEqual(currentPage.video.map((item: { id: string }) => item.id), [current.id]);
  assert.deepEqual(otherPage.experience.map((item: { id: string }) => item.id), [generic.id]);
  assert.equal((await app.inject(address("competition-002", currentEdition))).statusCode, 404);
  assert.equal((await app.inject(`${address("competition-001", oldEdition)}?extra=1`)).statusCode, 400);
  const publicResponse = await app.inject(address("competition-001", currentEdition));
  assert.equal(publicResponse.headers["cache-control"], "no-store");
  assert.ok(!publicResponse.body.includes("内部关联依据") && !publicResponse.body.includes("coverPermission"));
});

test("编辑、解除关联、撤回即时停止公开；修订与审计保留且不调用模型", async () => {
  const before = await sql`SELECT (SELECT count(*)::int FROM receipts) AS receipts,(SELECT count(*)::int FROM articles) AS articles,(SELECT count(*)::int FROM competition_runs) AS runs`;
  let resource = await publish(await save(data(), [link("competition-001")]));
  const publicIds = async () => (await app.inject(address("competition-001", currentEdition))).json().experience.map((item: { id: string }) => item.id);
  assert.ok((await publicIds()).includes(resource.id));
  resource = await save({ ...resource.data, summary: "修改后的测试内容" }, resource.links, resource.id, resource.version);
  assert.equal(resource.status, "draft");
  assert.ok(!(await publicIds()).includes(resource.id));
  resource = await publish(resource);
  resource = (await reviewResource(resource.id, { action: "withdraw", expectedVersion: resource.version, reason: "撤回测试" }, "resource-test"))!;
  assert.ok(!(await publicIds()).includes(resource.id));
  resource = await save(resource.data, [], resource.id, resource.version);
  await assert.rejects(publish(resource), /发布前/);
  const detail = (await resourceDetail(resource.id))!;
  assert.equal(detail.history.length, resource.version);
  assert.equal(detail.history.at(-1)!.snapshot.data.summary, "测试内容，不作为真实收录");
  const [audit] = await sql`SELECT count(*)::int AS total FROM audit_log WHERE subject=${`resource:${resource.id}`}`;
  assert.equal(audit.total, resource.version);
  const after = await sql`SELECT (SELECT count(*)::int FROM receipts) AS receipts,(SELECT count(*)::int FROM articles) AS articles,(SELECT count(*)::int FROM competition_runs) AS runs`;
  assert.deepEqual(after, before);
});

test("重复链接、错误归属和年份、未核验及失效资源拒绝发布", async () => {
  const first = await save(data(), [link("competition-001")]);
  await assert.rejects(save({ ...first.data, url: `${first.data.url}#fragment` }, []), /已收录/);
  await assert.rejects(save(data(), [link("competition-002", currentEdition)]), /届次不属于/);
  await assert.rejects(save(data(), [link("competition-001", currentEdition, 2025)]), /年份/);
  await assert.rejects(save(data(), [link("competition-099")]), /不存在/);
  await assert.rejects(publish(await save(data({ verification: "unverified" }), [link("competition-001")])));
  await assert.rejects(publish(await save(data({ availability: "invalid", availabilityReason: "原作者删除" }), [link("competition-001")])));
  const transient = await publish(await save(data({ availability: "temporarily_unreachable", availabilityReason: "内部访问检查记录" }), [link("competition-001")]));
  const response = await app.inject(address("competition-001", currentEdition));
  assert.ok(response.body.includes(transient.id));
  assert.ok(response.body.includes("暂时无法访问"));
  assert.ok(!response.body.includes("内部访问检查记录"));
});

test("并发保存／审核拒绝旧版本，不覆盖其他管理员改动", async () => {
  const resource = await save(data(), [link("competition-001")]);
  const results = await Promise.allSettled([publish(resource), publish(resource)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  await assert.rejects(save(resource.data, resource.links, resource.id, resource.version), /版本已变化/);
});

test("公开资源优先官方，同类资源按可靠发布日期排序", async () => {
  const officialOld = await publish(await save(data({ official: true, publishedDate: "2024-01-01", publishedYear: 2024 }), [link("competition-002")]));
  const officialNew = await publish(await save(data({ official: true, publishedDate: "2026-01-01", publishedYear: 2026 }), [link("competition-002")]));
  const personal = await publish(await save(data({ publishedDate: "2026-10-01", publishedYear: 2026 }), [link("competition-002")]));
  const items = (await app.inject(address("competition-002", otherEdition))).json().experience as { id: string }[];
  const position = (id: string) => items.findIndex(item => item.id === id);
  assert.ok(position(officialNew.id) < position(officialOld.id));
  assert.ok(position(officialOld.id) < position(personal.id));
});

test("元数据拒绝危险链接、虚构日期、无依据封面和重复关联", () => {
  assert.equal(resourceDataSchema.safeParse(data({ url: "www.example.org/post" })).success, false);
  assert.equal(resourceDataSchema.parse(data({ url: "https://star.baidu.com/#/learning-more?tab=4" })).url, "https://star.baidu.com/#/learning-more?tab=4");
  assert.equal(resourceDataSchema.parse(data({ url: "https://example.org/post#section" })).url, "https://example.org/post");
  assert.equal(resourceDataSchema.safeParse(data({ url: "javascript:alert(1)" })).success, false);
  assert.equal(resourceDataSchema.safeParse(data({ url: "https://user:secret@example.org/" })).success, false);
  assert.equal(resourceDataSchema.safeParse(data({ publishedDate: "2026-02-30" })).success, false);
  assert.equal(resourceDataSchema.safeParse(data({ publishedDate: "2025-01-01", publishedYear: 2026 })).success, false);
  assert.equal(resourceDataSchema.safeParse(data({ coverUrl: "https://example.org/cover.png" })).success, false);
  assert.equal(resourceWriteSchema.safeParse({ expectedVersion: 0, reason: "test", data: data(), links: [link("competition-001"), link("competition-001")] }).success, false);
});
