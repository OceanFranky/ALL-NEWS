import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PublicNotice } from "@aihot/contracts/admission";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { AdmissionNav, NoticeCard } from "./components.tsx";
import { toggleStar, useStars } from "./stars.ts";
export const handle = { tab: "admission", name: "升学收藏" };
export const headers = () => ({ "Cache-Control": "no-store" });
type SavedRow = { id: string; item?: PublicNotice; error?: "missing" | "network" };
export default function SavedAdmissions() {
  const { ids, corrupt } = useStars(); const [rows, setRows] = useState<SavedRow[]>([]); const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0); const [failed, setFailed] = useState(false);
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
  return <><PhoneBar title="升学收藏" /><div className="pb-10 pt-3 lg:pt-0"><AdmissionNav /><h1 data-page-title className="font-serif text-3xl font-bold text-ink">留给下一步的准备</h1><p className="my-4 text-sm leading-7 text-ink-3">升学收藏与新闻、竞赛收藏分别保存，仅在当前浏览器可见，最多100条；不自动发送提醒。已撤回公告不会继续展示旧内容。</p>{corrupt && <p role="alert" className="card mb-4 p-4 text-sm text-ink-3">收藏数据无法读取，原始数据已保留。请检查浏览器存储。</p>}{failed && <p role="status" className="mb-4 text-sm text-ink-3">浏览器未允许修改收藏。</p>}
    {loading ? <p className="py-8 text-sm text-ink-3" role="status">正在读取收藏…</p> : <div className="grid gap-4 xl:grid-cols-2">{rows.map(row => row.item ? <NoticeCard key={row.id} item={row.item} /> : <article key={row.id} className="card p-5"><h2 className="font-semibold text-ink">{row.error === "missing" ? "公告已撤回或不存在" : "暂时无法读取这条公告"}</h2><p className="mt-2 break-all text-xs text-ink-3">编号：{row.id}</p><div className="mt-4 flex gap-3">{row.error === "network" && <button className={buttonClass()} onClick={() => setRetry(value => value + 1)}>重试</button>}<button className={buttonClass()} onClick={() => setFailed(!toggleStar(row.id))}>移除收藏</button></div></article>)}</div>}
    {!loading && !ids.length && !corrupt && <div className="card mt-6 p-8 text-center"><p className="mb-5 text-sm text-ink-3">还没有收藏。先找一个目标院校或体验示例。</p><Link className={buttonClass("primary")} to="/admissions">去机会看板</Link></div>}</div></>;
}
