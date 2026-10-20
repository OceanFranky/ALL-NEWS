import type { ReactNode } from "react";
import { Link } from "react-router";
import { stages, statusLabels, tracks, type PublicNotice } from "@aihot/contracts/admission";
import { Deadline, MaterialChecklist } from "./components.tsx";
import { ApplicationTimeline } from "./timeline.tsx";
import { MaterialMatrix } from "./material-matrix.tsx";

export function PreparationBoard({ items, onRemove }: { items: PublicNotice[]; onRemove: (id: string) => void }) {
  const columns = items.length === 3 ? "md:grid-cols-3" : items.length === 2 ? "md:grid-cols-2" : "";
  const mixedScope = new Set(items.map(item => `${item.track}:${item.year}:${item.stage}`)).size > 1;
  const row = (title: string, render: (item: PublicNotice) => ReactNode) => <section className="border-t border-line">
    <h3 className="bg-bg-sunk px-5 py-3 text-xs font-semibold tracking-wider text-ink-3">{title}</h3>
    <div className={`grid ${columns}`}>{items.map(item => <div key={item.id} className="min-w-0 break-words border-b border-line p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <p className="mb-3 text-xs font-medium text-accent md:hidden">{item.school.name} · {item.programme}</p>{render(item)}
    </div>)}</div>
  </section>;
  return <section id="target-comparison" aria-labelledby="comparison-title" className="scroll-mt-20">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="mb-2 text-xs font-semibold tracking-widest text-accent">02 / 比较目标</p><h2 id="comparison-title" className="font-serif text-2xl font-bold text-ink">把选择放在一起看</h2></div><p role="status" className="text-sm text-ink-3">已选 {items.length}/3 个目标</p></div>
    {!items.length ? <div className="rounded-2xl border border-dashed border-line-strong p-7 text-sm leading-7 text-ink-3">从下方收藏中选择最多3条公告，集中比较适用范围、时间与申请条件，再勾选材料。</div> : <>
      <div className="mb-4 rounded-xl border border-line bg-surface p-4 text-xs leading-6 text-ink-3">
        {items.some(item => item.demo) && <p className="font-semibold text-amber-700 dark:text-amber-300">当前仅对比虚构示例，不能用于报名。</p>}
        {items.length === 1 && <p>再选一个目标，即可对照查看。</p>}
        {mixedScope && <p className="font-semibold text-ink">所选公告的招生路径、年份或阶段不同，请先核对适用范围。</p>}
        <p>以下仅并列展示公告要点，不作院校排名或录取判断。缺失条件不表示没有要求，报名以对应院系、本批次官方原文为准。</p>
      </div>
      <ApplicationTimeline items={items} />
      <div className="overflow-hidden rounded-2xl border border-line bg-surface" data-target-comparison>
        <div className={`grid ${columns}`}>{items.map((item, index) => <header key={item.id} className="min-w-0 break-words border-b border-line p-5 md:border-b-0 md:border-r md:last:border-r-0">
          <div className="flex items-center justify-between gap-3"><span className="font-serif text-3xl text-accent/60">0{index + 1}</span><button className="min-h-11 px-2 text-xs text-ink-3 hover:text-accent" onClick={() => onRemove(item.id)} aria-label={`移出对比：${item.title}`}>移出对比</button></div>
          <p className="mt-2 font-semibold text-ink">{item.school.name}</p><Link to={`/admissions/${item.id}`} className="mt-2 block text-sm leading-7 text-accent hover:underline">{item.title} ↗</Link>
          <p className="mt-3 text-xs text-ink-3">{item.demo ? "虚构示例" : item.source.verification === "machine" ? "机器整理" : "人工核验"} · v{item.version}</p>
        </header>)}</div>
        {row("适用范围", item => <div className="space-y-2 text-sm leading-7 text-ink-2"><p className="font-semibold text-ink">{item.year}级 · {tracks[item.track]} · {stages[item.stage]}</p><p>{item.department}</p><p>{item.programme} / {item.batch}</p><p className="text-xs text-ink-3">{{ academic: "学术学位", professional: "专业学位", both: "学术／专业均含", unknown: "学位类型待确认" }[item.degree]}</p></div>)}
        {row("报名时间", item => <div className="space-y-2 text-sm leading-7 text-ink-2"><p className="font-semibold text-accent">{statusLabels[item.status]}</p><p>开始：{item.opensOn ?? "待确认"}</p><p>截止：<Deadline item={item} /></p>{item.dateNote && <p className="text-xs text-ink-3">{item.dateNote}</p>}</div>)}
        {row("申请条件", item => item.eligibility.length ? <ul className="list-disc space-y-2 pl-4 text-sm leading-7 text-ink-2">{item.eligibility.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p className="text-sm leading-7 text-ink-3">尚未整理，不能理解为没有限制。</p>)}
        {row("核对依据", item => <div className="text-xs leading-6 text-ink-3"><a href={item.source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-accent underline">{item.demo ? "官方查找入口（非示例依据）" : "核对官方原文"} ↗</a><p className="mt-2">原文发布：{item.source.publishedOn ?? "未说明"}</p><p>{item.source.verification === "machine" ? "机器证据检查" : "人工核验"}：{item.source.checkedOn ?? "未核验"}</p></div>)}
      </div>
      <section id="target-materials" aria-labelledby="preparation-title" className="mt-8 scroll-mt-20"><p className="mb-2 text-xs font-semibold tracking-widest text-accent">03 / 准备材料</p><h2 id="preparation-title" className="font-serif text-2xl font-bold text-ink">每个目标，逐项准备</h2><p className="mt-3 text-sm leading-7 text-ink-3">与公告详情页的清单同步，勾选只存于当前浏览器；公告更新版本后需重新核对。</p><MaterialMatrix items={items} /><div className={`mt-5 grid items-start gap-4 ${columns}`} data-target-checklists>{items.map(item => <div key={`${item.id}:${item.version}`} className="min-w-0 break-words"><h3 className="mb-3 text-sm font-semibold leading-7 text-ink">{item.school.name} · {item.programme}</h3><MaterialChecklist item={item} /></div>)}</div></section>
    </>}
  </section>;
}
