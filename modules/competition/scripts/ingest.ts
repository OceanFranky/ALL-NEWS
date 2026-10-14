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
  const entry = catalogueEntrySchema.parse({ id: row.id, name: row.name, schoolLevel: row.schoolLevel, schoolLevelByScope: row.schoolLevelByScope, schoolRecognitionText: row.schoolRecognitionText, collectionScope: row.collectionScope });
  const seeds = JSON.parse(readFileSync(new URL("../sources.json", import.meta.url), "utf8"));
  const urls = values.url ?? seeds.entries.find((s: { competitionId: string }) => s.competitionId === entry.id)?.urls ?? [];
  const result = await ingestCompetition(entry, urls, [...competitionCategories], undefined, values.auto);
  console.log(JSON.stringify({ ...result, run: await readRun(entry.id, result.runId) }));
} finally {
  await closeDb();
}
