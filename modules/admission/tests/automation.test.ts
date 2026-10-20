import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { reserveAdmission, admissionCost, BATCH, AdmissionBudgetError, extractAdmission } from "../backend/model.ts";
import { config } from "@aihot/backend/config";
import { stub } from "../../../tests/setup.ts";
import { publishResult, processDocument } from "../backend/automation.ts";
import { saveNotice, changePublication } from "../backend/store.ts";
import { readDaily } from "../backend/updates.ts";
import { readNotice } from "../backend/publication.ts";
import { htmlMaterial } from "../backend/sources.ts";
import { demoNotices } from "../backend/demo.ts";
test.after(closeDb);
test("5 CNY allowance is durable, atomic under contention and retains unknown charges", async () => {
  const results = await Promise.allSettled(Array.from({ length: 7 }, () => reserveAdmission(randomUUID(), 1)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 5);
  assert.ok(results.filter(r => r.status === "rejected").every(r => r.reason instanceof AdmissionBudgetError));
  assert.equal((await admissionCost()).accountedUpperCny, 5);
  // There is no date filter or restart reset: old, unknown reservations still consume the total.
  await sql`UPDATE admission_allowance SET created_at='2020-01-01' WHERE batch=${BATCH}`;
  await assert.rejects(reserveAdmission(randomUUID(), 0.01), AdmissionBudgetError);
  assert.equal((await admissionCost()).attempts, 5);
});
test("machine publication, revision, manual withdrawal and live digest respect the public version", async () => {
  const { id: _id, schoolId, source: _source, resources: _res, ...fields } = demoNotices[0];
  const quote = "2027年推荐免试硕士招生通知。具体报名和申请材料要求另行公布，请以学院官方通知为准。";
  const material = htmlMaterial(`<article>${quote.repeat(4)}</article>`, "https://yz.tsinghua.edu.cn/info/1024/test.htm");
  const extraction = { ...fields, opensOn: null, deadline: null, deadlineTime: null, eligibility: [], materials: [], evidence: ["year", "track", "stage", "summary"].map(field => ({ field, materialId: material.id, blockId: "block-1", quote })) };
  await sql`INSERT INTO admission_sources(school_id,config) VALUES(${schoolId},'{}')`;
  const row = { id: "test-document", school_id: schoolId, url: material.url, title: "2027年推荐免试硕士招生通知", published_on: "2026-09-01", notice_ids: [] as string[] };
  await sql`INSERT INTO admission_documents(id,school_id,url,title) VALUES(${row.id},${schoolId},${row.url},${row.title})`;
  for (const title of ["2027年接收推荐免试（直博）研究生说明", "关于推荐2027届优秀本科毕业生免试攻读研究生的办法"]) {
    await assert.rejects(publishResult({ ...row, title }, [extraction], [material], "invalid-scope"), /不属于硕士接收/);
  }
  const [id] = await publishResult(row, [extraction], [material], "revision-1");
  let notice = await readNotice(id); assert.equal(notice?.source.verification, "machine"); assert.equal(notice?.source.verified, false);
  assert.ok((await readDaily({})).changes.some(c => c.notice.id === id));
  const [updated] = await publishResult({ ...row, notice_ids: [id] }, [{ ...extraction, summary: "官方原文发生修订，这是一条用于测试的更新摘要。" }], [material], "revision-2");
  assert.equal(updated, id); notice = await readNotice(id); assert.match(notice!.summary, /发生修订/);
  await assert.rejects(saveNotice({ id, expectedVersion: notice!.version, notice: { ...fields, schoolId, source: notice!.source, resources: [] }, reason: "伪造机器身份" }, "admin"), /只能由/);
  await changePublication(id, "withdraw", { expectedVersion: notice!.version, reason: "人工撤回测试" }, "admin");
  await assert.rejects(publishResult({ ...row, notice_ids: [id] }, [extraction], [material], "revision-3"), /人工撤回/);
  assert.equal((await readDaily({})).changes.some(c => c.notice.id === id), false);
  assert.equal(await readNotice(id), null);
  await assert.rejects(publishResult(row, [{ ...extraction, batch: "atomic-rollback" }, extraction], [material], "revision-atomic"), /人工记录/);
  const [rolledBack] = await sql`SELECT count(*)::int AS count FROM admission_notices WHERE draft->>'batch'='atomic-rollback'`;
  assert.equal(rolledBack.count, 0, "a later conflict must roll back earlier notices and their change records");
  assert.equal((await processDocument(row.id)).status, "disabled");
});
test("model calls use receipts, reuse cached answers and charge unknown failures conservatively", async () => {
  await sql`DELETE FROM admission_allowance WHERE batch=${BATCH}`;
  const provider = await stub((_hit, req) => {
    const body = JSON.parse(req.body); assert.equal(body.max_tokens, 4500); assert.equal(body.model, "deepseek-flash");
    return { choices: [{ message: { content: JSON.stringify(body.messages[1].content.includes("bad-output") ? { invalid: true } : { relevant: false, reason: "测试材料不构成公告", notices: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };
  });
  const keys = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_EXTRA_JSON", "MODEL_CALLS_ENABLED"];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]])); const privateFetch = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  Object.assign(process.env, { LLM_BASE_URL: provider.url, LLM_API_KEY: "fake-key", LLM_MODEL: "deepseek-flash", LLM_EXTRA_JSON: "{}", MODEL_CALLS_ENABLED: "true" });
  try {
    const materials = [htmlMaterial(`<article>${"测试素材".repeat(30)}</article>`, "https://yz.tsinghua.edu.cn/test.htm")];
    const first = await extractAdmission("清华大学", "测试", "model-test", materials); assert.equal(first.reused, false);
    const again = await extractAdmission("清华大学", "测试", "model-test", materials); assert.equal(again.reused, true); assert.equal(provider.hits(), 1);
    assert.ok((await admissionCost()).accountedUpperCny < 0.001);
    await assert.rejects(extractAdmission("清华大学", "bad-output", "invalid-test", materials));
    const charged = await admissionCost(); assert.ok(charged.accountedUpperCny > 0.03); assert.equal(charged.attempts, 3);
    process.env.LLM_EXTRA_JSON = '{"max_tokens":100000}';
    await assert.rejects(extractAdmission("清华大学", "测试", "override", materials), /override/); assert.equal(provider.hits(), 2);
  } finally {
    config.allowPrivateNetworkFetch = privateFetch;
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    await provider.close();
  }
});
