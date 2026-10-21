import { useState } from "react";
import { Link, NavLink, useRouteError, isRouteErrorResponse, useRevalidator } from "react-router";
import { stages, statusLabels, tracks, type PublicNotice } from "@aihot/contracts/admission";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { IconBookmark } from "@aihot/web/components/icons";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { useStars, toggleStar, useChecklist } from "./stars.ts";

export const inputClass = "min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent";
export function AdmissionNav() {
  return <nav aria-label="升学导航" className="mb-7 flex flex-wrap gap-x-6 border-b border-line text-sm">{[["/admissions", "机会看板"], ["/admissions/schools", "院校目录"], ["/admissions/saved", "我的收藏"], ["/admissions/sources", "我的来源"], ["/admissions/agent", "升学简报"], ["/admissions/updates", "收录动态"]].map(([to, label]) => <NavLink key={to} to={to} end className={({ isActive }) => `border-b-2 py-3 ${isActive ? "border-accent font-semibold text-accent" : "border-transparent text-ink-3"}`}>{label}</NavLink>)}</nav>;
}
export function SaveButton({ id }: { id: string }) {
  const { ids } = useStars(); const active = ids.includes(id); const [failed, setFailed] = useState(false);
  return <div className="shrink-0"><button type="button" aria-pressed={active} aria-label={active ? "取消收藏公告" : "收藏公告"} className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-3 text-sm ${active ? "bg-accent-soft text-accent" : "bg-bg-sunk text-ink-3"}`} onClick={() => setFailed(!toggleStar(id))}><IconBookmark size={17} filled={active} /><span>{active ? "已收藏" : "收藏"}</span></button>{failed && <p role="status" className="mt-2 max-w-48 text-xs text-ink-3">保存失败，请检查浏览器存储；最多收藏100条。</p>}</div>;
}
export function Deadline({ item }: { item: PublicNotice }) {
  return <span>{item.deadline ? `${item.deadline}${item.deadlineTime ? ` ${item.deadlineTime}（北京时间）` : "（具体时刻未说明）"}` : "截止时间待确认"}</span>;
}
export function NoticeCard({ item }: { item: PublicNotice }) {
  return <article className="card min-w-0 p-5 transition-colors hover:border-accent/40" data-admission-card={item.id}>
    <div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2 text-xs"><span className="rounded bg-accent-soft px-2 py-1 font-medium text-accent">{tracks[item.track]} · {stages[item.stage]}</span><span className="rounded bg-bg-sunk px-2 py-1 text-ink-3">{item.year}级</span><span className="rounded bg-bg-sunk px-2 py-1 text-ink-3">{item.source.verification === "machine" ? "机器整理" : "人工核验"}</span></div><SaveButton id={item.id} /></div>
    <p className="mt-4 text-xs text-ink-3">{item.school.province} · {item.school.name} · {item.school.tier}</p><h2 className="mt-2 break-words text-lg font-semibold leading-relaxed text-ink"><Link to={`/admissions/${item.id}`} className="hover:text-accent hover:underline">{item.title}</Link></h2>
    <p className="mt-2 break-words text-xs text-ink-3">{item.department} / {item.programme} / {item.batch}</p><p className="mt-3 line-clamp-2 text-sm leading-7 text-ink-2">{item.summary}</p>
    <details className="mt-3 border-t border-line pt-3 text-sm"><summary className="cursor-pointer font-medium text-accent">查看申请条件与材料</summary><div className="mt-3 space-y-3 break-words text-xs leading-6 text-ink-2"><p className="text-ink-3">仅适用于上方院系／项目、年份和批次，是原文要点摘要。</p><div><p className="font-semibold">申请条件</p>{item.eligibility.length ? <ul className="list-disc pl-4">{item.eligibility.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p>尚未整理；不能理解为没有限制。</p>}</div><div><p className="font-semibold">申请材料</p>{item.materials.length ? <ul className="list-disc pl-4">{item.materials.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p>尚未整理，请核对原公告。</p>}</div><a href={item.source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">核对官方原文 ↗</a></div></details>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs"><p className="text-ink-3"><Deadline item={item} /></p><span className={item.status === "open" ? "font-semibold text-accent" : "text-ink-3"}>{statusLabels[item.status]}</span></div>
  </article>;
}
export function MaterialChecklist({ item }: { item: PublicNotice }) {
  const { checked, toggle } = useChecklist(item.id, item.version); const [failed, setFailed] = useState(false);
  return <section className="card p-5"><h2 className="text-lg font-semibold text-ink">材料准备 <span className="text-sm font-normal text-accent">{item.materials.filter(text => checked.includes(text)).length}/{item.materials.length}</span></h2><p className="mt-2 text-xs leading-6 text-ink-3">勾选仅保存在当前浏览器；公告版本更新后重新核对。此清单不代表资格审核通过。</p><div className="mt-4 space-y-2">{item.materials.map((text, i) => <label key={`${i}:${text}`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-bg-sunk p-3 text-sm leading-6 text-ink-2"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-teal-700" checked={checked.includes(text)} onChange={() => setFailed(!toggle(text))} /><span className={checked.includes(text) ? "line-through opacity-60" : ""}>{text}</span></label>)}</div>{!item.materials.length && <p className="mt-4 text-sm text-ink-3">材料尚未录入，请查阅原公告。</p>}{failed && <p role="status" className="mt-3 text-sm text-ink-3">浏览器未允许保存清单。</p>}</section>;
}
export function AdmissionError() {
  const error = useRouteError(); const revalidator = useRevalidator(); const missing = isRouteErrorResponse(error) && error.status === 404;
  return <><PhoneBar title="升学" /><AdmissionNav /><div className="card p-8"><h1 className="text-xl font-semibold text-ink">{missing ? "公告不存在或已撤回" : "暂时无法读取升学资料"}</h1><p className="my-4 text-sm text-ink-3">{missing ? "收藏会保留原编号；请返回看板查找最新公告。" : "请稍后重试，筛选条件会保留。"}</p><div className="flex gap-3"><Link to="/admissions" className={buttonClass()}>返回看板</Link>{!missing && <button className={buttonClass("primary")} disabled={revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}>重试</button>}</div></div></>;
}
