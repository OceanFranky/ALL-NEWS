// Discover official faculty indexes without invoking a model.
import { syncSources, collectSchool, automationEnabled } from "../modules/admission/backend/automation.ts";
import { sourceConfigs } from "../modules/admission/backend/sources.ts";
import { sql, closeDb } from "@aihot/backend/db";

if (!automationEnabled()) throw new Error("Admissions collection disabled");
const ids = process.argv.slice(2);
if (ids.some(id => !sourceConfigs.some(source => source.schoolId === id))) throw new Error("Unknown configured school");
try {
  await syncSources();
  const pending = sourceConfigs.filter(source => !ids.length || ids.includes(source.schoolId));
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (pending.length) {
      const source = pending.shift()!;
      console.log(JSON.stringify(await collectSchool(source)));
    }
  }));
  console.log(JSON.stringify(await sql`SELECT school_id,kind,count(*)::int FROM admission_directory GROUP BY school_id,kind ORDER BY school_id,kind`));
} finally { await closeDb(); }
