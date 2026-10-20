import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { guardedFetch, type GuardedResponse } from "@aihot/backend/lib/http-fetch";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { maintenanceConfigSchema, maintenanceWriteSchema, resourceUrlSchema, type MaintenanceSettings, type MaintenancePlan, type MaintenanceRun, type MaintenanceReport, type MaintenanceObservation, type ResourceCandidate } from "@aihot/contracts/learning-resources";
import { getResource, saveResource } from "./repository.ts";

const defaults = maintenanceConfigSchema.parse(JSON.parse(readFileSync(new URL("../seeds/maintenance-sources.json", import.meta.url), "utf8")));
const collectionEnabled = () => process.env.COLLECT_ENABLED === "true";
const emptyReport = (): MaintenanceReport => ({ requests: 0, created: 0, duplicates: 0, observations: [] });
const sourceKey = (id: string, url: string) => `source:${id}:${url}`;
const resourceKey = (id: string) => `resource:${id}`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function maintenanceSettings(): Promise<MaintenanceSettings> {
  const [row] = await sql`SELECT version,config FROM resource_maintenance_settings WHERE id=true`;
  return row ? { version: row.version, config: maintenanceConfigSchema.parse(row.config) } : { version: 0, config: structuredClone(defaults) };
}
export async function saveMaintenanceSettings(raw: unknown, actor: string) {
  const input = maintenanceWriteSchema.parse(raw);
  if (input.config.sources.length !== defaults.sources.length || input.config.sources.some(s => !defaults.sources.some(d => d.competitionId === s.competitionId))) throw new Conflict("请保留31项既定竞赛的来源配置");
  return sql.begin(async tx => {
    // Serializes the first insert as well as later edits of this singleton.
    await tx`SELECT pg_advisory_xact_lock(176320,1)`;
    const [before] = await tx`SELECT version,config FROM resource_maintenance_settings WHERE id=true FOR UPDATE`;
    if ((before?.version ?? 0) !== input.expectedVersion) throw new Conflict("维护配置已变化，请刷新后保存");
    const after = { version: input.expectedVersion + 1, config: input.config };
    await tx`INSERT INTO resource_maintenance_settings (id,version,config) VALUES (true,${after.version},${tx.json(after.config)}) ON CONFLICT (id) DO UPDATE SET version=excluded.version,config=excluded.config,updated_at=now()`;
    await audit(actor, "resource.maintenance.configure", "resource-maintenance", input.reason, before ?? null, after, { db: tx });
    return after;
  });
}
function asRun(row: Record<string, any>): MaintenanceRun {
  return { id: row.id, status: row.status, actor: row.actor, plan: row.plan, report: row.report, cancelRequested: row.cancel_requested, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
export async function maintenanceRun(id: string) {
  const [row] = await sql`SELECT * FROM resource_maintenance_runs WHERE id=${id}`;
  return row ? asRun(row) : null;
}
export async function maintenanceOverview() {
  const [settings, runs] = await Promise.all([maintenanceSettings(), sql`SELECT * FROM resource_maintenance_runs ORDER BY created_at DESC LIMIT 20`]);
  return { settings, collectionEnabled: collectionEnabled(), runs: runs.map(asRun) };
}
export async function previewMaintenance(competitionId?: string): Promise<MaintenancePlan> {
  const settings = await maintenanceSettings();
  const { config } = settings;
  const checks = await sql`SELECT key,checked_at FROM resource_maintenance_checks`;
  const checked = new Map(checks.map(row => [row.key, new Date(row.checked_at).getTime()]));
  const due = (key: string) => (checked.get(key) ?? 0) <= Date.now() - config.intervalDays * 86400000;
  const sources = config.sources.filter(s => s.enabled && (!competitionId || s.competitionId === competitionId)).flatMap(s => s.urls.map(url => ({ competitionId: s.competitionId, name: s.name, keywords: s.keywords, url })))
    .filter(s => due(sourceKey(s.competitionId, s.url))).sort((a, b) => (checked.get(sourceKey(a.competitionId, a.url)) ?? 0) - (checked.get(sourceKey(b.competitionId, b.url)) ?? 0)).slice(0, config.maxSources);
  const rows = await sql`SELECT r.id FROM learning_resources r LEFT JOIN resource_maintenance_checks c ON c.key='resource:' || r.id::text
    WHERE r.status='published' AND r.data->>'availability'<>'invalid' AND (c.checked_at IS NULL OR c.checked_at <= now() - ${config.intervalDays} * interval '1 day')
    AND (${competitionId ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM learning_resource_links l WHERE l.resource_id=r.id AND l.competition_id=${competitionId ?? null}))
    ORDER BY c.checked_at ASC NULLS FIRST,r.id LIMIT ${config.maxChecks}`;
  return { settings, sources, resourceIds: rows.map(r => r.id), collectionEnabled: collectionEnabled() };
}
export async function createMaintenanceRun(actor: string, scheduled = false, preparedPlan?: MaintenancePlan) {
  const plan = preparedPlan ?? await previewMaintenance();
  if (!collectionEnabled()) throw new Conflict("采集总开关COLLECT_ENABLED未开启，仍可预览维护计划");
  if (scheduled && !plan.settings.config.enabled) return null;
  if (!plan.sources.length && !plan.resourceIds.length && !plan.candidates?.length) return null;
  const id = randomUUID();
  try {
    await sql.begin(async tx => {
      await tx`INSERT INTO resource_maintenance_runs (id,status,actor,plan,report) VALUES (${id},'queued',${actor},${tx.json(plan as never)},${tx.json(emptyReport() as never)})`;
      await audit(actor, "resource.maintenance.start", `resource-maintenance:${id}`, plan.competition ? `竞赛Agent资源接入：${plan.competition.runId}` : scheduled ? "定时维护" : "手动维护", null, { settingsVersion: plan.settings.version, competition: plan.competition ?? null }, { db: tx });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Conflict("已有维护任务，请等待完成或停止该任务");
    throw error;
  }
  return id;
}
export async function stopMaintenance(id: string, actor: string) {
  return sql.begin(async tx => {
    const [row] = await tx`SELECT * FROM resource_maintenance_runs WHERE id=${id} FOR UPDATE`;
    if (!row) return null;
    // A dead worker cannot acknowledge cancellation; its queue execution expires after 10 minutes.
    const immediate = row.status === "queued" || Date.now() - new Date(row.updated_at).getTime() > 15 * 60000;
    if (["queued", "running"].includes(row.status)) {
      await tx`UPDATE resource_maintenance_runs SET cancel_requested=true,status=${immediate ? "cancelled" : row.status},updated_at=now() WHERE id=${id}`;
      await audit(actor, "resource.maintenance.stop", `resource-maintenance:${id}`, "停止维护，当前请求结束后停止", { status: row.status }, { cancelRequested: true }, { db: tx });
    }
    return { stopped: true };
  });
}

/** Remove known tracking parameters only; preserve content identity and SPA routes. */
export function canonicalResourceUrl(raw: string): string {
  const url = new URL(resourceUrlSchema.parse(raw));
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|spm_id_from|vd_source|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export function inspectResourcePage(response: GuardedResponse) {
  if ([404, 410].includes(response.status)) return { outcome: "missing", note: `HTTP ${response.status}，建议人工核实；未自动撤回` };
  if (response.status < 200 || response.status >= 300) return { outcome: "restricted", note: `HTTP ${response.status}，暂不能判断资源是否失效` };
  if (!/html/i.test(response.headers.get("content-type") ?? "")) return { outcome: "unknown", note: "非HTML页面，需人工检查视频或文件" };
  const $ = load(response.text());
  $("script,style,noscript,nav,footer").remove();
  const title = $("title").text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const challenge = /验证码|安全验证|访问验证|访问受限|访问过于频繁|IP.*风险|人机验证|请先登录|captcha|access denied|verify you are human/i;
  if (challenge.test(title) || text.length < 400 && (challenge.test(text) || $("input[type=password],input#codeValue").length > 0) || /登录|sign in/i.test(title)) return { outcome: "restricted", note: "登录／风控／验证页面，保留人工判断" };
  if (/404|页面不存在|内容已删除|视频已失效|视频不见了/.test(title) || /^(该|此)(内容|视频|文章).{0,12}(已删除|不存在|已下架)/.test(text)) return { outcome: "missing", note: "页面提示内容不存在，需人工核实；未自动撤回" };
  if (!title || text.length < 120) return { outcome: "unknown", note: "正文不足或需要动态加载，不能确认内容可用" };
  return { outcome: "page_readable", note: "页面正文可读；未证明内容质量或视频可播放", title: title.slice(0, 300), text, hash: digest(text) };
}
export function discoverResourceLinks(html: string, source: MaintenancePlan["sources"][number]) {
  const $ = load(html);
  $("nav,footer,header").remove();
  const found = new Map<string, { url: string; title: string }>();
  $("a[href]").each((_i, element) => {
    const title = $(element).text().replace(/\s+/g, " ").trim();
    if (title.length < 4 || !source.keywords.some(k => title.toLowerCase().includes(k.toLowerCase()))) return;
    try {
      const url = canonicalResourceUrl(new URL($(element).attr("href")!, source.url).href);
      // Following an official site's external link does not establish the new site's identity.
      if (new URL(url).origin !== new URL(source.url).origin || url === canonicalResourceUrl(source.url) || /\.(pdf|zip|png|jpg|mp4)(\?|$)/i.test(url)) return;
      if (found.size < 100) found.set(url, { url, title: title.slice(0, 300) });
    } catch { /* Ignore anchors, javascript and invalid URL values. */ }
  });
  return [...found.values()];
}

export type FetchPage = (url: string) => Promise<GuardedResponse>;
const fetchPage: FetchPage = url => guardedFetch(url, { timeoutMs: 8000, maxBytes: 1024 * 1024, maxRedirects: 0, headers: { accept: "text/html" } });
export async function executeMaintenance(id: string, fetch: FetchPage = fetchPage) {
  const [claimed] = await sql`UPDATE resource_maintenance_runs SET status='running',updated_at=now() WHERE id=${id} AND status='queued' AND cancel_requested=false RETURNING *`;
  if (!claimed) return;
  const run = asRun(claimed);
  const report = emptyReport();
  const limits = maintenanceConfigSchema.parse(run.plan.settings.config);
  const allowed = async () => {
    const current = await maintenanceRun(id);
    return collectionEnabled() && current?.status === "running" && !current.cancelRequested;
  };
  const checkpoint = async () => { await sql`UPDATE resource_maintenance_runs SET report=${sql.json(report as never)},updated_at=now() WHERE id=${id} AND status='running'`; };
  const observe = async (key: string, observation: MaintenanceObservation, hash?: string) => {
    report.observations.push(observation);
    await sql`INSERT INTO resource_maintenance_checks (key,observation) VALUES (${key},${sql.json({ ...observation, hash } as never)}) ON CONFLICT (key) DO UPDATE SET checked_at=now(),observation=excluded.observation`;
    await checkpoint();
  };
  const request = async (url: string) => {
    report.requests++;
    // Record the attempt before IO so an interrupted process retains its request count.
    await checkpoint();
    return fetch(url);
  };
  const canRequest = async () => report.requests < limits.maxRequests && await allowed();
  const notes = (error: unknown) => error instanceof Error && /redirect/i.test(error.message) ? "重定向未跟随，请核对最终地址后更新来源" : "请求超时、网络失败或安全检查拒绝；未判定失效";
  try {
    const known = new Set((await sql`SELECT url FROM learning_resources`).map(r => canonicalResourceUrl(r.url)));
    const seen = new Set<string>();
    const acceptCandidate = async (candidate: ResourceCandidate) => {
      if (seen.has(candidate.url)) return;
      seen.add(candidate.url);
      if (known.has(candidate.url)) { report.duplicates++; await checkpoint(); return; }
      if (report.created >= limits.maxCandidates || !await canRequest()) return;
      const result: MaintenanceObservation = { type: "candidate", url: candidate.url, outcome: "unknown", note: "" };
      try {
        const page = inspectResourcePage(await request(candidate.url));
        if (!await allowed()) return;
        result.outcome = page.outcome; result.note = page.note;
        if (page.outcome === "page_readable" && page.text) {
          const context = run.plan.competition;
          const isVideo = /视频|录像|录播|video/i.test(candidate.title);
          const evidence = `发现页${candidate.sourceUrl}${candidate.materialId ? `；材料${candidate.materialId}` : ""}${context ? `；竞赛任务${context.runId}` : ""}`;
          const resource = await saveResource(null, { expectedVersion: 0, reason: `自动资源候选；维护${id}；${evidence}`.slice(0, 1000), data: {
            kind: isVideo ? "video" : "experience", title: page.title || candidate.title, url: candidate.url,
            author: null, platform: new URL(candidate.url).hostname, contentType: "tutorial", topic: "自动发现候选，内容类型、年份及赛道待核对",
            summary: `来源列表标题：${candidate.title}。正文可读，尚未人工确认内容质量与适用范围。`,
            summaryBasis: `自动维护${id}；${evidence}；只检查正文可读性，未观看视频、未生成经验总结。`.slice(0, 2000),
            official: false, verification: "unverified", publishedDate: null, publishedYear: null, durationSeconds: null, coverUrl: null, coverPermission: null,
            availability: "available", availabilityReason: "",
          }, links: [{ competitionId: candidate.competitionId, editionId: null, year: null, scope: ((context?.collectionScope ? `名单范围：${context.collectionScope}；` : "") + "关联、年份与赛道待人工核对；暂未发布").slice(0, 500), reason: `${evidence}提供链接，不代表已确认归属`.slice(0, 1000) }] }, context ? "competition-agent" : "resource-maintenance");
          if (resource) { result.resourceId = resource.id; result.outcome = "draft_created"; result.note = "已保存待审核；需确认竞赛、届次、质量及来源身份"; report.created++; }
          known.add(candidate.url);
        }
      } catch (error) {
        if ((await sql`SELECT id FROM learning_resources WHERE url=${candidate.url}`).length) { report.duplicates++; known.add(candidate.url); result.outcome = "duplicate"; result.note = "已有资源，未覆盖"; }
        else { result.outcome = "error"; result.note = notes(error); }
      }
      report.observations.push(result);
      await checkpoint();
    };
    // Already collected competition pages are not downloaded again. Same-origin links have priority;
    // observed external links are candidates only and never inherit an official-source claim.
    const candidates = [...(run.plan.candidates ?? [])].sort((a, b) => Number(new URL(a.url).origin !== new URL(a.sourceUrl).origin) - Number(new URL(b.url).origin !== new URL(b.sourceUrl).origin));
    for (const candidate of candidates) {
      if (!await canRequest()) break;
      await acceptCandidate(candidate);
    }
    // Configured source pages share the same request and draft limits.
    for (const source of run.plan.sources.slice(0, limits.maxSources)) {
      if (!await canRequest()) break;
      try {
        const response = await request(source.url);
        if (!await allowed()) break;
        const page = inspectResourcePage(response);
        await observe(sourceKey(source.competitionId, source.url), { type: "source", url: source.url, outcome: page.outcome, note: page.note });
        if (page.outcome !== "page_readable" || !page.text) continue;
        for (const candidate of discoverResourceLinks(response.text(), source)) {
          if (report.created >= limits.maxCandidates) break;
          await acceptCandidate({ ...candidate, competitionId: source.competitionId, sourceUrl: source.url });
        }
      } catch (error) { await observe(sourceKey(source.competitionId, source.url), { type: "source", url: source.url, outcome: "error", note: notes(error) }); }
    }
    for (const resourceId of run.plan.resourceIds.slice(0, limits.maxChecks)) {
      if (!await canRequest()) break;
      const resource = await getResource(resourceId);
      if (!resource || resource.status !== "published" || resource.data.availability === "invalid") continue;
      const observation: MaintenanceObservation = { type: "resource", url: resource.data.url, resourceId, outcome: "unknown", note: "", historical: !!resource.data.publishedDate && Date.parse(resource.data.publishedDate) < Date.now() - 365 * 86400000 };
      let hash: string | undefined;
      try {
        const page = inspectResourcePage(await request(resource.data.url));
        if (!await allowed()) break;
        observation.outcome = page.outcome;
        observation.note = page.note;
        hash = page.hash;
        const [previous] = await sql`SELECT observation FROM resource_maintenance_checks WHERE key=${resourceKey(resourceId)}`;
        if (hash && previous?.observation?.hash && previous.observation.hash !== hash) { observation.outcome = "changed"; observation.note = "页面文字相对上次发生变化，需人工复核；未修改已发布内容"; }
      } catch (error) { observation.outcome = "error"; observation.note = notes(error); }
      if (!resource.data.publishedDate) observation.note += "；发布日期未知，抓取时间不代替发布日期";
      await observe(resourceKey(resourceId), observation, hash);
    }
    const status = await allowed() ? "succeeded" : "cancelled";
    await sql`UPDATE resource_maintenance_runs SET status=${status},report=${sql.json(report as never)},updated_at=now() WHERE id=${id} AND status='running'`;
  } catch {
    report.observations.push({ type: "source", url: "", outcome: "error", note: "维护执行异常，已保存进度；请检查服务日志后重新预览" });
    await sql`UPDATE resource_maintenance_runs SET status='failed',report=${sql.json(report as never)},updated_at=now() WHERE id=${id} AND status='running'`;
    throw new Error("Resource maintenance failed; see saved run report");
  }
  return maintenanceRun(id);
}

export const maintenanceQueue = defineQueue<{ runId: string }>({
  name: "resources.maintain", options: { policy: "short", retryLimit: 0, expireInSeconds: 600 },
  worker: { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 5 },
  run: jobs => jobs[0] ? executeMaintenance(z.uuid().parse(jobs[0].runId)) : Promise.resolve(),
});
export async function enqueueMaintenance(actor: string, scheduled = false) {
  const id = await createMaintenanceRun(actor, scheduled);
  if (!id) return { id: null, skipped: "没有到期的来源或资源" };
  try {
    if (!await enqueueOn(maintenanceQueue, { runId: id })) throw new Error("Queue did not accept maintenance run");
  } catch {
    await sql`UPDATE resource_maintenance_runs SET status='failed',updated_at=now() WHERE id=${id} AND status='queued'`;
    throw new Conflict("维护任务未能入队，请检查worker与数据库连接后重试");
  }
  return { id };
}
export async function scheduleMaintenance() {
  if (!collectionEnabled() || !(await maintenanceSettings()).config.enabled) return { skipped: "自动维护关闭" };
  if ((await sql`SELECT id FROM resource_maintenance_runs WHERE status IN ('queued','running')`).length) return { skipped: "已有维护任务" };
  return enqueueMaintenance("resource-maintenance-schedule", true);
}
