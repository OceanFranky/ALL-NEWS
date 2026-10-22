import { useState, type ReactNode } from "react";
import { isRouteErrorResponse, Link, NavLink, useRevalidator, useRouteError } from "react-router";
import type { CompetitionField, CompetitionRecord } from "@aihot/contracts/competitions";
import { Badge } from "@aihot/web/components/ui/Badge";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { IconBookmark, IconArrowUpRight } from "@aihot/web/components/icons";
import { activityLabels, competitionPath, displayDate, nodeLabels, safeLink } from "./format.ts";
import { toggleCompetitionStar, useCompetitionStars, type SavedCompetition } from "./stars.ts";

export function CompetitionNav() {
  return <nav aria-label="竞赛导航" className="scrollbar-none mb-6 flex snap-x gap-2 overflow-x-auto border-b border-line text-[13px] lg:gap-5">
    {[["/competitions", "竞赛总览"], ["/competitions/library", "全部竞赛库"], ["/competitions/saved", "竞赛收藏"]].map(([to, label]) => <NavLink key={to} to={to} end className={({ isActive }) => `min-h-11 shrink-0 snap-start border-b-2 px-3 pb-3 pt-2 lg:px-1 ${isActive ? "border-accent font-semibold text-accent" : "border-transparent text-ink-3 hover:text-ink"}`}>{label}</NavLink>)}
  </nav>;
}
export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3"><div><h2 className="flex items-center gap-2.5 text-[17px] font-semibold text-ink"><span className="h-4 w-0.5 bg-accent" />{title}</h2>{description && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{description}</p>}</div>{action}</div>;
}
export function FieldNotice({ field }: { field: CompetitionField<unknown> }) {
  return <span className="text-[13px] text-ink-3">{field.reason || "资料不足，待核验"}</span>;
}
export function SaveButton({ item }: { item: SavedCompetition }) {
  const saved = useCompetitionStars();
  const active = saved.some(entry => entry.editionId === item.editionId && entry.competitionId === item.competitionId);
  const [failed, setFailed] = useState(false);
  return <div className="relative shrink-0"><button type="button" aria-label={active ? "取消收藏" : "收藏竞赛"} aria-pressed={active} title={active ? "取消收藏" : "收藏竞赛"} onClick={() => setFailed(!toggleCompetitionStar(item))} className={`grid size-10 place-items-center rounded-full transition-colors ${active ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-bg-sunk hover:text-accent"}`}><IconBookmark size={19} /></button>{failed && <span role="status" className="absolute right-0 z-10 w-48 rounded-control border border-line bg-surface p-2 text-[12px] text-ink-3">浏览器未允许保存，请检查存储设置。</span>}</div>;
}
export function CompetitionImage({ item, large = false }: { item: CompetitionRecord; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = safeLink(item.promotionImage.value);
  if (!url || failed) return null;
  return <img src={url} alt={`${item.name.value ?? item.catalogueName}宣传图`} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} className={large ? "max-h-64 w-full rounded-card bg-bg-sunk object-contain" : "hidden h-28 w-40 shrink-0 rounded-control bg-bg-sunk object-cover xl:block"} />;
}
export function Recognition({ item }: { item: CompetitionRecord }) {
  const recognition = item.schoolRecognition;
  return <div className="flex flex-wrap gap-1.5">{recognition.schoolLevel && <Badge>{`学校认定 ${recognition.schoolLevel}`}</Badge>}{recognition.schoolLevelByScope.map((entry, index) => <span key={index} className="text-[11px] leading-relaxed text-ink-3">{entry.scope}：{entry.level}</span>)}</div>;
}
export function Activity({ item, compact = false }: { item: CompetitionRecord; compact?: boolean }) {
  const active = item.activity.filter(entry => entry.status === "registration_open" || entry.status === "competition_ongoing");
  const rest = item.activity.filter(entry => !active.includes(entry));
  const entries = compact ? [...active, ...rest].filter((entry, index, values) => values.findIndex(value => value.status === entry.status) === index).slice(0, 2) : item.activity;
  return <div className="flex flex-wrap gap-1.5">{entries.map((entry, index) => <span key={index} className="inline-flex max-w-full flex-wrap items-center gap-1">{!compact && entry.scope && <span className="break-words text-[11px] leading-relaxed text-ink-3">{entry.scope}</span>}<Badge tone={entry.status === "registration_open" || entry.status === "competition_ongoing" ? "accent" : "neutral"} title={entry.scope || undefined}>{activityLabels[entry.status]}</Badge></span>)}{compact && item.activity.length > entries.length && <Badge>共{item.activity.length}项安排</Badge>}</div>;
}
export function NextNode({ item }: { item: CompetitionRecord }) {
  const node = item.nextNodes[0];
  return node ? <div><p className="text-[11px] text-ink-3">{nodeLabels[node.kind]}</p><p className="mt-1 text-[14px] font-semibold text-accent">{displayDate(node.date, node.precision, node.timezone)}</p><p className="mt-1 text-[12px] text-ink-3">{node.daysRemaining === 0 ? "今天" : `还有 ${node.daysRemaining} 天`}{item.nextNodes.length > 1 ? ` · ${item.nextNodes.length}个并列节点` : ""}</p><p className="mt-1 break-words text-[11px] leading-relaxed text-ink-4">{node.scope}</p></div> : <p className="text-[12px] leading-relaxed text-ink-3">暂无可确定的后续节点<br /><span className="text-ink-4">以已公布赛段为准</span></p>;
}
export function CompetitionCard({ item, from, compact = false }: { item: CompetitionRecord; from?: string; compact?: boolean }) {
  const href = competitionPath(item);
  const title = item.name.value ?? item.catalogueName;
  return <article data-competition-card={item.editionId} className="card relative min-w-0 p-5 transition-colors hover:border-accent/35">
    <div className="flex items-start gap-5">
      {!compact && <CompetitionImage item={item} />}
      <div className="min-w-0 flex-1"><Activity item={item} compact /><h3 className="mt-2.5 break-words text-[16px] font-semibold leading-relaxed text-ink"><Link to={href} state={from ? { competitionReturn: from } : undefined} className="after:absolute after:inset-0 after:rounded-card focus:outline-none focus:after:ring-2 focus:after:ring-accent">{title}</Link></h3>
        <div className="mt-2 flex flex-wrap items-center gap-2"><span title={item.year.value?.officialText} className="text-[12px] text-ink-3">{item.year.value ? `${item.year.value.primary}年` : "年份待核验"}</span><Recognition item={item} /></div>
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-3">{item.introduction.value ?? item.introduction.reason}</p>
        {!compact && <div className="mt-3 space-y-1 text-[12px] leading-relaxed text-ink-3"><p>人数：{item.participantLimit.value?.map(entry => `${entry.scope}：${entry.text}`).join("；") ?? item.participantLimit.reason}</p><p>指导老师：{item.teacherLimit.value?.map(entry => `${entry.scope}：${entry.text}`).join("；") ?? item.teacherLimit.reason}</p></div>}
        <div className="mt-3 flex flex-wrap gap-1.5">{item.categories.value?.map(category => <Badge key={category}>{category}</Badge>)}</div>
      </div>
      <div className="relative z-10"><SaveButton item={item} /></div>
      {!compact && <div className="hidden w-44 shrink-0 border-l border-line pl-5 lg:block"><NextNode item={item} /></div>}
    </div>
    <div className={`mt-4 border-t border-line-soft pt-3 ${compact ? "" : "lg:hidden"}`}><NextNode item={item} /></div>
  </article>;
}
export function ExternalLink({ href, children }: { href: string | null; children: ReactNode }) {
  const safe = safeLink(href);
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 break-words text-[13px] leading-relaxed text-accent hover:underline">{children}<IconArrowUpRight size={14} /></a> : null;
}
export function CompetitionError() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const status = isRouteErrorResponse(error) ? error.status : 503;
  const title = status === 404 ? "竞赛暂不可查看" : status === 400 ? "筛选条件无效" : "暂时无法加载竞赛";
  return <><PhoneBar title="大学生竞赛" back={{ to: "/competitions", label: "竞赛总览" }} /><div className="pt-5 lg:pt-0"><CompetitionNav /><div className="card"><EmptyState title={title} action={<div className="flex flex-wrap justify-center gap-3"><Link to="/competitions/library" className={buttonClass()}>返回竞赛库</Link>{status >= 500 && <button type="button" onClick={() => void revalidator.revalidate()} className={buttonClass("primary")}>重新加载</button>}</div>}>{status === 404 ? "此记录可能已撤回，或尚未开放展示。" : status === 400 ? "请重置筛选条件后重试。" : "服务暂时不可用，请稍后重试；这不表示没有竞赛。"}</EmptyState></div></div></>;
}
