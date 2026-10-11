import { tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { paidRequest, logicalKeyFor, BudgetExceededError, completeReceipt, rejectReceivedResponse } from "@aihot/backend/providers/receipts";

const T = tag();
const ai = `receipt-ai-${T}`;
const world = `receipt-world-${T}`;
before(async () => {
  for (const [section, id] of [["ai", ai], ["world", world]]) {
    await sql`INSERT INTO sources (section_id,id,name,kind,enabled) VALUES (${section!},${id!},${id!},'rss',false)`;
  }
});
after(closeDb);
const worldRequest = (service: string, identity: string) => ({ sectionId: "world" as const, resource: { kind: "source" as const, id: world }, service, purpose: "test", identity });

test("missing world budget and wrong persisted resource refuse before spending", async () => {
  let sent = 0;
  const call = async () => { sent++; return { response: true }; };
  const req = worldRequest(`missing-${T}`, "one");
  await assert.rejects(paidRequest(req, call), BudgetExceededError);
  await assert.rejects(paidRequest({ ...req, resource: { kind: "source", id: ai } }, call), /mismatch/);
  await assert.rejects(paidRequest({ ...req, resource: undefined }, call), /resource/);
  await assert.rejects(paidRequest({ ...req, sectionId: null as never }, call), /section/);
  assert.equal(sent, 0);
  assert.equal((await sql`SELECT 1 FROM receipts`).length, 0);
});

test("AI logical keys remain compatible and identical world requests have independent receipts", async () => {
  const service = `reuse-${T}`;
  await sql`INSERT INTO section_budgets VALUES ('world',${service},10,10,10)`;
  const plain = { service, purpose: "test", identity: "same" };
  const req = worldRequest(service, "same");
  assert.equal(logicalKeyFor(plain), logicalKeyFor({ ...plain, sectionId: "ai" }));
  assert.notEqual(logicalKeyFor(plain), logicalKeyFor(req));
  let sent = 0;
  const call = async () => ({ response: ++sent });
  const a = await paidRequest(plain, call);
  const w = await paidRequest(req, call);
  assert.notEqual(a.receiptId, w.receiptId);
  assert.equal((await paidRequest(req, call)).reused, true);
  assert.equal(sent, 2);
  await assert.rejects(completeReceipt(sql, w.receiptId), /section/);
  await assert.rejects(rejectReceivedResponse(w.receiptId, "wrong"), /section/);
  await completeReceipt(sql, w.receiptId, "world");
});

test("concurrent world requests cannot overshoot their own allowance; AI can still use the service", async () => {
  const service = `concurrent-${T}`;
  await sql`INSERT INTO budgets (service,per_minute,per_hour,per_day) VALUES (${service},20,20,20)`;
  await sql`INSERT INTO section_budgets VALUES ('world',${service},1,20,20)`;
  let sent = 0;
  const call = async () => ({ response: ++sent });
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => paidRequest(worldRequest(service, String(i)), call)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(results.filter(r => r.status === "rejected").every(r => r.reason instanceof BudgetExceededError));
  await paidRequest({ service, purpose: "test", identity: "ai" }, call);
  assert.equal(sent, 2);
});

test("service-wide budget stops both sections even with remaining world allowance", async () => {
  const service = `total-${T}`;
  await sql`INSERT INTO budgets (service,per_minute,per_hour,per_day) VALUES (${service},1,20,20)`;
  await sql`INSERT INTO section_budgets VALUES ('world',${service},20,20,20)`;
  let sent = 0;
  const call = async () => ({ response: ++sent });
  await paidRequest({ service, purpose: "test", identity: "ai" }, call);
  await assert.rejects(paidRequest(worldRequest(service, "world"), call), BudgetExceededError);
  assert.equal(sent, 1);
});
