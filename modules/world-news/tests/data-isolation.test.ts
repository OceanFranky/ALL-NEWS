import { tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { closeDb, sql } from "@aihot/backend/db";
import { createSource, sourceDetail, listSources, fetchNow, updateSource } from "@aihot/backend/admin/sources";
import { upsertMaterial, reviseMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { extractArticleBody } from "@aihot/backend/content/extract";
import { groupArticle } from "@aihot/backend/events/group";
import { mergeStoryInto } from "@aihot/backend/events/merge";
import { publishArticle } from "@aihot/backend/publication/publish";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { collectSource } from "@aihot/backend/sources/collect";

after(closeDb);
const T = tag();
const AI = `ai-data-${T}`;
const WORLD = `world-data-${T}`;
const draft = (id: string) => ({ id, name: id, kind: "rss", tier: "T1", config: {
  feedUrl: `https://fixture.invalid/${T}/rss`, publisherUrlPrefixes: [`https://fixture.invalid/${T}`],
} });
const material = { sourceId: WORLD, sectionId: "world" as const, via: "fetch" as const,
  url: `https://fixture.invalid/${T}/news`, title: "原始材料", excerpt: "机构发布政策声明。", publishedAt: new Date() };
let aiId: string;
let worldId: string;

test("expand migrations are validated, preserve global uniqueness and default old records to AI", async () => {
  const constraints = await sql`SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE '%_section_%'`;
  assert.ok(constraints.length >= 34);
  assert.ok(constraints.every(row => row.convalidated));
  assert.equal((await sql`SELECT 1 FROM pg_constraint WHERE conrelid='articles'::regclass AND conname='articles_identity_key_key'`).length, 1);
  assert.equal((await sql`SELECT 1 FROM pg_index WHERE indexrelid='articles_section_identity_idx'::regclass AND indisvalid`).length, 1);
  await createSource(draft(AI), "test");
  const [source] = await sql`SELECT section_id FROM sources WHERE id=${AI}`;
  assert.equal(source!.section_id, "ai");
  await assert.rejects(sql`INSERT INTO sources (section_id,id,name,kind) VALUES ('all',${`bad-${T}`},'bad','rss')`, { code: "23514" });
});

test("source addresses and admin operations are scoped; world starts paused", async () => {
  assert.equal((await createSource(draft(WORLD), "test", "world")).created, true);
  assert.equal((await createSource(draft(`world-dup-${T}`), "test", "world")).created, false);
  assert.equal(await sourceDetail(WORLD), null);
  const world = await sourceDetail(WORLD, "world");
  assert.ok(world);
  assert.equal(world.source.enabled, false);
  assert.equal(world.source.next_fetch_at, null);
  assert.deepEqual((await listSources({}, "world")).rows.map(row => row.id), [WORLD]);
  assert.ok((await listSources({})).rows.every(row => row.id !== WORLD));
  assert.equal(await fetchNow(WORLD, "test"), null);
  await assert.rejects(fetchNow(WORLD, "test", "world"), /暂不能采集/);
  await assert.rejects(updateSource(WORLD, { patch: { section_id: "ai" }, version: new Date(world.source.updated_at).toISOString() }, "test", "world"));
  await assert.rejects(updateSource(WORLD, { patch: { enabled: true }, version: new Date(world.source.updated_at).toISOString() }, "test", "world"), /暂不能启用/);
});

test("source mismatches and an incomplete production cutover reject material", async () => {
  await assert.rejects(upsertMaterial({ ...material, sectionId: "ai" }), /mismatch/);
  await assert.rejects(upsertMaterial({ ...material, sectionId: undefined }), /mismatch/);
  await assert.rejects(upsertMaterial({ ...material, sourceId: AI }), /mismatch/);
  await assert.rejects(upsertMaterial(material), /cutover/);
  assert.equal((await sql`SELECT 1 FROM articles WHERE source_id=${WORLD}`).length, 0);
});

test("TEST-ONLY cutover: same link is independent across sections, concurrent repeats and revisions stay scoped", async () => {
  // The shipped expand batch deliberately never drops this constraint. Simulate the later cutover
  // only inside the per-file disposable test database, never against deployment data.
  assert.match(sql.options.database, /_f\d+_test$/);
  await sql`ALTER TABLE articles DROP CONSTRAINT articles_identity_key_key`;
  aiId = (await upsertMaterial({ ...material, sectionId: undefined, sourceId: AI })).articleId;
  const results = await Promise.all(Array.from({ length: 12 }, () => upsertMaterial(material)));
  worldId = results[0]!.articleId;
  assert.notEqual(worldId, aiId);
  assert.equal(results.filter(row => row.created).length, 1);
  assert.ok(results.every(row => row.articleId === worldId));
  assert.equal((await upsertMaterial(material)).created, false);
  assert.equal((await upsertMaterial({ ...material, title: "仅世界新闻修订" })).revised, true);
  const articles = await sql`SELECT id, section_id, title, revision, source_id FROM articles WHERE id IN (${aiId}, ${worldId})`;
  assert.equal(articles.find(row => row.id === aiId)!.revision, 1);
  assert.equal(articles.find(row => row.id === worldId)!.revision, 2);
  assert.equal(articles.find(row => row.id === worldId)!.source_id, WORLD, "an AI publisher with the same URL must not take ownership");
  await assert.rejects(sql`UPDATE articles SET source_id=${AI} WHERE id=${worldId}`, { code: "23503" });
  await assert.rejects(sql`INSERT INTO article_discoveries (section_id,article_id,source_id,via) VALUES ('world',${worldId},${AI},'test')`, { code: "23503" });
  await assert.rejects(reviseMaterial(sql, worldId, { set: sql`title='wrong'`, title: "wrong", bodyText: null, hash: "wrong" }), /mismatch/);
});

test("database rejects cross-section facts, links, signals, merges and unrelated analysis references", async () => {
  const [aiStory] = await sql`INSERT INTO stories (section_id,public_id,title) VALUES ('ai',gen_random_uuid(),'AI') RETURNING id`;
  const [worldStory] = await sql`INSERT INTO stories (section_id,public_id,title) VALUES ('world',gen_random_uuid(),'世界') RETURNING id`;
  const sid = worldStory!.id;
  const [fact] = await sql`INSERT INTO facts (section_id,public_id,story_id,title) VALUES ('world',${`f-${T}`},${sid},'具体事实') RETURNING id`;
  await assert.rejects(sql`UPDATE facts SET story_id=${aiStory!.id} WHERE id=${fact!.id}`, { code: "23503" });
  await assert.rejects(sql`INSERT INTO fact_articles (section_id,fact_id,article_id) VALUES ('world',${fact!.id},${aiId})`, { code: "23503" });
  await assert.rejects(sql`INSERT INTO story_links (section_id,story_id,other_id,relation) VALUES ('world',${sid},${aiStory!.id},'related')`, { code: "23503" });
  await assert.rejects(sql`UPDATE stories SET merged_into=${aiStory!.id} WHERE id=${sid}`, { code: "23503" });
  await assert.rejects(sql`INSERT INTO story_signals (section_id,story_id,article_id,source_id,participant_key,kind,observed_at)
    VALUES ('world',${sid},${worldId},${AI},'test','editorial',now())`, { code: "23503" });
  assert.equal(await mergeStoryInto(sid, aiStory!.id, "test", "test"), null);
  assert.equal(await mergeStoryInto(aiStory!.id, sid, "test", "test"), null);
  await assert.rejects(sql`INSERT INTO analyses (section_id,article_id,input_revision,origin) VALUES ('world',${aiId},1,'rule')`, { code: "23503" });
  const secondId = (await upsertMaterial({ ...material, url: `https://fixture.invalid/${T}/another` })).articleId;
  const [analysis] = await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin) VALUES ('world',${secondId},1,'rule') RETURNING id`;
  await assert.rejects(sql`INSERT INTO publications (section_id,article_id,analysis_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at)
    VALUES ('world',${worldId},${analysis!.id},'错误关联',${WORLD},'news',${material.url},now(),now(),now())`, { code: "23503" });
  await sql`INSERT INTO fact_articles (section_id,fact_id,article_id) VALUES ('world',${fact!.id},${worldId})`;
  await sql`INSERT INTO story_signals (section_id,story_id,article_id,source_id,participant_key,kind,observed_at)
    VALUES ('world',${sid},${worldId},${WORLD},'test','editorial',now())`;
});

test("legacy AI entry points skip world material before network, queues, models or publication", async () => {
  assert.equal(await analyzeArticle(worldId), null);
  assert.equal(await extractArticleBody(worldId), "skipped");
  assert.deepEqual(await groupArticle(worldId), { verdict: "skipped" });
  assert.equal(await publishArticle(worldId), null);
  assert.equal(await queueProcessing(worldId), null);
  assert.equal((await collectSource(WORLD, { force: true })).status, "skipped");
  assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id=${worldId}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM publications WHERE article_id=${worldId}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM fetch_runs WHERE source_id=${WORLD}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM receipts`).length, 0);
});

test("30 saved real RSS materials replay as 60 independent records without fetching or inventing text", async () => {
  const fixture = JSON.parse(readFileSync(new URL("../review/samples.json", import.meta.url), "utf8")) as {
    sources: { sourceId: string }[];
    samples: { title: string; url: string; rssText: string; sourceId: string; publishedAtRaw: string }[];
  };
  assert.equal(fixture.samples.length, 30);
  for (const source of fixture.sources) for (const section of ["ai", "world"] as const) {
    const id = `${section}-corpus-${source.sourceId}-${T}`;
    await sql`INSERT INTO sources (section_id,id,name,kind,enabled,site_fulltext)
      VALUES (${section},${id},${id},'rss',false,false)`;
  }
  const ids: string[] = [];
  for (const sample of fixture.samples) {
    const pair: string[] = [];
    for (const section of ["ai", "world"] as const) {
      const input = { sectionId: section, sourceId: `${section}-corpus-${sample.sourceId}-${T}`,
        url: sample.url, title: sample.title, excerpt: sample.rssText || null,
        publishedAt: new Date(sample.publishedAtRaw), via: "fetch" as const };
      const first = await upsertMaterial(input);
      assert.equal(first.created, true);
      const again = await upsertMaterial(input);
      assert.equal(again.created, false);
      assert.equal(again.revised, false);
      const [row] = await sql`SELECT excerpt,body_text,revision FROM articles WHERE id=${first.articleId}`;
      assert.equal(row!.excerpt, sample.rssText || null);
      assert.equal(row!.body_text, null);
      assert.equal(row!.revision, 1);
      ids.push(first.articleId);
      pair.push(first.articleId);
    }
    assert.notEqual(pair[0], pair[1]);
  }
  assert.equal(new Set(ids).size, 60);
  assert.equal((await sql`SELECT 1 FROM receipts`).length, 0);
});
