import type { AgentBrief, AgentGoal, AgentStatus } from "@aihot/contracts/admission-agent";
import type { PublicNotice } from "@aihot/contracts/admission";
import { beijingDate } from "@aihot/contracts/time";
import { matchesAgentGoal, specificAgentMatch } from "./agent-planner.ts";

const dayMs = 86_400_000;
const daysUntil = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
// Selection and composition reuse published, evidenced LLM summaries. Reading a brief never buys a call.
export function buildAgentBrief(goal: AgentGoal, schoolName: string, notices: PublicNotice[], checkedAt: string | null, status: AgentStatus, now = new Date()): AgentBrief {
  const today = beijingDate(now);
  const closed = (notice: PublicNotice) => notice.deadline ? notice.deadline < today || notice.deadline === today && !!notice.deadlineTime
    && Date.parse(`${notice.deadline}T${notice.deadlineTime}:00+08:00`) <= now.getTime() : false;
  const relevant = [...new Map(notices.filter(notice => (notice.source.verified || notice.source.verification === "machine" && !!notice.source.evidence.trim())
    && matchesAgentGoal(notice, goal)).map(notice => [notice.id, notice])).values()];
  const target = relevant.filter(notice => specificAgentMatch(notice, goal));
  const references = relevant.filter(notice => !specificAgentMatch(notice, goal));
  const recent = (notice: PublicNotice) => !!notice.source.publishedOn && daysUntil(notice.source.publishedOn, today) >= -14 && daysUntil(notice.source.publishedOn, today) <= 0;
  const rank = (notice: PublicNotice) => {
    if (closed(notice)) return 3;
    if (notice.deadline && daysUntil(notice.deadline, today) <= 7) return 0;
    if (recent(notice)) return 1;
    return 2;
  };
  target.sort((a, b) => rank(a) - rank(b) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")
    || (b.source.publishedOn ?? "").localeCompare(a.source.publishedOn ?? "") || a.id.localeCompare(b.id));
  const chosen = target.slice(0, 3), current = target.filter(notice => !closed(notice)).length;
  const waiting = ["queued", "discovering", "extracting", "supplementing", "awaiting-model", "budget-paused", "needs-review", "paused"].includes(status);
  const state = chosen.length ? "ready" : waiting ? "waiting" : "empty";
  const overview = chosen.length ? `截至${today}，已整理${target.length}篇符合${goal.keywords.length ? "关注方向、" : ""}入学年份与招生阶段的公告，选出${chosen.length}篇要点。${current ? `${current}篇未明确截止或尚未截止，具体开放安排仍以原文为准。` : "已整理的申请节点均已截止，以下仅供政策回顾。"}`
    : references.length ? `已整理${references.length}篇校级或其他专业参考，尚无符合关注方向的要求，暂不将参考内容写成你的申请条件。`
      : status === "awaiting-model" ? "官网材料已保存，摘要整理尚未启用。启用后将汇总相关公告、申请重点与日期；当前不根据搜索标题生成报告。"
        : status === "budget-paused" ? "官网材料已保存，模型额度不足，简报等待整理。不会自行追加费用。"
          : status === "paused" ? "任务已由管理员暂停，尚无可写入简报的匹配公告；刷新不会恢复执行。"
            : status === "needs-review" ? "本轮检查已结束，部分材料需要人工核对，尚无可写入简报的匹配公告。"
              : status === "queued" ? "目标已保存，等待后台执行；尚无可写入简报的匹配公告。"
                : waiting ? "后台上次记录正在查找或整理材料，尚无可写入简报的匹配公告，请结合最近活动与处理记录核对。"
                  : "本轮尚未整理出符合条件的公告。可能存在读取限制或尚未定位到材料，不能据此认定学校没有发布。";
  const items = chosen.map(notice => {
    const days = notice.deadline ? daysUntil(notice.deadline, today) : null;
    const reason = closed(notice) ? "已截止 · 政策回顾" : days !== null && days <= 7 ? days === 0 ? "今日截止 · 核对原文时刻" : `${days}天内截止 · 优先核对`
      : recent(notice) ? "近14天发布" : notice.deadline ? "有明确申请日期" : "申请时间待确认";
    const action = closed(notice) ? "本批申请时间已过，请关注后续批次；不要按本报告提交过期申请。"
      : `${notice.deadline ? `先核对${notice.deadline}${notice.deadlineTime ? ` ${notice.deadlineTime}（北京时间）` : "（原文未注明截止时刻）"}的截止安排。` : "先查原文确认申请时间。"}${notice.materials.length ? `准备重点：${notice.materials.slice(0, 2).join("；")}。` : "申请材料尚未整理，请以原文清单为准。"}`;
    return { notice, reason, action };
  });
  const timeline: AgentBrief["timeline"] = chosen.flatMap(notice => [
    ...(notice.opensOn ? [{ noticeId: notice.id, date: notice.opensOn, time: null, kind: "opens" as const, title: notice.programme, url: notice.source.url, past: notice.opensOn < today }] : []),
    ...(notice.deadline ? [{ noticeId: notice.id, date: notice.deadline, time: notice.deadlineTime, kind: "deadline" as const, title: notice.programme, url: notice.source.url, past: closed(notice) }] : []),
  ]).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.kind.localeCompare(b.kind));
  return { title: `${schoolName} · ${goal.track === "kaoyan" ? "考研" : "保研"}简报`, overview, asOf: today, checkedAt, state, current, closed: target.length - current,
    items, references: references.slice(0, 2), timeline, unknownDates: chosen.filter(notice => !notice.deadline).length };
}
