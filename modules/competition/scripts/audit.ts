import { sql, closeDb } from "@aihot/backend/db";

try {
  const rows = await sql`SELECT c.id,c.name,c.recognition,r.id AS revision_id,r.status,r.year,r.data,r.validation,r.created_at AS revision_created_at,
    (SELECT count(*)::int FROM competition_materials m WHERE m.competition_id = c.id) AS materials,
    (SELECT count(*)::int FROM competition_runs j WHERE j.competition_id = c.id) AS runs
    FROM competition_catalogue c LEFT JOIN LATERAL (
      SELECT id,status,year,data,validation,created_at FROM competition_revisions WHERE competition_id = c.id ORDER BY created_at DESC LIMIT 1
    ) r ON true ORDER BY c.id`;
  const [budget] = await sql`SELECT coalesce(sum(coalesce(actual_upper_cny,reserved_cny)),0)::float AS allocated_cny,
    coalesce(sum(actual_upper_cny),0)::float AS known_upper_cny,
    count(*) FILTER(WHERE actual_upper_cny IS NULL)::int AS unsettled_calls FROM competition_model_allowance`;
  const budgetRounds = await sql`SELECT batch,coalesce(sum(coalesce(actual_upper_cny,reserved_cny)),0)::float AS allocated_cny,
    coalesce(sum(actual_upper_cny),0)::float AS known_upper_cny,count(*) FILTER(WHERE actual_upper_cny IS NULL)::int AS unsettled_calls
    FROM competition_model_allowance GROUP BY batch ORDER BY batch`;
  const [integrity] = await sql`SELECT
    (SELECT count(*)::int FROM competition_revisions r JOIN competition_runs j ON j.id=r.run_id WHERE r.competition_id<>j.competition_id) AS revision_run_mismatches,
    (SELECT count(*)::int FROM competition_revisions r CROSS JOIN LATERAL jsonb_array_elements_text(r.material_ids) mid
      WHERE NOT EXISTS (SELECT 1 FROM competition_materials m WHERE m.competition_id=r.competition_id AND m.id=mid)) AS missing_revision_materials,
    (SELECT count(*)::int FROM (SELECT regexp_replace(lower(name),'[[:space:]（）()“”"''·-]','','g') k FROM competition_catalogue GROUP BY 1 HAVING count(*)>1) d) AS normalized_duplicate_names,
    (SELECT count(*)::int FROM competition_materials WHERE fetched_at > now() + interval '5 minutes') AS future_materials,
    (SELECT max(fetched_at) FROM competition_materials) AS newest_material_at`;
  const runStatuses = await sql`SELECT status,count(*)::int AS count FROM competition_runs GROUP BY status ORDER BY status`;
  const sourceStatuses = await sql`SELECT status,count(*)::int AS sources,count(DISTINCT competition_id)::int AS competitions FROM competition_sources GROUP BY status ORDER BY status`;
  const fields = ["name", "year", "promotionImage", "categories", "participantLimit", "teacherLimit", "registrationTimes", "competitionTimes", "stages", "officialWebsite", "files", "introduction"];
  const revisions = rows.filter(row => row.revision_id);
  const fieldCoverage = Object.fromEntries(fields.map(field => {
    const statuses: Record<string, number> = {};
    for (const row of revisions) {
      const status = String(row.data?.[field]?.status ?? "missing");
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
    return [field, { known: statuses.known ?? 0, total: revisions.length, rate: revisions.length ? Number(((statuses.known ?? 0) / revisions.length).toFixed(4)) : 0, statuses }];
  }));
  const quality = {
    grain: "one catalogue row per approved competition; versioned materials, runs and candidate revisions are child records",
    integrity,
    runStatuses,
    sourceStatuses,
    fieldCoverage,
    noRevision: rows.filter(row => !row.revision_id).map(row => row.id),
    invalidLatestRevision: rows.filter(row => row.validation && !row.validation.valid).map(row => ({ id: row.id, errors: row.validation.errors })),
  };
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    totalCatalogue: rows.length,
    withRevisions: rows.filter(r => r.revision_id).length,
    readyForReview: rows.filter(r => r.validation?.readyForReview).length,
    completeKnownFields: rows.filter(r => r.validation?.valid && !r.validation?.missing?.length).length,
    budget, budgetRounds, quality, entries: rows,
  }, null, 2));
} finally { await closeDb(); }
