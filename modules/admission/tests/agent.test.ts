import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { zipSync, strToU8 } from "fflate";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { stopBoss, getBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "@aihot/api/app";
import admission from "../server.ts";
import { schoolById } from "../schools.ts";
import { submitAgent, resolveAgentGoal, runAgent, commandAgent } from "../backend/agent.ts";
import { readAgents } from "../backend/publication.ts";
import { emptyAgentState, type AgentState } from "../backend/agent-planner.ts";
import { admissionCost, reserveAdmission } from "../backend/model.ts";
import { agentQueue, scheduleAdmissionAgents } from "../jobs.ts";
import { testNotices } from "./fixtures.ts";
import { stub } from "../../../tests/setup.ts";
import type { Material } from "@aihot/backend/documents/types";
import type { AgentGoal } from "@aihot/contracts/admission-agent";
installModules([admission]);
test.after(async () => { await stopBoss(); await closeDb(); });
const goal = { schoolId: "s002", keywords: ["计算机"], year: 2027, stages: ["pre"], urls: ["https://yz.tsinghua.edu.cn/seed.htm"], searchWeb: false };
test("web discovery reads a new faculty URL, persists searches, survives failure and never runs on public reads or old goals", async () => {
  const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(new URL("../../../packages/backend/package.json", import.meta.url))("undici");
  const dispatcher = getGlobalDispatcher(), mock = new MockAgent(); mock.disableNetConnect();
  const privateFetch = config.allowPrivateNetworkFetch, proxy = config.egressProxyUrl;
  const keys = ["COLLECT_ENABLED", "ADMISSION_AUTOMATION_ENABLED", "MODEL_CALLS_ENABLED"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let searches = 0, reads = 0, fail = false;
  mock.get("https://www.so.com").intercept({ path: /\/s\?/ }).reply(() => {
    searches++;
    return { statusCode: fail ? 503 : 200, data: '<li class="res-list"><h3><a data-mdurl="https://www.cs.tsinghua.edu.cn/new-notice.htm">计算机系2027年接收推免硕士研究生办法</a></h3></li>' };
  }).persist();
  for (const host of ["https://www.cs.tsinghua.edu.cn", "https://yz.tsinghua.edu.cn"]) mock.get(host).intercept({ path: /.*/ }).reply(() => {
    reads++; return { statusCode: 200, data: `<title>计算机系2027年接收推免硕士研究生办法</title><article>${"2027年计算机系接收推免硕士研究生，优秀应届本科生提交成绩单，具体申请安排见本通知。".repeat(5)}</article>`, responseOptions: { headers: { "content-type": "text/html; charset=utf-8" } } };
  }).persist();
  const insert = async (value: AgentGoal, state = emptyAgentState(1, value.urls)) => {
    const id = randomUUID();
    await sql`INSERT INTO admission_sources(school_id,config) VALUES(${value.schoolId},${sql.json({ schoolId: value.schoolId, urls: value.urls })}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO admission_agent_tasks(id,identity,goal,state) VALUES(${id},${id},${sql.json(value)},${sql.json(state)})`;
    return id;
  };
  try {
    config.allowPrivateNetworkFetch = true; config.egressProxyUrl = null; setGlobalDispatcher(mock);
    Object.assign(process.env, { COLLECT_ENABLED: "true", ADMISSION_AUTOMATION_ENABLED: "true", MODEL_CALLS_ENABLED: "false" });
    assert.equal(resolveAgentGoal({ ...goal, searchWeb: undefined }).searchWeb, true);
    const before = await admissionCost(), id = await insert({ ...goal, stages: ["pre"], searchWeb: true });
    await readAgents({ ids: id }); assert.equal(searches, 0); assert.equal(reads, 0);
    assert.equal((await runAgent(id)).status, "awaiting-model", JSON.stringify(await readAgents({ ids: id })));
    let task = (await readAgents({ ids: id })).items[0];
    assert.equal(searches, 2); assert.equal(task.search?.links.length, 1);
    assert.ok(task.steps.some(step => step.stage === "read" && step.url === "https://www.cs.tsinghua.edu.cn/new-notice.htm"));
    assert.equal(task.notices.length, 0);
    const count = reads; await runAgent(id); await readAgents({ ids: id });
    assert.equal(searches, 2); assert.equal(reads, count); assert.deepEqual(await admissionCost(), before);
    // A crash after dispatch is explicit failure, not an implicit repeat of an external request.
    const state = emptyAgentState(1, goal.urls); state.search = structuredClone(task.search!);
    state.search.queries[0].status = "running";
    const interrupted = await insert({ ...goal, stages: ["pre"], searchWeb: true }, state);
    await runAgent(interrupted); task = (await readAgents({ ids: interrupted })).items[0];
    assert.equal(searches, 2); assert.equal(task.search!.queries[0].status, "failed");
    assert.ok(task.gaps.some(gap => gap.includes("搜索覆盖不完整")));
    fail = true; const failed = await insert({ ...goal, stages: ["pre"], searchWeb: true });
    await runAgent(failed); task = (await readAgents({ ids: failed })).items[0];
    assert.ok(task.search!.queries.every(query => query.status === "failed"));
    assert.ok(task.steps.some(step => step.stage === "read" && step.status === "ready"));
    const total = searches, { searchWeb: _, ...oldGoal } = goal;
    await runAgent(await insert({ ...oldGoal, stages: ["pre"] })); assert.equal(searches, total);
    assert.deepEqual(await admissionCost(), before);
  } finally {
    setGlobalDispatcher(dispatcher); config.allowPrivateNetworkFetch = privateFetch; config.egressProxyUrl = proxy;
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    await mock.close();
  }
});
test("goals normalize, deduplicate atomically, enforce official inputs, and public reads never schedule models", async () => {
  const submissions = await Promise.all(Array.from({ length: 4 }, () => submitAgent(goal)));
  assert.equal(new Set(submissions.map(s => s.id)).size, 1);
  assert.equal(submissions.filter(s => !s.reused).length, 1);
  assert.deepEqual(resolveAgentGoal({ ...goal, keywords: ["计算机", "计算机"] }).keywords, ["计算机"]);
  const { schoolId: _, ...byName } = goal;
  assert.equal(resolveAgentGoal({ ...byName, source: "清华大学", keywords: [] }).schoolId, goal.schoolId);
  assert.deepEqual(resolveAgentGoal({ ...byName, source: "https://www.cs.tsinghua.edu.cn/rules.htm", urls: [] }).urls, ["https://www.cs.tsinghua.edu.cn/rules.htm"]);
  assert.equal(resolveAgentGoal({ ...byName, source: "清华大学", track: "kaoyan", stages: ["prospectus"] }).track, "kaoyan");
  assert.throws(() => resolveAgentGoal({ ...goal, source: "北京大学" }), /不一致/);
  assert.throws(() => resolveAgentGoal({ ...goal, track: "kaoyan" }), /不一致/);
  assert.throws(() => resolveAgentGoal({ ...byName, source: "不存在的学校" }), /未匹配/);
  for (const url of ["http://127.0.0.1/", "https://pku.edu.cn/", "https://tsinghua.edu.cn:8080/", "https://tsinghua.edu.cn/a?session=x"]) assert.throws(() => resolveAgentGoal({ ...goal, urls: [url] }));
  const app = await buildApp();
  try {
    const before = await admissionCost();
    const read = await app.inject(`/api/v1/admissions/agents?ids=${submissions[0].id}`);
    assert.equal(read.statusCode, 200); assert.equal(read.json().items[0].steps.length, 0);
    assert.equal((await app.inject("/api/v1/admissions/agents?ids=wrong")).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/admissions/agents", payload: goal, headers: { origin: "https://evil.example" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: `/api/admin/admissions/agents/${submissions[0].id}`, payload: { action: "pause" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/admissions/agents", payload: goal })).statusCode, 202);
    assert.deepEqual(await admissionCost(), before);
  } finally { await app.close(); }
});

test("queued agent walks faculty, parses attachments, supplements missing requirements, preserves checkpoints and publishes only evidenced versions", async () => {
  await sql`UPDATE admission_agent_tasks SET enabled=false`;
  const school = schoolById.get("s002")!, website = school.website, privateFetch = config.allowPrivateNetworkFetch;
  const keys = ["COLLECT_ENABLED", "ADMISSION_AUTOMATION_ENABLED", "MODEL_CALLS_ENABLED", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_EXTRA_JSON"];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  let changed = false; const hits = new Map<string, number>(), readOrder: string[] = [];
  const quote = "2027年计算机学院计算机科学与技术接收预推免硕士研究生，预推免批次。申请人为优秀应届本科生，需提交成绩单。截止日期另行公布，具体安排见补充细则。";
  const finalQuote = "2027年计算机学院计算机科学与技术预推免补充批次硕士招生。报名截止2026年9月20日17:00，申请人为优秀应届本科生，需提交成绩单。";
  const examQuote = "2027年计算机学院计算机科学与技术硕士研究生统考招生简章，统考批次。报考人为本科毕业生，需提交学历证明，具体申请日期待公布。";
  const docx = Buffer.from(zipSync({ "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${quote.repeat(2)}</w:t></w:r></w:p></w:body></w:document>`) }));
  const server = createServer((req, res) => {
    const path = req.url!; hits.set(path, (hits.get(path) ?? 0) + 1); readOrder.push(path);
    if (path === "/form.docx") { res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); res.end(docx); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const body = path === "/seed" ? `<h1>研究生招生</h1><p>${"官方网站招生入口。".repeat(15)}</p><a href="/departments">各学院接收推免细则汇总</a>`
      : path === "/departments" ? `<h1>各学院推免细则汇总</h1><p>${"请查看各学院规则。".repeat(15)}</p><a href="/cs">计算机学院</a>`
      : path === "/cs" ? `<h1>计算机学院</h1><p>${"学院官网招生栏目。".repeat(15)}</p><a href="/notice">接收推免生办法</a><a href="/cs">下一页</a><a href="http://127.0.0.2/private">计算机推免办法</a>`
      : path === "/notice" || path === "/budgetnotice" ? `<h1>2027年计算机学院接收预推免办法</h1><article>${quote.repeat(3)}${changed ? "本公告文字修订。" : ""}<a href="/form.docx">申请材料附件</a><a href="/supplement">计算机学院预推免补充细则</a></article>`
      : path === "/supplement" ? `<h1>2027年计算机学院预推免补充细则</h1><article>${finalQuote.repeat(3)}</article>`
      : path === "/exam" ? `<h1>2027年计算机学院硕士研究生招生简章</h1><article>${examQuote.repeat(3)}</article>` : "";
    if (!body) res.statusCode = 404; res.end(body);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const provider = await stub((_hit, req) => {
    const input = JSON.parse(JSON.parse(req.body).messages[1].content), materials = input.materials as Material[];
    if (materials[0].url.endsWith("form.docx")) return { choices: [{ message: { content: JSON.stringify({ relevant: false, reason: "只是申请表参考附件", notices: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
    const exam = materials[0].url.endsWith("/exam"), final = materials[0].url.endsWith("supplement"), text = exam ? examQuote : final ? finalQuote : quote;
    const material = materials.find(m => m.blocks.some(b => b.text.includes(text)))!, block = material.blocks.find(b => b.text.includes(text))!;
    const { id: _id, schoolId: _schoolId, resources: _resources, source: _source, ...fields } = testNotices[0];
    const notice = { ...fields, title: input.title, department: "计算机学院", programme: "计算机科学与技术", batch: final ? "补充批次" : "预推免批次", stage: "pre", year: 2027,
      summary: changed ? "学院官网文字已修订，具体申请要求以本批次官方通知为准。" : "学院公布了预推免接收要求，请核对对应批次的原文和附件。", opensOn: null, deadline: final ? "2026-09-20" : null, deadlineTime: final ? "17:00" : null,
      dateNote: final ? "以补充批次为准" : "日期另行公布", eligibility: ["优秀应届本科生"], materials: ["成绩单"],
      evidence: ["year", "track", "stage", "summary", "department", "programme", "batch", "eligibility.0", "materials.0", ...(final ? ["deadline", "deadlineTime"] : [])].map(field => ({ field, materialId: material.id, blockId: block.id, quote: text })) };
    if (exam) Object.assign(notice, { track: "kaoyan", stage: "prospectus", batch: "统考批次", eligibility: ["本科毕业生"], materials: ["学历证明"], summary: "学院公布了硕士研究生统考招生简章，具体条件以原文为准。" });
    return { choices: [{ message: { content: JSON.stringify({ relevant: true, reason: "合成官方材料", notices: [notice] }) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } };
  });
  const id = randomUUID(), testGoal: AgentGoal = { ...goal, stages: ["pre"], urls: [base + "/seed"] };
  try {
    config.allowPrivateNetworkFetch = true; school.website = base;
    Object.assign(process.env, { COLLECT_ENABLED: "true", ADMISSION_AUTOMATION_ENABLED: "true", MODEL_CALLS_ENABLED: "true", LLM_BASE_URL: provider.url, LLM_API_KEY: "test-key", LLM_MODEL: "deepseek-flash", LLM_EXTRA_JSON: "{}" });
    await sql`INSERT INTO admission_agent_tasks(id,identity,goal,state) VALUES(${id},${id},${sql.json(testGoal)},${sql.json(emptyAgentState(1, testGoal.urls))})`;
    assert.equal((await scheduleAdmissionAgents()).enqueued, 1);
    const boss = await getBoss(), jobs = await boss.fetch<{ taskId: string }>(agentQueue.name);
    assert.equal(jobs.length, 1); await agentQueue.run(jobs.map(j => j.data)); await boss.complete(agentQueue.name, jobs[0].id);
    let task = (await readAgents({ ids: id })).items[0]; assert.equal(task.status, "queued"); assert.equal(task.stats.pages, 2);
    // Each invocation reads the durable row again, exactly as a new worker after a restart would.
    for (let n = 0; n < 8 && task.status === "queued"; n++) { await runAgent(id); task = (await readAgents({ ids: id })).items[0]; }
    assert.equal(task.notices.length, 2, JSON.stringify(task));
    assert.equal(task.brief?.state, "ready"); assert.equal(task.brief.items.length, 2);
    assert.ok(task.brief.items.every(item => item.notice.source.verification === "machine" && item.notice.source.evidence && item.notice.source.url.startsWith(base)));
    const firstNotice = task.notices[0].id, [published] = await sql`SELECT published FROM admission_notices WHERE id=${firstNotice}`;
    const beforeReads = provider.hits(); await readAgents({ ids: id }); assert.equal(provider.hits(), beforeReads);
    await sql`UPDATE admission_notices SET published=NULL WHERE id=${firstNotice}`;
    assert.equal((await readAgents({ ids: id })).items[0].brief?.items.some(item => item.notice.id === firstNotice), false, "withdrawn notices must disappear from reports immediately");
    await sql`UPDATE admission_notices SET published=${sql.json(published.published)} WHERE id=${firstNotice}`;
    assert.ok(task.steps.some(s => s.stage === "supplement"));
    assert.ok(task.steps.some(s => s.detail.includes("2份")), "HTML and actual DOCX attachment were read together");
    assert.equal(hits.has("/private"), false); assert.ok((hits.get("/cs") ?? 0) < 3);
    assert.equal((await sql`SELECT count(*)::int AS n FROM admission_changes`)[0].n, 2);
    const calls = provider.hits(); await runAgent(id);
    for (let n = 0; n < 8; n++) { task = (await readAgents({ ids: id })).items[0]; if (task.status !== "queued") break; await runAgent(id); }
    assert.equal(provider.hits(), calls, "unchanged materials do not invoke a model");
    // Simulate interruption after saving the last candidate, with no remaining network frontier.
    // Three saved candidates require two worker invocations; neither may reset the cycle or refetch.
    const [saved] = await sql<{ state: AgentState }[]>`SELECT state FROM admission_agent_tasks WHERE id=${id}`;
    assert.equal(saved.state.pages.filter(p => p.candidate).length, 3);
    for (const page of saved.state.pages) if (page.candidate) page.status = "collected";
    saved.state.frontier = [];
    const savedCycle = saved.state.cycle, savedHits = [...hits];
    await sql`UPDATE admission_agent_tasks SET state=${sql.json(saved.state)},status='failed' WHERE id=${id}`;
    assert.equal((await runAgent(id)).status, "queued", "remaining snapshots must not be lost at finalization");
    assert.equal((await readAgents({ ids: id })).items[0].cycle, savedCycle);
    await runAgent(id);
    const [resumed] = await sql<{ state: AgentState }[]>`SELECT state FROM admission_agent_tasks WHERE id=${id}`;
    assert.equal(resumed.state.cycle, savedCycle);
    assert.equal(resumed.state.pages.filter(p => p.status === "collected").length, 0);
    assert.deepEqual([...hits], savedHits); assert.equal(provider.hits(), calls);
    assert.equal((await sql`SELECT count(*)::int AS n FROM admission_changes`)[0].n, 2, "crash replay must not republish versions");
    changed = true; await runAgent(id); for (let n = 0; n < 8; n++) { if ((await readAgents({ ids: id })).items[0].status !== "queued") break; await runAgent(id); }
    assert.equal(provider.hits(), calls + 1); assert.equal((await readAgents({ ids: id })).items[0].notices.length, 2);
    await commandAgent(id, { action: "pause" }, "test"); assert.equal((await runAgent(id)).status, "paused");
    assert.equal((await scheduleAdmissionAgents()).enqueued, 0);
    // Same pipeline supports a school-wide exam brief, not just a different form label.
    const examId = randomUUID(), examGoal: AgentGoal = { ...testGoal, keywords: [], track: "kaoyan", stages: ["prospectus"], urls: [base + "/exam"] };
    await sql`INSERT INTO admission_agent_tasks(id,identity,goal,state) VALUES(${examId},${examId},${sql.json(examGoal)},${sql.json(emptyAgentState(1, examGoal.urls))})`;
    await runAgent(examId);
    const examTask = (await readAgents({ ids: examId })).items[0];
    assert.equal(examTask.brief?.state, "ready", JSON.stringify(examTask));
    assert.equal(examTask.brief.items[0].notice.track, "kaoyan"); assert.match(examTask.brief.title, /考研简报/);
    await commandAgent(examId, { action: "pause" }, "test");
    // Preserve the cumulative allowance and already read material when model funds are exhausted.
    await reserveAdmission(randomUUID(), 4.99);
    await sql`UPDATE admission_agent_tasks SET state=${sql.json(emptyAgentState(9, [base + "/budgetnotice"]))},status='queued',enabled=true WHERE id=${id}`;
    const before = provider.hits(); await runAgent(id);
    task = (await readAgents({ ids: id })).items[0];
    assert.equal(task.status, "budget-paused", "budget stop must be visible after the first blocked page");
    assert.equal(task.stats.pages, 1);
    assert.ok(task.stats.remaining > 0, "unread supplementary links remain checkpointed while paused");
    assert.ok(task.gaps.every(gap => !gap.includes("本轮已达页面")), "a budget pause is not a crawl limit");
    for (let n = 0; n < 5 && (await readAgents({ ids: id })).items[0].status === "queued"; n++) await runAgent(id);
    task = (await readAgents({ ids: id })).items[0]; assert.equal(task.status, "budget-paused"); assert.equal(provider.hits(), before);
    assert.ok(task.gaps.length > 0); assert.ok((await admissionCost()).accountedUpperCny >= 4.99);
    const reads = hits.get("/budgetnotice");
    process.env.MODEL_CALLS_ENABLED = "false";
    await commandAgent(id, { action: "resume" }, "test"); await runAgent(id);
    assert.equal(hits.get("/budgetnotice"), reads, "resume uses saved material rather than fetching the page again");
    assert.equal((await readAgents({ ids: id })).items[0].status, "awaiting-model");
    assert.equal(provider.hits(), before);
    const pending = emptyAgentState(10, [base + "/supplement"]); pending.frontier[0].priority = 3;
    await sql`UPDATE admission_agent_tasks SET state=${sql.json(pending)},status='partial' WHERE id=${id}`;
    const offset = readOrder.length; await runAgent(id);
    assert.deepEqual(readOrder.slice(offset, offset + 2), ["/supplement", "/seed"], "carry-over faculty links run first; previously extracted material can be reused without a model call");
    assert.ok((await readAgents({ ids: id })).items[0].stats.remaining > 0);
    await sql`UPDATE admission_agent_tasks SET state=${sql.json(emptyAgentState(10, [base + "/missing"]))},status='queued' WHERE id=${id}`;
    await runAgent(id); task = (await readAgents({ ids: id })).items[0]; assert.equal(task.status, "failed"); assert.equal(task.stats.failed, 1);
  } finally {
    school.website = website; config.allowPrivateNetworkFetch = privateFetch;
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await provider.close();
  }
});
