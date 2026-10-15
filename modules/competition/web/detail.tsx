import { Link, data, useLoaderData, useLocation, useNavigate, type LoaderFunctionArgs } from "react-router";
import type { CompetitionDetail, CompetitionField, CompetitionLimit, CompetitionTime } from "@aihot/contracts/competitions";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { Activity, CompetitionImage, CompetitionNav, ExternalLink, FieldNotice, NextNode, Recognition, SaveButton, SectionTitle } from "./components.tsx";
import { activityLabels, competitionPath, displayDate, safeLink } from "./format.ts";

export const handle = { tab: "competition", name: "竞赛详情" };
export { CompetitionError as ErrorBoundary } from "./components.tsx";
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request, params }: LoaderFunctionArgs) {
  return data({ detail: await loadOr404<CompetitionDetail>(`/api/v1/competitions/${encodeURIComponent(params.competitionId ?? "")}/editions/${encodeURIComponent(params.editionId ?? "")}`, { signal: request.signal }) }, { headers: headers() });
}
export function meta({ loaderData }: { loaderData?: { detail: CompetitionDetail } }) {
  const item = loaderData?.detail.item;
  return pageMeta({ title: item?.name.value ?? "竞赛详情", description: item?.introduction.value ?? "查看竞赛时间、赛段、参赛人数限制及官方资料。", path: item ? competitionPath(item) : "/competitions/library" });
}
function Limits({ field }: { field: CompetitionField<CompetitionLimit[]> }) {
  return field.value?.length ? <ul className="space-y-3">{field.value.map((limit, index) => <li key={index}><span className="text-[12px] font-medium text-ink-2">{limit.scope}</span><p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{limit.text}</p></li>)}</ul> : <FieldNotice field={field} />;
}
function TimeList({ title, kind, field, activity }: { title: string; kind: "registration" | "competition"; field: CompetitionField<CompetitionTime[]>; activity: CompetitionDetail["item"]["activity"] }) {
  return <div><h3 className="mb-4 text-[14px] font-semibold text-ink">{title}</h3>{field.value?.length ? <ol className="ml-1 space-y-5 border-l border-line">{field.value.map((time, index) => {
    const state = activity.find(entry => entry.kind === kind && entry.scope === time.scope && entry.label === time.label);
    return <li key={index} className="relative pl-5"><span className="absolute -left-[4px] top-1.5 size-[7px] rounded-full bg-accent" aria-hidden="true" /><div className="flex flex-wrap items-center gap-2"><h4 className="text-[13px] font-semibold text-ink-2">{time.label}</h4>{state && <span className="text-[11px] text-accent">{activityLabels[state.status]}</span>}</div><p className="mt-1 break-words text-[12px] leading-relaxed text-ink-3">适用范围：{time.scope}</p><p className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink-2">{time.officialText}</p>{(time.start || time.end) && <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{time.start ? displayDate(time.start, time.precision, time.timezone) : "开始时间未确定"} — {time.end ? displayDate(time.end, time.precision, time.timezone) : "结束时间未确定"}</p>}<p className="mt-1 text-[11px] text-ink-4">{time.timezone} · {({ minute: "具体时刻", day: "日期", month: "月份", approximate: "大约安排" })[time.precision]}</p></li>;
  })}</ol> : <FieldNotice field={field} />}</div>;
}
export default function CompetitionDetailPage() {
  const { detail } = useLoaderData<typeof loader>();
  const { item } = detail;
  const location = useLocation();
  const navigate = useNavigate();
  const stateReturn = (location.state as { competitionReturn?: string } | null)?.competitionReturn;
  const back = stateReturn && /^\/competitions(?:\?|\/|$)/.test(stateReturn) ? stateReturn : "/competitions/library";
  const latestRead = item.sources.map(source => source.fetchedAt).sort().at(-1);
  return <><PhoneBar title="竞赛详情" back={{ to: back, label: "竞赛库" }} />
    <div className="pb-10 pt-4 lg:pt-0"><CompetitionNav />
      <button type="button" onClick={() => stateReturn ? navigate(-1) : navigate(back)} className="mb-5 min-h-9 text-[13px] text-ink-3 hover:text-accent">← 返回{back === "/competitions" ? "竞赛总览" : back.startsWith("/competitions/saved") ? "竞赛收藏" : "竞赛库"}</button>
      <header className="card mb-6 p-5 lg:p-7"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><Activity item={item} /><h1 data-page-title className="mt-4 break-words text-[25px] font-bold leading-snug text-ink lg:text-[30px]">{item.name.value ?? item.catalogueName}</h1><p title={item.year.value?.officialText} className="mt-3 text-[13px] text-ink-3">{item.year.value ? `${item.year.value.primary}年` : "所属年份待核验"}{item.year.value && item.year.value.primary < Number(detail.computedAt.slice(0, 4)) && <span className="ml-3 text-amber-ink">往届资料</span>}</p></div><SaveButton item={item} /></div><div className="mt-4"><Recognition item={item} /></div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-5 border-t border-line-soft pt-5"><NextNode item={item} />{safeLink(item.officialWebsite.value) ? <a href={safeLink(item.officialWebsite.value)} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>官方网站 ↗</a> : <div><p className="mb-1 text-[11px] text-ink-4">官网入口</p><FieldNotice field={item.officialWebsite} /></div>}</div>
        <div className="mt-5"><CompetitionImage key={item.promotionImage.value} item={item} large /></div>
      </header>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="card min-w-0 p-5 lg:col-start-1 lg:row-start-1 lg:p-6"><SectionTitle title="报名与比赛时间" description="不同赛段分别展示，官方原始表述和日期精度一并保留。" /><div className="space-y-7"><TimeList title="报名安排" kind="registration" field={item.registrationTimes} activity={item.activity} /><TimeList title="比赛安排" kind="competition" field={item.competitionTimes} activity={item.activity} /></div></section>
        <aside className="space-y-5 lg:col-start-2 lg:row-span-2 lg:row-start-1"><section className="card p-5"><SectionTitle title="参赛关键信息" /><div className="space-y-5"><div><h3 className="mb-2 text-[12px] font-semibold text-ink-3">学科方向</h3><p className="text-[13px] leading-relaxed text-ink-2">{item.categories.value?.join(" / ") ?? item.categories.reason}</p></div><div><h3 className="mb-2 text-[12px] font-semibold text-ink-3">参赛人数</h3><Limits field={item.participantLimit} /></div><div><h3 className="mb-2 text-[12px] font-semibold text-ink-3">指导老师</h3><Limits field={item.teacherLimit} /></div>{item.schoolRecognition.schoolRecognitionText && <p className="text-[12px] leading-relaxed text-ink-3">{item.schoolRecognition.schoolRecognitionText}</p>}<p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-4">学校级别来自已提供的认定名录，学校名称与认定有效年份尚未补充。未知人数不代表不限。</p></div></section>
          {detail.editions.length > 1 && <section className="card p-5"><h2 className="mb-3 text-[14px] font-semibold text-ink">其他届次</h2><ul className="space-y-3">{detail.editions.filter(edition => edition.editionId !== item.editionId).map(edition => <li key={edition.editionId}><Link to={competitionPath({ competitionId: item.competitionId, editionId: edition.editionId })} state={{ competitionReturn: back }} className="text-[13px] leading-relaxed text-accent hover:underline">{edition.name ?? `${edition.year ?? "年份待核验"}竞赛`}</Link></li>)}</ul></section>}
        </aside>
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-2">
          <section className="card p-5 lg:p-6"><SectionTitle title="竞赛简介" /><p className="whitespace-pre-line break-words text-[14px] leading-7 text-ink-2">{item.introduction.value ?? item.introduction.reason}</p></section>
          <section className="card p-5 lg:p-6"><SectionTitle title="已公布赛段" />{item.stages.value?.length ? <ol className="grid gap-3 sm:grid-cols-2">{item.stages.value.map((stage, index) => <li key={index} className="flex gap-3 rounded-control bg-bg-sunk p-3 text-[13px] leading-relaxed text-ink-2"><span className="num text-accent">{String(index + 1).padStart(2, "0")}</span>{stage}</li>)}</ol> : <FieldNotice field={item.stages} />}</section>
          <section className="card p-5 lg:p-6"><SectionTitle title="竞赛相关文件" description="查看对应届次的公开通知、规则与附件。" />{item.files.value?.length ? <ul className="divide-y divide-line-soft">{item.files.value.map((file, index) => <li key={index} className="py-3 first:pt-0"><ExternalLink href={file.url}>{file.title}</ExternalLink></li>)}</ul> : <FieldNotice field={item.files} />}
            <details className="mt-5 border-t border-line pt-4"><summary className="cursor-pointer text-[12px] font-medium text-ink-3">资料来源与读取时间（{item.sources.length}份）</summary><ul className="mt-3 space-y-3">{item.sources.map((source, index) => <li key={index} className="min-w-0 break-all"><ExternalLink href={source.url}>{safeLink(source.url) ? new URL(source.url).hostname : "公开材料"}</ExternalLink><p className="mt-1 text-[11px] text-ink-4">读取于 {displayDate(source.fetchedAt, "minute", "Asia/Shanghai")}（北京时间）</p></li>)}</ul></details>
          </section>
          <p className="text-[11px] leading-relaxed text-ink-4">本站信息更新于 {displayDate(item.publishedAt, "minute", "Asia/Shanghai")}；{latestRead ? `最近材料读取于 ${displayDate(latestRead, "minute", "Asia/Shanghai")}。` : ""}这些时间不代表官方发布日期。资料可能只覆盖部分赛段，后续安排请以官方通知为准。</p>
        </div>
      </div>
    </div>
  </>;
}
