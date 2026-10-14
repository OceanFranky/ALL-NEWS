import assert from "node:assert/strict";
import test from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { reserveAllowance } from "../backend/allowance.ts";

test.after(closeDb);
test.beforeEach(async () => { await sql`DELETE FROM competition_model_allowance`; });

test("concurrent reservations cannot exceed the authorised 10 CNY", async () => {
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => reserveAllowance(`parallel-${i}`, 0.6)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 16);
  const [sum] = await sql`SELECT sum(reserved_cny)::float AS total FROM competition_model_allowance`;
  assert.ok(sum.total <= 10);
});

test("settled conservative token cost releases unused reservation while unknown calls keep their full reserve", async () => {
  await reserveAllowance("settled", 8);
  await sql`UPDATE competition_model_allowance SET actual_upper_cny = 1 WHERE request_key = 'settled'`;
  await reserveAllowance("pending", 8);
  await assert.rejects(reserveAllowance("over", 2), /budget exhausted/);
  await reserveAllowance("last", 1);
});

test("the explicitly authorised second round retains first-round reserves and has its own hard cap", async () => {
  await sql`INSERT INTO competition_model_allowance(request_key,batch,reserved_cny) VALUES ('first-pending','first-live-acceptance',9.9)`;
  await reserveAllowance("second-pending", 9.9);
  await assert.rejects(reserveAllowance("second-over", 0.2), /budget exhausted/);
  const rows = await sql`SELECT batch,reserved_cny::float AS amount FROM competition_model_allowance ORDER BY batch`;
  assert.deepEqual(rows.map(row => ({ ...row })), [{ batch: "first-live-acceptance", amount: 9.9 }, { batch: "second-live-acceptance", amount: 9.9 }]);
  await assert.rejects(reserveAllowance("first-pending", 0.1), /another budget round/);
});
