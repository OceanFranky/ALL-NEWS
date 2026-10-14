import { randomUUID } from "node:crypto";
import type { JSONValue } from "postgres";
import { sql } from "@aihot/backend/db";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { extractedSchema, validateExtraction, type CatalogueEntry, type Material, type Extracted } from "./schema.ts";

const json = (value: unknown): JSONValue => JSON.parse(JSON.stringify(value)) as JSONValue;

export async function saveCatalogue(entry: CatalogueEntry): Promise<void> {
  await sql`INSERT INTO competition_catalogue (id, name, recognition)
    VALUES (${entry.id}, ${entry.name}, ${sql.json({ schoolLevel: entry.schoolLevel, schoolLevelByScope: entry.schoolLevelByScope, schoolRecognitionText: entry.schoolRecognitionText ?? null })})
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, recognition = excluded.recognition`;
}

export async function startRun(competitionId: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO competition_runs (id, competition_id, status) VALUES (${id}, ${competitionId}, 'running')`;
  return id;
}

export async function saveMaterial(competitionId: string, material: Material): Promise<void> {
  await sql`INSERT INTO competition_materials (competition_id, id, url, content_hash, fetched_at, content)
    VALUES (${competitionId}, ${material.id}, ${material.url}, ${material.hash}, ${material.fetchedAt}, ${sql.json(json(material))})
    ON CONFLICT (competition_id, id) DO NOTHING`;
}

export async function saveRevision(entry: CatalogueEntry, runId: string, input: Extracted, materials: Material[], categories: string[], receiptId: number | null): Promise<string> {
  const data = extractedSchema.parse(input);
  const validation = validateExtraction(data, materials, categories);
  const id = randomUUID();
  await sql.begin(async tx => {
    const [run] = await tx`SELECT id FROM competition_runs WHERE id = ${runId} AND competition_id = ${entry.id} FOR UPDATE`;
    if (!run) throw new Error("Competition run ownership mismatch");
    for (const material of materials) {
      const [saved] = await tx`SELECT id FROM competition_materials WHERE competition_id = ${entry.id} AND id = ${material.id}`;
      if (!saved) throw new Error("Competition material ownership mismatch");
    }
    await tx`INSERT INTO competition_revisions (competition_id, id, run_id, year, name, status, data, validation, material_ids, receipt_id)
      VALUES (${entry.id}, ${id}, ${runId}, ${data.year.value?.primary ?? null}, ${data.name.value},
      ${validation.readyForReview ? "needs_review" : "draft"},
      ${tx.json(json({ ...data, schoolLevel: entry.schoolLevel, schoolLevelByScope: entry.schoolLevelByScope, schoolRecognitionText: entry.schoolRecognitionText ?? null }))},
      ${tx.json(json(validation))}, ${tx.json(materials.map(m => m.id))}, ${receiptId})`;
    if (receiptId !== null) await completeReceipt(tx, receiptId);
    await tx`UPDATE competition_runs SET status = 'needs_review', finished_at = now(), report = report || ${tx.json(json({ revisionId: id, validation }))} WHERE id = ${runId}`;
  });
  return id;
}

export async function failRun(runId: string, error: string): Promise<void> {
  await sql`UPDATE competition_runs SET status = 'failed', finished_at = now(), report = report || ${sql.json({ error })} WHERE id = ${runId}`;
}

export async function readRun(competitionId: string, runId: string) {
  const [run] = await sql`SELECT id, competition_id, status, started_at, finished_at, report
    FROM competition_runs WHERE competition_id = ${competitionId} AND id = ${runId}`;
  return run ?? null;
}

export async function recordRunReport(runId: string, report: Record<string, unknown>): Promise<void> {
  await sql`UPDATE competition_runs SET report = report || ${sql.json(json(report))} WHERE id = ${runId}`;
}
