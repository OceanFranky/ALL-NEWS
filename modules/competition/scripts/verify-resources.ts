// Checks the running HTTP API and real display identities; never creates fixture data.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { CompetitionDetail, CompetitionList } from "@aihot/contracts/competitions";
import type { CompetitionResources } from "@aihot/contracts/learning-resources";
import { resourceManifestSchema } from "../../learning-resources/backend/import.ts";
import { closeDb } from "@aihot/backend/db";

try {
  const { values } = parseArgs({ options: { base: { type: "string", default: "http://localhost:3000" }, output: { type: "string" } } });
  const base = new URL(values.base!);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Expected HTTP(S) base without credentials");
  const catalogue = JSON.parse(await readFile(new URL("../catalogue.json", import.meta.url), "utf8")).entries as { id: string; name: string }[];
  if (catalogue.length !== 31 || new Set(catalogue.map(item => item.id)).size !== 31) throw new Error("Expected 31 unique approved competitions");
  const manifest = resourceManifestSchema.parse(JSON.parse(await readFile(new URL("../../learning-resources/seeds/competition-resources.json", import.meta.url), "utf8")));
  async function get<T>(pathname: string): Promise<T> {
    const response = await fetch(new URL(pathname, base), { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${pathname}`);
    return response.json() as Promise<T>;
  }
  const records = [] as CompetitionList["items"];
  let page = 1;
  for (;;) {
    const list = await get<CompetitionList>(`/api/v1/competitions?pageSize=100&page=${page}`);
    records.push(...list.items);
    if (records.length >= list.total) break;
    if (!list.items.length || page >= 100) throw new Error("Competition pagination did not finish");
    page++;
  }
  const checks = [];
  for (const entry of catalogue) {
    const editions = records.filter(item => item.competitionId === entry.id);
    const problems: string[] = [];
    const details = [];
    if (!editions.length) problems.push("没有真实公开展示届次，不能完成详情联调");
    for (const edition of editions) {
      try {
        const pathname = `/api/v1/competitions/${entry.id}/editions/${edition.editionId}`;
        const detail = (await get<CompetitionDetail>(pathname)).item;
        if (detail.competitionId !== entry.id || detail.editionId !== edition.editionId || detail.revisionId !== edition.revisionId) problems.push("详情身份或版本与列表不一致");
        if (detail.name.status !== "known" || !detail.sources.length) problems.push("真实名称或材料来源缺失");
        const resources = await get<CompetitionResources>(pathname + "/resources");
        const urls = new Set<string>();
        for (const kind of ["experience", "video"] as const) {
          for (const item of resources[kind]) {
            if (item.data.kind !== kind || item.data.verification !== "verified" || item.data.availability === "invalid") problems.push("未通过审核的资源进入公开读取");
            if (urls.has(item.data.url)) problems.push("同届次存在重复资源URL");
            urls.add(item.data.url);
            if (!item.links.length || item.links.some(link => link.competitionId !== entry.id || link.editionId && link.editionId !== edition.editionId || link.year !== null && link.year !== detail.year.value?.primary)) problems.push("资源范围与当前竞赛／届次／年份不符");
            if ("coverPermission" in item.data || "availabilityReason" in item.data || item.links.some(link => "reason" in link)) problems.push("内部审核字段泄漏到公开接口");
          }
        }
        for (const item of manifest.resources.filter(item => item.decision === "publish" && item.links.some(link => link.competitionId === entry.id && (!link.editionId || link.editionId === edition.editionId) && (!link.year || link.year === detail.year.value?.primary)))) {
          if (!urls.has(item.data.url)) problems.push(`精选资源未展示（如已人工撤回应复核清单）：${item.key}`);
        }
        details.push({ editionId: edition.editionId, revisionId: detail.revisionId, sourceCount: detail.sources.length, experience: resources.experience.length, video: resources.video.length });
      } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
    }
    checks.push({ competitionId: entry.id, name: entry.name, passed: problems.length === 0, details, problems });
  }
  const report = { checkedAt: new Date().toISOString(), base: base.origin, requiredCompetitions: 31, checkedCompetitions: checks.length, passed: checks.filter(item => item.passed).length, complete: checks.every(item => item.passed), entries: checks };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (values.output) { await mkdir(path.dirname(values.output), { recursive: true }); await writeFile(values.output, text); }
  console.log(text);
  if (!report.complete) process.exitCode = 1;
} finally { await closeDb(); }
