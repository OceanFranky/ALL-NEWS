import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PublicNotice } from "@aihot/contracts/admission";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { AdmissionNav, NoticeCard } from "./components.tsx";
import { toggleStar, useStars } from "./stars.ts";
import { PreparationBoard } from "./preparation.tsx";
export const handle = { tab: "admission", name: "升学收藏" };
export const headers = () => ({ "Cache-Control": "no-store" });
type SavedRow = { id: string; item?: PublicNotice; error?: "missing" | "network" };
export default function SavedAdmissions() {
  const { ids, corrupt } = useStars(); const [rows, setRows] = useState<SavedRow[]>([]); const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0); const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dataset, setDataset] = useState<"live" | "demo" | null>(null);
  const currentRows = rows.filter(row => ids.includes(row.id));
  const live = currentRows.filter(row => row.item && !row.item.demo);
  const demo = currentRows.filter(row => row.item?.demo);
  const activeDataset = dataset ?? (live.length ? "live" : "demo");
  const visible = activeDataset === "live" ? live : demo;
  const compared = visible.flatMap(row => row.item && selected.includes(row.id) ? [row.item] : []);
  const choose = (id: string) => setSelected(compared.some(item => item.id === id) ? compared.filter(item => item.id !== id).map(item => item.id) : [...compared.map(item => item.id), id].slice(0, 3));
  useEffect(() => {
    const abort = new AbortController(); setLoading(true);
    void Promise.all(ids.map(async (id): Promise<SavedRow> => {
      try { const res = await fetch(`/api/v1/admissions/${encodeURIComponent(id)}`, { signal: abort.signal, cache: "no-store" });
        if (res.status === 404) return { id, error: "missing" }; if (!res.ok) return { id, error: "network" };
        return { id, item: await res.json() as PublicNotice };
      } catch { return { id, error: "network" }; }
    })).then(values => { if (!abort.signal.aborted) { setRows(values); setLoading(false); } });
    return () => abort.abort();
  }, [ids, retry]);
  return <><PhoneBar title="升学收藏" /><div className="pb-10 pt-3 lg:pt-0"><AdmissionNav />
    <header className="mb-8 border-b border-line pb-7"><p className="mb-3 text-xs font-semibold tracking-widest text-accent">我的升学准备</p><h1 data-page-title className="font-serif text-3xl font-bold leading-tight text-ink lg:text-4xl">从心仪的目标，到下一步行动。</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-ink-3">收藏想去的项目，比较申请要求，再逐项准备材料。把分散的官网信息，整理成自己的申请路径。</p>
      <nav aria-label="升学准备步骤" className="mt-6 grid gap-3 sm:grid-cols-3">{[["01", "/admissions/sources", "收集官网", "添加自己关注的官方链接"], ["02", "#target-comparison", "比较目标", "最多3项，先核对适用范围"], ["03", "#target-materials", "准备材料", "逐项勾选，与详情页同步"]].map(([number, to, title, note]) => <Link key={number} to={to} className="flex min-w-0 items-center gap-4 rounded-xl border border-line p-4 transition-colors hover:border-accent"><span className="font-serif text-3xl text-accent/60">{number}</span><span><span className="block text-sm font-semibold text-ink">{title}</span><span className="mt-1 block text-xs leading-5 text-ink-3">{note}</span></span></Link>)}</nav>
      <p className="mt-4 text-xs leading-6 text-ink-3">收藏与勾选仅在当前浏览器保存，最多100条收藏，不自动发送提醒。已撤回公告不展示旧内容。</p></header>
    {corrupt && <p role="alert" className="card mb-4 p-4 text-sm text-ink-3">收藏数据无法读取，原始数据已保留。请检查浏览器存储。</p>}{failed && <p role="status" className="mb-4 text-sm text-ink-3">浏览器未允许修改收藏。</p>}
    {loading ? <p className="py-8 text-sm text-ink-3" role="status">正在读取收藏…</p> : <>
      {!!(live.length || demo.length) && <><div aria-label="收藏数据范围" className="mb-5 flex flex-wrap gap-3">{([["live", "真实公告", live.length], ["demo", "虚构演示", demo.length]] as const).map(([value, label, count]) => <button key={value} aria-pressed={activeDataset === value} className={buttonClass(activeDataset === value ? "primary" : "secondary")} onClick={() => { setDataset(value); setSelected([]); }}>{label} {count}</button>)}</div><PreparationBoard items={compared} onRemove={choose} />
      <section aria-labelledby="saved-title" className="mt-9"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><h2 id="saved-title" className="font-serif text-2xl font-bold text-ink">我的收藏 <span className="text-base font-normal text-ink-3">{visible.length}</span></h2><p className="text-xs leading-6 text-ink-3">{compared.length >= 3 ? "已选满3项，移出一项后可继续选择。" : "选择下方公告，加入上方对比。"}</p></div><div className="grid items-start gap-4 xl:grid-cols-2">{visible.map(row => <div key={row.id} className="min-w-0"><NoticeCard item={row.item!} /><button aria-pressed={compared.some(item => item.id === row.id)} disabled={compared.length >= 3 && !compared.some(item => item.id === row.id)} className={`${buttonClass(compared.some(item => item.id === row.id) ? "primary" : "secondary")} mt-3 w-full`} onClick={() => choose(row.id)} aria-label={`${compared.some(item => item.id === row.id) ? "移出对比" : "加入对比"}：${row.item!.title}`}>{compared.some(item => item.id === row.id) ? "已加入对比 · 点击移出" : "＋ 加入目标对比"}</button></div>)}</div>{!visible.length && <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-ink-3">该范围暂无收藏。<Link to={activeDataset === "demo" ? "/admissions?dataset=demo" : "/admissions"} className="ml-2 text-accent underline">去看板选择目标</Link></p>}</section></>}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">{currentRows.filter(row => !row.item).map(row => <article key={row.id} className="card p-5"><h2 className="font-semibold text-ink">{row.error === "missing" ? "公告已撤回或不存在" : "暂时无法读取这条公告"}</h2><p className="mt-2 break-all text-xs text-ink-3">编号：{row.id}</p><div className="mt-4 flex gap-3">{row.error === "network" && <button className={buttonClass()} onClick={() => setRetry(value => value + 1)}>重试</button>}<button className={buttonClass()} onClick={() => setFailed(!toggleStar(row.id))}>移除收藏</button></div></article>)}</div>
    </>}
    {!loading && !ids.length && !corrupt && <div className="card mt-6 p-8 text-center"><p className="mb-5 text-sm text-ink-3">还没有收藏。先找一个目标院校，或用虚构示例体验完整流程。</p><div className="flex flex-wrap justify-center gap-3"><Link className={buttonClass("primary")} to="/admissions">去机会看板</Link><Link className={buttonClass()} to="/admissions?dataset=demo">体验虚构示例</Link></div></div>}</div></>;
}
