import { stub, tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { analyzeSectionArticle } from "@aihot/backend/editorial/section-analyze";
import { worldNewsModule } from "../server.ts";
import { runWorldAnalysisTask, queueWorldAnalysis } from "../jobs.ts";

const T = tag();
const source = `analysis-world-${T}`;
let mode = "pass";
const body = "The central bank announced a rate cut of 0.25 percentage points, effective Monday.";
const requests: { system: string; user: string }[] = [];
const provider = await stub((_hit, req) => {
  const messages = JSON.parse(req.body).messages as { content: string }[];
  const system = messages[0]!.content;
  requests.push({ system, user: messages[1]!.content });
  let response: unknown;
  if (system.includes("判定顺序")) response = { label: mode === "block" ? "BLOCK" : mode === "unknown" ? "UNKNOWN" : "PASS", reason: "实际政策动作" };
  else if (system.includes("材料充分性先于公开")) response = { scope: mode === "insufficient" ? "unknown" : "single", category: "economy", contentType: "institutional_statement",
    materialSufficient: mode !== "insufficient", tags: ["货币政策"], subjects: ["central bank"],
    fact: mode === "insufficient" ? null : { title: "央行宣布降息", subject: "central bank", action: "announced", object: "rate cut", occurredAt: null,
      evidence: mode === "invented" ? "invented evidence" : body, conditions: [] } };
  else if (system.includes("五轴：")) response = { attentionScore: 80 };
  else response = { materialSufficient: true, titleZh: "央行宣布降息", summaryZh: "央行宣布降息 0.25 个百分点，下周一生效。", reasonZh: "提供利率调整幅度与生效时间。" };
  return { choices: [{ message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } };
});
process.env.LLM_BASE_URL = `${provider.url}/v1`;
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "local-world-fixture";
before(async () => {
  installModules([worldNewsModule]);
  await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world',${source},'fixture','rss',false)`;
  await sql`INSERT INTO section_budgets VALUES ('world','llm',100,100,100)`;
});
after(async () => { await provider.close(); installModules([]); await closeDb(); });
let count = 0;
async function article(excerpt: string | null = body, section = "world") {
  const id = `analysis-${T}-${++count}`;
  const sid = section === "world" ? source : `ai-${source}`;
  if (section === "ai") await sql`INSERT INTO sources (id,name,kind,enabled) VALUES (${sid},'AI','rss',false) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO articles (section_id,id,source_id,identity_key,url,title,excerpt,discovered_at,timeline_at)
    VALUES (${section},${id},${sid},${id},${`https://fixture.invalid/${id}`},'Policy announcement',${excerpt},now(),now())`;
  return id;
}

test("actual shared chat transport runs world prompts, independent scores, Chinese copy and scoped receipts", async () => {
  mode = "pass";
  const id = await article();
  const start = provider.hits();
  const result = await analyzeSectionArticle("world", id);
  assert.equal(result.relevance, "pass");
  assert.equal(provider.hits() - start, 5);
  const [saved] = await sql`SELECT selected,category,score,output,title_zh FROM analyses WHERE id=${result.analysisId}`;
  assert.equal(saved!.selected, false, "uncalibrated world rules never auto-select");
  assert.equal(saved!.category, "economy");
  assert.equal(Number(saved!.score), 80);
  assert.deepEqual(saved!.output.scores, [80, 80]);
  const scoring = requests.filter(r => r.system.includes("五轴："));
  assert.equal(scoring.length, 2);
  assert.equal(scoring[0]!.user, scoring[1]!.user, "no first score enters the second request");
  assert.ok(requests.every(r => r.system.includes("不可信材料")));
  assert.ok((await sql`SELECT section_id,status FROM receipts`).every(r => r.section_id === "world" && r.status === "completed"));
  await analyzeSectionArticle("world", id);
  assert.equal(provider.hits() - start, 5, "same revision reuses paid answers");
});

test("empty and title-only RSS materials wait without model calls or invented copy", async () => {
  for (const excerpt of [null, "Policy announcement"]) {
    const start = provider.hits();
    const result = await analyzeSectionArticle("world", await article(excerpt));
    assert.equal(result.relevance, "unknown");
    assert.deepEqual(result.receiptIds, []);
    assert.equal(provider.hits(), start);
    const [row] = await sql`SELECT title_zh,summary_zh FROM analyses WHERE id=${result.analysisId}`;
    assert.equal(row!.title_zh, null);
    assert.equal(row!.summary_zh, null);
  }
});

test("unrelated, unknown and insufficient material does not start scoring or writing", async () => {
  for (const state of ["block", "unknown", "insufficient"]) {
    mode = state;
    const start = provider.hits();
    const result = await analyzeSectionArticle("world", await article());
    assert.equal(result.relevance, state === "block" ? "block" : "unknown");
    assert.equal(provider.hits() - start, state === "insufficient" ? 2 : 1);
  }
});

test("unsupported evidence and cross-section resource are rejected before publication or extra spending", async () => {
  mode = "invented";
  const id = await article();
  await assert.rejects(analyzeSectionArticle("world", id), /unsupported/);
  assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id=${id}`).length, 0);
  const [failed] = await sql`SELECT processing_state FROM articles WHERE id=${id}`;
  assert.equal(failed!.processing_state, "failed");
  const ai = await article(body, "ai");
  const start = provider.hits();
  await assert.rejects(analyzeSectionArticle("world", ai), /mismatch/);
  assert.equal(provider.hits(), start);
});

test("world task producer and consumer reject forged section ownership and record a scoped run", async () => {
  mode = "pass";
  const ai = await article(body, "ai");
  const start = provider.hits();
  await assert.rejects(queueWorldAnalysis({ sectionId: "world", articleId: ai }), /mismatch/);
  await assert.rejects(runWorldAnalysisTask({ sectionId: "world", articleId: ai }), /mismatch/);
  await assert.rejects(runWorldAnalysisTask({ sectionId: "ai", articleId: ai }));
  await assert.rejects(runWorldAnalysisTask({ articleId: ai }));
  assert.equal(provider.hits(), start);
  const result = await runWorldAnalysisTask({ sectionId: "world", articleId: await article() });
  assert.equal(result.relevance, "pass");
  const rows = await sql`SELECT section_id,status FROM job_runs WHERE job='world-news.analyze'`;
  assert.ok(rows.every(row => row.section_id === "world"));
  assert.ok(rows.some(row => row.status === "ok"));
});
