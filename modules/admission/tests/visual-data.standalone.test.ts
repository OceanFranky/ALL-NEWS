import assert from "node:assert/strict";
import test from "node:test";
import { materialRows, sharedDeadlineDates, timelineScale } from "../web/visual-data.ts";

test("timeline preserves unknown endpoints and scales cross-year and same-day calendar coordinates", () => {
  assert.equal(timelineScale([{ opensOn: null, deadline: null }]), null);
  const single = timelineScale([{ opensOn: null, deadline: "2026-10-18" }])!;
  assert.equal(single.position("2026-10-18"), 50);
  assert.equal(single.start, "2026-10-17"); assert.equal(single.end, "2026-10-19");
  const crossYear = timelineScale([{ opensOn: "2026-12-30", deadline: "2027-01-02" }, { opensOn: null, deadline: null }])!;
  assert.equal(crossYear.position("2027-01-01") - crossYear.position("2026-12-31"), 20);
  assert.ok(crossYear.position("2026-12-30") > 0 && crossYear.position("2027-01-02") < 100);
  assert.deepEqual(crossYear.ticks, ["2026-12-29", "2026-12-31", "2027-01-03"]);
  assert.equal(crossYear.position("2026-01-01") < 0, true);
  const sameDay = timelineScale([{ opensOn: "2028-02-29", deadline: "2028-02-29" }])!;
  assert.equal(sameDay.position("2028-02-29"), 50);
  assert.deepEqual(sharedDeadlineDates([{ deadline: null }, { deadline: "2027-01-01" }, { deadline: "2027-01-01" }, { deadline: "2026-12-31" }]), [["2027-01-01", 2]]);
});

test("material overlap never discards qualifications or merges similar requirements", () => {
  const items = [{ id: "a", materials: ["成绩单", "个人陈述（不超过1000字）", "成绩单", "英语成绩证明"] },
    { id: "b", materials: ["成绩单", "个人陈述（不超过2000字）", "英语 成绩证明"] },
    { id: "c", materials: [] }];
  const rows = materialRows(items);
  assert.deepEqual(rows[0], { text: "成绩单", targetIds: ["a", "b"] });
  assert.equal(rows.length, 5);
  assert.equal(rows.filter(row => row.text.startsWith("个人陈述")).length, 2);
  assert.equal(rows.filter(row => row.targetIds.includes("c")).length, 0);
  assert.deepEqual(items[0].materials, ["成绩单", "个人陈述（不超过1000字）", "成绩单", "英语成绩证明"]);
});
