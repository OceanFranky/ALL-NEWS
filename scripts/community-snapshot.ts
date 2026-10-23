// Share reviewed database results, never a production backup. Requires PostgreSQL 17 client tools.
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [command, file] = process.argv.slice(2);
if (!["export", "restore"].includes(command) || !file) throw new Error("Usage: community-snapshot.ts export|restore /path/to/community.dump");
const sharedTables = new Set([
  "schema_migrations", "sources", "articles", "analyses", "publications", "editorial_overrides", "pool_search",
  "stories", "story_aliases", "story_links", "story_digests", "facts", "fact_articles", "story_signals", "hot_rankings", "story_heat_hourly",
  "reports", "selected_ledger", "selected_state", "section_source_permissions", "section_daily_revisions", "settings",
  "competition_catalogue", "competition_sources", "competition_materials", "competition_runs", "competition_revisions",
  "competition_editions", "competition_edition_revisions", "competition_displays",
  "admission_sources", "admission_notices", "admission_changes", "learning_resources", "learning_resource_links",
]);
function pg(program: string, url: string, args: string[]) {
  const u = new URL(url);
  const env = { ...process.env,
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) };
  const tmp = mkdtempSync(path.join(tmpdir(), "nexus-restore-list-"));
  try {
    if (program === "pg_restore" && !args.includes("--file")) {
      const list = execFileSync(program, ["--list", args.at(-1)!], { env, encoding: "utf8" });
      const toc = path.join(tmp, "restore.list");
      writeFileSync(toc, list.split("\n").filter(line => !/ SCHEMA - public | COMMENT - SCHEMA public /.test(line)).join("\n"));
      args = ["--dbname", decodeURIComponent(u.pathname.slice(1)), "--use-list", toc, ...args];
    }
    execFileSync(program, args, { stdio: ["ignore", "ignore", "pipe"], env });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
async function restore(url: string) {
  const manifest = JSON.parse(readFileSync(file + ".json", "utf8"));
  if (manifest.format !== "nexus-public-snapshot-v1" || digest(file) !== manifest.sha256) throw new Error("Snapshot format/checksum mismatch");
  const db = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await db`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'`;
    if (row.count) throw new Error("Restore requires an EMPTY database; existing tables will never be overwritten");
    await db`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    pg("pg_restore", url, ["--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", file]);
  } finally { await db.end(); }
}

async function sanitize(db: ReturnType<typeof postgres>, ids: string[]) {
  await db.begin(async tx => {
    await tx`CREATE TEMP TABLE shared_articles(id text PRIMARY KEY) ON COMMIT DROP`;
    if (ids.length) await tx`INSERT INTO shared_articles SELECT unnest(${tx.array(ids)}::text[])`;
    await tx`DELETE FROM publications WHERE article_id NOT IN (SELECT id FROM shared_articles)`;
    await tx`UPDATE articles SET grouping_receipt_id=NULL`;
    await tx`UPDATE competition_revisions SET receipt_id=NULL`;
    const tables = (await tx`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`).map(r => String(r.table_name));
    const fks = await tx`SELECT c.relname AS child,p.relname AS parent FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_class p ON p.oid=f.confrelid WHERE f.contype='f' AND f.connamespace='public'::regnamespace`;
    const privateTables = new Set(tables.filter(name => !sharedTables.has(name)));
    while (privateTables.size) {
      const leaves = [...privateTables].filter(name => !fks.some(fk => fk.parent === name && fk.child !== name && privateTables.has(fk.child)));
      if (!leaves.length) throw new Error("Private table dependency cycle; review before export");
      for (const name of leaves) { await tx`DELETE FROM ${tx(name)}`; privateTables.delete(name); }
    }
    await tx`DELETE FROM fact_articles WHERE article_id NOT IN (SELECT id FROM shared_articles)`;
    await tx`DELETE FROM story_signals WHERE article_id NOT IN (SELECT id FROM shared_articles)`;
    await tx`DELETE FROM facts WHERE id NOT IN (SELECT fact_id FROM fact_articles UNION SELECT fact_id FROM publications WHERE fact_id IS NOT NULL)`;
    await tx`CREATE TEMP TABLE shared_stories ON COMMIT DROP AS WITH RECURSIVE kept(id) AS (
      SELECT story_id FROM facts WHERE story_id IS NOT NULL UNION SELECT story_id FROM publications WHERE story_id IS NOT NULL
      UNION SELECT st.merged_into FROM stories st JOIN kept k ON k.id=st.id WHERE st.merged_into IS NOT NULL) SELECT id FROM kept`;
    await tx`DELETE FROM stories WHERE id NOT IN (SELECT id FROM shared_stories)`;
    await tx`DELETE FROM articles WHERE id NOT IN (SELECT id FROM shared_articles)`;
    await tx`DELETE FROM analyses WHERE id NOT IN (SELECT analysis_id FROM publications WHERE analysis_id IS NOT NULL)`;
    await tx`UPDATE articles a SET body_text=NULL,body_html=NULL,raw=NULL,x_post=NULL,body_status='none',excerpt=p.summary FROM publications p WHERE p.article_id=a.id`;
    await tx`UPDATE analyses SET receipt_ids='{}',model=NULL,prompt_version=NULL,output=jsonb_strip_nulls(jsonb_build_object('scope',output->'scope'))`;
    await tx`UPDATE sources SET config='{}',enabled=false,site_fulltext=false,syndicate_fulltext=false`;
    await tx`UPDATE publications SET body_mode='summary',syndicate=false`;
    await tx`UPDATE pool_search SET body=''`;
    await tx`UPDATE editorial_overrides SET reason=NULL,updated_by='community-snapshot'`;
    await tx`UPDATE story_digests SET receipt_id=NULL`;
    await tx`UPDATE reports SET model=NULL`;
    await tx`DELETE FROM selected_state WHERE NOT in_set OR article_id NOT IN (SELECT id FROM shared_articles)`;
    await tx`DELETE FROM selected_ledger WHERE seq NOT IN (SELECT last_seq FROM selected_state)`;
    await tx`DELETE FROM settings WHERE key NOT IN ('sections.world.daily','sections.world.publication','selected_ledger_epoch')`;
    await tx`UPDATE settings SET updated_by='community-snapshot'`;
    await tx`DELETE FROM section_daily_revisions r WHERE status<>'approved' OR id NOT IN (
      SELECT DISTINCT ON(section_id,edition_date) id FROM section_daily_revisions WHERE approved_at IS NOT NULL ORDER BY section_id,edition_date,revision DESC)`;
    await tx`UPDATE section_daily_revisions SET generated_by='community-snapshot',approved_by='community-snapshot'`;
    await tx`UPDATE section_source_permissions SET reviewed_by='community-snapshot'`;
    await tx`DELETE FROM admission_notices WHERE published IS NULL`;
    await tx`UPDATE admission_notices SET draft=published`;
    await tx`UPDATE admission_sources SET config='{}',status='paused',detail='{}'`;
    await tx`DELETE FROM learning_resource_links WHERE resource_id IN (SELECT id FROM learning_resources WHERE status<>'published' OR data->>'verification'<>'verified' OR data->>'availability'='invalid')`;
    await tx`DELETE FROM learning_resources WHERE status<>'published' OR data->>'verification'<>'verified' OR data->>'availability'='invalid'`;
    await tx`DELETE FROM learning_resource_links l WHERE edition_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM competition_displays d WHERE d.competition_id=l.competition_id AND d.edition_id=l.edition_id)`;
    await tx`DELETE FROM competition_edition_revisions r WHERE NOT EXISTS(SELECT 1 FROM competition_displays d WHERE d.competition_id=r.competition_id AND d.edition_id=r.edition_id AND d.revision_id=r.revision_id)`;
    await tx`DELETE FROM competition_revisions r WHERE NOT EXISTS(SELECT 1 FROM competition_displays d WHERE d.competition_id=r.competition_id AND d.revision_id=r.id)`;
    await tx`DELETE FROM competition_runs WHERE id NOT IN (SELECT run_id FROM competition_revisions)`;
    await tx`UPDATE competition_runs SET report='{}'`;
    await tx`DELETE FROM competition_materials m WHERE NOT EXISTS(SELECT 1 FROM competition_revisions r WHERE r.competition_id=m.competition_id AND r.material_ids @> jsonb_build_array(m.id))`;
    await tx`UPDATE competition_materials SET content='{}'`;
    await tx`DELETE FROM competition_editions e WHERE NOT EXISTS(SELECT 1 FROM competition_displays d WHERE d.competition_id=e.competition_id AND d.edition_id=e.id)`;
  });
}

async function exportSnapshot() {
  const source = process.env.DATABASE_URL, scratch = process.env.SNAPSHOT_SCRATCH_URL;
  if (!source || !scratch) throw new Error("DATABASE_URL and SNAPSHOT_SCRATCH_URL are required");
  const u = new URL(scratch), name = decodeURIComponent(u.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]*_share_test$/.test(name) || u.pathname === new URL(source).pathname) throw new Error("Scratch must be a separate NEW database ending in _share_test");
  const adminUrl = new URL(scratch); adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const tmp = mkdtempSync(path.join(tmpdir(), "nexus-private-export-")); let created = false;
  try {
    await admin`CREATE DATABASE ${admin(name)}`; created = true;
    console.log("export: scratch database created");
    const { sql, closeDb } = await import("@aihot/backend/db");
    const { listedCondition, selectedCondition } = await import("@aihot/backend/publication/scope");
    const now = new Date();
    const ids = (await sql`SELECT p.article_id FROM publications p WHERE ${listedCondition(now, "ai")} OR ${selectedCondition(now, "ai")} OR ${listedCondition(now, "world")}`).map(r => String(r.article_id));
    await closeDb();
    console.log("export: public article scope read");
    const privateDump = path.join(tmp, "private.dump");
    pg("pg_dump", source, ["--schema=public", "--no-owner", "--no-privileges", "--format=custom", "--file", privateDump]);
    const db = postgres(scratch, { max: 1, onnotice: () => {} });
    try {
      await db`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
      pg("pg_restore", scratch, ["--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", privateDump]);
      console.log("export: private working copy restored");
      await sanitize(db, ids);
      const counts: Record<string, number> = {};
      for (const row of await db`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`) {
        const [count] = await db`SELECT count(*)::int AS n FROM ${db(row.table_name)}`;
        counts[row.table_name] = count.n;
        if (!sharedTables.has(row.table_name) && count.n) throw new Error("Private table was not cleared");
      }
      pg("pg_dump", scratch, ["--schema=public", "--no-owner", "--no-privileges", "--format=custom", "--file", file]);
      const bytes = readFileSync(file);
      // Inspect SQL rather than compressed bytes. Never print a matching secret or row.
      const inspect = path.join(tmp, "share.sql");
      pg("pg_restore", scratch, ["--file", inspect, file]);
      const sensitive = /(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{20,}|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@)/;
      let copyTable = "schema", copyColumns: string[] = [];
      for (const line of readFileSync(inspect, "utf8").split("\n")) {
        const header = /^COPY public\.([a-z_]+) \(([^)]+)\)/.exec(line);
        if (header) { copyTable = header[1]; copyColumns = header[2].split(", "); }
        if (sensitive.test(line)) {
          console.error(JSON.stringify({ blockedTable: copyTable, columns: line.split("\t").flatMap((value, i) => sensitive.test(value) ? [copyColumns[i] ?? "schema"] : []) }));
          throw new Error("Potential credential in export; output must not be shared");
        }
      }
      const migrations = (await db`SELECT name FROM schema_migrations ORDER BY name`).map(r => r.name);
      writeFileSync(file + ".json", JSON.stringify({ format: "nexus-public-snapshot-v1", createdAt: now.toISOString(), sha256: digest(file), bytes: statSync(file).size, migrations, counts,
        policy: "Published summaries and relationships only; no secrets, accounts, receipts, private tasks or raw article/attachment bodies. Collection disabled." }, null, 2) + "\n");
      console.log(JSON.stringify({ file, bytes: bytes.length, counts }));
    } finally { await db.end(); }
  } catch (error) {
    rmSync(file, { force: true }); rmSync(file + ".json", { force: true });
    // Constraint identifiers and SQLSTATE help repair export logic without exposing row values.
    console.error(JSON.stringify({ name: (error as Error).name, location: (error as Error).stack?.split("\n").slice(1, 4), code: (error as { code?: string }).code, table: (error as { table_name?: string }).table_name,
      constraint: (error as { constraint_name?: string }).constraint_name,
      clientError: (error as { stderr?: Buffer }).stderr?.toString().split("\n").filter(line => !/DETAIL:|COPY |VALUES|INSERT INTO/.test(line)).slice(0, 2) }));
    throw new Error(`Export failed (${(error as { code?: string }).code ?? "validation"}); no shareable output retained`, { cause: undefined });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
    await admin.end();
  }
}

if (command === "export") await exportSnapshot();
else {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await restore(process.env.DATABASE_URL); console.log("Public snapshot restored into empty database; no model or collection tasks started.");
}
