import { config } from "@aihot/backend/config";
import { collectMaterial } from "./materials.ts";
import { extractMaterials } from "./extract.ts";
import { failRun, saveCatalogue, saveMaterial, saveRevision, startRun } from "./repository.ts";
import { catalogueEntrySchema, type CatalogueEntry, type Material, type Extracted } from "./schema.ts";

export interface WorkflowTools {
  collect: (url: string) => Promise<Material>;
  extract: (entry: CatalogueEntry, materials: Material[], categories: string[]) => Promise<{ data: Extracted; receiptId: number | null }>;
}

// The live worker supplies confirmed official URLs; source discovery is a separate recorded step.
export async function ingestCompetition(input: CatalogueEntry, urls: string[], categories: string[], tools?: WorkflowTools) {
  const entry = catalogueEntrySchema.parse(input);
  if (!tools && (process.env.COLLECT_ENABLED !== "true" || !config.modelCallsEnabled)) throw new Error("Competition collection and model calls must be explicitly enabled");
  if (!urls.length || urls.length > 12) throw new Error("Expected 1–12 confirmed material URLs");
  await saveCatalogue(entry);
  const runId = await startRun(entry.id);
  const selected = tools ?? { collect: collectMaterial, extract: extractMaterials };
  try {
    const materials: Material[] = [];
    for (const url of [...new Set(urls)]) {
      const material = await selected.collect(url);
      await saveMaterial(entry.id, material);
      materials.push(material);
    }
    const extracted = await selected.extract(entry, materials, categories);
    const revisionId = await saveRevision(entry, runId, extracted.data, materials, categories, extracted.receiptId);
    return { competitionId: entry.id, runId, revisionId };
  } catch (error) {
    await failRun(runId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
