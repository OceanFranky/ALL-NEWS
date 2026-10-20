import { sql } from "@aihot/backend/db";
import { Conflict } from "@aihot/backend/audit";
import type { CompetitionMaintenanceContext, CompetitionResourceMaterial, CompetitionResourceResult, ResourceCandidate } from "@aihot/contracts/learning-resources";
import { canonicalResourceUrl, createMaintenanceRun, executeMaintenance, previewMaintenance, type FetchPage } from "./maintenance.ts";


/** Uses observed links from this competition's stored evidence, without another model call. */
export async function maintainCompetitionResources(context: CompetitionMaintenanceContext, materials: CompetitionResourceMaterial[], fetch?: FetchPage): Promise<CompetitionResourceResult> {
  const [run] = await sql`SELECT id FROM competition_runs WHERE id=${context.runId} AND competition_id=${context.competitionId}`;
  if (!run) throw new Error("Competition resource run ownership mismatch");
  const plan = await previewMaintenance(context.competitionId);
  const skip = (reason: string): CompetitionResourceResult => ({ status: "skipped", maintenanceRunId: null, reason });
  if (!plan.settings.config.competitionAgentEnabled) return skip("竞赛Agent资源接入已关闭");
  if (process.env.COLLECT_ENABLED !== "true") return skip("采集总开关COLLECT_ENABLED未开启");
  const source = plan.settings.config.sources.find(s => s.competitionId === context.competitionId);
  if (!source) return skip("不在31项资源来源配置中");
  const ids = [...new Set(materials.map(m => m.id))].slice(0, 12);
  // Re-read persisted links: unsaved in-memory links cannot become discovery evidence.
  const saved = ids.length ? await sql`SELECT content FROM competition_materials WHERE competition_id=${context.competitionId} AND id IN ${sql(ids)}` : [];
  const candidates = new Map<string, ResourceCandidate>();
  for (const row of saved) {
    const material = row.content as CompetitionResourceMaterial;
    for (const link of material.links) {
      if (link.title.trim().length < 4 || !source.keywords.some(k => link.title.toLowerCase().includes(k.toLowerCase()))) continue;
      try {
        const url = canonicalResourceUrl(link.url);
        if (url === canonicalResourceUrl(material.url) || /\.(pdf|docx?|zip|png|jpe?g|webp|mp4)(?:[?#]|$)/i.test(url)) continue;
        if (candidates.size < 100) candidates.set(url, { competitionId: context.competitionId, url, title: link.title.slice(0, 300), sourceUrl: material.url, materialId: material.id });
      } catch { /* Only guarded HTTP/HTTPS candidates are accepted. */ }
    }
  }
  plan.competition = context;
  plan.candidates = [...candidates.values()];
  if (!plan.settings.config.maxCandidates) { plan.candidates = []; plan.sources = []; }
  let id: string | null;
  try { id = await createMaintenanceRun("competition-agent", false, plan); }
  catch (error) {
    if (error instanceof Conflict) return skip(error.message);
    throw error;
  }
  if (!id) return skip("当前材料无资源链接，且没有已启用到期来源或关联资源需要复查");
  try {
    // Run inside the existing competition job; no second worker or model is needed.
    const result = await executeMaintenance(id, fetch);
    return { status: result?.status ?? "failed", maintenanceRunId: id, requests: result?.report.requests ?? 0, created: result?.report.created ?? 0, duplicates: result?.report.duplicates ?? 0 };
  } catch {
    return { status: "failed", maintenanceRunId: id, reason: "资源执行失败，已保存维护进度；详情结果保留" };
  }
}
