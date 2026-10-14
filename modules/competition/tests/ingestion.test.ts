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
