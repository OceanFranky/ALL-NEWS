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
