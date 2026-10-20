import { stub } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { BudgetExceededError, paidRequest, ProviderRejectedError, releaseUnknownReceipt } from "@aihot/backend/providers/receipts";
import { dailyMoneyRetryAfter, reserveSectionModelCost } from "@aihot/backend/providers/section-money";
import { SERVER_MODULES, WORKER_MODULES } from "@aihot/site/modules/server";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { runWorldBudgeted, worldGroupQueue } from "../modules/world-news/jobs.ts";
import { chatJson } from "@aihot/backend/providers/llm";
import { z } from "zod";

const policy = { limitCny: 5, startedAt: new Date(0).toISOString(), service: "llm", model: "local-model", endpointHost: "fixture.invalid",
  inputPerMillionCny: 2, outputPerMillionCny: 8, reference: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/" };
const request = (identity: string, sectionId: "ai" | "world" = "ai", reservedCostCny = 1) => ({
  service: "llm", model: "local-model", purpose: "daily-money-test", identity, sectionId, reservedCostCny,
  ...(sectionId === "world" ? { resource: { kind: "source" as const, id: "daily-money-source" } } : {}),
});
before(async () => {
  await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES ('world','daily-money-source','Local','rss',false)`;
  await sql`INSERT INTO section_budgets VALUES ('world','llm',100,100,100)`;
});
beforeEach(async () => {
  await sql`DELETE FROM receipts`;
  await sql`INSERT INTO settings (key,value) VALUES ('providers.daily_spend',${sql.json(policy)}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
});
after(async () => { await stopBoss(); await closeDb(); });

test("AI and world concurrent attempts share one daily ceiling and saved answers remain reusable", async () => {
  let calls = 0;
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => paidRequest(request(`parallel-${index}`, index % 2 ? "world" : "ai"), async () => ({ response: ++calls }))));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 5);
  assert.equal(calls, 5);
  assert(results.some(result => result.status === "rejected" && result.reason instanceof BudgetExceededError));
  const successful = results.findIndex(result => result.status === "fulfilled");
  assert.equal((await paidRequest(request(`parallel-${successful}`, successful % 2 ? "world" : "ai"), async () => ({ response: ++calls }))).reused, true);
  assert.equal(calls, 5);
  const [usage] = await sql`SELECT count(*)::int AS attempts,sum((r.request->>'reservedCostCny')::numeric)::float8 AS reserved FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id`;
  assert.equal(usage!.attempts, 5);
  assert.equal(usage!.reserved, 5);
});

test("unknown, refused and retried calls all retain their monetary reservation", async () => {
  let calls = 0;
  await assert.rejects(paidRequest(request("unknown"), async () => { calls++; throw new Error("lost response"); }), /lost response/);
  const [receipt] = await sql`SELECT id FROM receipts WHERE status='unknown'`;
  await releaseUnknownReceipt(sql, Number(receipt!.id), "Local fake billing checked", "ai");
  await paidRequest(request("unknown"), async () => ({ response: ++calls }));
  await assert.rejects(paidRequest(request("refused", "world"), async () => { calls++; throw new ProviderRejectedError("refused", 400, false); }), /refused/);
  await paidRequest(request("refused", "world"), async () => ({ response: ++calls }));
  await paidRequest(request("last"), async () => ({ response: ++calls }));
  await assert.rejects(paidRequest(request("exhausted", "world"), async () => ({ response: ++calls })), BudgetExceededError);
  assert.equal(calls, 5);
});

test("Beijing midnight renews the allowance without resetting history, regardless of database time zone", async () => {
  await paidRequest(request("yesterday", "ai", 5), async () => ({ response: true }));
  await assert.rejects(paidRequest(request("blocked"), async () => ({ response: true })), BudgetExceededError);
  await sql`UPDATE receipt_attempts SET started_at=(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')-interval '1 second'`;
  await sql.begin(async transaction => {
    await transaction`SET LOCAL TIME ZONE 'America/Los_Angeles'`;
    assert.equal(await dailyMoneyRetryAfter(transaction, "llm", "local-model", 5), null);
  });
  await paidRequest(request("today", "world", 5), async () => ({ response: true }));
  await assert.rejects(paidRequest(request("today-full"), async () => ({ response: true })), BudgetExceededError);
  assert.equal((await sql`SELECT count(*)::int AS count FROM receipt_attempts`)[0]!.count, 2);
});

test("uncovered, unbounded, future-dated policies and unknown prior reservations fail before spending", async () => {
  let calls = 0;
  await assert.rejects(paidRequest({ ...request("no-bound"), reservedCostCny: undefined }, async () => ({ response: ++calls })), /bounded paid request/);
  await assert.rejects(paidRequest({ ...request("wrong-model"), model: "another" }, async () => ({ response: ++calls })), /bounded paid request/);
  const input = { service: "llm", model: "local-model", endpoint: "https://fixture.invalid/v1", system: "规则", user: "材料", maxTokens: 1000 };
  assert.equal(await reserveSectionModelCost(undefined, input), await reserveSectionModelCost("world", input));
  await assert.rejects(reserveSectionModelCost("ai", { ...input, endpoint: "https://other.invalid" }), /does not cover/);
  await assert.rejects(reserveSectionModelCost("ai", { ...input, maxTokens: Infinity }), /bounded output/);
  assert.equal(calls, 0);
  await paidRequest(request("legacy-unbounded"), async () => ({ response: true }));
  await sql`UPDATE receipts SET request='{}'::jsonb`;
  await assert.rejects(paidRequest(request("blocked-by-history"), async () => ({ response: ++calls })), BudgetExceededError);
  await sql`UPDATE settings SET value=${sql.json({ ...policy, startedAt: "2099-01-01T00:00:00Z" })} WHERE key='providers.daily_spend'`;
  await assert.rejects(paidRequest(request("future-policy"), async () => ({ response: ++calls })), /cannot start in the future/);
  assert.equal(calls, 0);
});

test("news worker excludes competition automation without removing its API module", () => {
  assert.deepEqual(WORKER_MODULES.map(module => module.name), ["world-news"]);
  assert.deepEqual(SERVER_MODULES.map(module => module.name), ["world-news", "competition", "learning-resources"]);
});

test("successful bounded token usage settles conservatively while unresolved attempts retain full reservation", async () => {
  await paidRequest(request("known-usage", "ai", 5), async () => ({ response: true, usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  await paidRequest(request("unresolved-usage", "world", 4.99), async () => ({ response: true }));
  await assert.rejects(paidRequest(request("over-settled-budget", "ai", 0.02), async () => ({ response: true })), BudgetExceededError);
  assert.equal((await sql`SELECT count(*)::int AS count FROM receipt_attempts`)[0]!.count, 2);
});

test("a legacy failed request receives a bounded reservation before its first daily-budget retry", async () => {
  await sql`DELETE FROM settings WHERE key='providers.daily_spend'`;
  await assert.rejects(paidRequest({ ...request("legacy-retry"), reservedCostCny: undefined }, async () => { throw new ProviderRejectedError("refused", 400, false); }), /refused/);
  await sql`UPDATE receipt_attempts SET started_at=now()-interval '1 day'`;
  await sql`INSERT INTO settings (key,value) VALUES ('providers.daily_spend',${sql.json(policy)})`;
  await paidRequest(request("legacy-retry"), async () => ({ response: true }));
  assert.equal(Number((await sql`SELECT request->>'reservedCostCny' AS reserved FROM receipts`)[0]!.reserved), 1);
  await sql.begin(async transaction => assert.equal(await dailyMoneyRetryAfter(transaction, "llm", "local-model", 4), null));
});

test("AI and world chat calls reserve before local HTTP and reject price-bound overrides", async () => {
  const provider = await stub(() => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }));
  const keys = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_EXTRA_JSON", "LLM_REASONING_TOKENS"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.LLM_BASE_URL = provider.url;
    process.env.LLM_API_KEY = "local-test-key";
    process.env.LLM_MODEL = "local-model";
    process.env.LLM_EXTRA_JSON = "{}";
    process.env.LLM_REASONING_TOKENS = "0";
    await sql`UPDATE settings SET value=${sql.json({ ...policy, endpointHost: "127.0.0.1" })} WHERE key='providers.daily_spend'`;
    for (const sectionId of ["ai", "world"] as const) {
      const result = await chatJson({ model: "default", sectionId,
        ...(sectionId === "world" ? { resource: { kind: "source" as const, id: "daily-money-source" } } : {}),
        purpose: "daily-chat-test", subject: sectionId, promptVersion: "test", system: "规则", user: "实际像素以外的本地文字", maxTokens: 512, schema: z.object({ ok: z.boolean() }) });
      assert.equal(result.data.ok, true);
    }
    assert.equal((await sql`SELECT count(*)::int AS count FROM receipts WHERE request->>'reservedCostCny' IS NOT NULL`)[0]!.count, 2);
    for (const extra of [{ model: "another" }, { max_tokens: 1000000 }, { messages: [] }]) {
      process.env.LLM_EXTRA_JSON = JSON.stringify(extra);
      await assert.rejects(chatJson({ model: "default", purpose: "bad-extra", subject: "bad", promptVersion: "test", system: "规则", user: "材料", maxTokens: 512, schema: z.object({}) }), /overrides unbounded/);
    }
    process.env.LLM_EXTRA_JSON = "{}";
    await assert.rejects(chatJson({ model: "default", purpose: "image", subject: "image", promptVersion: "test", system: "规则",
      user: [{ type: "image_url", image_url: { url: "https://fixture.invalid/image.png" } }], maxTokens: 512, schema: z.object({}) }), /text-only/);
    assert.equal((await sql`SELECT count(*)::int AS count FROM receipts`)[0]!.count, 2);
    assert.equal(provider.hits(), 2);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await provider.close();
  }
});

test("world budget exhaustion defers work without provider calls or immediate retry loops", async () => {
  await getBoss();
  const task = { sectionId: "world" as const, articleId: "local-budget-article" };
  let calls = 0;
  const exhausted = async () => { calls++; throw new BudgetExceededError("llm", "daily-money", 3600); };
  await runWorldBudgeted(worldGroupQueue, [task], exhausted);
  await runWorldBudgeted(worldGroupQueue, [task], exhausted);
  const rows = await sql`SELECT data,start_after FROM pgboss.job WHERE name='world-news.group' AND state='created'`;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.data, task);
  assert(new Date(rows[0]!.start_after).getTime() > Date.now() + 3500 * 1000);
  assert.equal(calls, 2);
  await assert.rejects(runWorldBudgeted(worldGroupQueue, [task], async () => { throw new Error("not a budget error"); }), /not a budget error/);
  assert.equal((await sql`SELECT count(*)::int AS count FROM receipt_attempts`)[0]!.count, 0);
});
