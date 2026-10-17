import { useState, type FormEvent } from "react";
import { data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { noticeSchema, stages, tracks, type AdmissionNotice, type AdmissionSchool, type AdminNotice } from "@aihot/contracts/admission";
import { adminGet } from "@aihot/web/lib/admin.server";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { inputClass } from "./components.tsx";
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) {
  const [rows, schools] = await Promise.all([adminGet<AdminNotice[]>(request, "/api/admin/admissions"), loadOr404<AdmissionSchool[]>("/api/v1/admissions/schools", { signal: request.signal })]);
  return data({ rows, schools }, { headers: headers() });
}
const blank: AdmissionNotice = {
  schoolId: "s001", title: "", track: "baoyan", stage: "pre", year: 2027, department: "", programme: "", batch: "", degree: "unknown", summary: "",
  opensOn: null, deadline: null, deadlineTime: null, dateNote: "", eligibility: [], materials: [],
  source: { title: "", url: "", publishedOn: null, checkedOn: null, verified: false, evidence: "" }, resources: [],
};
export default function AdmissionAdmin() {
  const { rows, schools } = useLoaderData<typeof loader>(); const [selected, setSelected] = useState<AdminNotice | null>(null); const [newKey, setNewKey] = useState(0);
  return <div className="pb-10"><h1 data-page-title className="text-2xl font-semibold text-ink">升学公告</h1><p className="my-4 max-w-3xl text-sm leading-7 text-ink-3">先录入草稿、核对具体院系与批次，再发布。修改已发布公告时，公开版本继续保留，直到再次发布；撤回立即停止公开读取。所有操作记录原因与审计。当前显示最近200条记录。</p>
    <div className="grid items-start gap-5 xl:grid-cols-[260px_minmax(0,1fr)]"><aside className="card p-4"><button className={`${buttonClass("primary")} mb-4`} onClick={() => { setSelected(null); setNewKey(value => value + 1); }}>＋ 新建公告</button><div className="space-y-2">{rows.map(row => <button key={row.id} className={`w-full rounded-lg border p-3 text-left ${selected?.id === row.id ? "border-accent bg-accent-soft" : "border-line"}`} onClick={() => setSelected(row)}><span className="block break-words text-sm font-medium text-ink">{row.draft.title}</span><span className="mt-2 block text-xs text-ink-3">{row.published ? "有公开版本" : "未公开"} · v{row.version}</span></button>)}{!rows.length && <p className="text-sm text-ink-3">暂无公告，请新建草稿。</p>}</div></aside>
    <Editor key={selected ? `${selected.id}:${selected.version}` : `new:${newKey}`} record={selected} schools={schools} onSaved={setSelected} /></div></div>;
}
function Editor({ record, schools, onSaved }: { record: AdminNotice | null; schools: AdmissionSchool[]; onSaved: (record: AdminNotice) => void }) {
  const item = record?.draft ?? blank; const action = useAdminAction(); const [error, setError] = useState(""); const [reason, setReason] = useState("");
  const [track, setTrack] = useState(item.track);
  const field = (name: string, label: string, value: string | number | null, type = "text", required = false) => <label className="block min-w-0 text-xs text-ink-3"><span className="mb-2 block">{label}{required && " *"}</span><input name={name} defaultValue={value ?? ""} type={type} required={required} maxLength={type === "text" ? 2000 : undefined} className={inputClass} /></label>;
  const area = (name: string, label: string, value: string, rows = 3, required = false) => <label className="block text-xs text-ink-3"><span className="mb-2 block">{label}{required && " *"}</span><textarea name={name} defaultValue={value} rows={rows} required={required} maxLength={10000} className={inputClass} /></label>;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget); const text = (name: string) => String(form.get(name) ?? "").trim(); const lines = (name: string) => text(name).split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    let resources: unknown;
    try { resources = JSON.parse(text("resources") || "[]"); } catch { setError("资源必须是合法JSON数组，请参照下方格式。"); return; }
    const result = noticeSchema.safeParse({ schoolId: text("schoolId"), title: text("title"), track: text("track"), stage: text("stage"), year: Number(text("year")), department: text("department"), programme: text("programme"), batch: text("batch"), degree: text("degree"), summary: text("summary"), opensOn: text("opensOn") || null, deadline: text("deadline") || null, deadlineTime: text("deadlineTime") || null, dateNote: text("dateNote"), eligibility: lines("eligibility"), materials: lines("materials"), source: { title: text("sourceTitle"), url: text("sourceUrl"), publishedOn: text("publishedOn") || null, checkedOn: text("checkedOn") || null, verified: form.get("verified") === "on", evidence: text("evidence") }, resources });
    if (!result.success) { setError(result.error.issues.map(issue => `${issue.path.join(".")}：${issue.message}`).join("；")); return; }
    const saved = await action.run<AdminNotice>("POST", "/api/admin/admissions", { ...(record ? { id: record.id, expectedVersion: record.version } : {}), notice: result.data, reason }, { success: "草稿已保存，公开版本尚未改变" });
    if (saved) onSaved(saved);
  }
  async function command(kind: "publish" | "withdraw") {
    if (!record || !reason.trim()) { setError("请先填写操作原因。"); return; }
    const saved = await action.run<AdminNotice>("POST", `/api/admin/admissions/${record.id}/${kind}`, { expectedVersion: record.version, reason }, { success: kind === "publish" ? "已发布保存的草稿" : "已撤回公开版本" });
    if (saved) onSaved(saved);
  }
  return <form className="card min-w-0 space-y-5 p-5 lg:p-6" onSubmit={event => void save(event)}><h2 className="text-lg font-semibold text-ink">{record ? "编辑草稿" : "新建公告"}</h2>{error && <p role="alert" className="break-words rounded-xl border border-line p-4 text-sm text-ink">{error}</p>}
    <div className="grid gap-4 md:grid-cols-2"><label className="text-xs text-ink-3"><span className="mb-2 block">院校 *</span><select name="schoolId" className={inputClass} defaultValue={item.schoolId}>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{field("year", "入学年份", item.year, "number", true)}<label className="text-xs text-ink-3"><span className="mb-2 block">路径 *</span><select name="track" value={track} onChange={event => setTrack(event.target.value as AdmissionNotice["track"])} className={inputClass}>{Object.entries(tracks).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs text-ink-3"><span className="mb-2 block">阶段 *</span><select name="stage" key={track} defaultValue={track === item.track ? item.stage : track === "baoyan" ? "pre" : "prospectus"} className={inputClass}>{Object.entries(stages).filter(([key]) => track === "baoyan" ? ["summer", "pre", "recommendation", "prospectus"].includes(key) : !["summer", "pre", "recommendation"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{field("department", "院系（校级通知请明确写全校）", item.department, "text", true)}{field("programme", "专业／方向（按原文适用范围）", item.programme, "text", true)}{field("batch", "批次（没有分批请明确写统一批次）", item.batch, "text", true)}<label className="text-xs text-ink-3"><span className="mb-2 block">学位类型</span><select name="degree" defaultValue={item.degree} className={inputClass}>{[["unknown", "未说明"], ["academic", "学术学位"], ["professional", "专业学位"], ["both", "均含"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    {field("title", "公告标题", item.title, "text", true)}{area("summary", "摘要（至少10字，不录入无授权全文）", item.summary, 4, true)}<div className="grid gap-4 md:grid-cols-3">{field("opensOn", "开始日期（可留空）", item.opensOn, "date")}{field("deadline", "截止日期（可留空）", item.deadline, "date")}{field("deadlineTime", "截止时刻（北京时间，不明确则留空）", item.deadlineTime, "time")}</div>{area("dateNote", "时间范围／例外说明", item.dateNote, 2)}<div className="grid gap-4 md:grid-cols-2">{area("eligibility", "申请条件（每行一项）", item.eligibility.join("\n"))}{area("materials", "材料清单（每行一项）", item.materials.join("\n"))}</div>
    <h3 className="border-t border-line pt-5 font-semibold text-ink">来源核验</h3>{field("sourceTitle", "官方原文标题", item.source.title, "text", true)}{field("sourceUrl", "具体公告链接（院校官网／研招网，不填门户首页）", item.source.url, "url", true)}<div className="grid gap-4 md:grid-cols-2">{field("publishedOn", "原文发布日期（未知留空）", item.source.publishedOn, "date")}{field("checkedOn", "人工核验日期", item.source.checkedOn, "date")}</div>{area("evidence", "支持摘要、条件、时间的原文短摘录（发布至少20字）", item.source.evidence, 4)}<label className="flex min-h-11 items-center gap-3 text-sm text-ink-2"><input type="checkbox" name="verified" defaultChecked={item.source.verified} />我已核对官方原文、年份、院系、专业、阶段与批次</label>
    {area("resources", "相关资源（JSON，可留空）", item.resources.length ? JSON.stringify(item.resources, null, 2) : "", 4)}<details className="text-xs leading-6 text-ink-3"><summary className="cursor-pointer">资源录入格式</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all">{'[{"kind":"experience","title":"标题","url":"https://…","author":"作者","year":2026,"scope":"适用院系、专业和阶段","note":"往届经验，仅供参考"}]'}</pre><p>kind可选official／experience／video；年份未知填null。不得使用带账号或密码的链接。</p></details>
    <label className="block text-xs text-ink-3"><span className="mb-2 block">操作原因 *（保存／发布／撤回均需要）</span><input className={inputClass} required value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label><div className="flex flex-wrap gap-3"><button className={buttonClass("primary")} disabled={action.busy || !reason.trim()} type="submit">保存草稿</button>{record && <><button className={buttonClass()} type="button" disabled={action.busy || !reason.trim()} onClick={() => void command("publish")}>发布已保存草稿</button><button className={buttonClass()} type="button" disabled={action.busy || !record.published || !reason.trim()} onClick={() => void command("withdraw")}>撤回公开版本</button></>}</div><p className="text-xs leading-6 text-ink-3">发布按钮只发布已保存内容。已公开记录的院校／年份／院系／专业／路径／阶段／批次不能直接改动；需要先撤回，再修正。并发编辑冲突会拒绝写入。</p>
  </form>;
}
