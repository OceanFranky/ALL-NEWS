// Explicit, auditable first-round batch. Uses the same worker use cases and durable 5 CNY allowance.
import { writeFileSync, mkdirSync } from "node:fs";
import { sourceConfigs } from "../modules/admission/backend/sources.ts";
import { syncSources, refreshSchool, processDocument, automationEnabled } from "../modules/admission/backend/automation.ts";
import { admissionCost } from "../modules/admission/backend/model.ts";
import { readMonitor } from "../modules/admission/backend/updates.ts";
import { closeDb, sql } from "@aihot/backend/db";
if (!automationEnabled()) throw new Error("Set ADMISSION_AUTOMATION_ENABLED=true and COLLECT_ENABLED=true for this explicit run");
try {
  await syncSources();
  const ids = process.argv.slice(2).filter(id => /^s\d{3}$/.test(id));
  const sources = sourceConfigs.filter(s => !ids.length || ids.includes(s.schoolId));
  const results: object[] = [];
  // Every school gets a first pass before a second sweep; low concurrency respects school sites.
  const pending = [...sources];
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (pending.length) {
      const source = pending.shift()!;
      const reviewed = process.argv.includes("--recheck") ? await sql<{ id: string }[]>`SELECT id FROM admission_documents WHERE school_id=${source.schoolId} AND status='needs-review' ORDER BY priority` : null;
      const checked = [];
      if (reviewed) for (const doc of reviewed) checked.push({ id: doc.id, ...await processDocument(doc.id, true) });
      const result = { schoolId: source.schoolId, ...(reviewed ? { results: checked } : await refreshSchool(source.schoolId)) };
      results.push(result); console.log(JSON.stringify(result));
    }
  }));
  const report = { at: new Date().toISOString(), cost: await admissionCost(), monitor: await readMonitor(), results };
  mkdirSync(".data/admission-research", { recursive: true });
  writeFileSync(".data/admission-research/live-run.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cost: report.cost, schools: report.monitor.schools.length, publishedSchools: report.monitor.schools.filter(s => s.notices).length }));
} finally { await closeDb(); }
