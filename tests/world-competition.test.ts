import assert from "node:assert/strict";
import test from "node:test";
import { MODULES } from "@aihot/site/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { installModules } from "@aihot/backend/modules";
import { sql, closeDb } from "@aihot/backend/db";
import { buildApp } from "../apps/api/src/app.ts";
import { extractedSchema } from "../modules/competition/backend/schema.ts";
import { parseHtml } from "../modules/competition/backend/materials.ts";
import { saveCatalogue, saveMaterial, startRun, saveRevision } from "../modules/competition/backend/repository.ts";
import { addEdition, selectDisplay } from "../modules/competition/backend/display.ts";

test.after(closeDb);
test("the installed site serves world and competition routes together without publishing one into the other", async () => {
  assert.deepEqual(MODULES.map(module => module.name), ["world-news", "competition", "admission", "learning-resources"]);
  assert.deepEqual(SERVER_MODULES.map(module => module.name), ["world-news", "competition", "admission", "learning-resources"]);
  installModules(SERVER_MODULES);
  const entry = { id: "competition-001", name: "集成竞赛", schoolLevel: "A2", schoolLevelByScope: [] };
  await saveCatalogue(entry);
  const material = parseHtml("https://example.org/integration", `<body>${"集成竞赛官方通知".repeat(30)}</body>`);
  await saveMaterial(entry.id, material);
  const data = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, { status: "unknown", value: null, reason: "待核验", evidence: [] }])));
  data.name = { status: "known", value: "集成竞赛", reason: "", evidence: [{ materialId: material.id, blockId: material.blocks[0].id, quote: "集成竞赛" }] };
  const revisionId = await saveRevision(entry, await startRun(entry.id), data, [material], [], null);
  const { editionId } = await addEdition(entry.id, revisionId, "test", "集成测试");
  await selectDisplay(entry.id, editionId, { revisionId, expectedVersion: 0, reason: "集成测试" }, "test");
  const before = await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM competition_runs) AS runs`;
  const app = await buildApp();
  try {
    const competition = await app.inject("/api/v1/competitions");
    assert.equal(competition.statusCode, 200);
    assert.equal(competition.json().total, 1);
    const world = await app.inject("/api/v1/world/items");
    assert.equal(world.statusCode, 200);
    assert.equal(world.json().items.length, 0);
    assert.ok(!world.body.includes("集成竞赛"));
    for (const path of ["/api/v1/world/highlights", "/api/v1/competitions/overview", `/api/v1/competitions/${entry.id}/editions/${editionId}`]) {
      assert.equal((await app.inject(path)).statusCode, 200, path);
    }
    for (const path of ["/api/admin/world/runs", "/api/admin/competitions/candidates"]) assert.equal((await app.inject(path)).statusCode, 401, path);
    assert.deepEqual(await sql`SELECT (SELECT count(*) FROM receipts) AS receipts,(SELECT count(*) FROM competition_runs) AS runs`, before);
    assert.equal((await sql`SELECT count(*)::int AS count FROM articles`)[0].count, 0);
  } finally { await app.close(); installModules([]); }
});
