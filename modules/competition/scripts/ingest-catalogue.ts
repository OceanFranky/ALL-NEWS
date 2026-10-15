import { readFileSync } from "node:fs";
import { closeDb } from "@aihot/backend/db";
import { ingestCompetition } from "../backend/workflow.ts";
import { catalogueEntrySchema } from "../backend/schema.ts";
import { competitionCategories } from "../backend/taxonomy.ts";
import { parseArgs } from "node:util";
import { competitionProviderUnavailable } from "../backend/model.ts";

const { values } = parseArgs({ options: { ids: { type: "string" } } });
const selectedIds = values.ids ? new Set(values.ids.split(",")) : null;

try {
  const catalogue = JSON.parse(readFileSync(new URL("../catalogue.json", import.meta.url), "utf8"));
  const seeds = JSON.parse(readFileSync(new URL("../sources.json", import.meta.url), "utf8"));
  for (const row of catalogue.entries) {
    if (selectedIds && !selectedIds.has(row.id)) continue;
    const entry = catalogueEntrySchema.parse({ id: row.id, name: row.name, schoolLevel: row.schoolLevel, schoolLevelByScope: row.schoolLevelByScope, schoolRecognitionText: row.schoolRecognitionText, collectionScope: row.collectionScope });
    const source = seeds.entries.find((s: { competitionId: string }) => s.competitionId === row.id);
    console.log(JSON.stringify({ event: "starting", id: entry.id }));
    try {
      const result = await ingestCompetition(entry, source?.urls ?? [], [...competitionCategories], undefined, true);
      console.log(JSON.stringify({ event: "persisted", ...result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({ event: "failed", id: entry.id, reason: message.slice(0, 240) }));
      if (competitionProviderUnavailable(error) || /budget exhausted|Invalid competition model reservation/.test(message)) break;
    }
  }
} finally { await closeDb(); }
