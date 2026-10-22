import { Form, Link, data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { CompetitionOverview } from "@aihot/contracts/competitions";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { EmptyState, MoreLink } from "@aihot/web/components/ui/Page";
import { CompetitionCard, CompetitionNav, SectionTitle } from "./components.tsx";
import { competitionPath, displayDate, nodeLabels } from "./format.ts";

export const handle = { tab: "competition", name: "竞赛总览" };
export { CompetitionError as ErrorBoundary } from "./components.tsx";
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) {
  return data(await loadOr404<CompetitionOverview>("/api/v1/competitions/overview", { signal: request.signal }), { headers: headers() });
}
export function meta() { return pageMeta({ title: "大学生竞赛", description: "浏览大学生竞赛、报名和比赛节点，以及不同学科方向的官方资料。", path: "/competitions" }); }
function changedValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(entry => typeof entry === "string" ? entry : entry && typeof entry === "object" ? [entry.scope, entry.officialText ?? entry.text].filter(Boolean).join("：") : String(entry)).join("；");
  return String(value ?? "待核验");
}
export default function CompetitionOverviewPage() {
  const overview = useLoaderData<typeof loader>();
  return <><PhoneBar title="大学生竞赛" />
    <div className="pb-12 pt-4 lg:pt-0"><CompetitionNav />
      <header className="mb-7 flex flex-wrap items-end justify-between gap-5 border-t-2 border-accent pt-5 lg:mb-9 lg:pt-7"><div><p className="mono mb-3 text-[10px] tracking-[0.2em] text-accent">COMPETITIONS / FIND YOUR FIELD</p><h1 data-page-title className="font-serif text-[34px] font-semibold leading-tight tracking-tight text-ink lg:text-[44px]">大学生竞赛</h1><p className="mt-2 text-[13px] leading-relaxed text-ink-3">关注报名与赛程，让每一次准备都有方向。</p></div><Link to="/competitions/library" className={buttonClass()}>全部竞赛库 →</Link></header>
      <Form action="/competitions/library" className="mb-7 flex gap-3"><label className="min-w-0 flex-1"><span className="sr-only">竞赛名称</span><input name="q" maxLength={200} placeholder="搜索竞赛名称，如软件杯、数学建模" className="h-11 w-full rounded-full border border-line-strong bg-surface px-4 text-[14px] text-ink outline-none focus:border-accent" /></label><button className={buttonClass("primary")} type="submit">搜索</button></Form>
      <div className="mb-9 grid grid-cols-3 divide-x divide-line border-y border-line py-4">{[["已收录届次", overview.total], ["有范围正在报名", overview.registrationOpen], ["有赛段正在进行", overview.competitionOngoing]].map(([label, value]) => <div key={label} className="px-3 first:pl-0 last:pr-0 sm:px-5"><div className="num text-[25px] font-semibold text-ink">{value}</div><p className="mt-1 text-[11px] text-ink-3 lg:text-[12px]">{label}</p></div>)}</div>
      <section className="mb-9"><SectionTitle title="正在进行" description="报名与比赛按官方已知范围分别判断，具体要求请查看详情。" action={<MoreLink to="/competitions/library?activity=registration_open,competition_ongoing">查看全部</MoreLink>} /><div className="grid gap-3 xl:grid-cols-3">{overview.active.slice(0, 6).map(item => <CompetitionCard key={item.editionId} item={item} compact from="/competitions" />)}</div>{!overview.active.length && <div className="card"><EmptyState title="当前没有可确定的进行中记录">仍可在竞赛库查看已公布的竞赛与后续安排。</EmptyState></div>}</section>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0"><section className="mb-9"><SectionTitle title="重点关注" description="先从软件、人工智能与数学建模三个方向了解竞赛；不是热度或含金量排名。" /><div className="space-y-4">{overview.featured.map(({ item, reason }) => <div key={item.editionId}><p className="mb-2 pl-1 text-[12px] leading-relaxed text-ink-3">{reason}</p><CompetitionCard item={item} compact from="/competitions" /></div>)}</div>{!overview.featured.length && <div className="card"><EmptyState title="暂无可展示的重点记录" /></div>}</section>
        <section><SectionTitle title="按方向探索" description="一项竞赛可以属于多个方向；保留实际年份与已知赛段。" /><div className="grid gap-3 md:grid-cols-2">{overview.categories.map(category => <section key={category.name} className="card min-w-0 p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-[14px] font-semibold text-ink"><Link to={`/competitions/library?${new URLSearchParams({ category: category.name })}`} className="hover:text-accent">{category.name}</Link></h3><span className="num text-[12px] text-ink-4">{category.count} 项</span></div><ul className="mt-3 space-y-2">{category.items.map(item => <li key={item.editionId} className="text-[12px] leading-relaxed"><Link to={competitionPath(item)} state={{ competitionReturn: "/competitions" }} className="text-ink-2 hover:text-accent">{item.name.value ?? item.catalogueName}</Link></li>)}</ul>{!category.items.length && <p className="mt-3 text-[12px] text-ink-4">暂无已确认分类的记录</p>}</section>)}</div></section></div>
        <aside className="min-w-0 space-y-6"><section className="border-t-2 border-line-strong pt-4"><SectionTitle title="近期关键节点" /><ol className="space-y-5">{overview.upcoming.slice(0, 10).map(({ item, node }, index) => <li key={`${item.editionId}:${index}`} className="border-l border-line-strong pl-4"><p className="text-[12px] font-semibold text-accent">{displayDate(node.date, node.precision, node.timezone)}</p><Link to={competitionPath(item)} state={{ competitionReturn: "/competitions" }} className="mt-1 block text-[13px] leading-relaxed text-ink-2 hover:text-accent">{item.name.value ?? item.catalogueName}</Link><p className="mt-1 text-[11px] leading-relaxed text-ink-3">{nodeLabels[node.kind]} · {node.scope}</p></li>)}</ol>{!overview.upcoming.length && <p className="text-[13px] text-ink-3">暂无可确定的后续节点。</p>}</section>
          <section className="border-t-2 border-line-strong pt-4"><SectionTitle title="重要变更" />{overview.changes.length ? <ul className="space-y-4">{overview.changes.map(change => <li key={change.item.editionId}><Link to={competitionPath(change.item)} className="text-[13px] font-semibold text-accent hover:underline">{change.item.name.value ?? change.item.catalogueName}</Link><p className="mt-1 text-[11px] text-ink-4">展示更新于 {displayDate(change.changedAt, "minute", "Asia/Shanghai")}</p><details className="mt-2 text-[12px] leading-relaxed text-ink-3"><summary className="cursor-pointer">{change.fields.map(field => field.name).join("、")}变化</summary>{change.fields.map(field => <div key={field.name} className="mt-2"><p className="font-medium">{field.name}</p><p>原：{changedValue(field.previous.value)}</p><p>现：{changedValue(field.current.value)}</p></div>)}</details></li>)}</ul> : <p className="text-[13px] leading-relaxed text-ink-3">暂无已确认的重要变更。首次收录不计为变更。</p>}</section>
          <div className="rounded-card border border-line p-5 text-[12px] leading-relaxed text-ink-3">资料可能包含往届或部分赛段。缺失信息会明确标注，请以适用范围内的官方通知为准。</div></aside>
      </div>
    </div>
  </>;
}
