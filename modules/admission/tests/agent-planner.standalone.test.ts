import assert from "node:assert/strict";
import test from "node:test";
import { planOfficialLinks, canonicalAgentUrl, noticeCandidate, specificAgentMatch, noticeGaps, AGENT_LIMITS } from "../backend/agent-planner.ts";
import { testNotices } from "./fixtures.ts";
import type { AgentGoal } from "@aihot/contracts/admission-agent";
import { alignEvidence, validateScopeEvidence, type ExtractedNotice } from "../backend/automation-schema.ts";

const goal: AgentGoal = { schoolId: "s002", keywords: ["计算机"], year: 2027, stages: ["pre"], urls: [] };
const base = "https://yz.tsinghua.edu.cn/notice.htm";
const parent = { url: base, title: "校级推免办法", depth: 1, reason: "测试", priority: 0, supplement: 0 };

test("degree type needs explicit degree wording instead of a subject followed by masters", () => {
  for (const [quote, degree, expected] of [
    ["计算机科学与技术专业硕士研究生", "professional", "unknown"],
    ["硕士、博士研究生", "both", "unknown"],
    ["专业学位硕士研究生", "professional", "professional"],
    ["学术学位和专业学位硕士研究生", "both", "both"],
  ] as const) {
    const notice = { degree, evidence: [{ field: "degree", materialId: "m", blockId: "b", quote }] } as ExtractedNotice;
    alignEvidence(notice, [{ id: "m", blocks: [{ id: "b", text: quote }] }] as Parameters<typeof alignEvidence>[1]);
    assert.equal(notice.degree, expected);
  }
});
test("goal discovery follows observed faculty, undated rules, supplementary links and pagination without inventing URLs", () => {
  const html = `<title>2027年各学院推免细则汇总</title><a href="/cs/">计算机学院</a><a href="/rules.htm">接收推免生办法</a>
  <a href="/form.docx">申请材料附件</a><a href="/page2.htm">下一页</a><a href="/page2.htm#top">下一页</a>
  <a href="/old.htm">2024年计算机推免办法</a><a href="/roster.htm">2027年推免拟录取名单公示</a>
  <a href="https://evil.example/">计算机推免</a><a href="http://127.0.0.1/">计算机推免</a><a href="/a?token=x">推免通知</a>`;
  const links = planOfficialLinks(html, base, goal, parent, true);
  assert.deepEqual(new Set(links.map(l => new URL(l.url).pathname)), new Set(["/cs/", "/rules.htm", "/form.docx", "/page2.htm"]));
  assert.equal(links.find(l => l.url.endsWith("form.docx"))?.supplement, 1);
  assert.ok(links.every(l => l.depth === 2 && l.reason.length > 10));
  assert.equal(planOfficialLinks(html, base, goal, { ...parent, supplement: AGENT_LIMITS.supplements }, true).some(l => l.url.endsWith("form.docx")), false);
  assert.ok(noticeCandidate("接收推免生办法", "这是有内容的官方推免规则。".repeat(12), base));
  assert.equal(noticeCandidate("各学院推免细则汇总", "推免".repeat(60), base), false);
});
test("official link normalization rejects credentials and nonofficial origins", () => {
  assert.equal(canonicalAgentUrl(goal.schoolId, "/x.htm?utm_source=a#top", base), "https://yz.tsinghua.edu.cn/x.htm");
  for (const raw of ["https://tsinghua.edu.cn.evil.example/a", "file:///x", "https://u:p@tsinghua.edu.cn/", "https://tsinghua.edu.cn/a?auth=a"]) assert.equal(canonicalAgentUrl(goal.schoolId, raw), null);
});
test("observed onclick notices and redirect wrappers work without executing scripts or entering doctoral and international columns", () => {
  const html = `<div onclick="window.open('/redirect/url?redirectUrl=/rules.pdf&amp;type=1')">2027年硕士推免办法</div>
    <li onclick="window.open('/pre','_self')">推免专栏</li><a href="/bszs/list.htm">招生公告</a>
    <a href="/international">国际招生</a><a href="/new">2026级研究生新生入学须知</a>`;
  const links = planOfficialLinks(html, base, goal, parent, false);
  assert.deepEqual(new Set(links.map(l => new URL(l.url).pathname)), new Set(["/rules.pdf", "/pre"]));
});
test("school-wide, different year, stage and other programme notices never count as target requirements", () => {
  const notice = { ...testNotices[0], schoolId: goal.schoolId, year: 2027, stage: "pre" as const, department: "计算机学院", programme: "计算机科学与技术" };
  assert.equal(specificAgentMatch(notice, goal), true);
  for (const changed of [{ ...notice, year: 2026 }, { ...notice, stage: "summer" as const }, { ...notice, department: "全校（具体范围见原文）" }, { ...notice, programme: "适用专业见官方目录" }, { ...notice, schoolId: "s001" }]) assert.equal(specificAgentMatch(changed, goal), false);
  assert.ok(noticeGaps([{ ...notice, department: "全校（具体范围见原文）" }], goal)[0].includes("仅作参考"));
});
test("concrete faculty, programme and batch names require their own literal source support", () => {
  const { id: _id, schoolId: _school, source: _source, resources: _resources, ...fields } = testNotices[0];
  const notice = { ...fields, department: "计算机学院", programme: "计算机科学与技术", batch: "预推免批次", evidence: ["department", "programme", "batch"].map(field => ({ field, materialId: "m", blockId: "b", quote: "计算机学院计算机科学与技术预推免批次招生。" })) };
  assert.doesNotThrow(() => validateScopeEvidence(notice));
  assert.throws(() => validateScopeEvidence({ ...notice, programme: "软件工程" }), /具体招生范围/);
  assert.throws(() => validateScopeEvidence({ ...notice, evidence: [] }), /department/);
});
test("exam candidates and school-wide scope work with no required programme", () => {
  const exam: AgentGoal = { ...goal, keywords: [], track: "kaoyan", stages: ["prospectus"] };
  assert.equal(noticeCandidate("2027年硕士研究生招生简章", "硕士研究生招生办法。".repeat(15), base, exam), true);
  assert.equal(noticeCandidate("2027年博士研究生招生简章", "博士招生办法。".repeat(15), base, exam), false);
  assert.equal(specificAgentMatch({ ...testNotices[1], schoolId: goal.schoolId, department: "全校（具体范围见原文）" }, exam), true);
  assert.ok(planOfficialLinks('<a href="/exam.htm">2027年硕士研究生招生简章</a>', base, exam, parent, false).some(link => link.url.endsWith("exam.htm")));
});
test("observed admission explanations are candidates but outgoing undergraduate eligibility is excluded", () => {
  const text = "2027年接收推荐免试研究生，申请人应获得所在学校推荐免试资格，申请材料与报名安排如下。".repeat(4);
  assert.equal(noticeCandidate("某学院2027年接收推荐免试研究生说明", text, base, goal), true);
  assert.equal(noticeCandidate("某学院2027年推免招生指南", text, base, goal), true);
  const outgoing = "关于推荐2027届优秀本科毕业生免试攻读研究生的办法";
  assert.equal(noticeCandidate(outgoing, text, base, goal), false);
  assert.equal(noticeCandidate("关于2027届本科毕业生推免资格申请的通知", text, base, goal), false);
  assert.deepEqual(planOfficialLinks(`<a href="/out.htm">${outgoing}</a><a href="/in.htm">2027年接收推免说明</a>`, base, goal, parent, false).map(link => new URL(link.url).pathname), ["/in.htm"]);
});

test("direct doctoral recommendations are excluded while explicit masters and doctoral notices remain candidates", () => {
  const text = "2027年接收推荐免试研究生，报名安排和材料如下。".repeat(8);
  const titles = ["2027年推荐免试（直博）研究生的说明", "接收2027年推荐免试博士研究生通知"];
  for (const title of titles) {
    assert.equal(noticeCandidate(title, text, base, goal), false);
    assert.equal(planOfficialLinks(`<a href="/doctoral.htm">${title}</a>`, base, goal, parent, false).length, 0);
  }
  assert.equal(noticeCandidate("2027年接收推荐免试硕士、博士研究生说明", text, base, goal), true);
  assert.equal(noticeCandidate("2027年接收推荐免试硕博研究生说明", text, base, goal), true);
});
