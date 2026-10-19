import { load } from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import type { AgentGoal } from "@aihot/contracts/admission-agent";
import { schoolById } from "../schools.ts";
import { canonicalAgentUrl, outgoingRecommendation, doctoralOnly, type AgentLink } from "./agent-planner.ts";

export function agentSearchQueries(goal: AgentGoal) {
  const school = schoolById.get(goal.schoolId)!;
  const domain = new URL(school.website!).hostname.replace(/^www\./, "");
  // Keep search operators out of user keywords; official host validation applies independently.
  const words = goal.keywords.map(word => word.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).join(" ");
  const stage = goal.track === "kaoyan" ? goal.stages.every(stage => stage === "retest") ? "硕士 复试" : goal.stages.every(stage => stage === "adjustment") ? "硕士 调剂" : "硕士研究生 招生简章" : goal.stages.every(stage => stage === "summer") ? "夏令营" : "接收推免";
  const year = stage === "夏令营" ? goal.year - 1 : goal.year;
  const queries = [`${school.name} ${words} ${year} ${stage}`, `site:${domain} ${words} ${year} ${stage} 学院`];
  if (goal.stages.includes("summer") && stage !== "夏令营") queries.push(`${school.name} ${words} ${goal.year - 1} 夏令营`);
  return queries;
}
export const agentSearchUrl = (query: string) => `https://www.so.com/s?q=${encodeURIComponent(query)}`;

export function parseAgentSearch(html: string, goal: AgentGoal) {
  const $ = load(html);
  if (/验证码|安全验证|访问验证|captcha|verify you are human/i.test($("title").text())
    || $("form[action*='captcha'],#captcha").length) throw new Error("search-access-restricted");
  const results = $("li.res-list h3 a");
  // A blank/dynamic/error page must not be reported as a valid search with zero hits.
  if (!results.length && !/没有找到|未找到|找不到.*相关|没有相关/.test($("body").text())) throw new Error("search-format-unavailable");
  const links = new Map<string, AgentLink>();
  results.slice(0, 10).each((_, node) => {
    const element = $(node), title = element.text().replace(/\s+/g, " ").trim().slice(0, 200);
    // Read only destinations explicitly present in results. Do not follow search/ad redirects.
    const raw = element.attr("data-mdurl") || element.attr("href");
    const url = raw && canonicalAgentUrl(goal.schoolId, raw);
    if (!url || new URL(url).port || !title || /名单|公示|录取结果|拟录取|成绩查询|博士后|国际招生|港澳台/.test(title)) return;
    if (outgoingRecommendation(title)) return;
    if (doctoralOnly(title)) return;
    const years = [...title.matchAll(/20\d{2}/g)].map(match => Number(match[0]));
    if (years.length && !years.includes(goal.year) && !(goal.stages.includes("summer") && years.includes(goal.year - 1))) return;
    const keyword = goal.keywords.some(word => title.includes(word));
    const topic = (goal.track === "kaoyan" ? /硕士|统考|考研|复试|调剂|招生简章|招生章程|专业目录/ : /推免|推荐免试|夏令营|接收免试/).test(title);
    const navigation = /学院|学系|招生|研究生/.test(title);
    if (!topic && !(keyword && navigation)) return;
    if (!links.has(url)) links.set(url, { url, title, depth: 0, supplement: 0, priority: keyword ? -3 : -2,
      reason: "实时网页搜索发现的官方入口；搜索标题仅作线索，实际要求需读取官网原文核验" });
  });
  return { returned: Math.min(results.length, 10), links: [...links.values()] };
}

export async function searchAgentQuery(query: string, goal: AgentGoal) {
  const response = await guardedFetch(agentSearchUrl(query), { timeoutMs: 12000, maxBytes: 2 * 1024 * 1024 });
  if (response.status !== 200 || new URL(response.url).hostname !== "www.so.com") throw new Error("search-unavailable");
  return parseAgentSearch(response.text(), goal);
}
