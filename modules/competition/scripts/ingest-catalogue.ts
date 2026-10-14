import { readFileSync } from "node:fs";
import { closeDb } from "@aihot/backend/db";
import { ingestCompetition } from "../backend/workflow.ts";
import { catalogueEntrySchema } from "../backend/schema.ts";
import { saveCatalogue, startRun, failRun } from "../backend/repository.ts";

try {
  const catalogue = JSON.parse(readFileSync(new URL("../catalogue.json", import.meta.url), "utf8"));
  const survey = JSON.parse(readFileSync(new URL("../verification/2026-10-13-source-survey.json", import.meta.url), "utf8"));
  for (const row of catalogue.entries) {
    const entry = catalogueEntrySchema.parse({ id: row.id, name: row.name, schoolLevel: row.schoolLevel, schoolLevelByScope: row.schoolLevelByScope, schoolRecognitionText: row.schoolRecognitionText });
    const source = survey.sources.find((s: { catalogueId: string }) => s.catalogueId === row.id);
    console.log(JSON.stringify({ event: "starting", id: entry.id }));
    if (!source?.candidateEntry) {
      await saveCatalogue(entry);
      const run = await startRun(entry.id);
      await failRun(run, "No candidate official URL confirmed by discovery research; requires source review");
      console.log(JSON.stringify({ event: "source-unresolved", id: entry.id, runId: run }));
      continue;
    }
    try {
      const result = await ingestCompetition(entry, [source.candidateEntry], [], undefined, true);
      console.log(JSON.stringify({ event: "persisted", ...result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({ event: "failed", id: entry.id, reason: message.slice(0, 240) }));
      if (/budget exhausted|Invalid competition model reservation/.test(message)) break;
    }
  }
} finally { await closeDb(); }
