import "./setup.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "@aihot/backend/config";
import { SITE } from "@aihot/site";
import { sha256, stableJson } from "../packages/backend/src/lib/ids.ts";

test("bundled community snapshot restores public data without private runtime records and refuses overwrite", async () => {
  const file = new URL("../data/community/nexus-2026-10-23.dump", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL(file.href + ".json"), "utf8"));
  assert.equal(manifest.format, "nexus-public-snapshot-v1");
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), manifest.sha256);
  const privateTables = ["admin_users", "admin_sessions", "audit_log", "feedback", "feedback_bans", "receipts", "receipt_attempts", "notify_targets", "deliveries", "job_runs", "admission_agent_tasks", "admission_agent_steps", "admission_documents", "admission_snapshots", "admission_imports", "competition_model_allowance", "admission_allowance"];
  for (const name of privateTables) assert.equal(manifest.counts[name], 0, name);
  const name = `snapshot_${randomBytes(6).toString("hex")}_ci`;
  const target = new URL(config.databaseUrl); target.pathname = `/${name}`;
  const adminUrl = new URL(config.databaseUrl); adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const script = new URL("../scripts/community-snapshot.ts", import.meta.url);
  const args = [fileURLToPath(script), "restore", fileURLToPath(file)];
  const env = { ...process.env, DATABASE_URL: target.toString() };
  await admin`CREATE DATABASE ${admin(name)}`;
  const db = postgres(target.toString(), { max: 1, onnotice: () => {} });
  try {
    execFileSync(process.execPath, args, { env, stdio: "pipe" });
    for (const [table, count] of Object.entries(manifest.counts)) {
      const [row] = await db`SELECT count(*)::int AS count FROM ${db(table)}`;
      assert.equal(row.count, count, table);
    }
    for (const name of privateTables) {
      const [row] = await db`SELECT count(*)::int AS count FROM ${db(name)}`;
      assert.equal(row.count, 0, name);
    }
    const [counts] = await db`SELECT (SELECT count(*)::int FROM admission_notices WHERE published IS NOT NULL) AS admissions,
      (SELECT count(*)::int FROM competition_displays) AS competitions,(SELECT count(*)::int FROM learning_resources WHERE status='published') AS resources,
      (SELECT count(*)::int FROM sources WHERE enabled OR site_fulltext OR syndicate_fulltext) AS active_sources,
      (SELECT count(*)::int FROM articles WHERE body_text IS NOT NULL OR body_html IS NOT NULL OR raw IS NOT NULL) AS raw_bodies`;
    assert.deepEqual(counts, { admissions: 159, competitions: 31, resources: 75, active_sources: 0, raw_bodies: 0 });
    const [report] = await db`SELECT id,content FROM reports WHERE content->>'title' LIKE ${SITE.name + "%"} ORDER BY id LIMIT 1`;
    assert.ok(report);
    assert.ok(String(report.content.title).startsWith(SITE.name));
    const [entry] = await db`SELECT seq,payload FROM selected_ledger WHERE payload->'attribution' IS NOT NULL LIMIT 1`;
    assert.equal(entry.payload.attribution.name, SITE.name);
    const previous = "Previous Brand";
    await db`UPDATE reports SET content=jsonb_set(jsonb_set(content,'{title}',to_jsonb(${previous + " 周报"}::text)),'{testSourceQuote}',to_jsonb(${previous}::text)) WHERE id=${report.id}`;
    await db`UPDATE selected_ledger SET payload=jsonb_set(payload,'{attribution,name}',to_jsonb(${previous}::text)) WHERE seq=${entry.seq}`;
    const rename = fileURLToPath(new URL("../scripts/rename-site-data.ts", import.meta.url));
    for (let repeat = 0; repeat < 2; repeat++) execFileSync(process.execPath, [rename, previous], { env, stdio: "pipe" });
    const [renamed] = await db`SELECT content FROM reports WHERE id=${report.id}`;
    assert.equal(renamed.content.title, SITE.name + " 周报");
    assert.equal(renamed.content.testSourceQuote, previous);
    const [state] = await db`SELECT l.payload,s.payload_hash FROM selected_ledger l JOIN selected_state s ON s.last_seq=l.seq WHERE l.seq=${entry.seq}`;
    assert.equal(state.payload.attribution.name, SITE.name);
    assert.equal(state.payload_hash, sha256(stableJson(state.payload)));
    assert.throws(() => execFileSync(process.execPath, args, { env, stdio: "pipe" }), /EMPTY database/);
    const [after] = await db`SELECT count(*)::int AS count FROM admission_notices`;
    assert.equal(after.count, 159);
  } finally {
    await db.end(); await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`; await admin.end();
  }
});
