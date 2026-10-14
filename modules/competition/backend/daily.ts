import { readFileSync } from "node:fs";
import { config } from "@aihot/backend/config";
import { sql } from "@aihot/backend/db";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { catalogueEntrySchema, type CatalogueEntry } from "./schema.ts";
import { competitionCategories } from "./taxonomy.ts";
import { ingestCompetition } from "./workflow.ts";

const catalogueFile = JSON.parse(readFileSync(new URL("../catalogue.json", import.meta.url), "utf8")) as { entries: unknown[] };
const seedsFile = JSON.parse(readFileSync(new URL("../sources.json", import.meta.url), "utf8")) as { entries: Array<{ competitionId: string; urls: string[] }> };
const catalogue = new Map(catalogueFile.entries.map(raw => {
  const row = raw as Record<string, unknown>;
  const entry = catalogueEntrySchema.parse({
    id: row.id,
    name: row.name,
    schoolLevel: row.schoolLevel,
    schoolLevelByScope: row.schoolLevelByScope,
    schoolRecognitionText: row.schoolRecognitionText,
    collectionScope: row.collectionScope,
  });
  return [entry.id, entry];
}));
const seeds = new Map(seedsFile.entries.map(entry => [entry.competitionId, entry.urls]));

export function competitionAutomationEnabled(): boolean {
  return process.env.COLLECT_ENABLED === "true" && config.modelCallsEnabled;
}

export function selectRefreshUrls(confirmed: string[], configured: string[]): string[] {
  // Keep the current discovery entries even after an older official notice was confirmed. A historical
  // source must not replace the four approved C4 branches or hide a new season's candidate portal.
  return [...new Set([...configured, ...confirmed])].slice(0, 4);
}

async function sourceUrls(competitionId: string): Promise<string[]> {
  const confirmed = await sql<{ url: string }[]>`SELECT url FROM competition_sources
    WHERE competition_id = ${competitionId} AND status = 'confirmed' ORDER BY checked_at DESC LIMIT 4`;
  const configured = seeds.get(competitionId) ?? [];
  return selectRefreshUrls(confirmed.map(row => row.url), configured);
}

async function refreshCompetition(entry: CatalogueEntry) {
  return ingestCompetition(entry, await sourceUrls(entry.id), [...competitionCategories], undefined, true);
}

export const competitionIngestQueue = defineQueue<{ competitionId: string }>({
  name: "competition.ingest",
  options: { policy: "short", retryLimit: 1, retryDelay: 300, expireInSeconds: 1800 },
  worker: { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 5 },
  run: async jobs => {
    if (!competitionAutomationEnabled()) return { skipped: "competition collection or model calls disabled" };
    const job = jobs[0];
    const entry = job ? catalogue.get(job.competitionId) : null;
    if (!entry) throw new Error("Unknown approved competition catalogue ID");
    return refreshCompetition(entry);
  },
});

export async function scheduleCompetitionRefresh(): Promise<{ enqueued: number; total: number }> {
  if (!competitionAutomationEnabled()) return { enqueued: 0, total: catalogue.size };
  let enqueued = 0;
  for (const entry of catalogue.values()) {
    if (await enqueueOn(competitionIngestQueue, { competitionId: entry.id }, { singletonKey: entry.id })) enqueued += 1;
  }
  return { enqueued, total: catalogue.size };
}
