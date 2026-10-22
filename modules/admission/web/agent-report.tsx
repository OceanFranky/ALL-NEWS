import { useRef, useState } from "react";
import type { AgentTask } from "@aihot/contracts/admission-agent";
import { stages } from "@aihot/contracts/admission";

export function AgentReport({ task }: { task: AgentTask }) {
  const report = task.brief;
  const [selected, setSelected] = useState<string | null>(null);
  const articles = useRef(new Map<string, HTMLElement>());
  function selectNotice(id: string) {
    setSelected(id);
    const article = articles.current.get(id);
    article?.focus({ preventScroll: true });
    article?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  if (!report) return <p className="py-4 text-sm leading-7 text-ink-3">尚无可阅读简报，任务状态与下一步见上方。</p>;
  return <div data-admission-brief>
    {(report.state === "ready" || !!report.references.length) && <p className="max-w-3xl text-[15px] leading-8 text-ink-2" data-brief-overview>{report.overview}</p>}
    {report.state === "ready" ? <>
      <div className="mt-6 grid grid-cols-3 divide-x divide-line border-y border-line py-4" role="group" aria-label="简报摘要">
        {[{ label: "匹配公告", value: report.current + report.closed, tone: "text-ink" }, { label: "已截止", value: report.closed, tone: "text-ink-3" }, { label: "本期要点", value: report.items.length, tone: "text-accent" }].map(item => <div key={item.label} className="px-3 first:pl-0 last:pr-0 sm:px-5"><span className={`font-mono text-2xl font-semibold ${item.tone}`}>{item.value}</span><span className="mt-1 block text-[11px] leading-5 text-ink-3 sm:text-xs">{item.label}</span></div>)}
      </div>
      <div className="mt-6 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 divide-y divide-line">{report.items.map(({ notice, reason, action }, index) => <section key={notice.id} ref={element => { if (element) articles.current.set(notice.id, element); else articles.current.delete(notice.id); }} tabIndex={-1} aria-label={notice.title} data-brief-item={notice.id} className={`min-w-0 scroll-mt-20 py-6 outline-none first:pt-0 ${selected === notice.id ? "rounded-lg bg-accent-softer px-3 ring-1 ring-accent/30" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-6"><span className="font-mono text-accent">{String(index + 1).padStart(2, "0")}</span><span className="font-medium text-accent">{reason}</span><span className="text-ink-3">{stages[notice.stage]} · {notice.source.publishedOn ? `${notice.source.publishedOn}发布` : "发布日期待确认"}</span></div>
        <h3 className="mt-2 break-words text-lg font-semibold leading-8 text-ink"><a href={notice.source.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{notice.title} ↗</a></h3>
        <p className="mt-1 break-words text-xs leading-6 text-ink-3">{notice.department} / {notice.programme} / {notice.batch}</p>
        <p className="text-xs leading-6 text-ink-3">{notice.source.verified ? "来源已人工核验" : "机器已核对原文引用 · 未经人工复核"}</p>
        <p className="mt-3 break-words text-sm leading-8 text-ink-2">{notice.summary.length > 320 ? `${notice.summary.slice(0, 320)}…（摘要节选，完整内容见详情）` : notice.summary}</p>
        {!!notice.eligibility.length && <div className="mt-3 text-sm leading-7 text-ink-2"><p className="line-clamp-3 break-words"><span className="font-medium text-ink">申请重点：</span>{notice.eligibility.slice(0, 2).join("；")}。</p><details className="mt-1 text-xs leading-6 text-ink-3"><summary className="min-h-10 cursor-pointer py-2">展开查看完整申请条件</summary><ul className="list-disc space-y-2 pb-2 pl-4">{notice.eligibility.map((requirement, requirementIndex) => <li key={requirementIndex} className="break-words">{requirement}</li>)}</ul></details></div>}
        <p className="mt-4 break-words rounded-r-lg border-l-2 border-accent bg-accent-softer px-4 py-3 text-sm leading-7 text-ink-2"><span className="mb-1 block text-[11px] font-semibold tracking-wide text-accent">建议下一步</span>{action}</p>
        {notice.dateNote && <p className="mt-2 break-words text-xs leading-6 text-ink-3">日程说明：{notice.dateNote}</p>}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs leading-6"><a href={notice.source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">[{index + 1}] 官方原文 ↗</a><a href={`/admissions/${notice.id}`} className="text-ink-3 underline">条件与材料详情</a></div>
      </section>)}</div>
      <aside className="order-first min-w-0 rounded-xl border border-line bg-bg-sunk p-4 sm:p-5 xl:sticky xl:top-6 xl:order-last xl:border-0 xl:bg-transparent xl:p-0" aria-label="简报时间轴">
        <p className="font-mono text-[10px] tracking-[0.16em] text-accent">DATES FROM OFFICIAL NOTICES</p><h3 className="mt-1 font-serif text-lg font-semibold text-ink">申请时间轴</h3><p className="mt-1 text-xs leading-6 text-ink-3">北京时间 · 点选日期查看对应公告要点</p>
        {report.timeline.length ? <ol className="mt-5 border-l border-line-strong pl-4">{report.timeline.map((event, index) => <li key={`${event.noticeId}:${event.kind}`} className={`relative pb-4 before:absolute before:-left-[21px] before:top-4 before:size-2.5 before:rounded-full before:ring-4 before:ring-bg-sunk xl:before:ring-bg ${event.past ? "before:bg-ink-4" : event.kind === "deadline" ? "before:bg-hot" : "before:bg-accent"}`}>
          <button type="button" aria-pressed={selected === event.noticeId} onClick={() => selectNotice(event.noticeId)} className={`min-h-11 w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected === event.noticeId ? "border-accent/40 bg-accent-soft" : "border-transparent hover:border-line hover:bg-surface"}`} data-brief-node={index}>
            <span className="block font-mono text-sm font-medium text-ink">{event.date}{event.time && ` ${event.time}`}</span><span className={`mt-1 block text-xs font-medium leading-6 ${event.past ? "text-ink-4" : event.kind === "deadline" ? "text-hot" : "text-accent"}`}>{event.kind === "opens" ? "开始日期" : "截止日期"}{event.past ? " · 已过" : ""}</span><span className="block break-words text-xs leading-6 text-ink-3">{event.title}</span>
          </button><a href={event.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs leading-6 text-ink-3 underline">日期依据 ↗</a>
        </li>)}</ol> : <p className="mt-5 text-sm leading-7 text-ink-3">公告暂未明确申请日期，不绘制推测节点。</p>}
        {!!report.unknownDates && <p className="mt-2 text-xs leading-6 text-ink-3">{report.unknownDates}篇要点的截止日期待确认。</p>}
        <p className="mt-4 border-t border-line pt-4 text-xs leading-6 text-ink-3">仅展示已整理的开始与截止日期；考试、面试安排请核对原文，不把日期之间视为连续报名期。</p>
      </aside>
      </div>
    </> : <div className="my-4 border-t border-line pt-4"><p className="text-sm font-medium text-ink">尚无可阅读简报</p><p className="mt-1 text-sm leading-7 text-ink-3">{task.stats.candidates ? `已发现${task.stats.candidates}份候选材料，目前没有可写入简报的匹配公告；候选不等于已核验要求。` : "目前没有可写入简报的匹配公告，不能据此认定学校尚未发布。"}</p></div>}
    {!!report.references.length && <details className="mt-5 border-t border-line pt-4"><summary className="min-h-11 cursor-pointer text-sm text-ink-3">校级或其他范围参考（不代表目标专业要求）</summary><ul className="space-y-3 py-3">{report.references.map(notice => <li key={notice.id} className="text-sm leading-7"><a href={notice.source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{notice.title} ↗</a><p className="text-xs text-ink-3">{notice.source.publishedOn ?? "发布日期待确认"} · {notice.department}</p></li>)}</ul></details>}
    {report.state === "ready" && <p className="mt-5 border-t border-line pt-4 text-xs leading-6 text-ink-3">根据已发布且有原文依据的摘要整理，按截止紧迫程度与发布日期筛选，最多3篇；招生条件以官方原文为准。上次检查{report.checkedAt ? ` ${new Date(report.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : "尚未完成"}，不代表已覆盖全部公告。</p>}
  </div>;
}
