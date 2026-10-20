import assert from "node:assert/strict";
import test from "node:test";
import { agentSearchQueries, parseAgentSearch } from "../backend/agent-search.ts";
import type { AgentGoal } from "@aihot/contracts/admission-agent";

const goal: AgentGoal = { schoolId: "s004", keywords: ["计算机"], year: 2027, stages: ["pre", "recommendation"], urls: [], searchWeb: true };
const result = (title: string, url: string) => `<li class="res-list"><h3><a href="https://www.so.com/link?opaque" data-mdurl="${url}">${title}</a></h3></li>`;
test("search queries use the live goal and official domain without accepting keyword operators", () => {
  assert.deepEqual(agentSearchQueries(goal), ["北京航空航天大学 计算机 2027 接收推免", "site:buaa.edu.cn 计算机 2027 接收推免 学院"]);
  const queries = agentSearchQueries({ ...goal, keywords: ["计算机 site:evil.com"], stages: ["summer", "pre"] });
  assert.equal(queries.length, 3); assert.ok(queries[2].includes("2026 夏令营"));
  assert.ok(queries.every(query => !query.includes("site:evil.com")));
  assert.ok(agentSearchQueries({ ...goal, stages: ["summer"] }).every(query => query.includes("2026 夏令营")));
});
test("search admits observed official destinations, deduplicates, and excludes recommendations, rosters, stale years and unsafe URLs", () => {
  const url = "https://scse.buaa.edu.cn/info/1299/12507.htm";
  const html = result("计算机学院2027年接收推免研究生工作方案", url) + result("计算机学院2027年接收推免研究生工作方案", url + "#top")
    + result("计算机2027推免", "https://buaa.edu.cn.evil.example/a") + result("计算机2027推免", "http://127.0.0.1/a")
    + result("计算机2027推免", "https://scse.buaa.edu.cn/a?token=secret") + result("计算机2027推免", "https://scse.buaa.edu.cn:8080/a")
    + result("计算机2024推免办法", "https://scse.buaa.edu.cn/old") + result("计算机2027推免名单", "https://scse.buaa.edu.cn/roster")
    + result("计算机2027年推荐优秀应届本科毕业生工作方案", "https://scse.buaa.edu.cn/outgoing")
    + result("各学院接收2027年研究生推免通知", "https://yzb.buaa.edu.cn/index.htm");
  const parsed = parseAgentSearch(html, goal);
  assert.equal(parsed.returned, 10); assert.deepEqual(parsed.links.map(link => link.url), [url, "https://yzb.buaa.edu.cn/index.htm"]);
  assert.ok(parsed.links[0].priority < parsed.links[1].priority);
  assert.ok(parsed.links.every(link => link.depth === 0 && link.reason.includes("原文核验")));
});
test("empty result, access challenge and unrecognized search markup remain distinct", () => {
  assert.deepEqual(parseAgentSearch("<body>没有找到相关结果</body>", goal), { returned: 0, links: [] });
  assert.throws(() => parseAgentSearch("<title>安全验证</title><body>验证码</body>", goal), /restricted/);
  assert.throws(() => parseAgentSearch("<html><body>loading</body></html>", goal), /format/);
});
test("school-wide exam searches discover official exam notices without baoyan terms", () => {
  const exam: AgentGoal = { ...goal, keywords: [], track: "kaoyan", stages: ["prospectus", "exam"] };
  assert.ok(agentSearchQueries(exam).every(query => query.includes("2027 硕士研究生 招生简章") && !query.includes("推免")));
  assert.ok(agentSearchQueries({ ...exam, stages: ["retest"] }).every(query => query.includes("硕士 复试")));
  const parsed = parseAgentSearch(result("2027年硕士研究生招生简章", "https://yzb.buaa.edu.cn/exam.htm") + result("2027年博士招生简章", "https://yzb.buaa.edu.cn/doctor.htm"), exam);
  assert.deepEqual(parsed.links.map(link => link.url), ["https://yzb.buaa.edu.cn/exam.htm"]);
});
test("year-qualified outgoing recommendation and eligibility application titles do not enter search leads", () => {
  const parsed = parseAgentSearch(result("关于推荐2027届优秀本科毕业生免试攻读研究生的办法", "https://scse.buaa.edu.cn/outgoing.htm")
    + result("关于2027届本科毕业生推免资格申请的通知", "https://scse.buaa.edu.cn/eligibility.htm")
    + result("计算机学院2027年接收推荐免试研究生说明", "https://scse.buaa.edu.cn/incoming.htm"), goal);
  assert.deepEqual(parsed.links.map(link => new URL(link.url).pathname), ["/incoming.htm"]);
});
