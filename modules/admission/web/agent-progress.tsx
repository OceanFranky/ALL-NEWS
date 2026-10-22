import type { AgentStatus, AgentTask } from "@aihot/contracts/admission-agent";

export const activeAgentStatuses: AgentStatus[] = ["queued", "discovering", "extracting", "supplementing"];
const messages: Record<AgentStatus, { title: string; action: string }> = {
  queued: { title: "任务已保存，等待后台执行", action: "可稍后刷新查看；若一直没有新记录，请联系管理员核对执行队列。" },
  discovering: { title: "正在查找官网材料", action: "可稍后刷新查看新记录；查找范围以已核验的官网为准。" },
  extracting: { title: "正在整理与核对申请要求", action: "可稍后刷新；只有具备原文依据的内容才会进入简报。" },
  supplementing: { title: "正在补查相关材料", action: "后台正在跟进公告指向的页面或附件，可稍后刷新。" },
  "awaiting-model": { title: "材料已保存，模型尚未启用", action: "请联系管理员启用整理并恢复任务。此状态不表示模型账户余额不足，刷新不会启用模型。" },
  "budget-paused": { title: "整理因本站模型额度限制暂停", action: "请联系管理员核对本站累计额度并决定是否恢复；这不等于供应商账户余额不足，刷新不会追加费用。" },
  "needs-review": { title: "本轮已结束，部分内容需要核对", action: "先查看下方待核对项与官方原文；如有可访问的具体公告，可通过“我的来源”补充，再请管理员核对并决定是否重跑。" },
  paused: { title: "任务已暂停", action: "已保存的简报仍可阅读；继续整理需由管理员恢复，刷新不会恢复任务。" },
  failed: { title: "本轮未能完成整理", action: "请查看处理记录中的失败材料；可补充可访问的官方公告，再请管理员核对后重试。" },
  partial: { title: "本轮完成了部分检查", action: "先阅读已有要点，并核对未读取页面与日期缺口；本轮没有覆盖学校全部公告。" },
  completed: { title: "本轮检查完成", action: "核对简报中的申请日期与官方原文；本轮检查完成不代表覆盖该校全部专业。" },
};
const recordLabels: Record<string, string> = {
  running: "进行中（上次记录）", ready: "已记录结果", empty: "未找到线索", failed: "读取失败",
  "read-failed": "读取失败", published: "已发布", unchanged: "内容未变", irrelevant: "与目标无关",
  "needs-review": "需要核对", "budget-paused": "额度受限", "awaiting-model": "模型未启用",
};
const phases = [
  { title: "官网发现", stages: ["plan", "search", "discover"] },
  { title: "材料阅读", stages: ["read", "supplement"] },
  { title: "要求核对", stages: ["extract", "validate"] },
];
const at = (date: string) => new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

export function AgentProgress({ task, showRecords }: { task: AgentTask; showRecords: () => void }) {
  const message = messages[task.status];
  const records = task.steps.filter(step => step.cycle === task.cycle).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id);
  const lastAt = [task.createdAt, task.checkedAt, ...records.map(step => step.at)].filter((date): date is string => !!date && Number.isFinite(Date.parse(date)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const needsAttention = ["needs-review", "budget-paused", "awaiting-model", "failed", "paused", "partial"].includes(task.status);
  return <section aria-label="任务进度" data-agent-progress className="mb-6 rounded-xl border border-line bg-bg-sunk p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2"><h3 className="text-sm font-semibold leading-7 text-ink" data-agent-status-title>{message.title}</h3>
      <p className="text-[11px] leading-6 text-ink-3">最近活动 {lastAt ? <time dateTime={lastAt}>{at(lastAt)}</time> : "暂无记录"} · 北京时间</p></div>
    <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="本轮处理阶段">
      {phases.map((phase, index) => {
        const record = records.find(step => phase.stages.includes(step.stage));
        return <li key={phase.title} data-agent-stage className="min-w-0 border-t border-line-strong pt-2"><span className="font-mono text-[10px] text-ink-3">0{index + 1}</span><p className="mt-1 text-xs font-medium text-ink">{phase.title}</p><p className="mt-1 text-[11px] leading-5 text-ink-3">{record ? recordLabels[record.status] ?? "已有处理记录" : "暂无本轮记录"}</p></li>;
      })}
      <li data-agent-stage className="min-w-0 border-t border-line-strong pt-2"><span className="font-mono text-[10px] text-ink-3">04</span><p className="mt-1 text-xs font-medium text-ink">简报阅读</p><p className="mt-1 text-[11px] leading-5 text-accent">{task.brief?.state === "ready" ? "已有可读简报" : "尚无可读简报"}</p></li>
    </ol>
    {needsAttention && !!task.gaps.length && <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs leading-6 text-ink-2" data-agent-blockers>{task.gaps.slice(0, 2).map(gap => <li key={gap} className="break-words">{gap}</li>)}</ul>}
    <p className="mt-3 text-xs leading-6 text-ink-3"><span className="font-medium text-ink">下一步：</span>{message.action}</p>
    <div className="mt-1 flex flex-wrap gap-x-5 text-xs leading-6"><button type="button" onClick={showRecords} className="min-h-10 text-accent underline">查看来源与处理记录{task.gaps.length > 2 ? `（${task.gaps.length}项待核对）` : ""}</button>
      {["needs-review", "failed", "partial"].includes(task.status) && <a href="/admissions/sources" className="inline-flex min-h-10 items-center text-accent underline">补充官方公告</a>}</div>
    {activeAgentStatuses.includes(task.status) && <p className="text-[11px] leading-6 text-ink-3">以上为后台上次返回的状态，不能据此确认后台此刻仍在执行；本页会定时读取状态，刷新不会重跑任务。</p>}
  </section>;
}
