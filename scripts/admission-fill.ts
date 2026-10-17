// Explicit first-round sweep: at most one candidate per missing track, under the durable allowance.
import { sourceConfigs } from '../modules/admission/backend/sources.ts';
import { syncSources, collectSchool, processDocument, automationEnabled } from '../modules/admission/backend/automation.ts';
import { readMonitor } from '../modules/admission/backend/updates.ts';
import { admissionCost } from '../modules/admission/backend/model.ts';
import { sql, closeDb } from '@aihot/backend/db';

if (!automationEnabled()) throw new Error('Admissions automation disabled');
try {
  await syncSources();
  const ids = process.argv.slice(2);
  const pending = sourceConfigs.filter(source => !ids.length || ids.includes(source.schoolId));
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (pending.length) {
      const source = pending.shift()!;
      await collectSchool(source);
      const present = await sql<{ track: string }[]>`SELECT DISTINCT published->>'track' AS track FROM admission_notices WHERE published->>'schoolId'=${source.schoolId}`;
      for (const track of ['baoyan', 'kaoyan']) {
        if (present.some(notice => notice.track === track)) continue;
        const pattern = '推免|推荐免试|免试攻读';
        const [doc] = await sql<{ id: string; title: string }[]>`SELECT id,title FROM admission_documents WHERE school_id=${source.schoolId} AND status IN ('new','needs-review','awaiting-model') AND (title ~ ${pattern})=${track === 'baoyan'} ORDER BY priority,id LIMIT 1`;
        console.log(JSON.stringify({ schoolId: source.schoolId, track, ...(doc ? { title: doc.title, ...await processDocument(doc.id, true) } : { status: 'no-candidate' }) }));
      }
    }
  }));
  const monitor = await readMonitor();
  console.log(JSON.stringify({ cost: await admissionCost(), publishedSchools: monitor.schools.filter(s => s.notices).length, dualTrackSchools: monitor.schools.filter(s => s.baoyan && s.kaoyan).length }));
} finally {
  await closeDb();
}
