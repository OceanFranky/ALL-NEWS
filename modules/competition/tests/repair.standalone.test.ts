import assert from "node:assert/strict";
import test from "node:test";
import { extractedSchema } from "../backend/schema.ts";
import { mergeFieldRepair, repairFieldNames } from "../backend/repair.ts";

test("field repair preserves untouched evidence and rejects unrelated field changes", () => {
  const unknown = { value: null, status: "unknown", reason: "待补材料", evidence: [] };
  const previous = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, unknown])));
  previous.name = { value: "第十届测试竞赛", status: "known", reason: "", evidence: [{ materialId: "source", blockId: "block-1", quote: "第十届测试竞赛" }] };
  const fields = repairFieldNames({ valid: false, errors: ["files: evidence does not match the collected material"], missing: [], readyForReview: false });
  assert.deepEqual(fields, ["files"]);
  const result = mergeFieldRepair(previous, fields, { files: unknown });
  assert.deepEqual(result.name, previous.name);
  assert.throws(() => mergeFieldRepair(previous, fields, { files: unknown, name: unknown }));
  assert.deepEqual(repairFieldNames({ valid: false, errors: ["time: invalid calendar date"], missing: [], readyForReview: false }), ["registrationTimes", "competitionTimes"]);
});
