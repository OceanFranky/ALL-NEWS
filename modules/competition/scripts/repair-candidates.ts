import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { catalogueEntrySchema, validateExtraction, type Material } from "../backend/schema.ts";
import { competitionCategories } from "../backend/taxonomy.ts";
import { extractMaterials } from "../backend/extract.ts";
import { startRun, saveRevision, recordRunReport, failRun, stopRunForBudget } from "../backend/repository.ts";
import { CompetitionBudgetExhaustedError } from "../backend/allowance.ts";
import { competitionProviderUnavailable } from "../backend/model.ts";

try {
  if (!config.modelCallsEnabled) throw new Error("Competition model calls must be explicitly enabled");
  const rows = await sql`SELECT c.id,c.name,c.recognition,r.id AS revision_id,r.validation,r.material_ids
    FROM competition_catalogue c JOIN LATERAL (
      SELECT id,validation,material_ids FROM competition_revisions WHERE competition_id=c.id ORDER BY created_at DESC LIMIT 1
    ) r ON true WHERE (r.validation->>'valid')::boolean=false ORDER BY c.id`;
  for (const row of rows) {
    const entry = catalogueEntrySchema.parse({ id: row.id, name: row.name, ...row.recognition });
    const materials = (await sql<{ content: Material }[]>`SELECT content FROM competition_materials
      WHERE competition_id=${entry.id} AND id IN ${sql(row.material_ids as string[])}`).map(m => m.content);
    if (!materials.length) throw new Error(`No stored official evidence for ${entry.id}`);
    const runId = await startRun(entry.id);
    try {
      await recordRunReport(runId, { repairOf: row.revision_id, previousErrors: row.validation.errors, storedEvidenceOnly: true });
      const result = await extractMaterials(entry, materials, [...competitionCategories], row.validation);
      const revisionId = await saveRevision(entry, runId, result.data, materials, [...competitionCategories], result.receiptId);
      console.log(JSON.stringify({ competitionId: entry.id, runId, revisionId, validation: validateExtraction(result.data, materials, [...competitionCategories]) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof CompetitionBudgetExhaustedError) { await stopRunForBudget(runId, message); throw error; }
      await failRun(runId, message);
      console.log(JSON.stringify({ competitionId: entry.id, runId, error: message }));
      if (competitionProviderUnavailable(error)) throw error;
    }
  }
} finally { await closeDb(); }
