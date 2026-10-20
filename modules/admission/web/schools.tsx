import { useMemo, useState } from "react";
import { Link, data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { AdmissionSchool } from "@aihot/contracts/admission";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { AdmissionNav, inputClass } from "./components.tsx";
export { AdmissionError as ErrorBoundary } from "./components.tsx";
export const handle = { tab: "admission", name: "升学院校目录" };
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) { return data(await loadOr404<AdmissionSchool[]>("/api/v1/admissions/schools", { signal: request.signal }), { headers: headers() }); }
export default function SchoolDirectory() {
  const schools = useLoaderData<typeof loader>(); const [q, setQ] = useState(""); const [tier, setTier] = useState(""); const [province, setProvince] = useState("");
  const found = useMemo(() => schools.filter(school => school.name.includes(q.trim()) && (!tier || school.tier === tier || tier === "211") && (!province || school.province === province)), [schools, q, tier, province]);
  const provinces = [...new Set(schools.map(school => school.province))];
  return <><PhoneBar title="院校目录" /><div className="pb-10 pt-3 lg:pt-0"><AdmissionNav /><p className="text-xs tracking-widest text-accent">从目标院校开始</p><h1 data-page-title className="mt-3 font-serif text-3xl font-bold text-ink">找到你的下一站</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-ink-3">已整理39所985及历史211目录；按112所院校、116个办学条目展示。目录和网站入口仍需逐校维护，不代表已采集全部招生信息；官网链接如有迁移，请通过研招网核对。</p>
    <div className="card my-6 grid gap-3 p-4 sm:grid-cols-3"><label><span className="sr-only">搜索院校</span><input className={inputClass} placeholder="输入院校名称" value={q} maxLength={100} onChange={event => setQ(event.target.value)} /></label><label><span className="sr-only">院校层次</span><select className={inputClass} value={tier} onChange={event => setTier(event.target.value)}><option value="">全部层次</option><option value="985">985</option><option value="211">211（含985）</option></select></label><label><span className="sr-only">地区</span><select className={inputClass} value={province} onChange={event => setProvince(event.target.value)}><option value="">全部地区</option>{provinces.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <p className="mb-4 text-xs text-ink-3">找到 {found.length} 个办学条目 · 河北工业大学按办学所在地列入天津</p><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{found.map(school => <article key={school.id} className="card flex min-w-0 flex-col p-5"><div className="flex justify-between gap-2 text-xs text-ink-3"><span>{school.province}</span><span className={school.tier === "985" ? "font-semibold text-accent" : ""}>{school.tier}</span></div><h2 className="mt-3 text-base font-semibold text-ink">{school.name}</h2><p className="mt-2 text-xs text-ink-3">公告覆盖以已发布记录为准</p><div className="mt-auto flex flex-wrap gap-4 pt-5 text-sm"><Link className="text-accent hover:underline" to={`/admissions?school=${school.id}`}>查看公告 →</Link>{school.website && <a className="text-ink-3 hover:underline" href={school.website} target="_blank" rel="noopener noreferrer">院校官网 ↗</a>}</div></article>)}</div>{!found.length && <p className="py-10 text-center text-sm text-ink-3">未找到匹配院校，请调整筛选。</p>}
    <p className="mt-6 text-sm text-ink-3">官方核对入口：<a href="https://yz.chsi.com.cn/sch/" target="_blank" rel="noopener noreferrer" className="text-accent underline">研招网院校库 ↗</a>。其他本科院校尚未批量录入。</p></div></>;
}
