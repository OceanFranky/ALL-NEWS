import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "@aihot/api/app";
import admission from "../server.ts";
import { schoolById } from "../schools.ts";
import { resolveOfficialImport, submitImport, commandImport, runImport } from "../backend/imports.ts";
import { readImports } from "../backend/publication.ts";
import { admissionCost, reserveAdmission } from "../backend/model.ts";
import { scheduleAdmissions, importQueue } from "../jobs.ts";
import { stub } from "../../../tests/setup.ts";
installModules([admission]);
test.after(async () => { await stopBoss(); await closeDb(); });

test("official submissions are normalized, deduplicated under contention and bounded without fetching", async () => {
  const value = { url: "https://yz.tsinghua.edu.cn/notice.htm?utm_source=test#top", kind: "notice" };
  assert.equal(resolveOfficialImport(value).url, "https://yz.tsinghua.edu.cn/notice.htm");
  for (const url of ["http://127.0.0.1/", "https://pku.edu.cn.evil.example/", "file:///etc/passwd", "https://user:pass@pku.edu.cn/", "https://pku.edu.cn:8081/", "https://pku.edu.cn/a?token=private"]) assert.throws(() => resolveOfficialImport({ ...value, url }));
  const results = await Promise.all(Array.from({ length: 5 }, () => submitImport(value)));
  assert.equal(new Set(results.map(r => r.id)).size, 1); assert.equal(results.filter(r => !r.reused).length, 1);
  await assert.rejects(submitImport({ ...value, kind: "listing" }), /另一种类型/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM admission_documents`)[0].n, 0);
  assert.equal((await admissionCost()).attempts, 0);
  await sql`INSERT INTO admission_imports(school_id,url,kind) SELECT 's002','https://yz.tsinghua.edu.cn/limit/'||i,'notice' FROM generate_series(1,29) i`;
  await assert.rejects(submitImport({ ...value, url: "https://yz.tsinghua.edu.cn/over-limit" }), /较多/);
  assert.equal((await submitImport(value)).reused, true, "existing tasks are recoverable at the limit");
});

test("public API reads create no work, cross-origin submissions and unauthorized admin commands are rejected", async () => {
  await sql`DELETE FROM admission_imports`;
  const app = await buildApp(); const before = await admissionCost();
  try {
    assert.equal((await app.inject("/api/v1/admissions/imports")).json().items.length, 0);
    assert.equal((await app.inject("/api/v1/admissions/imports?ids=wrong")).statusCode, 400);
    const payload = { url: "https://yz.tsinghua.edu.cn/api-test.htm", kind: "notice" };
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/admissions/imports", headers: { origin: "https://evil.example" }, payload })).statusCode, 403);
    const response = await app.inject({ method: "POST", url: "/api/v1/admissions/imports", payload });
    assert.equal(response.statusCode, 202); const { id } = response.json();
    await sql`UPDATE admission_imports SET error='private-fetch-diagnostic',status='failed' WHERE id=${id}`;
    const publicRow = (await app.inject(`/api/v1/admissions/imports?ids=${id}`)).json().items[0];
    assert.equal(publicRow.url, payload.url); assert.ok(!publicRow.message.includes("private-fetch-diagnostic"));
    assert.equal((await app.inject("/api/admin/admissions/imports")).statusCode, 401);
    const previous = config.devAdmin; config.devAdmin = { displayName: "imports-test" };
    try {
      const me = (await app.inject("/api/admin/me")).json();
      const path = `/api/admin/admissions/imports/${id}`;
      assert.equal((await app.inject({ method: "POST", url: path, payload: { action: "pause" } })).statusCode, 403);
      assert.equal((await app.inject({ method: "POST", url: path, headers: { "x-csrf-token": me.csrf }, payload: { action: "pause" } })).statusCode, 200);
      assert.equal((await readImports({ ids: id })).items[0].enabled, false);
      assert.match((await readImports({}, true)).items[0].message, /private-fetch-diagnostic/);
    } finally { config.devAdmin = previous; }
    assert.deepEqual(await admissionCost(), before);
  } finally { await app.close(); }
});

test("admin changes cannot race an active importer", async () => {
  const [row] = await sql`SELECT id FROM admission_imports LIMIT 1`;
  const connection = await sql.reserve();
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended(${`admission-import:${row.id}`},0))`;
    await assert.rejects(commandImport(row.id, { action: "retry" }, "test"), /正在处理/);
  } finally { await connection`SELECT pg_advisory_unlock(hashtextextended(${`admission-import:${row.id}`},0))`; connection.release(); }
  await commandImport(row.id, { action: "retry" }, "test");
  assert.equal((await sql`SELECT force_retry FROM admission_imports WHERE id=${row.id}`)[0].force_retry, true);
});

test("real queue imports a local listing, retains budget-paused materials and reuses successful extraction", async () => {
  const year = new Date().getUTCFullYear() + 1;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/listing") return res.end(`<a href="/notice">${year}年计算机学院硕士研究生招生简章</a><a href="/roster">${year}年硕士研究生拟录取名单公示</a>`);
    res.end(`<title>${year}年计算机学院硕士研究生招生简章</title><article>${"申请材料和报考条件详见学院正式公告，请核对原文。".repeat(10)}</article>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const provider = await stub(() => ({ choices: [{ message: { content: JSON.stringify({ relevant: false, reason: "本地测试材料不构成招生机会", notices: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  const school = schoolById.get("s002")!, website = school.website, privateFetch = config.allowPrivateNetworkFetch;
  const keys = ["COLLECT_ENABLED", "ADMISSION_AUTOMATION_ENABLED", "MODEL_CALLS_ENABLED", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_EXTRA_JSON"];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    config.allowPrivateNetworkFetch = true; school.website = url;
    Object.assign(process.env, { COLLECT_ENABLED: "true", ADMISSION_AUTOMATION_ENABLED: "true", MODEL_CALLS_ENABLED: "true", LLM_BASE_URL: provider.url, LLM_API_KEY: "test-key", LLM_MODEL: "deepseek-flash", LLM_EXTRA_JSON: "{}" });
    await sql`UPDATE admission_imports SET enabled=false`;
    const id = randomUUID();
    await sql`INSERT INTO admission_imports(id,school_id,url,kind) VALUES(${id},'s002',${url + "/listing"},'listing')`;
    await reserveAdmission(randomUUID(), 5);
    assert.equal((await scheduleAdmissions()).enqueued, 1);
    const boss = await getBoss(); const jobs = await boss.fetch<{ importId: string }>(importQueue.name);
    assert.equal(jobs.length, 1); await importQueue.run(jobs.map(j => j.data));
    await boss.complete(importQueue.name, jobs[0].id);
    const [item] = (await readImports({ ids: id })).items;
    assert.equal(item.stats.documents, 1); assert.ok(item.stats.characters! > 100); assert.equal(item.documentStates["budget-paused"], 1);
    assert.match(item.message, /额度不足/); assert.equal(provider.hits(), 0); assert.equal((await admissionCost()).accountedUpperCny, 5);
    process.env.MODEL_CALLS_ENABLED = "false"; await runImport(id);
    assert.equal((await readImports({ ids: id })).items[0].documentStates["awaiting-model"], 1);
    // Test databases only: release the simulated exhausted allowance to exercise the local model stub.
    await sql`DELETE FROM admission_allowance`; process.env.MODEL_CALLS_ENABLED = "true";
    await runImport(id); await runImport(id);
    assert.equal(provider.hits(), 1); assert.equal((await readImports({ ids: id })).items[0].documentStates.irrelevant, 1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM admission_snapshots`)[0].n, 1);
    await commandImport(id, { action: "pause" }, "test"); assert.equal((await runImport(id)).status, "paused");
  } finally {
    school.website = website; config.allowPrivateNetworkFetch = privateFetch;
    for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await provider.close();
  }
});
