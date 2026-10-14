import { config } from "@aihot/backend/config";
import { collectMaterial } from "./materials.ts";
import { extractMaterials } from "./extract.ts";
import { failRun, finishUnchangedRun, saveCatalogue, saveMaterial, saveRevision, startRun, recordRunReport, readPreviousMaterials, stopRunForBudget } from "./repository.ts";
import { catalogueEntrySchema, validateExtraction, type CatalogueEntry, type Material, type Extracted, type ValidationReport } from "./schema.ts";
import { planFollowups } from "./plan.ts";
import { recordIdentity, searchOfficial } from "./discovery.ts";
import { sql } from "@aihot/backend/db";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { CompetitionBudgetExhaustedError } from "./allowance.ts";
import { repairMaterials } from "./repair.ts";

export interface WorkflowTools {
  collect: (url: string) => Promise<Material>;
  extract: (entry: CatalogueEntry, materials: Material[], categories: string[], feedback?: ValidationReport) => Promise<{ data: Extracted; receiptId: number | null }>;
}

// The live worker supplies confirmed official URLs; source discovery is a separate recorded step.
export async function ingestCompetition(input: CatalogueEntry, urls: string[], categories: string[], tools?: WorkflowTools, autonomous = false) {
  const entry = catalogueEntrySchema.parse(input);
  if (!tools && (process.env.COLLECT_ENABLED !== "true" || !config.modelCallsEnabled)) throw new Error("Competition collection and model calls must be explicitly enabled");
  if ((!urls.length && !autonomous) || urls.length > 12) throw new Error("Expected 1–12 confirmed material URLs, or autonomous discovery");
  await saveCatalogue(entry);
  const runId = await startRun(entry.id);
  const selected = tools ?? { collect: collectMaterial, extract: extractMaterials };
  try {
    const materials: Material[] = [];
    const failures: Array<{ url: string; error: string }> = [];
    const attempted = new Set<string>();
    const collect = async (url: string) => {
      if (attempted.has(url)) return;
      attempted.add(url);
      try {
        const material = await selected.collect(url);
        await saveMaterial(entry.id, material);
        if (!materials.some(m => m.id === material.id)) materials.push(material);
      } catch (error) {
        failures.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
    };
    for (const url of [...new Set(urls)]) await collect(url);
    if (!materials.length && autonomous && !tools) {
      const hits = await searchOfficial(entry.name);
      const normalized = entry.name.replace(/[“”"\s（）()]/g, "");
      const alias = /“([^”]+)”/.exec(entry.name)?.[1];
      const relevant = hits.filter(hit => {
        const text = (hit.title + hit.description).replace(/[“”"\s（）()]/g, "");
        return text.includes(normalized) || (!!alias && text.includes(alias));
      });
      await recordRunReport(runId, { searchRecovery: { hits, relevant: relevant.map(hit => hit.url) } });
      for (const hit of relevant.slice(0, 3)) {
        await collect(hit.url);
        if (materials.length) break;
      }
    }
    await recordRunReport(runId, { attemptedUrls: [...attempted], failures });
    if (!materials.length) throw new Error(failures[0]?.error ?? "No readable official material");
    const previousMaterials = await readPreviousMaterials(entry.id);
    const unchanged = failures.length === 0 && previousMaterials.length > 0
      && materials.every(material => previousMaterials.some(previous => previous.url === material.url && previous.id === material.id));
    if (autonomous && unchanged) {
      await finishUnchangedRun(runId, { attemptedUrls: [...attempted], failures, autonomous, materialIds: materials.map(m => m.id) });
      return { competitionId: entry.id, runId, revisionId: null };
    }
    // Preserve previously grounded details when a new notice only states a schedule change.
    // A new version at the same URL replaces that old material; different notices remain distinct.
    for (const previous of previousMaterials) {
      if (!materials.some(m => m.url === previous.url) && materials.length < 12) materials.push(previous);
    }
    if (autonomous && !tools) {
      const hits = await searchOfficial(entry.name);
      let identity: "confirmed" | "candidate" = "candidate";
      let identityUrl: string | null = null;
      // A run can start with an organizer announcement and the actual competition portal. Check every
      // collected seed before asking the planner for more pages; the first page is not inherently primary.
      for (const material of materials) {
        identity = await recordIdentity(entry, material, hits);
        if (identity === "confirmed") { identityUrl = material.url; break; }
      }
      await recordRunReport(runId, { discovery: { hits, identity, identityUrl } });
      if (identity !== "confirmed") {
        // A navigation page may not identify its authority; inspect a linked rule or notice first.
        const plan = await planFollowups(entry, materials);
        for (const choice of plan.choices.slice(0, 2)) {
          const before = materials.length;
          await collect(choice.url);
          if (materials.length > before) {
            identity = await recordIdentity(entry, materials.at(-1)!, hits);
            if (identity === "confirmed") { identityUrl = materials.at(-1)!.url; break; }
          }
        }
        await completeReceipt(sql, plan.receiptId);
        await recordRunReport(runId, { discovery: { hits, identity, identityUrl }, attemptedUrls: [...attempted], failures });
      }
      if (identity !== "confirmed") throw new Error("Official source identity requires review");
      const plan = await planFollowups(entry, materials);
      for (const choice of plan.choices) if (attempted.size < 8) await collect(choice.url);
      await completeReceipt(sql, plan.receiptId);
    }
    let extracted = await selected.extract(entry, materials, categories);
    let revisionId = await saveRevision(entry, runId, extracted.data, materials, categories, extracted.receiptId);
    const report = validateExtraction(extracted.data, materials, categories);
    if (autonomous && !tools && (report.missing.length || !report.valid) && attempted.size < 8) {
      const plan = await planFollowups(entry, materials, report);
      const before = materials.length;
      for (const choice of plan.choices) if (attempted.size < 8) await collect(choice.url);
      await completeReceipt(sql, plan.receiptId);
      if (materials.length > before) {
        extracted = await selected.extract(entry, materials, categories);
        revisionId = await saveRevision(entry, runId, extracted.data, materials, categories, extracted.receiptId);
      }
    }
    const finalReport = validateExtraction(extracted.data, materials, categories);
    if (!finalReport.valid) {
      extracted = tools ? await selected.extract(entry, materials, categories, finalReport)
        : await repairMaterials(entry, materials, extracted.data, finalReport, categories);
      revisionId = await saveRevision(entry, runId, extracted.data, materials, categories, extracted.receiptId);
      await recordRunReport(runId, { validationRepair: { attempted: true, previousErrors: finalReport.errors } });
    }
    await recordRunReport(runId, { attemptedUrls: [...attempted], failures, autonomous });
    return { competitionId: entry.id, runId, revisionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CompetitionBudgetExhaustedError) await stopRunForBudget(runId, message);
    else await failRun(runId, message);
    throw error;
  }
}
