import { load } from "cheerio";
import type { AgentGoal, AgentSearch } from "@aihot/contracts/admission-agent";
import type { AdmissionNotice } from "@aihot/contracts/admission";
import { officialUrl } from "./sources.ts";

export const AGENT_LIMITS = { pages: 20, depth: 3, attachments: 3, supplements: 2, frontier: 100, stepMs: 180_000 } as const;
export type AgentLink = { url: string; title: string; depth: number; reason: string; priority: number; supplement: number };
export type AgentPage = AgentLink & { documentId: string; candidate: boolean; status: string; hash: string };
export type AgentState = {
  cycle: number; frontier: AgentLink[]; pages: AgentPage[]; gaps: string[]; truncated: boolean;
  search?: AgentSearch;
};
export const emptyAgentState = (cycle: number, seeds: string[]): AgentState => ({ cycle, frontier: seeds.map(url => ({
  url, title: "官方入口", depth: 0, reason: "从用户提供或已配置的官方入口开始", priority: 0, supplement: 0,
})), pages: [], gaps: [], truncated: false });

export function canonicalAgentUrl(schoolId: string, raw: string, base?: string) {
  try {
    const url = new URL(raw, base); url.hash = "";
    if (!officialUrl(schoolId, url.href) || url.username || url.password
      || /(?:token|password|secret|session|auth|ticket|key)/i.test([...url.searchParams.keys()].join(" "))) return null;
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^from$|^spm$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    if (/\.(?:jpg|png|gif|mp4|css|js|exe|zip|xlsx?)(?:$)/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
const admissions = /推免|推荐免试|免试攻读|夏令营|预报名|保研/;
const examAdmissions = /硕士|研究生.*招生|招生简章|招生章程|统考|考研|复试|调剂|招生专业目录/;
const relevantTopic = (goal?: AgentGoal) => goal?.track === "kaoyan" ? examAdmissions : admissions;
const exclusions = /名单|公示|录取结果|博士后|成绩查询|成绩复核|宣传|讲座|会议|新闻动态|国际招生|国际学生|港澳台|导师队伍|研究生导师|教育简介|新生入学|直播|登录|登陆/;
const navigation = /招生|研究生院|通知公告|院系|学院|学系|培养单位|细则汇总/;
export const outgoingRecommendation = (title: string) => !/接收/.test(title) && /推荐.{0,12}本科毕业生|推免资格(?:申请|审核|遴选)|推荐免试资格/.test(title);
export const doctoralOnly = (title: string) => /博士|直博/.test(title) && !/硕士|硕博/.test(title);
export function noticeCandidate(title: string, text: string, url: string, goal?: AgentGoal) {
  return !exclusions.test(title) && !outgoingRecommendation(title) && relevantTopic(goal).test(title + text.slice(0, 400))
    && !doctoralOnly(title)
    && (/\.(?:pdf|docx?)(?:[?#]|$)/i.test(url) || /办法|细则|简章|章程|通知|说明|指南|申请|报名|夏令营|专业目录/.test(title))
    && !/汇总|栏目|列表|导航|首页/.test(title) && text.length >= 80;
}
export function planOfficialLinks(html: string, base: string, goal: AgentGoal, parent: AgentLink, needsSupplement: boolean) {
  const $ = load(html); const links = new Map<string, AgentLink>();
  const topic = relevantTopic(goal);
  const years = (s: string) => [...s.matchAll(/20\d{2}/g)].map(m => Number(m[0]));
  const isIndex = /院系|学院|汇总/.test($("h1,title").first().text());
  $("a[href],[onclick]").each((_, el) => {
    const raw = $(el).attr("href") ?? /(?:window\.open|(?:window\.)?location(?:\.href)?\s*=)\s*\(?\s*['"]([^'"]+)/.exec($(el).attr("onclick") ?? "")?.[1];
    if (!raw) return;
    let target: URL; try { target = new URL(raw, base); } catch { return; }
    // An observed official wrapper contains the literal destination; no JavaScript is executed.
    if (target.pathname === "/redirect/url" && target.searchParams.get("redirectUrl")) { try { target = new URL(target.searchParams.get("redirectUrl")!, base); } catch { return; } }
    const title = ($(el).attr("title") || $(el).find("[title]").first().attr("title") || $(el).text()).replace(/\s+/g, " ").trim().slice(0, 200);
    const url = canonicalAgentUrl(goal.schoolId, target.href);
    if (!url || url === base || !title || exclusions.test(title) || outgoingRecommendation(title)) return;
    if (/\/(?:bszs|bsyjs|gatzsgz|gatzs|gjxs|dsdw)(?:\/|[._])/i.test(new URL(url).pathname)) return;
    const dates = years(title);
    if (dates.length && !dates.some(y => y === goal.year || y === goal.year - 1)) return;
    const keyword = goal.keywords.some(word => title.includes(word));
    const file = /\.(?:pdf|docx?)(?:[?#]|$)/i.test(url);
    const page = /^(?:下一页|下页|next|[2-9]\d?)$/i.test(title);
    const supplemental = needsSupplement && /附件|材料|申请表|报名表|细则|办法|延期|更正/.test(title);
    if (!keyword && !topic.test(title) && !navigation.test(title) && !page && !supplemental) return;
    if (file && !topic.test(title) && !supplemental && !(isIndex && keyword)) return;
    if (doctoralOnly(title)) return;
    const supplement = parent.supplement + Number(supplemental);
    if (supplement > AGENT_LIMITS.supplements) return;
    const reason = supplemental ? "当前材料存在缺口，跟进原文明确指向的补充材料" : keyword ? "链接标题匹配目标方向，继续核对学院或细则" : page ? "检查已观察到的下一页，补充栏目候选" : "沿官方招生栏目与相关通知继续查找";
    const rulesIndex = /各.*(?:学院|院系)|院系.*(?:细则|汇总)|学院.*(?:汇总|相关通知)/.test(title);
    const priority = supplemental ? 0 : keyword || rulesIndex ? 1 : topic.test(title) ? 2 : page ? 4 : 3;
    const previous = links.get(url);
    if (!previous || priority < previous.priority) links.set(url, { url, title, depth: parent.depth + 1, reason, priority, supplement });
  });
  return [...links.values()].sort((a, b) => a.priority - b.priority || a.url.localeCompare(b.url));
}
export function matchesAgentGoal(notice: AdmissionNotice, goal: AgentGoal) {
  return notice.schoolId === goal.schoolId && notice.track === (goal.track ?? "baoyan") && notice.year === goal.year
    && goal.stages.includes(notice.stage as AgentGoal["stages"][number]);
}
export function specificAgentMatch(notice: AdmissionNotice, goal: AgentGoal) {
  return matchesAgentGoal(notice, goal) && (!goal.keywords.length || !notice.department.startsWith("全校")
    && !/适用专业见|详见.*目录|全部专业/.test(notice.programme)
    && goal.keywords.some(word => `${notice.department} ${notice.programme}`.includes(word)));
}
export function noticeGaps(notices: AdmissionNotice[], goal: AgentGoal) {
  const matches = notices.filter(n => specificAgentMatch(n, goal));
  const gaps: string[] = [];
  if (!matches.length) gaps.push(goal.keywords.length ? "尚未找到目标方向、入学年份及阶段均匹配的院系／专业要求；校级通知仅作参考。" : "尚未整理出符合入学年份及招生阶段的公告。");
  if (matches.some(n => !n.deadline)) gaps.push("部分目标公告未明确截止日期，需核对后续通知。");
  if (matches.some(n => !n.eligibility.length)) gaps.push("部分目标公告的申请条件尚未整理。");
  if (matches.some(n => !n.materials.length)) gaps.push("部分目标公告的申请材料尚未整理。");
  return gaps;
}
