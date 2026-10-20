import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sql, closeDb } from "@aihot/backend/db";
import { importResourceManifest, resourceManifestSchema } from "../backend/import.ts";
import { getResource, reviewResource } from "../backend/repository.ts";
import { saveCatalogue } from "../../competition/backend/repository.ts";
import { saveMaterial, saveRevision, startRun } from "../../competition/backend/repository.ts";
import { parseHtml } from "../../competition/backend/materials.ts";
import { extractedSchema } from "../../competition/backend/schema.ts";
import { addEdition, selectDisplay } from "../../competition/backend/display.ts";
import { competitionResources } from "../backend/publication.ts";

test.after(closeDb);
test("精选导入可预览、候选留草稿、重复运行不恢复管理员撤回或增添审计", async () => {
  await saveCatalogue({ id: "competition-001", name: "导入测试", schoolLevel: "A2", schoolLevelByScope: [] });
  const source = JSON.parse(readFileSync(new URL("../seeds/competition-resources.json", import.meta.url), "utf8"));
  const first = structuredClone(source.resources.find((item: { decision: string }) => item.decision === "publish"));
  first.key = "import-fixture";
  first.data.url = "https://example.org/curated-import";
  first.links = [{ competitionId: "competition-001", editionId: null, year: null, scope: "测试关联", reason: "测试" }];
  const candidate = structuredClone(first);
  candidate.key = "candidate-fixture";
  candidate.data.url = "https://example.org/candidate";
  candidate.data.verification = "unverified";
  candidate.decision = "draft";
  candidate.evidence[0].method = "search_only";
  const manifest = { version: 1, checkedAt: "2026-10-19", resources: [first, candidate], gaps: [] };
  const before = await sql`SELECT (SELECT count(*)::int FROM receipts) receipts,(SELECT count(*)::int FROM competition_runs) runs,(SELECT count(*)::int FROM articles) articles`;
  const preview = await importResourceManifest(manifest, { actor: "test", publish: true });
  assert.deepEqual(preview.items.map(item => item.action), ["would_publish", "would_draft"]);
  assert.equal((await sql`SELECT count(*)::int n FROM learning_resources`)[0].n, 0);
  const result = await importResourceManifest(manifest, { actor: "test", apply: true, publish: true });
  const published = (await getResource(result.items[0].id!))!;
  assert.equal(published.status, "published");
  assert.equal((await getResource(result.items[1].id!))!.status, "draft");
  await reviewResource(published.id, { expectedVersion: published.version, action: "withdraw", reason: "人工撤回" }, "test-admin");
  const history = (await sql`SELECT count(*)::int n FROM learning_resource_history`)[0].n;
  const repeated = await importResourceManifest(manifest, { actor: "test", apply: true, publish: true });
  assert.deepEqual(repeated.items.map(item => item.action), ["exists", "exists"]);
  assert.equal((await getResource(published.id))!.status, "withdrawn");
  assert.equal((await sql`SELECT count(*)::int n FROM learning_resource_history`)[0].n, history);
  assert.deepEqual(await sql`SELECT (SELECT count(*)::int FROM receipts) receipts,(SELECT count(*)::int FROM competition_runs) runs,(SELECT count(*)::int FROM articles) articles`, before);
  const invalid = structuredClone(manifest);
  invalid.resources.push(structuredClone(first));
  await assert.rejects(importResourceManifest(invalid, { actor: "test", apply: true }), /重复/);
  candidate.decision = "publish";
  assert.equal(resourceManifestSchema.safeParse({ ...manifest, resources: [candidate] }).success, false);
});

test("真实精选清单覆盖31项检查、来源依据完整且不含测试资源", () => {
  const manifest = resourceManifestSchema.parse(JSON.parse(readFileSync(new URL("../seeds/competition-resources.json", import.meta.url), "utf8")));
  const catalogue = JSON.parse(readFileSync(new URL("../../competition/catalogue.json", import.meta.url), "utf8")).entries as { id: string }[];
  assert.deepEqual(manifest.gaps.map(item => item.competitionId).sort(), catalogue.map(item => item.id).sort());
  for (const item of manifest.resources) {
    assert.ok(!item.data.url.includes("example.org"), item.key);
    assert.ok(item.links.every(link => catalogue.some(entry => entry.id === link.competitionId)), item.key);
    assert.ok(item.evidence.every(evidence => evidence.checkedAt <= manifest.checkedAt), item.key);
  }
});

test("真实资源清单逐项通过公开读取，草稿不泄漏、其他竞赛不串入", async () => {
  const manifest = resourceManifestSchema.parse(JSON.parse(readFileSync(new URL("../seeds/competition-resources.json", import.meta.url), "utf8")));
  const catalogue = JSON.parse(readFileSync(new URL("../../competition/catalogue.json", import.meta.url), "utf8")).entries;
  for (const entry of catalogue) await saveCatalogue(entry);
  await importResourceManifest(manifest, { apply: true, publish: true, actor: "real-seed-isolated-test" });
  for (const entry of catalogue) {
    // Synthetic competition facts live only in the throwaway test database; real URLs are never fetched by tests.
    const material = parseHtml(`https://example.org/${entry.id}`, `<body>${"隔离测试正式通知".repeat(30)}</body>`);
    await saveMaterial(entry.id, material);
    const fields = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, { value: null, status: "unknown", reason: "隔离测试", evidence: [] }])));
    const evidence = [{ materialId: material.id, blockId: material.blocks[0].id, quote: "隔离测试正式通知" }];
    fields.name = { value: entry.name, status: "known", reason: "", evidence };
    fields.year = { value: { primary: 2026, officialText: "2026" }, status: "known", reason: "", evidence };
    const revisionId = await saveRevision(entry, await startRun(entry.id), fields, [material], [], null);
    const edition = await addEdition(entry.id, revisionId, "test", "仅测试公开读取");
    await selectDisplay(entry.id, edition.editionId, { revisionId, expectedVersion: 0, reason: "仅测试" }, "test");
    const actual = (await competitionResources({ competitionId: entry.id, editionId: edition.editionId }))!;
    const expected = manifest.resources.filter(item => item.decision === "publish" && item.links.some(link => link.competitionId === entry.id));
    for (const kind of ["experience", "video"] as const) {
      assert.deepEqual(actual[kind].map(item => item.data.url).sort(), expected.filter(item => item.data.kind === kind).map(item => item.data.url).sort(), `${entry.id}/${kind}`);
      assert.ok(actual[kind].every(item => item.links.every(link => link.competitionId === entry.id)));
    }
  }
});
