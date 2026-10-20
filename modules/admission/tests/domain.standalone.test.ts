import assert from "node:assert/strict";
import test from "node:test";
import { dateSchema, linkSchema, noticeSchema } from "@aihot/contracts/admission";
import { querySchema, noticeStatus, validatePublication } from "../backend/domain.ts";
import { demoNotices } from "../backend/demo.ts";
import { schools } from "../schools.ts";
import { calendarEvent } from "../web/calendar.ts";

test("historical directory distinguishes universities and teaching locations", () => {
  assert.equal(schools.length, 116); assert.equal(new Set(schools.map(s => s.family)).size, 112);
  assert.equal(schools.filter(s => s.tier === "985").length, 39);
  assert.equal(new Set(schools.map(s => s.id)).size, schools.length);
  assert.equal(new Set(schools.map(s => s.province)).size, 31);
});
test("invalid dates, unsafe links and incompatible stages are rejected", () => {
  assert.ok(dateSchema.safeParse("2028-02-29").success);
  assert.equal(dateSchema.safeParse("2027-02-29").success, false);
  assert.equal(dateSchema.safeParse("2026-13-10").success, false);
  for (const value of ["javascript:alert(1)", "https://user:secret@example.com/", "data:text/html,hello"]) assert.equal(linkSchema.safeParse(value).success, false);
  assert.equal(noticeSchema.safeParse({ ...demoNotices[0], id: undefined }).success, false);
  const { id: _id, ...notice } = demoNotices[0];
  assert.ok(noticeSchema.safeParse(notice).success);
  assert.equal(noticeSchema.safeParse({ ...notice, stage: "exam" }).success, false);
  assert.equal(noticeSchema.safeParse({ ...notice, opensOn: "2026-10-10", deadline: "2026-10-01" }).success, false);
});
test("China date boundaries preserve unknown times and do not infer open status", () => {
  const notice = { opensOn: "2026-10-01", deadline: "2026-10-17", deadlineTime: null };
  assert.equal(noticeStatus(notice, new Date("2026-10-17T15:59:59Z")), "open");
  assert.equal(noticeStatus(notice, new Date("2026-10-17T16:00:00Z")), "closed");
  assert.equal(noticeStatus({ ...notice, deadlineTime: "17:00" }, new Date("2026-10-17T09:00:01Z")), "closed");
  assert.equal(noticeStatus({ ...notice, opensOn: "2026-10-18", deadline: "2026-10-20" }, new Date("2026-10-17T10:00:00Z")), "upcoming");
  assert.equal(noticeStatus({ ...notice, opensOn: null }, new Date("2026-10-17T10:00:00Z")), "unknown");
  assert.equal(noticeStatus({ ...notice, deadline: null }, new Date("2026-10-17T10:00:00Z")), "unknown");
});
test("blank browser filters work while invalid filters are rejected", () => {
  assert.equal(querySchema.parse({ year: "", school: "" }).year, undefined);
  for (const input of [{ year: "bad" }, { page: 0 }, { dataset: "all" }, { track: "other" }, { extra: true }]) assert.equal(querySchema.safeParse(input).success, false);
});
test("publication needs human verification and a specific official page", () => {
  const { id: _id, ...notice } = demoNotices[0];
  assert.throws(() => validatePublication(notice));
  const source = { title: "test", url: "https://yz.tsinghua.edu.cn/info/1001/1002.htm", verified: true, publishedOn: "2026-09-01", checkedOn: "2026-10-17", evidence: "测试用的核验依据摘要：明确列出招生年度、专业、院系、阶段、适用批次与截止时间。" };
  const now = new Date("2026-10-17T12:00:00Z");
  assert.doesNotThrow(() => validatePublication({ ...notice, source }, now));
  for (const url of ["https://www.tsinghua.edu.cn/", "https://tsinghua.edu.cn.evil.example/info", "https://blog.example.edu.cn/test"]) assert.throws(() => validatePublication({ ...notice, source: { ...source, url } }, now));
  assert.throws(() => validatePublication({ ...notice, source: { ...source, checkedOn: "2026-10-18" } }, now));
});
test("calendar preserves date-only precision, China timestamps and escapes text", () => {
  const notice = { ...demoNotices[0], school: schools.find(s => s.id === demoNotices[0].schoolId)!, version: 1, updatedAt: "2026-10-17T00:00:00Z", demo: true, status: "closed" as const };
  const content = calendarEvent(notice)!;
  assert.match(content, /DTSTART;VALUE=DATE:20260920/); assert.match(content, /DTEND;VALUE=DATE:20260921/);
  assert.match(content, /虚构演示/); assert.doesNotMatch(content, /BEGIN:VALARM/);
  assert.ok(content.split("\r\n").every(line => new TextEncoder().encode(line).length <= 75));
  const timed = calendarEvent({ ...notice, deadlineTime: "17:00", title: "x\r\nBEGIN:VEVENT" })!;
  assert.match(timed, /DTSTART:20260920T090000Z/); assert.equal(timed.split("\r\nBEGIN:VEVENT").length, 2);
});
