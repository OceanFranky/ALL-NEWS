import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeDb } from "@aihot/backend/db";
import { ingestCompetition } from "../backend/workflow.ts";
import { catalogueEntrySchema } from "../backend/schema.ts";
import { readRun } from "../backend/repository.ts";
import { competitionCategories } from "../backend/taxonomy.ts";

const { values } = parseArgs({ options: { id: { type: "string" }, url: { type: "string", multiple: true }, auto: { type: "boolean", default: false } } });
try {
  const catalogue = JSON.parse(readFileSync(new URL("../catalogue.json", import.meta.url), "utf8"));
  const row = catalogue.entries.find((e: { id: string }) => e.id === values.id);
  if (!row) throw new Error("Choose an ID from the approved competition catalogue");
  const entry = catalogueEntrySchema.parse({ id: row.id, name: row.name, schoolLevel: row.schoolLevel, schoolLevelByScope: row.schoolLevelByScope, schoolRecognitionText: row.schoolRecognitionText });
  const survey = JSON.parse(readFileSync(new URL("../verification/2026-10-13-source-survey.json", import.meta.url), "utf8"));
  const previousDiscovery = survey.sources.find((s: { catalogueId: string }) => s.catalogueId === entry.id);
  const urls = values.url ?? (previousDiscovery?.candidateEntry ? [previousDiscovery.candidateEntry] : []);
  const result = await ingestCompetition(entry, urls, [...competitionCategories], undefined, values.auto);
  console.log(JSON.stringify({ ...result, run: await readRun(entry.id, result.runId) }));
} finally {
  await closeDb();
}
