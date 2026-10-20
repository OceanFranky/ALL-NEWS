import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { AdmissionImports, AdmissionImport } from "@aihot/contracts/admission";
import { readRaw, writeRaw } from "@aihot/web/lib/local-state";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { AdmissionNav, NoticeCard, inputClass } from "./components.tsx";
export const handle = { tab: "admission", name: "我的来源" };
export const headers = () => ({ "Cache-Control": "no-store" });
const KEY = "allnews-admission-sources-v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function storedIds(): string[] {
  const raw = readRaw(KEY); if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !uuid.test(v))) throw new Error("invalid-list");
    return [...new Set(value as string[])].slice(0, 20);
  } catch { throw new Error("本机来源清单损坏，未覆盖原数据。可先复制备份浏览器存储，或用下方恢复链接访问来源。"); }
}
export function ImportCard({ item, remove }: { item: AdmissionImport; remove?: () => void }) {
  return <article className="card min-w-0 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-accent">{item.school.name} · {item.kind === "notice" ? "具体公告" : "招生栏目"}{!item.enabled && " · 已暂停"}</p><h2 className="mt-2 break-words text-lg font-semibold text-ink">{item.title || "等待读取官网内容"}</h2></div>{remove && <button type="button" className="min-h-11 text-xs text-ink-3 underline" onClick={remove}>从本机移除</button>}</div>
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all text-xs leading-6 text-accent underline">{item.url} ↗</a><p role="status" className="mt-4 rounded-xl bg-bg-sunk p-3 text-sm leading-7 text-ink-2">{item.message}</p>
    <p className="mt-3 text-xs leading-6 text-ink-3">最近检查：{item.checkedAt ? new Date(item.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "等待首次读取"} · 发现{item.stats.documents ?? 0}条候选 · 已读取{item.stats.characters ?? 0}字 · 附件{item.stats.files ?? 0}份</p>
    <a href={`/admissions/sources?source=${item.id}`} className="mt-2 inline-block break-all text-xs text-accent underline">来源恢复链接（可另存或分享）</a>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">{item.notices.map(n => <NoticeCard key={n.id} item={n} />)}</div>
  </article>;
}
export default function AdmissionSources() {
  const [params] = useSearchParams(), source = params.get("source");
  const [ids, setIds] = useState<string[]>([]), [loaded, setLoaded] = useState(false), [items, setItems] = useState<AdmissionImport[]>([]);
  const [error, setError] = useState(""), [storageError, setStorageError] = useState(""), [busy, setBusy] = useState(false), [revision, refresh] = useState(0);
  useEffect(() => {
    const read = () => { try { setIds(storedIds()); } catch (e) { setStorageError((e as Error).message); } setLoaded(true); };
    read(); const listener = (e: StorageEvent) => { if (e.key === KEY || e.key === null) read(); };
    window.addEventListener("storage", listener); return () => window.removeEventListener("storage", listener);
  }, []);
  const viewed = [...new Set([...(source && uuid.test(source) ? [source] : []), ...ids])].slice(0, 20).join(",");
  useEffect(() => {
    if (!loaded) return;
    if (!viewed) { setItems([]); return; }
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/v1/admissions/imports?ids=${viewed}`, { signal: abort.signal });
        if (!response.ok) throw new Error("来源状态暂时无法读取，请点击刷新重试。");
        const value: AdmissionImports = await response.json(); if (abort.signal.aborted) return;
        setItems(value.items); setError("");
        if (value.items.some(i => i.status === "queued" || i.status === "reading")) timer = setTimeout(() => void load(), 5000);
      } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    }
    void load(); return () => { abort.abort(); clearTimeout(timer); };
  }, [viewed, revision, loaded]);
  function persist(next: string[]) {
    setIds(next);
    try { storedIds(); if (!writeRaw(KEY, JSON.stringify(next))) throw new Error("浏览器不允许保存。当前来源仅临时保留，请另存下方来源恢复链接。"); setStorageError(""); }
    catch (e) { setStorageError((e as Error).message); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !loaded) return; setError("");
    if (ids.length >= 20) { setError("本机最多保存20个来源，请先移除不再关注的来源。"); return; }
    const form = event.currentTarget, value = new FormData(form); setBusy(true);
    try {
      const response = await fetch("/api/v1/admissions/imports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: value.get("url"), kind: value.get("kind") }) });
      const result: { id?: string; detail?: string } = await response.json();
      if (!response.ok || !result.id) throw new Error(result.detail ?? "添加失败，请稍后重试。");
      persist([...new Set([result.id, ...ids])]); form.reset(); refresh(n => n + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><PhoneBar title="我的来源" /><div className="pb-10 pt-3 lg:pt-0"><AdmissionNav />
    <header className="mb-7 border-b border-line pb-6"><p className="text-sm text-accent">关注你的学院，跟进你的方向</p><h1 data-page-title className="mt-3 font-serif text-3xl font-bold text-ink">把官网链接，放进我的来源。</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-ink-3">添加学校或学院的招生公告、招生栏目，后台读取正文和可解析附件，整理申请条件、材料与时间。支持院校目录内学校的官方域名。</p></header>
    <form onSubmit={event => void submit(event)} className="card mb-6 space-y-4 p-5"><label className="block text-sm text-ink"><span className="mb-2 block font-semibold">官方网页链接</span><input type="url" name="url" required maxLength={2000} placeholder="https://… 学院公告或招生栏目" className={inputClass} /></label>
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-xs text-ink-3">链接类型</legend><label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm"><input className="mt-1" type="radio" name="kind" value="notice" defaultChecked /><span>具体公告<span className="mt-1 block text-xs leading-6 text-ink-3">直接读取这一篇公告，适合学院细则。</span></span></label><label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm"><input className="mt-1" type="radio" name="kind" value="listing" /><span>招生栏目<span className="mt-1 block text-xs leading-6 text-ink-3">每小时检查本页当年与次年的招生公告。</span></span></label></fieldset>
      <button disabled={busy || !loaded} className={buttonClass("primary")} type="submit">{busy ? "正在添加…" : "添加并读取"}</button><p className="text-xs leading-6 text-ink-3">清单保存在当前浏览器，最多20个，无账户同步。提交的链接与整理结果为公开资料；请勿粘贴带账号或口令的地址。移除仅取消本机关注，后台共享任务由管理员管理。</p>
    </form>
    {storageError && <p role="alert" className="mb-5 break-words rounded-xl border border-line p-4 text-sm leading-7 text-ink">{storageError}</p>}{error && <p role="alert" className="mb-5 text-sm text-ink">{error}</p>}
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold text-ink">我关注的官网</h2><button type="button" onClick={() => refresh(n => n + 1)} className={buttonClass()}>刷新状态</button></div>
    <p className="mb-5 text-xs leading-6 text-ink-3">通常约一分钟开始处理，每轮最多读取两篇。栏目仅检查当前页，扫描件、登录页和访问受限网页可能需要人工补充。模型额度不足时保留来源并提示等待；所有条件均需核对原文。</p>
    <div className="space-y-5">{items.map(item => <ImportCard key={item.id} item={item} remove={ids.includes(item.id) ? () => persist(ids.filter(id => id !== item.id)) : undefined} />)}</div>
    {loaded && !viewed && <div className="card p-8 text-sm leading-7 text-ink-3">还没有关注的来源。找到目标学院的招生通知，复制官方链接，从上方开始。</div>}
  </div></>;
}
