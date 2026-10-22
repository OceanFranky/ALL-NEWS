import { Form, Link, data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { AdmissionDaily, AdmissionMonitor } from "@aihot/contracts/admission";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { AdmissionNav, NoticeCard, inputClass } from "./components.tsx";
export { AdmissionError as ErrorBoundary } from "./components.tsx";
export const handle = { tab: "admission", name: "升学动态" };
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const [daily, monitor] = await Promise.all([loadOr404<AdmissionDaily>(`/api/v1/admissions/daily?${query}`, { signal: request.signal }), loadOr404<AdmissionMonitor>("/api/v1/admissions/monitor", { signal: request.signal })]);
  return data({ daily, monitor }, { headers: headers() });
}
const labels: Record<string, string> = { pending: "等待首次检查", ok: "入口正常", partial: "部分入口异常", failed: "入口读取失败", "no-matching-notices": "暂无匹配公告" };
function time(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未检查"; }
export default function AdmissionUpdates() {
  const { daily, monitor } = useLoaderData<typeof loader>();
  const published = monitor.schools.filter(s => s.notices > 0).length;
  return <><PhoneBar title="升学动态" /><div className="pb-10 pt-3 lg:pt-0"><AdmissionNav />
    <header className="mb-8 border-t-2 border-t-accent border-b border-b-line pb-6 pt-5 lg:pt-7"><p className="mono mb-3 text-[10px] tracking-[0.2em] text-accent">ADMISSIONS / UPDATES</p><h1 data-page-title className="font-serif text-[32px] font-semibold tracking-tight text-ink lg:text-[40px]">升学动态与来源覆盖</h1><p className="mt-4 text-sm leading-7 text-ink-3">后台围绕用户添加的官网来源更新。当前{published}校有已发布公告；入口正常不代表已覆盖全部院系。机器整理通过格式与引用检查，仍需对照官方原文。</p></header>
    <section className="mb-8"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold text-ink">每日升学简报</h2><Form className="flex items-center gap-2"><label className="sr-only" htmlFor="digest-date">简报日期</label><input id="digest-date" name="date" type="date" defaultValue={daily.date} className={inputClass} /><button className="shrink-0 px-3 py-2 text-sm text-accent">查看</button></Form></div>
      <p className="mb-4 text-xs leading-6 text-ink-3">按北京时间的首次收录／更新汇总，原文可能早于收录日期。展示当前有效版本，撤回内容即时移除；本简报自动编排，不额外调用模型。</p>
      {!daily.changes.length && <p className="card p-5 text-sm text-ink-3">这一天暂无已发布的收录或更新。</p>}
      <div className="grid gap-4 xl:grid-cols-2">{daily.changes.map(c => <div key={c.notice.id}><p className="mb-2 text-xs text-accent">{c.kind === "new" ? "首次收录" : "内容更新"} · {time(c.at)}</p><NoticeCard item={c.notice} /></div>)}</div>
    </section>
    <section className="mb-8"><h2 className="mb-4 text-xl font-semibold text-ink">未来7天截止提醒</h2><div className="grid gap-4 xl:grid-cols-2">{daily.deadlines.map(n => <NoticeCard key={n.id} item={n} />)}</div>{!daily.deadlines.length && <p className="text-sm text-ink-3">当前已发布公告中暂无明确日期的截止项；未说明日期不等于没有期限。</p>}</section>
    <section><h2 className="text-xl font-semibold text-ink">历史39校来源检查记录</h2><p className="my-3 text-xs leading-6 text-ink-3">以下保留前期校级来源的检查时间，已停止按39校名单自动扩充。当前任务请在“我的来源”查看。“候选”不等于已发布公告。</p>
      <div className="grid gap-3 md:grid-cols-2">{monitor.schools.map(s => <article key={s.school.id} className="card min-w-0 p-4"><div className="flex flex-wrap justify-between gap-2"><Link to={`/admissions?school=${s.school.id}`} className="font-semibold text-accent">{s.school.name}</Link><span className="text-xs text-ink-3">{labels[s.status] ?? s.status}</span></div><p className="mt-3 text-sm text-ink-2">保研{s.baoyan} · 考研{s.kaoyan} · 候选{s.candidates}</p><p className="mt-2 text-xs leading-6 text-ink-3">最近检查：{time(s.checkedAt)}<br />最近成功：{time(s.lastOkAt)}<br />待核对{s.documents["needs-review"] ?? 0} · 等待模型{s.documents["awaiting-model"] ?? 0} · 额度暂停{s.documents["budget-paused"] ?? 0}</p><div className="mt-2 flex flex-wrap gap-3">{s.urls.map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">官方入口{i + 1} ↗</a>)}</div>{s.errors.length > 0 && <details className="mt-3 text-xs text-ink-3"><summary>读取问题（{s.errors.length}）</summary>{s.errors.map((e, i) => <p key={i} className="mt-2 break-all leading-6">{e}</p>)}</details>}</article>)}</div>
    </section></div></>;
}
