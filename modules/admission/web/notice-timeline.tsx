import { Link } from "react-router";
import { statusLabels, tracks, type PublicNotice } from "@aihot/contracts/admission";
import { SaveButton } from "./components.tsx";

export function NoticeTimeline({ items }: { items: PublicNotice[] }) {
  const dates = [...new Set(items.flatMap(item => item.deadline ? [item.deadline] : []))].sort();
  const unknown = items.filter(item => !item.deadline);
  return <section aria-label="本页申请时间轴">
    <p className="mb-6 text-xs leading-6 text-ink-3">按本页公告的申请截止日期排列，时间为北京时间；翻页可查看其他公告。未说明的日期单独列出。</p>
    <ol className="ml-2 border-l border-line-strong pl-6 sm:ml-5 sm:pl-8">{dates.map(date => <li key={date} className="relative pb-7 last:pb-0">
      <span aria-hidden="true" className="absolute -left-[29px] top-2 size-[9px] rounded-full border-2 border-surface bg-accent sm:-left-[37px]" />
      <h3 className="mono mb-3 text-sm font-semibold text-accent"><time dateTime={date}>{date}</time><span className="ml-3 text-xs font-normal text-ink-3">申请截止</span></h3>
      <div className="space-y-3">{items.filter(item => item.deadline === date).map(item => <TimelineNotice key={item.id} item={item} />)}</div>
    </li>)}</ol>
    {unknown.length > 0 && <section className="mt-7 border-t border-dashed border-line-strong pt-5"><h3 className="text-sm font-semibold text-ink">截止日期待确认 <span className="ml-2 font-normal text-ink-3">{unknown.length} 条</span></h3><p className="mb-4 mt-2 text-xs text-ink-3">请核对官方原文，不能据此判断仍可报名。</p><div className="space-y-3">{unknown.map(item => <TimelineNotice key={item.id} item={item} />)}</div></section>}
  </section>;
}

function TimelineNotice({ item }: { item: PublicNotice }) {
  return <article data-timeline-notice={item.id} className="card min-w-0 p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-ink-3">{item.school.name} · {tracks[item.track]} · {item.year}级</p><h4 className="mt-2 break-words text-base font-semibold leading-7 text-ink"><Link to={`/admissions/${item.id}`} className="hover:text-accent hover:underline">{item.title}</Link></h4></div><SaveButton id={item.id} /></div><p className="mt-2 line-clamp-2 text-sm leading-7 text-ink-2">{item.summary}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className={item.status === "open" ? "font-medium text-accent" : "text-ink-3"}>{statusLabels[item.status]}{item.deadline && ` · ${item.deadlineTime ? `${item.deadlineTime} 截止` : "具体时刻未说明"}`}</span><a href={item.source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">官方原文 ↗</a></div></article>;
}
