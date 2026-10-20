import assert from "node:assert/strict";
import test from "node:test";
import type { PublicNotice } from "@aihot/contracts/admission";
import type { AgentGoal } from "@aihot/contracts/admission-agent";
import { buildAgentBrief } from "../backend/agent-brief.ts";
import { schoolFromInput } from "../goal-input.ts";
import { demoNotices } from "../backend/demo.ts";
import { schools } from "../schools.ts";

const goal: AgentGoal = { schoolId: "s002", keywords: ["计算机"], year: 2027, stages: ["pre"], urls: [] };
const now = new Date("2026-10-19T02:00:00Z");
const school = schools.find(s => s.id === goal.schoolId)!;
function notice(id: string, fields: Partial<PublicNotice> = {}): PublicNotice {
  return { ...demoNotices[0], id, demo: false, version: 1, updatedAt: now.toISOString(), school, status: "unknown",
    department: "计算机学院", programme: "计算机科学与技术", opensOn: null, deadline: null,
    source: { ...demoNotices[0].source, verified: true, url: "https://yz.tsinghua.edu.cn/rules.htm", publishedOn: null }, ...fields };
}
const brief = (notices: PublicNotice[], input = goal, date = now) => buildAgentBrief(input, school.name, notices, null, "completed", date);

test("school input resolves only verified names and domains, refuses ambiguity and disguised origins", () => {
  assert.equal(schoolFromInput(" 清华大学 ", schools).id, goal.schoolId);
  assert.equal(schoolFromInput("清华", schools).id, goal.schoolId);
  assert.equal(schoolFromInput("https://www.cs.tsinghua.edu.cn/rules.htm", schools).id, goal.schoolId);
  for (const value of ["大学", "不存在的学校", "http://127.0.0.1/", "https://tsinghua.edu.cn.evil.example/", "https://x:y@tsinghua.edu.cn/", "https://tsinghua.edu.cn:8080/"]) assert.throws(() => schoolFromInput(value, schools));
  assert.throws(() => schoolFromInput(school.website!, [school, { ...school, id: "s999", name: "另一校区" }]), /明确学校/);
});
test("brief ranks deadlines before recent publications and never calls future publication recent", () => {
  const rows = [notice("old", { deadline: "2026-10-18" }), notice("future", { source: { ...notice("x").source, publishedOn: "2026-10-20" } }),
    notice("recent", { source: { ...notice("x").source, publishedOn: "2026-10-18" } }), notice("soon", { deadline: "2026-10-21" })];
  const report = brief(rows);
  assert.deepEqual(report.items.map(item => item.notice.id), ["soon", "recent", "future"]);
  assert.equal(report.current, 3); assert.equal(report.closed, 1);
  assert.equal(report.items[2].reason, "申请时间待确认");
  assert.equal(report.items[1].reason, "近14天发布");
  assert.equal(report.timeline.length, 1); assert.equal(report.unknownDates, 2);
});
test("Beijing exact deadlines expire at the observed instant; date-only deadlines do not invent a time", () => {
  const report = brief([notice("exact", { deadline: "2026-10-19", deadlineTime: "10:00" }), notice("date", { deadline: "2026-10-19" })]);
  assert.equal(report.closed, 1); assert.equal(report.current, 1);
  assert.equal(report.timeline.find(event => event.noticeId === "exact")?.past, true);
  assert.equal(report.timeline.find(event => event.noticeId === "date")?.time, null);
  assert.equal(brief([notice("date", { deadline: "2026-10-19" })], goal, new Date("2026-10-19T16:00:00Z")).closed, 1);
});
test("unverified, demo, other track and mismatched scopes cannot become requirements", () => {
  const rows = [notice("demo", { demo: true }), notice("unverified", { source: { ...notice("x").source, verified: false } }),
    notice("kaoyan", { track: "kaoyan", stage: "prospectus" }), notice("wrong-year", { year: 2026 }), notice("school", { department: "全校（具体范围见原文）" })];
  const report = brief(rows);
  assert.equal(report.state, "empty"); assert.equal(report.items.length, 0); assert.equal(report.references.length, 1);
  assert.equal(brief(rows, { ...goal, keywords: [] }).items[0].notice.id, "school");
  assert.equal(brief(rows, { ...goal, track: "kaoyan", stages: ["prospectus"] }).items[0].notice.id, "kaoyan");
});
test("waiting, budget and empty outcomes state missing evidence without fabricating a report or dates", () => {
  for (const status of ["awaiting-model", "budget-paused", "discovering"] as const) {
    const report = buildAgentBrief(goal, school.name, [], null, status, now);
    assert.equal(report.state, "waiting"); assert.deepEqual(report.items, []); assert.deepEqual(report.timeline, []);
  }
  assert.match(brief([]).overview, /不能据此认定/);
  const report = brief([notice("x"), notice("x")]); assert.equal(report.items.length, 1); assert.equal(report.timeline.length, 0);
});
test("published machine summaries with checked citations remain distinct from human verification", () => {
  const source = { ...notice("x").source, verified: false, verification: "machine" as const, evidence: "程序已核对原文引用" };
  const report = brief([notice("machine", { source }), notice("no-evidence", { source: { ...source, evidence: "" } })]);
  assert.deepEqual(report.items.map(item => item.notice.id), ["machine"]);
  assert.equal(report.items[0].notice.source.verified, false);
});
