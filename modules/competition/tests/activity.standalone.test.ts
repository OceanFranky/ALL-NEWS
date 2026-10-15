import assert from "node:assert/strict";
import test from "node:test";
import { competitionActivity } from "../backend/activity.ts";
import { extractedSchema } from "../backend/schema.ts";

const empty = { value: null, status: "unknown", reason: "未核验", evidence: [] };
function times(registration: unknown[], competition: unknown[] = []) {
  const reference = [{ materialId: "material", blockId: "block", quote: "原文" }];
  const known = (value: unknown[]) => value.length ? { value, status: "known", reason: "", evidence: reference } : empty;
  return extractedSchema.pick({ registrationTimes: true, competitionTimes: true }).parse({ registrationTimes: known(registration), competitionTimes: known(competition) });
}
const period = (scope: string, start: string | null, end: string | null, precision = "day", timezone = "Asia/Shanghai") => ({ scope, label: "正式赛段", start, end, precision, timezone, officialText: "官方原始日期表达" });

test("报名和比赛同时进行，分范围状态和并列下一节点均保留", () => {
  const result = competitionActivity(times([period("A组", "2026-10-01", "2026-10-15"), period("B组", "2026-10-01", "2026-10-15")], [period("预选赛", "2026-10-10", "2026-10-20")]), new Date("2026-10-15T12:00:00+08:00"));
  assert.deepEqual(result.activity.map(entry => entry.status), ["registration_open", "registration_open", "competition_ongoing"]);
  assert.equal(result.nextNodes.length, 2);
  assert.equal(result.nextNodes[0].daysRemaining, 0);
  assert.equal(result.nextNodes[0].date, "2026-10-15");
});

test("日期截止包含当地最后一天，跨日无需材料变化即可关闭报名", () => {
  const data = times([period("总赛", "2026-10-01", "2026-10-15")]);
  assert.equal(competitionActivity(data, new Date("2026-10-15T15:59:59Z")).activity[0].status, "registration_open");
  assert.equal(competitionActivity(data, new Date("2026-10-15T16:00:00Z")).activity[0].status, "registration_closed");
});

test("只有截止不宣称开放，只有开始不无限宣称进行中", () => {
  const result = competitionActivity(times([period("只有截止", null, "2026-10-20"), period("只有开始", "2026-10-01", null)]), new Date("2026-10-15T00:00:00Z"));
  assert.deepEqual(result.activity.map(entry => entry.status), ["unknown", "unknown"]);
  assert.equal(result.nextNodes.length, 1);
});

test("月份、大约及未知时间不生成精确状态或倒计时", () => {
  const result = competitionActivity(times([period("月级", "2026-10", "2026-11", "month"), period("约期", null, null, "approximate")]), new Date("2026-10-15T00:00:00Z"));
  assert.ok(result.activity.every(entry => entry.status === "unknown"));
  assert.deepEqual(result.nextNodes, []);
  assert.equal(competitionActivity(times([]), new Date()).activity[0].status, "unknown");
});

test("分钟精度以实际时刻为界，时区不由运行机器决定", () => {
  const data = times([period("分钟", "2026-10-15T08:00+08:00", "2026-10-15T09:00+08:00", "minute")]);
  assert.equal(competitionActivity(data, new Date("2026-10-15T00:00Z")).activity[0].status, "registration_open");
  assert.equal(competitionActivity(data, new Date("2026-10-15T01:00Z")).activity[0].status, "registration_closed");
  const dst = times([period("夏令时", "2026-03-08", "2026-03-08", "day", "America/New_York")]);
  assert.equal(competitionActivity(dst, new Date("2026-03-09T03:59:00Z")).activity[0].status, "registration_open");
  assert.equal(competitionActivity(dst, new Date("2026-03-09T04:00:00Z")).activity[0].status, "registration_closed");
});
