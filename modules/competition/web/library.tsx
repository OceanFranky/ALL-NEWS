import { useState } from "react";
import { Form, Link, data, redirect, useLoaderData, useLocation, useNavigation, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { CompetitionFilters, CompetitionList } from "@aihot/contracts/competitions";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { Sheet } from "@aihot/web/components/ui/Sheet";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { Pagination } from "@aihot/web/features/feed/DayList";
import { CompetitionCard, CompetitionNav } from "./components.tsx";
import { activityLabels, libraryHref } from "./format.ts";

export const handle = { tab: "competition", name: "竞赛库" };
export { CompetitionError as ErrorBoundary } from "./components.tsx";
export const headers = () => ({ "Cache-Control": "no-store" });
const queryKeys = ["q", "category", "schoolLevel", "year", "activity", "sort", "page", "pageSize"];
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const key of queryKeys) for (const value of url.searchParams.getAll(key)) params.append(key, value);
  if (!params.has("pageSize")) params.set("pageSize", "12");
  const [result, filters] = await Promise.all([
    loadOr404<CompetitionList>(`/api/v1/competitions?${params}`, { signal: request.signal }),
    loadOr404<CompetitionFilters>("/api/v1/competitions/filters", { signal: request.signal }),
  ]);
  if (result.total > 0 && result.page > Math.ceil(result.total / result.pageSize)) {
    params.set("page", String(Math.ceil(result.total / result.pageSize)));
    throw redirect(libraryHref(params));
  }
  return data({ result, filters }, { headers: headers() });
}
export function meta() { return pageMeta({ title: "全部竞赛库", description: "按学科方向、学校认定、年份和报名状态查找竞赛，查看官方资料与赛段时间。", path: "/competitions/library" }); }

function FilterPanel({ filters, params, onClose }: { filters: CompetitionFilters; params: URLSearchParams; onClose: () => void }) {
  const [draft, setDraft] = useState(() => new URLSearchParams(params));
  const group = (key: string, title: string, options: Array<{ value: string; label: string }>, multiple = true) => <fieldset className="border-b border-line-soft py-4"><legend className="pt-4 text-[13px] font-semibold text-ink">{title}</legend><div className="mt-2 flex flex-wrap gap-2">{options.map(option => {
    const selected = (draft.get(key)?.split(",") ?? []).includes(option.value);
    return <label key={option.value} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-[12px] ${selected ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-ink-2"}`}><input type="checkbox" checked={selected} onChange={() => {
      const next = new URLSearchParams(draft);
      const values = multiple ? (draft.get(key)?.split(",") ?? []).filter(value => value !== option.value) : [];
      if (!selected) values.push(option.value);
      if (values.length) next.set(key, values.join(",")); else next.delete(key);
      setDraft(next);
    }} className="size-3.5 accent-accent" />{option.label}</label>;
  })}</div></fieldset>;
  return <Form method="get" action="/competitions/library" onSubmit={onClose}>
    {["q", "category", "schoolLevel", "year", "activity", "sort", "pageSize"].filter(key => draft.get(key)).map(key => <input key={key} type="hidden" name={key} value={draft.get(key)!} />)}
    <div className="px-5 pb-5">
      {group("category", "学科方向（可多选）", filters.categories.map(value => ({ value, label: value })))}
      {group("activity", "报名与比赛状态（按已知范围）", filters.activities.map(value => ({ value, label: activityLabels[value] })))}
      {group("schoolLevel", "学校认定级别", filters.schoolLevels.map(value => ({ value, label: value })))}
      {group("year", "竞赛所属年份", [...filters.years.map(value => ({ value: String(value), label: `${value}年` })), ...(filters.hasUnknownYear ? [{ value: "unknown", label: "年份待核验" }] : [])], false)}
      {group("sort", "排序", [{ value: "catalogue", label: "名录顺序" }, { value: "year_desc", label: "年份从新到旧" }, { value: "next_node", label: "下一节点从近到远" }], false)}
    </div>
    <div className="sticky bottom-0 flex gap-3 border-t border-line bg-surface p-4"><button type="button" className={`${buttonClass()} flex-1`} onClick={() => { const next = new URLSearchParams(); if (params.get("q")) next.set("q", params.get("q")!); setDraft(next); }}>重置筛选</button><button type="submit" className={`${buttonClass("primary")} flex-1`}>确定筛选</button></div>
  </Form>;
}

export default function CompetitionLibrary() {
  const { result, filters } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();
  const location = useLocation();
  const from = location.pathname + location.search;
  const busy = navigation.state !== "idle";
  const active = ["category", "schoolLevel", "year", "activity", "sort"].flatMap(key => (params.get(key)?.split(",") ?? []).map(value => ({ key, value })));
  const remove = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    const values = (next.get(key)?.split(",") ?? []).filter(entry => entry !== value);
    if (values.length) next.set(key, values.join(",")); else next.delete(key);
    next.delete("page"); setParams(next);
  };
  const label = (key: string, value: string) => key === "activity" ? activityLabels[value as keyof typeof activityLabels] : key === "sort" ? ({ catalogue: "名录顺序", year_desc: "年份从新到旧", next_node: "下一节点从近到远" }[value] ?? value) : value === "unknown" ? "年份待核验" : value;
  return <>
    <PhoneBar title="全部竞赛库" back={{ to: "/competitions", label: "竞赛总览" }} />
    <div className="pb-10 pt-4 lg:pt-0"><CompetitionNav />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-5"><div><h1 data-page-title className="text-[26px] font-bold tracking-tight text-ink">全部竞赛库</h1><p className="mt-2 text-[13px] leading-relaxed text-ink-3">从感兴趣的方向出发，找到竞赛与官方资料。</p></div><span className="num text-[13px] text-ink-3">共 {result.total} 项</span></div>
      <div className="mb-4 flex items-center gap-3"><Form key={params.get("q") ?? ""} method="get" className="flex min-w-0 flex-1 items-center gap-2">
        {queryKeys.filter(key => !["q", "page"].includes(key) && params.get(key)).map(key => <input key={key} type="hidden" name={key} value={params.get(key)!} />)}
        <label className="min-w-0 flex-1"><span className="sr-only">竞赛名称</span><input name="q" maxLength={200} defaultValue={params.get("q") ?? ""} placeholder="搜索竞赛名称" className="h-11 w-full rounded-full border border-line-strong bg-surface px-4 text-[14px] text-ink outline-none focus:border-accent" /></label><button type="submit" className={buttonClass("primary")}>搜索</button>
      </Form><button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={buttonClass()}>筛选{active.length ? ` · ${active.length}` : ""}</button></div>
      {active.length > 0 && <div className="mb-5 flex flex-wrap gap-2">{active.map(({ key, value }) => <button type="button" key={`${key}:${value}`} onClick={() => remove(key, value)} aria-label={`取消筛选 ${label(key, value)}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-3">{label(key, value)} <span aria-hidden="true">×</span></button>)}</div>}
      <p role="status" aria-live="polite" className="mb-3 text-[12px] text-ink-4">{busy ? "正在更新结果…" : "保留各届实际年份；报名与比赛按适用范围分别显示。"}</p>
      <div aria-busy={busy} className={`space-y-3 ${busy ? "opacity-60" : ""}`}>
        {result.items.map(item => <CompetitionCard key={item.editionId} item={item} from={from} />)}
        {!result.items.length && <div className="card"><EmptyState title={params.size ? "没有符合条件的竞赛" : "暂时没有可展示的竞赛"} action={<Link to="/competitions/library" className={buttonClass()}>清除条件</Link>}>可尝试其他关键词、年份或分类；没有结果不代表赛事已停办。</EmptyState></div>}
      </div>
      <Pagination page={result.page} pageCount={Math.ceil(result.total / result.pageSize)} href={page => { const next = new URLSearchParams(params); next.set("page", String(page)); return libraryHref(next); }} />
    </div>
    <Sheet open={open} onClose={() => setOpen(false)} title="筛选竞赛" centered>{open && <FilterPanel filters={filters} params={params} onClose={() => setOpen(false)} />}</Sheet>
  </>;
}
