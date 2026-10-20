import { cloneElement, useId, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router";
import type { ManagedResource, ResourceData, ResourceDetail, ResourceLink, ResourceTarget } from "@aihot/contracts/learning-resources";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, Input, Select, Textarea } from "@aihot/web/features/admin/ui";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement }) {
  const id = useId();
  return <div className="min-w-0"><label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</label>{cloneElement(children as ReactElement<{ id?: string }>, { id })}{hint && <p className="mt-1 text-[12px] text-ink-4">{hint}</p>}</div>;
}

export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  const [detail, targets] = await Promise.all([
    params.id ? adminGet<ResourceDetail>(request, `/api/admin/resources/${encodeURIComponent(params.id)}`) : Promise.resolve(null),
    adminGet<ResourceTarget[]>(request, "/api/admin/resources/targets"),
  ]);
  return { detail, targets };
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "资源录入与审核 · 后台" }];
const initialData: ResourceData = { kind: "experience", title: "", url: "", author: null, platform: "", contentType: "participation", topic: "", summary: "", summaryBasis: "", official: false, verification: "unverified", publishedDate: null, publishedYear: null, durationSeconds: null, coverUrl: null, coverPermission: null, availability: "available", availabilityReason: "" };
export default function ResourceEditor({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  return <Editor key={`${loaderData.detail?.resource.id ?? "new"}:${loaderData.detail?.resource.version ?? 0}`} {...loaderData} />;
}
function Editor({ detail, targets }: Awaited<ReturnType<typeof loader>>) {
  const navigate = useNavigate();
  const { run, busy } = useAdminAction();
  const resource = detail?.resource;
  const [form, setForm] = useState<ResourceData>(resource?.data ?? initialData);
  const [links, setLinks] = useState<ResourceLink[]>(resource?.links ?? []);
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const update = <K extends keyof ResourceData>(key: K, value: ResourceData[K]) => { setForm({ ...form, [key]: value }); setDirty(true); };
  const updateLink = (index: number, values: Partial<ResourceLink>) => { setLinks(links.map((link, i) => i === index ? { ...link, ...values } : link)); setDirty(true); };
  const save = async () => {
    const result = await run<ManagedResource>(resource ? "PUT" : "POST", resource ? `/api/admin/resources/${resource.id}` : "/api/admin/resources", { data: form, links, reason, expectedVersion: resource?.version ?? 0 }, { success: "已保存，等待审核", revalidate: !!resource });
    if (result && !resource) navigate(`/admin/resources/${result.id}`);
  };
  const review = async (action: "publish" | "withdraw") => { if (resource) await run("POST", `/api/admin/resources/${resource.id}/review`, { action, expectedVersion: resource.version, reason }, { success: action === "publish" ? "已发布" : "已撤回" }); };
  return <AdminPage title={resource ? "资源编辑与审核" : "录入资源"} subtitle="只保存链接和可核实元数据；个人经验不能作为官方规则。缺少作者或日期时保留未知。" actions={<Link to="/admin/resources" className="text-accent">返回资源列表</Link>}>
    {resource && <div className="mb-4"><Badge tone={resource.status === "published" ? "ok" : "muted"}>{{ draft: "待审核", published: "已发布", withdrawn: "已撤回" }[resource.status]} · 版本{resource.version}</Badge></div>}
    <div className="space-y-5"><Card title="资源信息"><div className="grid gap-4 sm:grid-cols-2">
      <Field label="资源类型"><Select value={form.kind} onChange={e => update("kind", e.target.value as ResourceData["kind"])}><option value="experience">经验帖</option><option value="video">教学视频</option></Select></Field>
      <Field label="内容类型"><Select value={form.contentType} onChange={e => update("contentType", e.target.value as ResourceData["contentType"])}><option value="participation">参赛经历</option><option value="beginner">入门建议</option><option value="tutorial">工具教程</option><option value="retrospective">赛后复盘</option></Select></Field>
      <Field label="标题"><Input value={form.title} onChange={e => update("title", e.target.value)} /></Field>
      <Field label="原文／原视频链接"><Input type="url" value={form.url} onChange={e => update("url", e.target.value)} /></Field>
      <Field label="作者／机构" hint="未知时留空"><Input value={form.author ?? ""} onChange={e => update("author", e.target.value || null)} /></Field>
      <Field label="平台"><Input value={form.platform} onChange={e => update("platform", e.target.value)} /></Field>
      <Field label="教学／经验主题"><Input value={form.topic} onChange={e => update("topic", e.target.value)} /></Field>
      <Field label="核验状态"><Select value={form.verification} onChange={e => update("verification", e.target.value as ResourceData["verification"])}><option value="unverified">待核验</option><option value="verified">已核验</option></Select></Field>
      <Field label="发布日期" hint="仅在可靠取得时填写"><Input type="date" value={form.publishedDate ?? ""} onChange={e => update("publishedDate", e.target.value || null)} /></Field>
      <Field label="发布年份" hint="只有年份时可单独填写"><Input type="number" min={1900} max={2200} value={form.publishedYear ?? ""} onChange={e => update("publishedYear", e.target.value ? Number(e.target.value) : null)} /></Field>
      <Field label="视频时长（秒）" hint="未知时留空"><Input type="number" min={1} value={form.durationSeconds ?? ""} onChange={e => update("durationSeconds", e.target.value ? Number(e.target.value) : null)} /></Field>
      <Field label="已核实为官方资源"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.official} onChange={e => update("official", e.target.checked)} /></Field>
      <Field label="封面链接（可选）"><Input type="url" value={form.coverUrl ?? ""} onChange={e => update("coverUrl", e.target.value || null)} /></Field>
      <Field label="封面使用依据"><Input value={form.coverPermission ?? ""} onChange={e => update("coverPermission", e.target.value || null)} /></Field>
      <Field label="简短介绍"><Textarea rows={4} value={form.summary} onChange={e => update("summary", e.target.value)} /></Field>
      <Field label="介绍依据" hint="注明原文、简介、字幕或人工整理依据"><Textarea rows={4} value={form.summaryBasis} onChange={e => update("summaryBasis", e.target.value)} /></Field>
      <Field label="链接可用性"><Select value={form.availability} onChange={e => update("availability", e.target.value as ResourceData["availability"])}><option value="available">可访问</option><option value="temporarily_unreachable">暂时无法访问</option><option value="invalid">已失效</option></Select></Field>
      <Field label="访问失败／失效原因"><Textarea value={form.availabilityReason} onChange={e => update("availabilityReason", e.target.value)} /></Field>
    </div></Card>
    <Card title="适用竞赛与范围"><p className="mb-4 text-[13px] text-ink-3">未限定届次和年份表示跨届通用；限定年份仅在该年份详情展示。旧届经验请关联原届次或年份，并在范围中说明。</p>
      <div className="space-y-4">{links.map((link, index) => { const target = targets.find(item => item.competitionId === link.competitionId); return <div key={index} className="grid gap-3 rounded-panel border border-line p-3 sm:grid-cols-2">
        <Field label="竞赛"><Select value={link.competitionId} onChange={e => updateLink(index, { competitionId: e.target.value, editionId: null, year: null })}>{targets.map(item => <option key={item.competitionId} value={item.competitionId}>{item.name}</option>)}</Select></Field>
        <Field label="届次"><Select value={link.editionId ?? ""} onChange={e => updateLink(index, { editionId: e.target.value || null })}><option value="">不限定届次</option>{target?.editions.map(edition => <option key={edition.id} value={edition.id}>{edition.year ?? "年份未知"} · {edition.id.slice(0, 8)}</option>)}</Select></Field>
        <Field label="限定适用年份（可选）"><Input type="number" min={1900} max={2200} value={link.year ?? ""} onChange={e => updateLink(index, { year: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="适用赛段／方向／范围"><Input value={link.scope} onChange={e => updateLink(index, { scope: e.target.value })} placeholder="例如：跨届通用 · 初学者入门" /></Field>
        <Field label="关联理由（仅后台）"><Textarea value={link.reason} onChange={e => updateLink(index, { reason: e.target.value })} /></Field>
        <div><Button disabled={busy} onClick={() => { setLinks(links.filter((_, i) => i !== index)); setDirty(true); }}>解除此关联</Button></div>
      </div>; })}</div>
      <div className="mt-4"><Button disabled={busy || !targets.length} onClick={() => { setLinks([...links, { competitionId: targets[0].competitionId, editionId: null, year: null, scope: "", reason: "" }]); setDirty(true); }}>添加竞赛关联</Button></div>
    </Card>
    <Card title="保存与审核"><Field label="本次操作说明"><Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="记录修改或审核依据" /></Field><div className="mt-4 flex flex-wrap gap-3">
      <Button disabled={busy || !reason.trim()} onClick={save}>保存待审核</Button>
      {resource && <><Button disabled={busy || dirty || !reason.trim() || resource.status === "published"} onClick={() => review("publish")}>审核发布</Button><Button disabled={busy || dirty || !reason.trim() || resource.status === "withdrawn"} onClick={() => review("withdraw")}>撤回</Button></>}
    </div>{dirty && resource && <p className="mt-3 text-[13px] text-ink-3">请先保存改动，再审核当前保存版本。保存会停止旧版本的公开展示。</p>}</Card>
    {detail && <Card title="修订与审核记录"><ol className="space-y-3 text-[13px]">{detail.history.map(item => <li key={item.version}><p>版本{item.version} · {item.actor} · {new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p><p className="text-ink-3">{item.reason}</p><details><summary className="cursor-pointer text-accent">查看该版本</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-[12px]">{JSON.stringify(item.snapshot, null, 2)}</pre></details></li>)}</ol></Card>}
    </div>
  </AdminPage>;
}
