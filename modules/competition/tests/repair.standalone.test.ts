import assert from "node:assert/strict";
import test from "node:test";
import { extractedSchema } from "../backend/schema.ts";
import { mergeFieldRepair, repairFieldNames, missingFieldReview, repairMaterialIds } from "../backend/repair.ts";

test("field repair preserves untouched evidence and rejects unrelated field changes", () => {
  const unknown = { value: null, status: "unknown", reason: "待补材料", evidence: [] };
  const previous = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, unknown])));
  previous.name = { value: "第十届测试竞赛", status: "known", reason: "", evidence: [{ materialId: "source", blockId: "block-1", quote: "第十届测试竞赛" }] };
  const fields = repairFieldNames({ valid: false, errors: ["files: evidence does not match the collected material"], missing: [], readyForReview: false });
  assert.deepEqual(fields, ["files"]);
  const result = mergeFieldRepair(previous, fields, { files: unknown });
  assert.deepEqual(result.name, previous.name);
  assert.deepEqual(repairMaterialIds(previous, ["recorded", "source"]), ["recorded", "source"]);
  assert.deepEqual(repairMaterialIds(previous, ["recorded"]), ["recorded", "source"]);
  assert.throws(() => mergeFieldRepair(previous, fields, { files: unknown, name: unknown }));
  assert.deepEqual(repairFieldNames({ valid: false, errors: ["time: invalid calendar date"], missing: [], readyForReview: false }), ["registrationTimes", "competitionTimes"]);
});

test("explicit missing-field review targets only gaps and preserves original validation", () => {
  const report = { valid: true, errors: [], missing: ["registrationTimes:unknown", "teacherLimit:not_stated"], readyForReview: false };
  const reviewed = missingFieldReview(report);
  assert.deepEqual(repairFieldNames(reviewed), ["teacherLimit", "registrationTimes"]);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(reviewed.missing, report.missing);
  assert.match(reviewed.errors[0]!, /不推断未知信息/);
});
