import "./setup.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "@aihot/backend/config";

test("bundled community snapshot restores public data without private runtime records and refuses overwrite", async () => {
  const file = new URL("../data/community/myhot-2026-10-21.dump", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL(file.href + ".json"), "utf8"));
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
    for (const name of privateTables) {
      const [row] = await db`SELECT count(*)::int AS count FROM ${db(name)}`;
      assert.equal(row.count, 0, name);
    }
    const [counts] = await db`SELECT (SELECT count(*)::int FROM admission_notices WHERE published IS NOT NULL) AS admissions,
      (SELECT count(*)::int FROM competition_displays) AS competitions,(SELECT count(*)::int FROM learning_resources WHERE status='published') AS resources,
      (SELECT count(*)::int FROM sources WHERE enabled OR site_fulltext OR syndicate_fulltext) AS active_sources,
      (SELECT count(*)::int FROM articles WHERE body_text IS NOT NULL OR body_html IS NOT NULL OR raw IS NOT NULL) AS raw_bodies`;
    assert.deepEqual(counts, { admissions: 159, competitions: 31, resources: 75, active_sources: 0, raw_bodies: 0 });
    assert.throws(() => execFileSync(process.execPath, args, { env, stdio: "pipe" }), /EMPTY database/);
    const [after] = await db`SELECT count(*)::int AS count FROM admission_notices`;
    assert.equal(after.count, 159);
  } finally {
    await db.end(); await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`; await admin.end();
  }
});
