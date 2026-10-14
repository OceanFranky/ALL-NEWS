import assert from "node:assert/strict";
import test from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { parseHtml } from "../backend/materials.ts";
import { ingestCompetition } from "../backend/workflow.ts";
import { extractedSchema } from "../backend/schema.ts";
import { saveCatalogue, startRun, saveRevision } from "../backend/repository.ts";

test.after(closeDb);
const entry = { id: "competition-001", name: "测试竞赛", schoolLevel: "A2", schoolLevelByScope: [] };
const blank = () => extractedSchema.parse(Object.fromEntries([
  "name", "year", "promotionImage", "categories", "participantLimit", "teacherLimit", "registrationTimes", "competitionTimes", "stages", "officialWebsite", "files", "introduction",
].map(key => [key, { value: null, status: "unknown", reason: "材料未完成核验", evidence: [] }])));

test("collected material and model candidate persist with school recognition, without writing news", async () => {
  const [before] = await sql`SELECT count(*)::int AS n FROM articles`;
  const material = parseHtml("https://example.org/contest", `<html><body><article>${"官方竞赛材料".repeat(30)}</article></body></html>`);
  const result = await ingestCompetition(entry, [material.url], [], { collect: async () => material, extract: async () => ({ data: blank(), receiptId: null }) });
  const [row] = await sql`SELECT data, status FROM competition_revisions WHERE competition_id = ${entry.id} AND id = ${result.revisionId}`;
  assert.equal(row.data.schoolLevel, "A2");
  assert.equal(row.status, "draft");
  assert.equal((await sql`SELECT 1 FROM competition_materials WHERE competition_id = ${entry.id} AND id = ${material.id}`).length, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM articles`)[0].n, before.n);
  await ingestCompetition(entry, [material.url], [], { collect: async () => material, extract: async () => ({ data: blank(), receiptId: null }) });
  assert.equal((await sql`SELECT 1 FROM competition_materials WHERE competition_id = ${entry.id} AND id = ${material.id}`).length, 1);
});

test("a different competition cannot claim an existing run", async () => {
  await saveCatalogue(entry);
  const run = await startRun(entry.id);
  const other = { ...entry, id: "competition-002" };
  await saveCatalogue(other);
  await assert.rejects(saveRevision(other, run, blank(), [], [], null), /ownership mismatch/);
});

test("failed collection is saved as a failed run without a revision", async () => {
  await assert.rejects(ingestCompetition(entry, ["https://example.org/broken"], [], { collect: async () => { throw new Error("HTTP 403"); }, extract: async () => ({ data: blank(), receiptId: null }) }), /403/);
  assert.ok((await sql`SELECT 1 FROM competition_runs WHERE competition_id = ${entry.id} AND status = 'failed'`).length > 0);
});

test("one failed attachment preserves other collected evidence and records the failure", async () => {
  const m = parseHtml("https://example.org/notice", `<body>${"官方竞赛通知正文".repeat(30)}</body>`);
  const result = await ingestCompetition(entry, [m.url, "https://example.org/broken.pdf"], [], {
    collect: async url => { if (url.endsWith("pdf")) throw new Error("HTTP 403"); return m; },
    extract: async () => ({ data: blank(), receiptId: null }),
  });
  const [row] = await sql`SELECT report FROM competition_runs WHERE id = ${result.runId}`;
  assert.equal(row.report.failures[0].error, "HTTP 403");
  assert.equal(row.report.attemptedUrls.length, 2);
});

test("a later schedule-only notice retains the previous material as evidence", async () => {
  const localEntry = { ...entry, id: "competition-003" };
  const initial = parseHtml("https://example.org/initial", `<body>${"报名通知含队伍规则".repeat(30)}</body>`);
  const later = parseHtml("https://example.org/extension", `<body>${"报名延期通知".repeat(30)}</body>`);
  await ingestCompetition(localEntry, [initial.url], [], { collect: async () => initial, extract: async () => ({ data: blank(), receiptId: null }) });
  const result = await ingestCompetition(localEntry, [later.url], [], {
    collect: async () => later,
    extract: async (_entry, materials) => {
      assert.ok(materials.some(m => m.id === initial.id));
      assert.ok(materials.some(m => m.id === later.id));
      return { data: blank(), receiptId: null };
    },
  });
  const [saved] = await sql`SELECT material_ids FROM competition_revisions WHERE competition_id = ${localEntry.id} AND id = ${result.revisionId}`;
  assert.equal(saved.material_ids.length, 2);
});

test("an autonomous refresh records unchanged input without another model extraction", async () => {
  const localEntry = { ...entry, id: "competition-004" };
  const material = parseHtml("https://example.org/stable", `<body>${"稳定的官方竞赛通知".repeat(30)}</body>`);
  await ingestCompetition(localEntry, [material.url], [], { collect: async () => material, extract: async () => ({ data: blank(), receiptId: null }) });
  let extracted = false;
  const result = await ingestCompetition(localEntry, [material.url], [], {
    collect: async () => material,
    extract: async () => { extracted = true; return { data: blank(), receiptId: null }; },
  }, true);
  assert.equal(extracted, false);
  assert.equal(result.revisionId, null);
  const [run] = await sql`SELECT status, report FROM competition_runs WHERE id = ${result.runId}`;
  assert.equal(run.status, "completed");
  assert.equal(run.report.unchanged, true);
});
