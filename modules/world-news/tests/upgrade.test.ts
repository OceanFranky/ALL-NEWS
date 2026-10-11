import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import postgres from "postgres";
import { closeDb, sql } from "@aihot/backend/db";
import { runMigrations } from "../../../scripts/migrate.ts";

after(closeDb);

test("a populated pre-section database upgrades without rewriting AI identities, relations or publication", async () => {
  assert.match(sql.options.database, /_f\d+_test$/);
  const name = `${sql.options.database}_upgrade_test`;
  const serverUrl = new URL(process.env.DATABASE_URL!);
  serverUrl.pathname = "/postgres";
  const server = postgres(serverUrl.href, { onnotice: () => {} });
  const root = path.resolve(import.meta.dirname, "../../..");
  const previous = await mkdtemp(path.join(tmpdir(), "world-upgrade-"));
  let db: postgres.Sql | undefined;
  let created = false;
  try {
    await server`CREATE DATABASE ${server(name)}`;
    created = true;
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    db = postgres(url.href, { onnotice: () => {} });
    const oldMigrations = path.join(previous, "database/migrations");
    await mkdir(oldMigrations, { recursive: true });
    for (const file of await readdir(path.join(root, "database/migrations"))) {
      if (file.endsWith(".sql") && Number(file.slice(0, 4)) <= 57) {
        await cp(path.join(root, "database/migrations", file), path.join(oldMigrations, file));
      }
    }
    await runMigrations(db, previous);
    await db`INSERT INTO sources (id,name,kind,enabled,cursor) VALUES ('old-source','旧信源','rss',false,'{"position":"unchanged"}')`;
    await db`INSERT INTO fetch_runs (source_id,status,found_count,new_count) VALUES ('old-source','ok',2,1)`;
    await db`INSERT INTO articles (id,source_id,identity_key,url,title,revision,discovered_at,timeline_at)
      VALUES ('old-article','old-source','url:fixture','https://fixture.invalid/old','旧标题',4,'2026-10-10T00:00:00Z','2026-10-10T00:00:00Z')`;
    const [analysis] = await db`INSERT INTO analyses (article_id,input_revision,origin,title_zh,score,selected)
      VALUES ('old-article',4,'rule','旧中文标题',87,true) RETURNING id`;
    await db`INSERT INTO stories (public_id,title) VALUES (gen_random_uuid(),'旧事件')`;
    await db`INSERT INTO facts (public_id,story_id,title) SELECT 'old-fact',id,'旧事实' FROM stories`;
    await db`INSERT INTO fact_articles (fact_id,article_id) SELECT id,'old-article' FROM facts`;
    await db`INSERT INTO article_discoveries (article_id,source_id,via) VALUES ('old-article','old-source','fetch')`;
    await db`INSERT INTO publications (article_id,analysis_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,eligible,selected)
      VALUES ('old-article',${analysis!.id},'旧中文标题','old-source','news','https://fixture.invalid/old',now(),now(),now(),true,true)`;
    const before = await db`SELECT a.*,s.cursor,p.title AS public_title,p.score AS public_score,p.selected AS public_selected,p.analysis_id
      FROM articles a JOIN sources s ON s.id=a.source_id JOIN publications p ON p.article_id=a.id`;
    assert.ok(await runMigrations(db, root) > 0);
    const after = await db`SELECT a.*,s.cursor,p.title AS public_title,p.score AS public_score,p.selected AS public_selected,p.analysis_id
      FROM articles a JOIN sources s ON s.id=a.source_id JOIN publications p ON p.article_id=a.id`;
    const { section_id, ...rest } = after[0]!;
    assert.equal(section_id, "ai");
    assert.deepEqual(rest, { ...before[0] });
    for (const table of ["sources", "articles", "analyses", "publications", "stories", "facts", "fact_articles", "article_discoveries","fetch_runs"]) {
      const rows: { section_id: string }[] = await db`SELECT section_id FROM ${db(table)}`;
      assert.ok(rows.length && rows.every(row => row.section_id === "ai"), table);
    }
    assert.equal(await runMigrations(db, root), 0, "full filename bookkeeping is idempotent");
    assert.equal((await db`SELECT 1 FROM pg_constraint WHERE conrelid='articles'::regclass AND conname='articles_identity_key_key'`).length, 0);
    await db`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world','new-world','世界源','rss',false)`;
    await db`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,discovered_at,timeline_at)
      VALUES ('world','new-world-article','new-world','url:fixture','https://fixture.invalid/old','世界独立标题',now(),now())`;
    assert.equal((await db`SELECT title FROM articles WHERE id='old-article'`)[0]!.title,'旧标题');
    await assert.rejects(db`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,discovered_at,timeline_at)
      VALUES ('world','duplicate-world','new-world','url:fixture','https://fixture.invalid/old','不应重复',now(),now())`,{ code:'23505' });
  } finally {
    await db?.end();
    if (created) await server`DROP DATABASE ${server(name)} WITH (FORCE)`;
    await server.end();
    await rm(previous, { recursive: true, force: true });
  }
});
