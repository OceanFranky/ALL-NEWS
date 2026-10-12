import { tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_TOOL_NAMES } from "@aihot/contracts/mcp";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { currentSignals, sourceClocks, computeHotRanking } from "@aihot/backend/events/hot";
import { loadItemShare } from "@aihot/backend/publication/og";
import { storyTexts } from "@aihot/backend/publication/story-text";
import { composeWorldStoryDigest } from "@aihot/backend/events/section-digest";
import { listedCondition, selectedCondition, seatedCondition, storyReportCondition } from "@aihot/backend/publication/scope";
import { buildApp } from "../../../apps/api/src/app.ts";
import { installModules } from "@aihot/backend/modules";
import { worldNewsModule } from "../server.ts";

const T = tag();
const AI = `ai-public-${T}`;
const WORLD = `world-public-${T}`;
const WORLD_TITLE = `WORLD-ONLY-${T}`;
const aiStory = randomUUID();
const worldStory = randomUUID();
const aiDate = "2098-01-01";
const worldDate = "2098-01-02";
installModules([worldNewsModule]);
const app = await buildApp();
let worldStoryId: number;

before(async () => {
  // Deliberately public world fixtures prove readers enforce isolation even before a world worker
  // exists. Only the runner's disposable per-file database is used, not production publication.
  assert.match(sql.options.database, /_f\d+_test$/);
  for (const section of ["ai", "world"] as const) {
    const id = section === "ai" ? AI : WORLD;
    const title = section === "ai" ? `AI-ONLY-${T}` : WORLD_TITLE;
    const publicId = section === "ai" ? aiStory : worldStory;
    await sql`INSERT INTO sources (section_id,id,name,kind,enabled,site_fulltext)
      VALUES (${section},${id},${title},'rss',true,false)`;
    await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,discovered_at,timeline_at)
      VALUES (${section},${id},${id},${id},${`https://fixture.invalid/${id}`},${title},${title},now(),now())`;
    const [story] = await sql`INSERT INTO stories (section_id,public_id,title)
      VALUES (${section},${publicId},${title}) RETURNING id`;
    if (section === "world") worldStoryId = Number(story!.id);
    const [fact] = await sql`INSERT INTO facts (section_id,public_id,story_id,title)
      VALUES (${section},${`fact-${id}`},${story!.id},${title}) RETURNING id`;
    await sql`INSERT INTO fact_articles (section_id,fact_id,article_id,role)
      VALUES (${section},${fact!.id},${id},'primary')`;
    await sql`INSERT INTO story_signals (section_id,story_id,article_id,source_id,participant_key,kind,observed_at)
      VALUES (${section},${story!.id},${id},${id},${id},'editorial',now())`;
    await sql`INSERT INTO publications (section_id,article_id,source_id,story_id,fact_id,title,summary,channel,url,
      visibility,eligible,selected,seat,indexable,discovered_at,timeline_at,sort_at,visible_after,search_text)
      VALUES (${section},${id},${id},${story!.id},${fact!.id},${title},${title},'news',${`https://fixture.invalid/${id}`},
      'public',true,true,true,true,now(),now(),now(),now()-interval '1 minute',${title.toLowerCase()})`;
    if(section==='world') {
      const [analysis]=await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,title_zh,summary_zh)
        VALUES ('world',${id},1,'rule','pass',${title},${title}) RETURNING id`;
      await sql`UPDATE articles SET grouping_status='complete' WHERE id=${id}`;
      await sql`UPDATE publications SET analysis_id=${analysis!.id} WHERE article_id=${id}`;
      await sql`INSERT INTO section_source_permissions (section_id,source_id,summary_allowed,permission_reference,reviewed_by)
        VALUES ('world',${id},true,'Local fixture permission; not a real source license','test')`;
    }
    const content = { leadItemId: id, sections: [{ label: "fixture", items: [{ itemId: id, title, summary: title }] }] };
    await sql`INSERT INTO reports (section_id,kind,key,window_start,window_end,content,generated_at)
      VALUES (${section},'daily',${section === "ai" ? aiDate : worldDate},now()-interval '1 day',now(),${sql.json(content)},now())`;
  }
});
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

async function get(url: string) {
  return app.inject({ method: "GET", url });
}

test("AI lists, search, timelines, RSS and Agent answers exclude public world fixtures", async () => {
  for (const path of ["/api/v1/items?mode=all", "/api/v1/items?mode=selected", "/api/site/pool",
    "/api/site/timeline", `/api/v1/items?mode=all&q=${T}`, `/api/site/pool?q=${T}`,
    "/feed.xml", "/feed/all.xml", "/feed/full.xml", "/api/v1/agent/latest"]) {
    const res = await get(path);
    assert.equal(res.statusCode, 200, path);
    assert.ok(!res.body.includes(WORLD_TITLE), path);
    assert.ok(!res.body.includes(WORLD), path);
  }
  const ai = await get("/api/v1/items?mode=all");
  assert.ok(ai.body.includes(AI), "AI content remains readable");
});

test("guessing world article and event IDs does not open AI detail or exports", async () => {
  for (const path of [`/api/site/items/${WORLD}`, `/api/site/items/${WORLD}/original`, `/items/${WORLD}/markdown`,
    `/api/site/stories/${worldStory}`, `/api/v1/stories/${worldStory}`]) {
    assert.equal((await get(path)).statusCode, 404, path);
  }
  assert.equal(await loadItemShare(WORLD), null);
  assert.equal((await storyTexts([worldStoryId])).size, 0);
  assert.equal((await get(`/api/site/items/${AI}`)).statusCode, 200);
  const available = (await get(`/api/site/items/availability?ids=${AI},${WORLD}`)).json();
  assert.equal(available[WORLD].status, "unavailable");
  assert.equal(available[AI].status, "public");
});

test("world digest rejects an AI story before any paid request",async()=>{
  const [story]=await sql`SELECT id FROM stories WHERE section_id='ai' AND public_id=${aiStory}`;
  await assert.rejects(composeWorldStoryDigest(Number(story!.id)),/section mismatch/);
  assert.equal((await sql`SELECT 1 FROM receipts`).length,0);
});

test("world reports stay out of AI latest, directory, detail, RSS, sitemap and statistics", async () => {
  for (const path of ["/api/v1/dailies", "/api/v1/dailies/latest", "/api/site/reports/daily",
    "/feed/daily.xml", "/sitemap.xml", "/api/site/stats"]) {
    const res = await get(path);
    assert.equal(res.statusCode, 200, path);
    assert.ok(!res.body.includes(WORLD_TITLE), path);
    assert.ok(!res.body.includes(worldDate), path);
  }
  assert.equal((await get(`/api/v1/dailies/${worldDate}`)).statusCode, 404);
  assert.equal((await get(`/api/site/reports/daily/${worldDate}`)).statusCode, 404);
  const stats = (await get("/api/site/stats")).json();
  assert.equal(stats.items, 1);
  assert.equal(stats.sources, 1);
  assert.equal(stats.dailies, 1);
});

test("AI sync snapshot and changes never include world ledger IDs or payloads", async () => {
  const first = (await get("/api/v1/selected/snapshot")).json();
  const payload = { id: WORLD, title: WORLD_TITLE };
  await sql`INSERT INTO selected_ledger (section_id,seq,article_id,op,payload)
    VALUES ('world',999,${WORLD},'upsert',${sql.json(payload)})`;
  await sql`INSERT INTO selected_state (section_id,article_id,in_set,last_seq)
    VALUES ('world',${WORLD},true,999)`;
  for (const path of ["/api/v1/selected/snapshot", `/api/v1/selected/changes?cursor=${encodeURIComponent(first.cursor)}`]) {
    const res = await get(path);
    assert.equal(res.statusCode, 200, path);
    assert.ok(!res.body.includes(WORLD), path);
    assert.ok(!res.body.includes(WORLD_TITLE), path);
  }
});

test("AI heat reads exclude world signals and source clocks; AI cleanup preserves world rankings", async () => {
  assert.deepEqual((await sourceClocks()).map(source => source.id), [AI]);
  const signals = await sql`SELECT article_id FROM ${currentSignals()} c`;
  assert.deepEqual(signals.map(row => row.article_id), [AI]);
  await sql`INSERT INTO hot_rankings (section_id,computed_at,rule_version,entries,evidence,published)
    VALUES ('world',now()-interval '31 days','world-fixture','[]','{}',true)`;
  await computeHotRanking();
  assert.equal((await sql`SELECT 1 FROM hot_rankings WHERE section_id='world'`).length, 1);
  assert.ok(!(await get("/api/site/hot")).body.includes(WORLD));
});

test("shared publication predicates select exactly one section and reject invalid section IDs", async () => {
  for (const predicate of [listedCondition, selectedCondition, seatedCondition, storyReportCondition]) {
    for (const section of ["ai", "world"] as const) {
      const rows = await sql`SELECT p.article_id FROM publications p JOIN sources s ON s.id=p.source_id
        WHERE ${predicate(new Date(), section)}`;
      assert.deepEqual(rows.map(row => row.article_id), [section === "ai" ? AI : WORLD]);
    }
    assert.throws(() => predicate(new Date(), "all" as never), /section/i);
  }
  assert.equal((await sql`SELECT 1 FROM receipts`).length, 0, "public reads must not call models");
});

test("real loopback MCP transport uses AI-only latest, search, daily and story readers", async () => {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new Client({ name: "section-isolation", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/api/mcp`)));
    for (const request of [
      { name: MCP_TOOL_NAMES.latest, arguments: { mode: "all" } },
      { name: MCP_TOOL_NAMES.search, arguments: { q: T } },
      { name: MCP_TOOL_NAMES.daily, arguments: {} },
      { name: MCP_TOOL_NAMES.story, arguments: { public_id: worldStory } },
    ]) {
      const result = await client.callTool(request);
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes(WORLD_TITLE), request.name);
      assert.ok(!serialized.includes(WORLD), request.name);
    }
  } finally {
    await client.close();
    app.server.closeAllConnections();
  }
  assert.equal((await sql`SELECT 1 FROM receipts`).length, 0);
});

test("world namespace only reads world; wrong section IDs and invalid categories never widen scope", async () => {
  for (const path of ["/api/v1/world/items","/api/v1/world/stories",`/api/v1/world/items/${WORLD}`,`/api/v1/world/stories/${worldStory}`]) {
    const response=await get(path);
    assert.equal(response.statusCode,200,path);
    assert.ok(response.body.includes(WORLD_TITLE),path);
    assert.ok(!response.body.includes(AI),path);
  }
  assert.equal((await get(`/api/v1/world/items/${AI}`)).statusCode,404);
  assert.equal((await get(`/api/v1/world/stories/${aiStory}`)).statusCode,404);
  for (const path of ["/api/v1/world/items?category=ai-models","/api/v1/world/items?section=ai","/api/v1/world/items?limit=0",
    "/api/v1/world/items?page=0"]) {
    assert.equal((await get(path)).statusCode,400,path);
  }
  const hot=(await get("/api/v1/world/hot")).json();
  assert.equal(hot.status,"calibration-required");
  assert.deepEqual(hot.items,[]);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${WORLD}`;
  assert.equal((await get(`/api/v1/world/items/${WORLD}`)).statusCode,404);
  assert.equal((await get(`/api/v1/world/stories/${worldStory}`)).statusCode,404);
  assert.ok(!(await get("/api/v1/world/items")).body.includes(WORLD_TITLE));
});
