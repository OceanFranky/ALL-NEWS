import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { MaintenanceConfig, MaintenanceOverview, MaintenancePlan } from "@aihot/contracts/learning-resources";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, Input, Select, Textarea } from "@aihot/web/features/admin/ui";

export async function loader({ request }: { request: Request }) {
  return adminGet<MaintenanceOverview>(request, "/api/admin/resources/maintenance");
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "资源自动维护 · 后台" }];
const states = { queued: "等待worker", running: "执行中", succeeded: "已完成", cancelled: "已停止", failed: "执行失败" };
const outcomes: Record<string, string> = { page_readable: "页面可读", missing: "疑似失效", restricted: "访问受限", unknown: "待人工检查", error: "请求异常", changed: "页面有变化", draft_created: "新建待审核", duplicate: "已有资源" };
export default function MaintenanceAdmin({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const revalidator = useRevalidator();
  const active = loaderData.runs.some(r => ["queued", "running"].includes(r.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void revalidator.revalidate(); }, 10000);
    return () => clearInterval(timer);
  }, [active, revalidator]);
  return <MaintenanceEditor key={loaderData.settings.version} overview={loaderData} refresh={() => { void revalidator.revalidate(); }} />;
}
function MaintenanceEditor({ overview, refresh }: { overview: MaintenanceOverview; refresh: () => void }) {
  const { run, busy } = useAdminAction();
  const [config, setConfig] = useState(overview.settings.config);
  const [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const [plan, setPlan] = useState<MaintenancePlan | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const change = (patch: Partial<MaintenanceConfig>) => { setConfig({ ...config, ...patch }); setDirty(true); setPlan(null); };
  const active = overview.runs.find(r => ["queued", "running"].includes(r.status));
  const report = overview.runs.find(r => r.id === selected) ?? overview.runs[0];
  const preview = async () => {
    setPreviewError("");
    try {
      const response = await fetch("/api/admin/resources/maintenance/preview", { credentials: "same-origin" });
      if (!response.ok) throw new Error();
      setPlan(await response.json());
    } catch { setPreviewError("维护计划读取失败，请刷新后重试。"); }
  };
  return <AdminPage title="资源自动维护" subtitle="发现候选、复查链接并保存报告。新候选仍需人工核验，异常链接和历史资源由管理员判断。" actions={<Link to="/admin/resources" className="text-accent">返回资源列表</Link>}>
    <div className="space-y-5">
      <Card title="运行控制"><div className="space-y-3 text-[13px]">
        <p><Badge tone={overview.collectionEnabled ? "ok" : "muted"}>{overview.collectionEnabled ? "采集总开关已开启" : "采集总开关关闭"}</Badge> · {overview.settings.config.enabled ? "定时维护已开启" : "定时维护关闭"}</p>
        <p className="text-ink-3">竞赛Agent每次运行时可同步接入资源；手动排队需竞赛／资源专用worker。03:40定时声明需部署调度器注册，单独勾选不会启动。请求上限涵盖来源页、候选页和已有资源；每次最多8秒、1MB，不跟随重定向。资源阶段不调用模型。</p>
        <div className="flex flex-wrap gap-3"><Button disabled={busy || dirty} onClick={preview}>预览下一次计划</Button><Button disabled={busy || dirty || !plan || !overview.collectionEnabled || !!active} onClick={async () => { await run("POST", "/api/admin/resources/maintenance/run", {}, { success: "已加入维护队列" }); setPlan(null); }}>立即运行一次</Button><Button onClick={refresh} disabled={busy}>刷新结果</Button></div>
        {dirty && <p>请先保存配置，再预览和运行。</p>}
        {previewError && <p role="alert">{previewError}</p>}
        {!overview.collectionEnabled && <p>可以保存配置和预览。实际请求需要运行环境明确设置COLLECT_ENABLED=true；本页不会修改环境配置。</p>}
        {plan && <div className="rounded-lg bg-surface-2 p-3"><p>到期来源页{plan.sources.length}个，已有资源{plan.resourceIds.length}条；最多{plan.settings.config.maxRequests}次请求、新建{plan.settings.config.maxCandidates}条草稿。</p>{plan.sources.map(s => <p key={`${s.competitionId}:${s.url}`} className="mt-2 break-all">{s.name}：{s.url}</p>)}</div>}
        {active && <div className="flex flex-wrap items-center gap-3"><span>{states[active.status]} · {active.report.requests}次请求 · {active.report.created}条新草稿{active.cancelRequested && " · 等待停止"}</span><Button disabled={busy || active.cancelRequested && Date.now() - Date.parse(active.updatedAt) < 15 * 60000} onClick={() => run("POST", `/api/admin/resources/maintenance/${active.id}/stop`, {}, { success: "已请求停止，当前请求结束后停止" })}>停止本次任务</Button></div>}
      </div></Card>
      <Card title="频率和执行上限"><div className="grid gap-4 text-[13px] sm:grid-cols-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={config.enabled} onChange={e => change({ enabled: e.target.checked })} />开启定时维护</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={config.competitionAgentEnabled} onChange={e => change({ competitionAgentEnabled: e.target.checked })} />竞赛Agent运行时接入资源</label>
        <label>检查频率<Select aria-label="检查频率" value={config.intervalDays} onChange={e => change({ intervalDays: Number(e.target.value) as 1 | 7 })}><option value={1}>每天</option><option value={7}>每周</option></Select></label>
        {([{ key: "maxSources", label: "每次来源页上限", max: 10, min: 0 }, { key: "maxChecks", label: "每次已有资源复查上限", max: 50, min: 0 }, { key: "maxCandidates", label: "每次新草稿上限", max: 20, min: 0 }, { key: "maxRequests", label: "每次请求总上限", max: 60, min: 1 }] as const).map(field => <label key={field.key}>{field.label}<Input type="number" min={field.min} max={field.max} value={config[field.key]} onChange={e => change({ [field.key]: Number(e.target.value) })} /></label>)}
      </div></Card>
      <Card title="31项竞赛的发现来源"><p className="mb-4 text-[13px] text-ink-3">竞赛Agent会从本次已保存材料的真实链接中发现资源，同源优先；实际出现的跨站链接也仅作待核验候选。以下额外发现页初始关闭，逐项核对网址及赛道后启用，仅跟进同源链接。未知日期、作者、届次和官方身份保持待核实。</p>
        <div className="space-y-2">{config.sources.map((source, index) => <details key={source.competitionId} className="rounded-lg border border-line p-3 text-[13px]">
          <summary className="cursor-pointer break-words">{source.enabled ? "已启用" : "关闭"} · {source.name}</summary>
          <div className="mt-3 space-y-3"><label className="flex items-center gap-2"><input type="checkbox" checked={source.enabled} onChange={e => change({ sources: config.sources.map((s, i) => i === index ? { ...s, enabled: e.target.checked } : s) })} />启用此来源（已确认网址与范围）</label>
            <label className="block">发现页网址，每行一个（最多4个）<Textarea rows={4} value={source.urls.join("\n")} onChange={e => change({ sources: config.sources.map((s, i) => i === index ? { ...s, urls: e.target.value.split("\n") } : s) })} /></label>
            <label className="block">标题关键词，用中文逗号分隔<Input value={source.keywords.join("，")} onChange={e => change({ sources: config.sources.map((s, i) => i === index ? { ...s, keywords: e.target.value.split(/[，,]/) } : s) })} /></label>
          </div></details>)}</div>
        <label className="mt-4 block text-[13px]">本次配置说明<Textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="mt-3"><Button disabled={busy || !reason.trim()} onClick={() => run("PUT", "/api/admin/resources/maintenance", { expectedVersion: overview.settings.version, reason, config: { ...config, sources: config.sources.map(s => ({ ...s, urls: s.urls.map(u => u.trim()).filter(Boolean), keywords: s.keywords.map(k => k.trim()).filter(Boolean) })) } }, { success: "维护配置已保存" })}>保存维护配置</Button></div>
      </Card>
      <Card title="维护运行记录"><div className="space-y-3 text-[13px]">
        {!overview.runs.length && <p>尚未执行维护。预览不发起外部请求，也不写入维护记录。</p>}
        {overview.runs.map(item => <button className="block w-full break-words rounded-lg border border-line p-3 text-left" key={item.id} onClick={() => setSelected(item.id)}>{new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）· {states[item.status]} · {item.report.requests}次请求／{item.report.created}条新草稿／{item.report.duplicates}条重复</button>)}
        {report && <div className="space-y-3">{report.plan.competition && <p className="break-all">竞赛Agent：{report.plan.competition.name} · 任务{report.plan.competition.runId}</p>}<p>本次采用配置版本{report.plan.settings.version}；执行次数达到上限时，剩余到期项保留到下一次计划。</p>
          {report.report.observations.map((item, index) => <div key={index} className="rounded-lg bg-surface-2 p-3"><p className="break-all">{outcomes[item.outcome] ?? item.outcome} · {item.url}</p><p className="mt-1">{item.note}{item.historical && "；发布日期超过一年，仅提醒核对是否仍适用，不自动移除"}</p>{item.resourceId && <Link to={`/admin/resources/${item.resourceId}`} className="mt-2 inline-block text-accent">查看资源并人工处理</Link>}</div>)}
        </div>}
      </div></Card>
    </div>
  </AdminPage>;
}
