import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeDb } from "@aihot/backend/db";
import { ingestCompetition } from "../backend/workflow.ts";
import { catalogueEntrySchema } from "../backend/schema.ts";
import { readRun } from "../backend/repository.ts";

const { values } = parseArgs({ options: { id: { type: "string" }, url: { type: "string", multiple: true } } });
try {
  const catalogue = JSON.parse(readFileSync(new URL("../catalogue.json", import.meta.url), "utf8"));
  const row = catalogue.entries.find((e: { id: string }) => e.id === values.id);
  if (!row) throw new Error("Choose an ID from the approved competition catalogue");
  const entry = catalogueEntrySchema.parse({ id: row.id, name: row.name, schoolLevel: row.schoolLevel, schoolLevelByScope: row.schoolLevelByScope, schoolRecognitionText: row.schoolRecognitionText });
  const result = await ingestCompetition(entry, values.url ?? [], []);
  console.log(JSON.stringify({ ...result, run: await readRun(entry.id, result.runId) }));
} finally {
  await closeDb();
}
