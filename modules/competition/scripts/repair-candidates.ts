import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { catalogueEntrySchema, extractedSchema, validateExtraction, type Material } from "../backend/schema.ts";
import { competitionCategories } from "../backend/taxonomy.ts";
import { repairMaterials, missingFieldReview, repairMaterialIds } from "../backend/repair.ts";
import { parseArgs } from "node:util";
import { startRun, saveRevision, recordRunReport, failRun, stopRunForBudget } from "../backend/repository.ts";
import { CompetitionBudgetExhaustedError } from "../backend/allowance.ts";
import { competitionProviderUnavailable } from "../backend/model.ts";

try {
  const { values } = parseArgs({ options: { ids: { type: "string" }, missing: { type: "boolean", default: false } } });
  const ids = values.ids?.split(",");
  if (values.missing && !ids?.length) throw new Error("Missing-field review requires explicit competition IDs");
  if (ids?.some(id => !/^competition-\d{3}$/.test(id))) throw new Error("Invalid competition ID");
  if (!config.modelCallsEnabled) throw new Error("Competition model calls must be explicitly enabled");
  const rows = await sql`SELECT c.id,c.name,c.recognition,r.id AS revision_id,r.data,r.validation,r.material_ids
    FROM competition_catalogue c JOIN LATERAL (
      SELECT id,data,validation,material_ids FROM competition_revisions WHERE competition_id=c.id ORDER BY created_at DESC LIMIT 1
    ) r ON true WHERE (r.validation->>'valid')::boolean=false OR ${values.missing} ORDER BY c.id`;
  for (const row of rows) {
    if (ids && !ids.includes(row.id)) continue;
    const review = values.missing ? missingFieldReview(row.validation) : row.validation;
    if (!review.errors.length) continue;
    const entry = catalogueEntrySchema.parse({ id: row.id, name: row.name, ...row.recognition });
    const previous = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(field => [field, row.data[field]])));
    const materials = (await sql<{ content: Material }[]>`SELECT content FROM competition_materials
      WHERE competition_id=${entry.id} AND id IN ${sql(repairMaterialIds(previous, row.material_ids as string[]))}`).map(m => m.content);
    if (!materials.length) throw new Error(`No stored official evidence for ${entry.id}`);
    const runId = await startRun(entry.id);
    try {
      await recordRunReport(runId, { repairOf: row.revision_id, previousErrors: row.validation.errors, missingFieldRecheck: values.missing, previousMissing: row.validation.missing, storedEvidenceOnly: true });
      const result = await repairMaterials(entry, materials, previous, review, [...competitionCategories]);
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
