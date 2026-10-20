import { useEffect, useState } from "react";
import { Link } from "react-router";
import { stages, tracks, type PublicNotice } from "@aihot/contracts/admission";
import { beijingDate } from "@aihot/contracts/time";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { Deadline } from "./components.tsx";
import { useChecklist } from "./stars.ts";
import { sharedDeadlineDates, timelineScale } from "./visual-data.ts";

function TimelineFocus({ item }: { item: PublicNotice }) {
  const { checked } = useChecklist(item.id, item.version);
  const pending = item.materials.filter(text => !checked.includes(text));
  return <div className="mt-5 border-l-2 border-accent bg-accent-softer p-4 sm:p-5" data-timeline-focus aria-live="polite">
    <p className="break-words text-xs leading-6 text-accent">{item.school.name} · {item.year}级 · {tracks[item.track]} · {stages[item.stage]} · v{item.version}</p>
    <h3 className="mt-2 break-words text-base font-semibold leading-7 text-ink">{item.department} / {item.programme}</h3>
    <p className="mt-1 break-words text-xs leading-6 text-ink-3">{item.batch}</p>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-ink-3">开始日期</dt><dd className="mt-1 text-ink">{item.opensOn ?? "待确认"}</dd></div><div><dt className="text-xs text-ink-3">截止时间</dt><dd className="mt-1 text-ink"><Deadline item={item} /></dd></div></dl>
    {item.dateNote && <p className="mt-3 break-words text-xs leading-6 text-ink-3">{item.dateNote}</p>}
    <p className="mt-4 text-sm leading-7 text-ink-2">{!item.materials.length ? "材料尚未整理，先查阅该批次原文。" : pending.length ? `下一步核对材料：${pending.slice(0, 2).join("；")}${pending.length > 2 ? `等${pending.length}项` : ""}` : "已勾选当前版本全部材料，提交前请再核对模板与签章。"}</p>
    <div className="mt-4 flex flex-wrap gap-3"><Link to={`/admissions/${item.id}`} className={buttonClass()}>公告与材料详情 ↗</Link><a href={item.source.url} target="_blank" rel="noopener noreferrer" className={buttonClass()}>{item.demo ? "官方查找入口（非示例依据）" : "核对官方原文"} ↗</a></div>
  </div>;
}

export function ApplicationTimeline({ items }: { items: PublicNotice[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(beijingDate(new Date())); update();
    const timer = window.setInterval(update, 60_000); return () => window.clearInterval(timer);
  }, []);
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const scale = timelineScale(items); const shared = sharedDeadlineDates(items);
  const todayPosition = scale && today ? scale.position(today) : null;
  const showToday = todayPosition !== null && todayPosition >= 0 && todayPosition <= 100;
  return <section aria-labelledby="timeline-title" className="mb-6 rounded-2xl border border-line bg-surface p-4 sm:p-6" data-application-timeline>
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold tracking-widest text-accent">时间视图 / 按公告日期</p><h3 id="timeline-title" className="mt-2 font-serif text-xl font-bold text-ink sm:text-2xl">把重要节点，放在同一条线上。</h3></div><p className="text-xs leading-6 text-ink-3">点击目标，查看对应准备任务</p></div>
    <p className="mb-5 mt-3 text-xs leading-6 text-ink-3">线段连接公告列出的开始与截止日期，不代表期间每天均可报名；分段安排与具体时刻见下方说明。只有一个日期时只画节点。</p>
    {scale ? <div className="mb-2 sm:ml-44" data-timeline-axis><p className="mb-3 text-xs leading-5 text-ink-3">{scale.start} — {scale.end}{showToday && ` · 今天 ${today}（北京时间）`}</p><div className="relative h-4 text-xs tabular-nums text-ink-3">{scale.ticks.map((tick, index) => <span key={tick} data-timeline-tick className={`absolute ${index === 0 ? "" : index === 1 ? "-translate-x-1/2" : "-translate-x-full"}`} style={{ left: `${scale.position(tick)}%` }}>{tick.slice(5).replace("-", "/")}</span>)}</div></div> : <p className="rounded-xl bg-bg-sunk p-4 text-sm leading-7 text-ink-3">所选目标还没有明确日期，暂不绘制时间刻度。可以点选目标回查原文。</p>}
    <div className="divide-y divide-line">{items.map((item, index) => {
      const active = selected?.id === item.id;
      const start = item.opensOn && scale ? scale.position(item.opensOn) : null;
      const end = item.deadline && scale ? scale.position(item.deadline) : null;
      const label = item.opensOn && item.deadline ? `${item.opensOn} 开始，${item.deadline} 截止` : item.opensOn ? `${item.opensOn} 开始，截止待确认` : item.deadline ? `开始待确认，${item.deadline} 截止` : "开始与截止日期待确认";
      return <button type="button" key={item.id} data-timeline-target={item.id} aria-pressed={active} aria-label={`查看时间安排：${item.title}`} onClick={() => setSelectedId(item.id)} className={`grid min-h-24 w-full min-w-0 gap-3 px-2 py-4 text-left transition-colors motion-reduce:transition-none sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4 ${active ? "bg-accent-softer" : "hover:bg-bg-sunk"}`}>
        <span className="min-w-0"><span className="block break-words text-sm font-semibold text-ink"><span className="mr-2 font-mono text-xs text-accent">0{index + 1}</span>{item.school.name}</span><span className="mt-1 block break-words text-xs leading-6 text-ink-3">{item.programme}</span></span>
        <span className="min-w-0 self-center">
          {scale && (start !== null || end !== null) ? <span role="img" aria-label={label} className="relative block h-8 rounded-md bg-bg-sunk">
            {scale.ticks.map(tick => <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-px bg-line" style={{ left: `${scale.position(tick)}%` }} />)}
            {start !== null && end !== null && start !== end && <span aria-hidden="true" data-timeline-range className={`absolute top-2 h-4 rounded-sm bg-accent ${active ? "opacity-75" : "opacity-30"}`} style={{ left: `${start}%`, width: `${end - start}%` }} />}
            {start !== null && <span aria-hidden="true" data-timeline-open className="absolute top-3 size-2 -translate-x-1/2 rounded-full bg-accent ring-2 ring-surface" style={{ left: `${start}%` }} />}
            {end !== null && <span aria-hidden="true" data-timeline-deadline className="absolute top-2.5 size-3 -translate-x-1/2 rotate-45 bg-accent ring-2 ring-surface" style={{ left: `${end}%` }} />}
            {showToday && <span aria-hidden="true" className="absolute inset-y-0 border-l border-dashed border-ink-3" style={{ left: `${todayPosition}%` }} />}
          </span> : <span className="block rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-ink-3">日期待确认 · 不推测报名区间</span>}
          <span className="mt-2 block text-xs leading-6 text-ink-3">{label}</span>
        </span>
      </button>;
    })}</div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs leading-6 text-ink-3"><span>● 开始日期</span><span>◆ 截止日期</span>{showToday && <span>虚线：今天</span>}</div>
    {shared.map(([date, count]) => <p key={date} className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-xs leading-6 text-ink">{date} 有{count}个目标同日截止，具体时刻与提交方式请分别核对。</p>)}
    {selected && <TimelineFocus key={`${selected.id}:${selected.version}`} item={selected} />}
  </section>;
}
