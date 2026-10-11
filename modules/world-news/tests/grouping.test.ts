import { stub, tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { groupSectionArticle } from "@aihot/backend/events/section-group";
import { worldNewsModule } from "../server.ts";

const T = tag();
const source = `group-world-${T}`;
let relation = "SAME_OCCURRENCE";
let disagree = false;
const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body);
  const review = body.messages[0].content.includes("独立复核者");
  return { choices: [{ message: { content: JSON.stringify({ a: "发生 A", b: "发生 B", relation: review && disagree ? "UNRELATED" : relation, confidence: 0.9, note: "仅依据输入具体动作" }) } }] };
});
process.env.LLM_BASE_URL = `${provider.url}/v1`;
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "world-local-group";
before(async () => {
  installModules([worldNewsModule]);
  await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world',${source},'world','rss',false)`;
  await sql`INSERT INTO section_budgets VALUES ('world','llm',100,100,100)`;
});
after(async () => { await provider.close(); await closeDb(); });
let n = 0;
async function article(type = "institutional_statement") {
  const id = `group-world-${T}-${++n}`;
  const text = "The central bank announced a rate cut effective Monday.";
  await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,published_at,discovered_at,timeline_at)
    VALUES ('world',${id},${source},${id},${`https://fixture.invalid/${id}`},'Bank policy',${text},now(),now(),now())`;
  const output = { scope: "single", contentType: type, fact: type === "opinion_analysis" ? null : { title: "央行宣布降息", subject: "bank", action: "announce", object: "cut", occurredAt: null, conditions: [], evidence: text } };
  await sql`INSERT INTO analyses (section_id,article_id,input_revision,origin,relevance,title_zh,summary_zh,output)
    VALUES ('world',${id},1,'rule','pass','央行宣布降息','周一生效',${sql.json(output)})`;
  return id;
}
let firstStory: number;
let firstFact: number;

test("new world occurrence creates scoped story, fact, membership and signal", async () => {
  const result = await groupSectionArticle("world",await article());
  assert.equal(result.verdict,"new");
  firstStory = result.storyId!;
  firstFact = result.factId!;
  assert.ok(firstStory && firstFact);
  assert.ok((await sql`SELECT section_id FROM facts`).every(r => r.section_id==='world'));
  assert.equal(provider.hits(),0);
});

test("same occurrence requires two independent world judgments and reuses membership on rerun", async () => {
  const id = await article();
  const start = provider.hits();
  const result = await groupSectionArticle("world",id);
  assert.equal(result.storyId,firstStory);
  assert.equal(result.factId,firstFact);
  assert.equal(result.verdict,"SAME_OCCURRENCE");
  assert.equal(provider.hits()-start,2);
  assert.equal((await groupSectionArticle("world",id)).verdict,"existing");
  assert.equal(provider.hits()-start,2);
  assert.ok((await sql`SELECT section_id,status FROM receipts`).every(r => r.section_id==='world' && r.status==='completed'));
});

test("direct development remains a separate fact under the concrete story", async () => {
  relation = "SAME_STORY";
  const result = await groupSectionArticle("world",await article());
  assert.equal(result.storyId,firstStory);
  assert.notEqual(result.factId,firstFact);
  assert.equal(result.verdict,"SAME_STORY");
});

test("commentary can mention an existing event but never creates a occurred fact or heat signal", async () => {
  relation="SAME_OCCURRENCE";
  const id=await article("opinion_analysis");
  const before=(await sql`SELECT 1 FROM facts`).length;
  const result=await groupSectionArticle("world",id);
  assert.equal(result.verdict,"mention");
  assert.equal((await sql`SELECT 1 FROM facts`).length,before);
  assert.equal((await sql`SELECT 1 FROM story_signals WHERE article_id=${id}`).length,0);
});

test("different actions or independent review disagreement cannot force a merge", async () => {
  relation="SAME_OCCURRENCE";
  disagree=true;
  const result=await groupSectionArticle("world",await article());
  assert.equal(result.verdict,"new");
  assert.notEqual(result.storyId,firstStory);
  disagree=false;
  relation="UNRELATED";
  const separate=await groupSectionArticle("world",await article());
  assert.equal(separate.verdict,"new");
  assert.notEqual(separate.storyId,result.storyId);
});

test("manual standalone choices and wrong section resources never trigger paid grouping", async () => {
  const id=await article();
  await sql`INSERT INTO grouping_overrides (article_id,mode) VALUES (${id},'standalone')`;
  const start=provider.hits();
  assert.equal((await groupSectionArticle("world",id)).verdict,"manual");
  await assert.rejects(groupSectionArticle("ai",id),/legacy/);
  const ai=`ai-group-${T}`;
  await sql`INSERT INTO sources (id,name,kind) VALUES (${ai},'AI','rss')`;
  await sql`INSERT INTO articles (id,source_id,identity_key,url,title,discovered_at,timeline_at)
    VALUES (${ai},${ai},${ai},'https://fixture.invalid/ai','AI',now(),now())`;
  await assert.rejects(groupSectionArticle("world",ai),/mismatch/);
  assert.equal(provider.hits(),start);
});
