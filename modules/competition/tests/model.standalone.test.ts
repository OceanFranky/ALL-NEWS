import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { competitionProviderUnavailable } from "../backend/model.ts";

test("provider account refusals stop a batch while an ordinary output error does not", () => {
  for (const status of [401, 402, 403]) assert.equal(competitionProviderUnavailable(new ProviderRejectedError("provider refused", status, false)), true);
  assert.equal(competitionProviderUnavailable(new ProviderRejectedError("rate limited", 429, true)), false);
  assert.equal(competitionProviderUnavailable(new Error("llm HTTP 402 in untrusted text")), false);
});
