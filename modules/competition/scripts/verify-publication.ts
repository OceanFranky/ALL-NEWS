import assert from "node:assert/strict";
import { buildApp } from "@aihot/api/app";
import { sql, closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { candidateList } from "../backend/candidates.ts";
import { competitionQuerySchema } from "../backend/query.ts";
import competition from "../server.ts";

installModules([competition]);
const app = await buildApp();
try {
  const [before] = await sql`SELECT (SELECT count(*)::int FROM receipts) AS receipts,(SELECT count(*)::int FROM competition_runs) AS runs`;
  const selected = await sql`SELECT d.*,r.data FROM competition_displays d JOIN competition_revisions r
    ON r.competition_id=d.competition_id AND r.id=d.revision_id ORDER BY d.competition_id,d.edition_id`;
  const list = await app.inject("/api/v1/competitions?pageSize=100");
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().total, selected.length);
  assert.ok(selected.length <= 100, "Verifier reads one page; expand verifier before using a larger catalogue");
  const checks = [];
  const fields = ["name", "year", "promotionImage", "categories", "participantLimit", "teacherLimit", "registrationTimes", "competitionTimes", "stages", "officialWebsite", "files", "introduction"];
  for (const row of selected) {
    const response = await app.inject(`/api/v1/competitions/${row.competition_id}/editions/${row.edition_id}`);
    assert.equal(response.statusCode, 200);
    const detail = response.json().item;
    const card = list.json().items.find((item: { editionId: string }) => item.editionId === row.edition_id);
    assert.equal(detail.revisionId, row.revision_id);
    assert.equal(card.revisionId, row.revision_id);
    for (const field of fields) {
      assert.equal(detail[field].status, row.data[field].status);
      assert.deepEqual(detail[field].value, row.data[field].value);
      assert.deepEqual(card[field], detail[field]);
      assert.equal("evidence" in detail[field], false);
    }
    assert.ok(detail.sources.length > 0);
    const search = await app.inject(`/api/v1/competitions?${new URLSearchParams({ q: detail.name.value })}`);
    assert.equal(search.statusCode, 200);
    assert.ok(search.json().items.some((item: { editionId: string }) => item.editionId === row.edition_id));
    checks.push({ competitionId: row.competition_id, editionId: row.edition_id, revisionId: row.revision_id, version: row.version,
      fieldsMatch: true, sourceCount: detail.sources.length, missing: fields.filter(field => detail[field].status !== "known"),
      activity: detail.activity, nextNodes: detail.nextNodes });
  }
  const page = await app.inject("/api/v1/competitions?page=2&pageSize=20");
  assert.equal(page.statusCode, 200);
  assert.equal(page.json().total, selected.length);
  assert.equal(page.json().items.length, Math.min(20, Math.max(0, selected.length - 20)));
  const filters = await app.inject("/api/v1/competitions/filters");
  assert.equal(filters.statusCode, 200);
  const candidates = await candidateList(competitionQuerySchema.parse({ pageSize: "100" }));
  assert.equal((await app.inject("/api/admin/competitions/candidates")).statusCode, 401);
  const [after] = await sql`SELECT (SELECT count(*)::int FROM receipts) AS receipts,(SELECT count(*)::int FROM competition_runs) AS runs`;
  assert.deepEqual(after, before);
  const newsBusinessTables = await sql`SELECT (SELECT count(*)::int FROM sources) AS sources,(SELECT count(*)::int FROM articles) AS articles,
    (SELECT count(*)::int FROM stories) AS stories,(SELECT count(*)::int FROM reports) AS reports,
    (SELECT count(*)::int FROM publications) AS publications,(SELECT count(*)::int FROM translations) AS translations`;
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), publicRecords: selected.length, allFieldValuesAndStatusesMatch: true,
    allDetailsAndSearchesPassed: true, paginationPassed: true, publicFilters: filters.json(), noCollectionOrModelCalls: true,
    candidateCount: candidates.total, protectedCandidateRoute: true,
    before, after, newsBusinessTables: newsBusinessTables[0], entries: checks }, null, 2));
} finally { await app.close(); installModules([]); await closeDb(); }
