import assert from "node:assert/strict";
import test from "node:test";
import { admissionLimit } from "../backend/budget.ts";

test("admission allowance defaults to five, accepts approved total and rejects invalid configuration", () => {
  assert.equal(admissionLimit(undefined), 5);
  assert.equal(admissionLimit("10"), 10);
  assert.equal(admissionLimit("5.5"), 5.5);
  for (const value of ["", " ", "0", "-5", "NaN", "Infinity", "10yuan"]) {
    assert.throws(() => admissionLimit(value), /ADMISSION_BUDGET_CNY/);
  }
});
