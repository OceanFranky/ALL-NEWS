import { useEffect, useState, type FormEvent } from "react";
import { data, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { stages, type AdmissionSchool } from "@aihot/contracts/admission";
import { agentStatusLabels, type AgentTask, type AgentTasks } from "@aihot/contracts/admission-agent";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { readRaw, writeRaw } from "@aihot/web/lib/local-state";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { AdmissionNav, inputClass } from "./components.tsx";
import { AgentReport } from "./agent-report.tsx";
export { AdmissionError as ErrorBoundary } from "./components.tsx";
export const handle = { tab: "admission", name: "升学简报" };
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) { return data({ schools: await loadOr404<AdmissionSchool[]>("/api/v1/admissions/schools", { signal: request.signal }), localReadOnly: process.env.AIHOT_ENVIRONMENT === "admission-local" }, { headers: headers() }); }
const KEY = "admission-agent-tasks-v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const active = ["queued", "discovering", "extracting", "supplementing"];
function stored(): string[] {
  const raw = readRaw(KEY); if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !uuid.test(id))) throw new Error("invalid-task-storage");
  return [...new Set(value as string[])].slice(0, 20);
}
const at = (date: string | null) => date ? new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未检查";
const fieldLabels: Record<string, string> = { new: "首次整理", deadline: "截止日期", deadlineTime: "截止时刻", opensOn: "开始日期", materials: "申请材料", eligibility: "申请条件", source: "原文依据", summary: "摘要", dateNote: "日程说明", resources: "附件资源" };
const stepLabels: Record<string, string> = { plan: "规划范围", search: "联网搜索", discover: "发现线索", supplement: "补查材料", read: "读取材料", extract: "提取要求", validate: "核对依据", finish: "结束本轮" };
const stepStatus: Record<string, string> = { ...agentStatusLabels, running: "进行中", ready: "已完成", empty: "未找到符合条件的线索", published: "已发布", unchanged: "内容未变", irrelevant: "与目标无关", "read-failed": "读取失败" };
export function AgentTaskCard({ task }: { task: AgentTask }) {
  return <article className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface" data-agent-task={task.id}>
    <header className="border-b border-line p-5 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs tracking-widest text-accent">ADMISSIONS BRIEF / {task.goal.year}</p><h2 className="mt-3 break-words font-serif text-2xl font-bold text-ink">{task.brief?.title ?? `${task.school.name} · 升学简报`}</h2></div><span role="status" className="text-xs leading-7 text-ink-3">{task.brief?.state === "ready" ? "已有简报" : agentStatusLabels[task.status]}</span></div><p className="mt-3 text-xs leading-6 text-ink-3">{task.goal.keywords.join(" · ") || "全校动态"} · {task.goal.year}级 · 最近检查 {at(task.checkedAt)}</p></header>
    <div className="p-5 sm:p-8"><AgentReport task={task} />
      <details className="mt-6 border-t border-line pt-4" data-agent-process><summary className="min-h-11 cursor-pointer text-xs text-ink-3">来源与处理记录 · {task.stats.pages}页已检查</summary><div className="pt-4">
      <p className="mb-4 text-xs leading-6 text-ink-3">{task.goal.stages.map(s => stages[s]).join(" / ")} · 第{task.cycle}轮 · {task.stats.candidates}份候选 · {task.stats.processed}份已处理</p>
      {!!task.gaps.length && <div className="mb-5 bg-bg-sunk p-4"><h3 className="text-sm font-semibold text-ink">还需要核对</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-6 text-ink-3">{task.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
      {task.search && <section className="mb-5 rounded-xl border border-line p-4" aria-label="联网搜索结果"><h3 className="text-sm font-semibold text-ink">联网发现 · {task.search.links.length}条官网线索</h3><p className="mt-2 text-xs leading-6 text-ink-3">来源：{task.search.provider} · {at(task.search.checkedAt)}。以下仅为搜索线索，是否适用需读取原文核对。</p><ul className="mt-2 space-y-2">{task.search.queries.map(query => <li key={query.query} className="text-xs leading-6 text-ink-3"><a className="break-words text-accent underline" href={query.url} target="_blank" rel="noopener noreferrer">{query.query} ↗</a><p>{query.status === "pending" ? "待搜索" : query.status === "running" ? "搜索中" : query.status === "failed" ? "搜索未完成，已保留其他入口" : `返回${query.returned}条 · 符合官网与范围筛选${query.accepted}条`}</p></li>)}</ul><ul className="mt-3 space-y-2 border-t border-line pt-3">{task.search.links.map(link => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer" className="break-words text-sm leading-6 text-accent underline">{link.title} ↗</a><p className="break-all text-xs leading-6 text-ink-3">{link.url}</p></li>)}</ul></section>}
      <details><summary className="min-h-11 cursor-pointer text-sm font-semibold text-accent">查看本轮执行记录 · {task.steps.length}条</summary><ol className="mt-2 border-l border-line pl-5">{task.steps.map(step => <li key={step.id} className="relative pb-5 before:absolute before:-left-[25px] before:top-1 before:size-2 before:rounded-full before:bg-accent"><p className="text-xs text-ink-3">{at(step.at)} · {stepLabels[step.stage] ?? "处理材料"} / {stepStatus[step.status] ?? "待核对"}</p><h4 className="mt-1 break-words text-sm font-medium text-ink">{step.title}</h4><p className="mt-1 break-words text-xs leading-6 text-ink-3">{step.detail}</p>{step.url && <a href={step.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-xs leading-6 text-accent underline">{step.stage === "search" ? "搜索结果页" : "官方材料"} ↗ {step.url}</a>}</li>)}</ol>{!task.steps.length && <p className="py-3 text-sm text-ink-3">任务已保存，等待后台执行；此处不会模拟运行步骤。</p>}</details>
      {!!task.changes.length && <details className="mt-5 border-t border-line pt-4"><summary className="min-h-11 cursor-pointer text-sm text-accent">相关公告最近收录与变化 · {task.changes.length}条</summary><p className="mb-3 text-xs leading-6 text-ink-3">按本站整理时间记录，官方原文可能更早；请打开当前有效版本核对。</p><ul className="space-y-3">{task.changes.map((change, i) => <li key={`${change.noticeId}:${i}`} className="text-xs leading-6 text-ink-3"><a className="text-accent underline" href={`/admissions/${change.noticeId}`}>{change.title}</a><p>{at(change.at)} · {change.kind === "new" ? "首次整理" : "已更新"} · {change.fields.map(field => fieldLabels[field] ?? "公告内容").join("、")}</p></li>)}</ul></details>}
      <p className="mt-2 text-xs leading-6 text-ink-3">剩余入口{task.stats.remaining}个 · 读取失败{task.stats.failed}页。一次检查不代表已覆盖该校全部专业。共享任务由管理员暂停或恢复。</p></div></details>
      <a className="mt-4 inline-block text-xs leading-6 text-ink-3 underline" href={`/admissions/agent?task=${task.id}`}>简报恢复链接（可另存或分享）</a>
    </div>
  </article>;
}
export default function AdmissionAgent() {
  const { schools, localReadOnly } = useLoaderData<typeof loader>(); const [params, setParams] = useSearchParams(); const restored = params.get("task");
  const [ids, setIds] = useState<string[]>([]), [loaded, setLoaded] = useState(false), [corrupt, setCorrupt] = useState(false);
  const [result, setResult] = useState<AgentTasks | null>(null), [error, setError] = useState(""), [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false), [revision, refresh] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [track, setTrack] = useState<"baoyan" | "kaoyan">("baoyan");
  const selectedTask = result?.items.find(task => task.id === restored) ?? result?.items[0];
  const stageOptions = track === "baoyan" ? ["summer", "pre", "recommendation"] as const : ["exam", "prospectus", "retest", "adjustment"] as const;
  useEffect(() => { try { setIds(stored()); } catch { setCorrupt(true); setWarning("本机任务清单无法读取，原数据已保留。请使用已保存的任务恢复链接。"); } setLoaded(true); }, []);
  const viewed = [...new Set([...(restored && uuid.test(restored) ? [restored] : []), ...ids])].slice(0, 20).join(",");
  useEffect(() => {
    if (!loaded) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const response = await fetch(`/api/v1/admissions/agents?ids=${viewed}`, { signal: abort.signal });
        if (!response.ok) throw new Error("任务状态暂时无法读取，请刷新重试。");
        const value: AgentTasks = await response.json(); if (abort.signal.aborted) return;
        setResult(value); setError(""); if (value.items.some(t => active.includes(t.status))) timer = setTimeout(() => void read(), 5000);
      } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    }
    void read(); return () => { abort.abort(); clearTimeout(timer); };
  }, [viewed, loaded, revision]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !loaded) return;
    if (ids.length >= 20) { setError("本机最多保存20个目标，请使用任务恢复链接查看其他目标。"); return; }
    const form = new FormData(event.currentTarget); setBusy(true); setError(""); setConfirmation("");
    try {
      const response = await fetch("/api/v1/admissions/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: form.get("source"), track,
        keywords: String(form.get("keywords") ?? "").split(/[,，、\s]+/).filter(Boolean), year: Number(form.get("year")), stages: form.getAll("stages"), searchWeb: form.has("searchWeb"), urls: [] }) });
      const value: { id?: string; reused?: boolean; detail?: string } = await response.json();
      if (!response.ok || !value.id) throw new Error(value.detail || "任务创建失败，请稍后重试。");
      const next = [...new Set([value.id, ...ids])]; setIds(next);
      if (corrupt || !writeRaw(KEY, JSON.stringify(next))) setWarning("任务已创建；本机未能保存清单，请另存下方任务恢复链接。");
      setParams(previous => { const next = new URLSearchParams(previous); next.set("task", value.id!); return next; }, { replace: true, preventScrollReset: true });
      setConfirmation(value.reused ? "已打开相同目标的已有任务，进度见下方；不会重复创建或自动重试已暂停的任务。" : "目标已创建并保存，进度见下方。后台按队列执行，首次检查通常需等待约一分钟。");
      refresh(n => n + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><PhoneBar title="升学简报" /><div className="pb-10 pt-3 lg:pt-0"><AdmissionNav />
    <header className="mb-8 max-w-2xl"><p className="font-mono text-xs tracking-widest text-accent">YOUR ADMISSIONS BRIEF</p><h1 data-page-title className="mt-3 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">学校动态，读这一份。</h1><p className="mt-4 text-sm leading-7 text-ink-3">告诉我一所学校，或贴一个官网链接。后台查找并阅读保研、考研公告，整理申请重点、下一步与时间轴，每条都能回到原文。</p></header>
    <form onSubmit={event => void submit(event)} className="mb-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <label className="block text-sm font-medium text-ink">学校名称或官网链接<input name="source" required minLength={2} maxLength={2000} list="agent-school-names" defaultValue={schools.find(s => s.id === params.get("school"))?.name ?? ""} placeholder="例如：清华大学，或 https://yz.tsinghua.edu.cn/" className={`${inputClass} mt-2`} /></label><datalist id="agent-school-names">{schools.map(s => <option key={s.id} value={s.name} />)}</datalist>
      <div className="mt-4 grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]"><label className="text-sm text-ink">升学方向<select aria-label="升学方向" name="track" value={track} onChange={e => setTrack(e.target.value as typeof track)} className={`${inputClass} mt-2`}><option value="baoyan">保研</option><option value="kaoyan">考研</option></select></label><label className="text-sm text-ink">专业方向（选填）<input name="keywords" maxLength={120} placeholder="留空关注全校，或填写计算机、软件" className={`${inputClass} mt-2`} /></label></div>
      <details className="mt-4 border-t border-line pt-3"><summary className="min-h-11 cursor-pointer text-xs leading-7 text-ink-3">年份与查找范围</summary><div className="pb-3 pt-2"><label className="block max-w-48 text-sm text-ink">入学年份<input name="year" type="number" required min="2020" max="2100" defaultValue={new Date().getUTCFullYear() + 1} className={`${inputClass} mt-2`} /></label><fieldset key={track} className="mt-4"><legend className="text-sm text-ink">关注阶段</legend><div className="mt-2 flex flex-wrap gap-3">{stageOptions.map(key => <label key={key} className="flex min-h-11 items-center gap-2 rounded-lg bg-bg-sunk px-3 text-sm text-ink"><input type="checkbox" name="stages" value={key} defaultChecked={key !== "summer"} className="size-4 accent-teal-700" />{stages[key]}</label>)}</div></fieldset><label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" name="searchWeb" defaultChecked className="size-4 accent-teal-700" />联网搜索新的官网入口</label><p className="text-xs leading-6 text-ink-3">仅跟进该校已核验的官网域名；搜索结果需读取原文后才能进入简报。暂未收录的学校需先核验官网归属。</p></div></details>
      <button type="submit" disabled={busy || !loaded} className={`${buttonClass("primary")} mt-2`}>{busy ? "正在保存…" : "生成我的升学简报 →"}</button><p className="mt-3 text-xs leading-6 text-ink-3">简报在后台整理，链接可保存后回来查看。学校资料与任务公开，请勿填写个人隐私。</p>
    </form>
    {localReadOnly && <p className="mb-5 text-xs leading-6 text-ink-3">本机预览：新任务暂不自动调用模型；已完成的真实简报可正常查看，刷新不会产生模型费用。</p>}
    {confirmation && <p role="status" aria-live="polite" className="mb-5 rounded-xl border border-line bg-accent-soft p-4 text-sm leading-7 text-accent">{confirmation}</p>}
    {warning && <p role="alert" className="mb-5 rounded-xl border border-line p-4 text-sm leading-7 text-ink">{warning}</p>}{error && <p role="alert" className="mb-5 text-sm text-ink">{error}</p>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-serif text-xl font-bold text-ink">我的简报</h2><button className={buttonClass()} onClick={() => refresh(n => n + 1)}>刷新简报</button></div>
    {restored && loaded && result && !result.items.some(task => task.id === restored) && <p role="alert" className="mb-4 text-sm leading-7 text-ink-3">该简报链接无效或已不可用，请重新创建。</p>}
    {selectedTask && <AgentTaskCard key={selectedTask.id} task={selectedTask} />}
    {!!result?.items.length && result.items.length > 1 && <details className="mt-5 border-t border-line pt-4"><summary className="min-h-11 cursor-pointer text-sm text-ink-3">其他已保存简报 · {result.items.length - 1}份</summary><ul className="space-y-2 py-3">{result.items.filter(task => task.id !== selectedTask?.id).map(task => <li key={task.id}><button type="button" className="min-h-11 text-left text-sm text-accent underline" onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set("task", task.id); return next; }, { preventScrollReset: true })}>{task.brief?.title ?? task.school.name} · {task.goal.year} · {task.goal.keywords.join("、") || "全校"}</button></li>)}</ul></details>}
    {loaded && result && !result.items.length && <p className="rounded-xl border border-dashed border-line-strong p-7 text-sm leading-7 text-ink-3">还没有简报。从一所学校开始，只读你关心的申请信息。</p>}
    {result && <details className="mt-5"><summary className="min-h-11 cursor-pointer text-xs text-ink-3">运行说明与额度</summary><p className="py-3 text-xs leading-6 text-ink-3">{localReadOnly ? "本机隔离库" : "升学累计"}模型保守记账 {result.budget.accountedUpperCny.toFixed(4)} / {result.budget.limitCny}元。额度不足时保存材料、暂停整理，不会自行追加；阅读与刷新不会调用模型。每目标每轮最多20页、深度3，每篇最多3附件；简报不代表全部公告或录取承诺。</p></details>}
  </div></>;
}
