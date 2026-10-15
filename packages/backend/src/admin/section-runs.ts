import { requireSectionId,type SectionId } from '@aihot/contracts/sections';
import { sql } from '../db.ts';
import { serverModules } from '../modules.ts';
import { QUEUES } from '../jobs/queue.ts';
import { sectionContext } from '../sections/context.ts';

/** Queue names come from registration; a payload claiming a section is not proof of ownership. */
export function sectionQueueCondition(sectionId:SectionId) {
  requireSectionId(sectionId);
  const modules=serverModules().filter(m=>m.sections?.some(s=>s.id===sectionId) || (sectionId==='ai' && !m.sections?.length));
  const names=[...(sectionId==='ai' ? Object.values(QUEUES) : []),...modules.flatMap(m=>m.queues?.map(q=>q.name) ?? [])];
  const otherCrons=serverModules().filter(m=>m.sections?.length && !m.sections.some(s=>s.id===sectionId))
    .flatMap(m=>m.schedules?.map(s=>`cron.${s.name}`) ?? []);
  return sql`(name=ANY(${names}::text[]) ${sectionId==='ai' ? sql`OR (name LIKE 'cron.%' AND NOT name=ANY(${otherCrons}::text[]))` : sql``})
    AND (${sectionId==='ai' ? sql`coalesce(data->>'sectionId','ai')='ai'` : sql`data->>'sectionId'=${sectionId}`})
    AND (data->>'articleId' IS NULL OR EXISTS (SELECT 1 FROM articles a WHERE a.id=data->>'articleId' AND a.section_id=${sectionId}))
    AND (data->>'sourceId' IS NULL OR EXISTS (SELECT 1 FROM sources s WHERE s.id=data->>'sourceId' AND s.section_id=${sectionId}))
    AND (data->'sourceIds' IS NULL OR (jsonb_typeof(data->'sourceIds')='array' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(data->'sourceIds')='array' THEN data->'sourceIds' ELSE '[]'::jsonb END) ids(id)
      WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.id=ids.id AND s.section_id=${sectionId}))))
    AND (data->>'storyId' IS NULL OR EXISTS (SELECT 1 FROM stories st
      WHERE st.id=CASE WHEN data->>'storyId' ~ '^[0-9]{1,16}$' THEN (data->>'storyId')::bigint ELSE NULL END AND st.section_id=${sectionId}))`;
}

export async function sectionRunsOverview(sectionId:SectionId) {
  requireSectionId(sectionId);sectionContext(sectionId);
  const [timeline,queues,failedJobs,sources,fetches,receipts,issues,states,grouping,budgets,counts]=await Promise.all([
    sql`SELECT id,job,started_at,finished_at,status,left(error,300) AS error FROM job_runs
      WHERE section_id=${sectionId} ORDER BY started_at DESC,id DESC LIMIT 80`,
    sql`SELECT name,state,count(*)::int AS n,min(created_on) AS oldest FROM pgboss.job
      WHERE ${sectionQueueCondition(sectionId)} AND state IN ('created','retry','active') GROUP BY 1,2 ORDER BY 1,2`,
    sql`SELECT name,count(*)::int AS failed,max(completed_on) AS last FROM pgboss.job
      WHERE ${sectionQueueCondition(sectionId)} AND state='failed' AND completed_on>now()-interval '24 hours' GROUP BY 1 ORDER BY 1`,
    sql`SELECT id,name,enabled,health,fail_count,last_ok_at,last_fetch_at,left(last_error,200) AS last_error
      FROM sources WHERE section_id=${sectionId} ORDER BY id`,
    sql`SELECT r.id,r.source_id,r.started_at,r.finished_at,r.status,left(r.error,200) AS error FROM fetch_runs r
      JOIN sources s ON s.id=r.source_id AND s.section_id=r.section_id
      WHERE r.section_id=${sectionId} ORDER BY r.started_at DESC,r.id DESC LIMIT 80`,
    sql`SELECT status,count(*)::int AS n FROM receipts WHERE section_id=${sectionId} AND created_at>now()-interval '7 days' GROUP BY 1`,
    sql`SELECT id,service,model,purpose,subject,status,attempts,left(error,240) AS error,created_at,updated_at FROM receipts
      WHERE section_id=${sectionId} AND (status='unknown' OR (status='failed' AND updated_at>now()-interval '3 days')
        OR (status='pending' AND updated_at<now()-interval '15 minutes')) ORDER BY updated_at DESC,id DESC LIMIT 40`,
    sql`SELECT processing_state AS state,count(*)::int AS n FROM articles WHERE section_id=${sectionId} GROUP BY 1`,
    sql`SELECT grouping_status AS state,count(*)::int AS n FROM articles WHERE section_id=${sectionId} GROUP BY 1`,
    sql`SELECT b.service,b.per_minute,b.per_hour,b.per_day,c.minute,c.hour,c.day,
      CASE WHEN b.per_minute<=0 OR b.per_hour<=0 OR b.per_day<=0 THEN 'paused'
        WHEN c.minute>=b.per_minute OR c.hour>=b.per_hour OR c.day>=b.per_day THEN 'exhausted' ELSE 'ready' END AS status
      FROM section_budgets b CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE a.started_at>now()-interval '1 minute')::int AS minute,
          count(*) FILTER (WHERE a.started_at>now()-interval '1 hour')::int AS hour,count(*)::int AS day
        FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.section_id=b.section_id
          AND a.service=b.service AND a.origin='live' AND a.started_at>now()-interval '1 day') c
      WHERE b.section_id=${sectionId} ORDER BY b.service`,
    sql`SELECT (SELECT count(*)::int FROM sources WHERE section_id=${sectionId}) AS sources,
      (SELECT count(*)::int FROM articles WHERE section_id=${sectionId}) AS articles,
      (SELECT count(*)::int FROM stories WHERE section_id=${sectionId} AND merged_into IS NULL) AS events`,
  ]);
  return { sectionId,checkedAt:new Date().toISOString(),timeline,queues,failedJobs,sources,fetches,
    receipts:{ counts:Object.fromEntries(receipts.map(r=>[r.status,r.n])),issues },
    processing:Object.fromEntries(states.map(r=>[r.state,r.n])),grouping:Object.fromEntries(grouping.map(r=>[r.state,r.n])),
    budgets,budgetStatus:budgets.length ? 'configured' : 'not-configured',budgetMeaning:'request counts, not a monetary spending cap',counts:counts[0] };
}
