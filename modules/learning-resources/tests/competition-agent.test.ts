import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import "@aihot/site/modules/competition-resources";
import { competitionResourceStage } from "../../competition/backend/resource-stage.ts";
import { CompetitionBudgetExhaustedError } from "../../competition/backend/allowance.ts";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { ingestCompetition } from "../../competition/backend/workflow.ts";
import { parseHtml } from "../../competition/backend/materials.ts";
import { extractedSchema, catalogueEntrySchema, type CatalogueEntry } from "../../competition/backend/schema.ts";
import { readRun, saveCatalogue, startRun, saveMaterial } from "../../competition/backend/repository.ts";
import { maintainCompetitionResources } from "../backend/competition.ts";
import { maintenanceSettings, saveMaintenanceSettings, previewMaintenance, maintenanceRun, stopMaintenance, createMaintenanceRun } from "../backend/maintenance.ts";
import { getResource, saveResource, reviewResource } from "../backend/repository.ts";

const paths: string[] = [];
const server = createServer((req, res) => {
  paths.push(req.url!);
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url?.includes("captcha")) return res.end("<title>安全验证</title><body>验证码</body>");
  const title = req.url?.includes("video") ? "竞赛教学视频" : "竞赛备赛经验分享";
  res.end(`<title>${title}</title><body>${"本地夹具，用来验证自动接入，不是真实竞赛资源。".repeat(30)}</body>`);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const previous = { collect: process.env.COLLECT_ENABLED, private: config.allowPrivateNetworkFetch };
test.before(() => { process.env.COLLECT_ENABLED = "true"; config.allowPrivateNetworkFetch = true; });
test.after(async () => { process.env.COLLECT_ENABLED = previous.collect; config.allowPrivateNetworkFetch = previous.private; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await closeDb(); });
const entry: CatalogueEntry = { id: "competition-001", name: "本地竞赛夹具", schoolLevel: "A2", schoolLevelByScope: [], collectionScope: "只收学生组" };
const blank = () => extractedSchema.parse(Object.fromEntries(["name", "year", "promotionImage", "categories", "participantLimit", "teacherLimit", "registrationTimes", "competitionTimes", "stages", "officialWebsite", "files", "introduction"].map(k => [k, { value: null, status: "unknown", reason: "本地夹具", evidence: [] }])));
const material = (key: string) => parseHtml(`${origin}/${key}/notice`, `<body>${"本地竞赛通知。".repeat(30)}<a href="/${key}/experience?utm_source=agent">备赛经验分享</a><a href="/${key}/video">竞赛视频培训</a><a href="/${key}/captcha">经验验证码</a></body>`);
async function configure(patch: Record<string, unknown> = {}) {
  const current = await maintenanceSettings();
  return saveMaintenanceSettings({ expectedVersion: current.version, reason: "本地联调", config: { ...current.config, competitionAgentEnabled: true, maxSources: 5, maxChecks: 20, maxCandidates: 10, maxRequests: 40, sources: current.config.sources.map(s => ({ ...s, enabled: false })), ...patch } }, "test");
}
const linked = (m: ReturnType<typeof material>) => ({ collect: async () => m, extract: async () => ({ data: blank(), receiptId: null }), resources: competitionResourceStage()! });

test("统一竞赛入口自动创建视频与经验草稿；unchanged仍运行资源且不重复、不覆盖撤回", async () => {
  assert.equal(competitionResourceStage(), maintainCompetitionResources);
  await configure();
  const m = material("integrated");
  const receipts = (await sql`SELECT count(*)::int n FROM receipts`)[0].n;
  const result = await ingestCompetition(entry, [m.url], [], linked(m));
  const run = await readRun(entry.id, result.runId);
  assert.equal(run.report.resources.status, "succeeded");
  assert.equal(run.report.resources.created, 2);
  const maintenance = (await maintenanceRun(run.report.resources.maintenanceRunId))!;
  assert.equal(maintenance.plan.competition!.runId, result.runId);
  assert.equal(maintenance.report.requests, 3);
  assert.ok(maintenance.report.observations.some(o => o.outcome === "restricted"));
  const drafts = await Promise.all(maintenance.report.observations.filter(o => o.resourceId).map(o => getResource(o.resourceId!)));
  assert.deepEqual(new Set(drafts.map(d => d!.data.kind)), new Set(["video", "experience"]));
  for (const draft of drafts) {
    assert.equal(draft!.status, "draft"); assert.equal(draft!.data.official, false); assert.equal(draft!.data.verification, "unverified");
    assert.equal(draft!.data.publishedDate, null); assert.equal(draft!.links[0].competitionId, entry.id);
    assert.match(draft!.links[0].scope, /只收学生组/); assert.match(draft!.data.summaryBasis, new RegExp(result.runId));
  }
  const withdrawn = await reviewResource(drafts[0]!.id, { expectedVersion: 1, action: "withdraw", reason: "测试撤回" }, "test");
  let extracted = false;
  const next = await ingestCompetition(entry, [m.url], [], { ...linked(m), extract: async () => { extracted = true; return { data: blank(), receiptId: null }; } }, true);
  const second = await readRun(entry.id, next.runId);
  assert.equal(extracted, false); assert.equal(second.report.unchanged, true);
  assert.equal(second.report.resources.created, 0); assert.equal(second.report.resources.duplicates, 2);
  assert.deepEqual(await getResource(drafts[0]!.id), withdrawn);
  assert.equal((await sql`SELECT count(*)::int n FROM receipts`)[0].n, receipts);
});

test("详情失败仍执行资源；资源失败不覆盖详情结果及原错误", async () => {
  const m = material("failed-details");
  await assert.rejects(ingestCompetition(entry, [m.url], [], { ...linked(m), extract: async () => { throw new Error("detail fixture failed"); } }), /detail fixture failed/);
  const [failed] = await sql`SELECT status,report FROM competition_runs WHERE report->>'error'='detail fixture failed'`;
  assert.equal(failed.status, "failed"); assert.equal(failed.report.resources.created, 2);
  const result = await ingestCompetition(entry, [m.url], [], { ...linked(m), resources: async () => { throw new Error("resource fixture failed"); } });
  const run = await readRun(entry.id, result.runId);
  assert.ok(result.revisionId); assert.equal(run.status, "needs_review"); assert.equal(run.report.resources.status, "failed");
  let visited = false;
  await assert.rejects(ingestCompetition(entry, [m.url], [], { ...linked(m), collect: async () => { throw new Error("no readable material"); }, resources: async (_context, materials) => { visited = true; assert.equal(materials.length, 0); return { status: "skipped", maintenanceRunId: null, reason: "本地无材料" }; } }), /no readable material/);
  assert.equal(visited, true);
  await assert.rejects(ingestCompetition(entry, [m.url], [], { ...linked(m), extract: async () => { throw new CompetitionBudgetExhaustedError(); } }), /budget exhausted/);
  const [budget] = await sql`SELECT status,report FROM competition_runs WHERE status='budget_stopped' ORDER BY started_at DESC LIMIT 1`;
  assert.equal(budget.report.resources.status, "succeeded");
});

test("材料真实跨站链接可入候选，同源优先，旧配置补开关而不改变定时设置", async () => {
  const { competitionAgentEnabled: _ignored, ...old } = (await maintenanceSettings()).config;
  await sql`UPDATE resource_maintenance_settings SET config=${sql.json(old as never)}`;
  assert.equal((await maintenanceSettings()).config.competitionAgentEnabled, true);
  assert.equal((await maintenanceSettings()).config.enabled, false);
  await configure();
  const external = origin.replace("127.0.0.1", "localhost");
  const m = parseHtml(origin + "/cross/notice", `<body>${"本地测试材料".repeat(30)}<a href="${external}/cross/experience">外站经验分享</a><a href="/cross/video">同源视频培训</a></body>`);
  const result = await ingestCompetition(entry, [m.url], [], linked(m));
  const run = await readRun(entry.id, result.runId);
  const report = (await maintenanceRun(run.report.resources.maintenanceRunId))!;
  assert.equal(report.report.created, 2);
  const cross = report.report.observations.filter(o => o.url.includes("/cross/"));
  assert.equal(cross[0].url, origin + "/cross/video");
  assert.ok(report.plan.candidates!.some(c => c.url.startsWith(external)));
  for (const candidate of report.report.observations.filter(o => o.resourceId)) assert.equal((await getResource(candidate.resourceId!))!.data.official, false);
});

test("31项均经统一入口建立真实任务关联，资源请求不产生模型回执或公开展示", async () => {
  await configure();
  const catalogue = JSON.parse(readFileSync(new URL("../../competition/catalogue.json", import.meta.url), "utf8"));
  const before = (await sql`SELECT (SELECT count(*)::int FROM receipts) receipts,(SELECT count(*)::int FROM competition_displays) displays`)[0];
  assert.equal(catalogue.entries.length, 31);
  for (const raw of catalogue.entries) {
    const e = catalogueEntrySchema.parse({ id: raw.id, name: raw.name, schoolLevel: raw.schoolLevel, schoolLevelByScope: raw.schoolLevelByScope, schoolRecognitionText: raw.schoolRecognitionText, collectionScope: raw.collectionScope });
    const m = material("catalogue-" + e.id);
    const result = await ingestCompetition(e, [m.url], [], linked(m));
    const run = await readRun(e.id, result.runId);
    assert.equal(run.report.resources.created, 2, e.id);
    const maintenance = (await maintenanceRun(run.report.resources.maintenanceRunId))!;
    for (const candidate of maintenance.report.observations.filter(o => o.resourceId)) {
      const resource = (await getResource(candidate.resourceId!))!;
      assert.equal(resource.links[0].competitionId, e.id); assert.equal(resource.links[0].editionId, null);
    }
  }
  assert.deepEqual((await sql`SELECT (SELECT count(*)::int FROM receipts) receipts,(SELECT count(*)::int FROM competition_displays) displays`)[0], before);
});

test("开关、请求上限、当前竞赛隔离、未保存链接与任务归属", async () => {
  await configure({ maxRequests: 1 });
  const m = material("limited");
  await saveMaterial(entry.id, m);
  const runId = await startRun(entry.id);
  const context = { competitionId: entry.id, runId, name: entry.name };
  const limited = await maintainCompetitionResources(context, [m]);
  assert.equal(limited.requests, 1); assert.equal(limited.created, 1);
  await configure({ competitionAgentEnabled: false });
  const hits = paths.length;
  assert.equal((await maintainCompetitionResources(context, [m])).status, "skipped");
  assert.equal(paths.length, hits);
  await configure();
  process.env.COLLECT_ENABLED = "false";
  assert.equal((await maintainCompetitionResources(context, [m])).status, "skipped");
  process.env.COLLECT_ENABLED = "true";
  await assert.rejects(maintainCompetitionResources({ ...context, competitionId: "competition-002" }, [m]), /ownership mismatch/);
  const fake = { ...m, id: "not-persisted", links: [{ title: "虚构经验分享", url: origin + "/never-fetch" }] };
  await maintainCompetitionResources(context, [fake]);
  assert.ok(!paths.includes("/never-fetch"));
  const other = (await saveResource(null, { expectedVersion: 0, reason: "隔离测试", data: { ...(await getResource((await sql`SELECT id FROM learning_resources LIMIT 1`)[0].id))!.data, url: origin + "/other-competition", verification: "verified" }, links: [{ competitionId: "competition-002", editionId: null, year: null, scope: "测试", reason: "测试" }] }, "test"))!;
  await reviewResource(other.id, { expectedVersion: 1, action: "publish", reason: "测试" }, "test");
  assert.ok(!(await previewMaintenance(entry.id)).resourceIds.includes(other.id));
  const settings = await maintenanceSettings();
  await configure({ sources: settings.config.sources.map(s => ({ ...s, enabled: true, urls: [origin + "/" + s.competitionId + "/source"] })) });
  assert.ok((await previewMaintenance(entry.id)).sources.every(s => s.competitionId === entry.id));
});

test("资源阶段可停止，已有活动任务如实跳过，SSRF保护不因Agent接入而绕过", async () => {
  await configure();
  const m = material("cancel");
  await saveMaterial(entry.id, m);
  const runId = await startRun(entry.id);
  const context = { competitionId: entry.id, runId, name: entry.name };
  const stopped = await maintainCompetitionResources(context, [m], async url => {
    const [active] = await sql`SELECT id FROM resource_maintenance_runs WHERE status='running'`;
    await stopMaintenance(active.id, "test");
    return guardedFetch(url, { maxRedirects: 0 });
  });
  assert.equal(stopped.status, "cancelled"); assert.equal(stopped.requests, 1); assert.equal(stopped.created, 0);
  const plan = await previewMaintenance(entry.id);
  plan.candidates = [{ competitionId: entry.id, url: origin + "/queued", title: "经验分享", sourceUrl: m.url }];
  const queued = (await createMaintenanceRun("test", false, plan))!;
  assert.equal((await maintainCompetitionResources(context, [m])).status, "skipped");
  await stopMaintenance(queued, "test");
  config.allowPrivateNetworkFetch = false;
  const hits = paths.length;
  const denied = await maintainCompetitionResources(context, [m]);
  assert.equal(paths.length, hits); assert.equal(denied.created, 0);
  assert.ok((await maintenanceRun(denied.maintenanceRunId!))!.report.observations.every(o => o.outcome === "error"));
  config.allowPrivateNetworkFetch = true;
});
