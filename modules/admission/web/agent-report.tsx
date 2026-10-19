import { useState } from "react";
import type { AgentTask } from "@aihot/contracts/admission-agent";
import { stages } from "@aihot/contracts/admission";

export function AgentReport({ task }: { task: AgentTask }) {
  const report = task.brief;
  const [selected, setSelected] = useState<string | null>(null);
  if (!report) return <p className="py-8 text-sm leading-7 text-ink-3">简报等待整理，请刷新查看。</p>;
  return <div data-admission-brief>
    <p className="max-w-3xl text-sm leading-8 text-ink-2" data-brief-overview>{report.overview}</p>
    {report.state === "ready" ? <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 divide-y divide-line">{report.items.map(({ notice, reason, action }, index) => <section key={notice.id} data-brief-item={notice.id} className={`min-w-0 py-6 first:pt-0 ${selected === notice.id ? "rounded-lg bg-accent-softer px-3 ring-1 ring-accent/30" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-6"><span className="font-mono text-accent">0{index + 1}</span><span className="font-medium text-accent">{reason}</span><span className="text-ink-3">{stages[notice.stage]} · {notice.source.publishedOn ? `${notice.source.publishedOn}发布` : "发布日期待确认"}</span></div>
        <h3 className="mt-2 break-words text-lg font-semibold leading-8 text-ink"><a href={notice.source.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{notice.title} ↗</a></h3>
        <p className="mt-1 break-words text-xs leading-6 text-ink-3">{notice.department} / {notice.programme} / {notice.batch}</p>
        <p className="text-xs leading-6 text-ink-3">{notice.source.verified ? "来源已人工核验" : "机器已核对原文引用 · 未经人工复核"}</p>
        <p className="mt-3 break-words text-sm leading-8 text-ink-2">{notice.summary.length > 320 ? `${notice.summary.slice(0, 320)}…（摘要节选，完整内容见详情）` : notice.summary}</p>
        {!!notice.eligibility.length && <p className="mt-3 break-words text-sm leading-7 text-ink-2"><span className="font-medium text-ink">申请重点：</span>{notice.eligibility.slice(0, 2).join("；")}。</p>}
        <p className="mt-3 break-words border-l-2 border-accent/50 pl-3 text-sm leading-7 text-ink-2"><span className="font-medium text-ink">下一步：</span>{action}</p>
        {notice.dateNote && <p className="mt-2 break-words text-xs leading-6 text-ink-3">日程说明：{notice.dateNote}</p>}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs leading-6"><a href={notice.source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">[{index + 1}] 官方原文 ↗</a><a href={`/admissions/${notice.id}`} className="text-ink-3 underline">条件与材料详情</a></div>
      </section>)}</div>
      <aside className="min-w-0 border-t border-line pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0" aria-label="简报时间轴">
        <h3 className="font-serif text-lg font-semibold text-ink">申请时间轴</h3><p className="mt-2 text-xs leading-6 text-ink-3">北京时间 · 点击日期突出显示对应要点</p>
        {report.timeline.length ? <ol className="mt-5 border-l border-line pl-4">{report.timeline.map((event, index) => <li key={`${event.noticeId}:${event.kind}`} className="relative pb-5 before:absolute before:-left-[20px] before:top-4 before:size-2 before:rounded-full before:bg-accent">
          <button type="button" aria-pressed={selected === event.noticeId} onClick={() => setSelected(event.noticeId)} className={`min-h-11 w-full rounded-lg p-2 text-left transition-colors hover:bg-accent-softer ${selected === event.noticeId ? "bg-accent-soft" : ""}`} data-brief-node={index}>
            <span className="block font-mono text-sm text-ink">{event.date}{event.time && ` ${event.time}`}</span><span className="mt-1 block text-xs leading-6 text-accent">{event.kind === "opens" ? "开始日期" : "截止日期"}{event.past ? " · 已过" : ""}</span><span className="block break-words text-xs leading-6 text-ink-3">{event.title}</span>
          </button><a href={event.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs leading-6 text-ink-3 underline">日期依据 ↗</a>
        </li>)}</ol> : <p className="mt-5 text-sm leading-7 text-ink-3">公告暂未明确申请日期，不绘制推测节点。</p>}
        {!!report.unknownDates && <p className="mt-2 text-xs leading-6 text-ink-3">{report.unknownDates}篇要点的截止日期待确认。</p>}
        <p className="mt-4 border-t border-line pt-4 text-xs leading-6 text-ink-3">仅展示已整理的开始与截止日期；考试、面试安排请核对原文，不把日期之间视为连续报名期。</p>
      </aside>
    </div> : <div className="my-7 border-l-2 border-line pl-4"><p className="font-serif text-xl text-ink">{report.state === "waiting" ? "简报正在准备中" : "暂时没有可用简报"}</p><p className="mt-3 text-sm leading-7 text-ink-3">{task.stats.candidates ? `已保存${task.stats.candidates}份候选材料，尚未完成要求整理。` : "有依据的摘要准备好后会出现在这里。"}</p></div>}
    {!!report.references.length && <details className="mt-5 border-t border-line pt-4"><summary className="min-h-11 cursor-pointer text-sm text-ink-3">校级或其他范围参考（不代表目标专业要求）</summary><ul className="space-y-3 py-3">{report.references.map(notice => <li key={notice.id} className="text-sm leading-7"><a href={notice.source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{notice.title} ↗</a><p className="text-xs text-ink-3">{notice.source.publishedOn ?? "发布日期待确认"} · {notice.department}</p></li>)}</ul></details>}
    {report.state === "ready" && <p className="mt-5 border-t border-line pt-4 text-xs leading-6 text-ink-3">根据已发布且有原文依据的摘要整理，按截止紧迫程度与发布日期筛选，最多3篇；招生条件以官方原文为准。上次检查{report.checkedAt ? ` ${new Date(report.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : "尚未完成"}，不代表已覆盖全部公告。</p>}
  </div>;
}
