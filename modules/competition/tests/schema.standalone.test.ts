import assert from "node:assert/strict";
import test from "node:test";
import { extractedSchema, validateExtraction } from "../backend/schema.ts";

const blank = () => Object.fromEntries([
  "name", "year", "promotionImage", "categories", "participantLimit", "teacherLimit", "registrationTimes", "competitionTimes", "stages", "officialWebsite", "files", "introduction",
].map(key => [key, { value: null, status: "unknown", reason: "尚未取得材料", evidence: [] }]));

test("extraction rejects expanded fields and unsupported known values", () => {
  assert.equal(extractedSchema.safeParse({ ...blank(), fee: 100 }).success, false);
  assert.equal(extractedSchema.safeParse({ ...blank(), name: { value: "比赛", status: "known", reason: "", evidence: [] } }).success, false);
});

test("missing restrictions cannot become unlimited or not applicable without evidence", () => {
  assert.equal(extractedSchema.safeParse({ ...blank(), teacherLimit: { value: null, status: "not_applicable", reason: "个人赛", evidence: [] } }).success, false);
  assert.equal(extractedSchema.safeParse(blank()).success, true);
});

test("fabricated evidence fails validation and cannot be ready for review", () => {
  const data = extractedSchema.parse({ ...blank(), name: { value: "2026比赛", status: "known", reason: "", evidence: [{ materialId: "m", blockId: "1", quote: "官网没有的内容" }] } });
  const report = validateExtraction(data, [{ id: "m", url: "https://example.org", hash: "h", fetchedAt: new Date().toISOString(), contentType: "text/html", blocks: [{ id: "1", text: "比赛通知" }], links: [], images: [] }], []);
  assert.equal(report.valid, false);
  assert.equal(report.readyForReview, false);
});

test("a date-shaped impossible calendar date does not pass validation", () => {
  const quote = "比赛时间待核验";
  const data = extractedSchema.parse({ ...blank(), competitionTimes: { value: [{ scope: "决赛", label: "比赛", officialText: quote, precision: "day", timezone: "Asia/Shanghai", start: "2026-02-30", end: null }], status: "known", reason: "", evidence: [{ materialId: "m", blockId: "1", quote }] } });
  const report = validateExtraction(data, [{ id: "m", url: "https://example.org", hash: "h", fetchedAt: new Date().toISOString(), contentType: "text/html", blocks: [{ id: "1", text: quote }], links: [], images: [] }], []);
  assert.ok(report.errors.includes("time: invalid calendar date"));
});
