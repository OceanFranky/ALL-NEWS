import { sql, closeDb } from "@aihot/backend/db";

try {
  const rows = await sql`SELECT c.id,c.name,c.recognition,r.id AS revision_id,r.status,r.year,r.validation,
    (SELECT count(*)::int FROM competition_materials m WHERE m.competition_id = c.id) AS materials,
    (SELECT count(*)::int FROM competition_runs j WHERE j.competition_id = c.id) AS runs
    FROM competition_catalogue c LEFT JOIN LATERAL (
      SELECT id,status,year,validation FROM competition_revisions WHERE competition_id = c.id ORDER BY created_at DESC LIMIT 1
    ) r ON true ORDER BY c.id`;
  const [budget] = await sql`SELECT coalesce(sum(coalesce(actual_upper_cny,reserved_cny)),0)::float AS allocated_cny,
    coalesce(sum(actual_upper_cny),0)::float AS known_upper_cny,
    count(*) FILTER(WHERE actual_upper_cny IS NULL)::int AS unsettled_calls FROM competition_model_allowance`;
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    totalCatalogue: rows.length,
    withRevisions: rows.filter(r => r.revision_id).length,
    readyForReview: rows.filter(r => r.validation?.readyForReview).length,
    completeKnownFields: rows.filter(r => r.validation?.valid && !r.validation?.missing?.length).length,
    budget, entries: rows,
  }, null, 2));
} finally { await closeDb(); }
