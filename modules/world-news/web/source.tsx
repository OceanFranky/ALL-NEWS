import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminSourceDetail } from '@aihot/contracts/admin';
import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,DataTable,Field,Json,ReasonDialog,Select,Stat,Time } from '@aihot/web/features/admin/ui';

type WorldSource=AdminSourceDetail & { sectionId:'world';permission:null|{ summary_allowed:boolean;permission_reference:string;reviewed_by:string;reviewed_at:string } };
export async function loader({ request,params }:{ request:Request;params:Record<string,string|undefined> }) {
  return adminGet<WorldSource>(request,`/api/admin/world/sources/${encodeURIComponent(params.id ?? '')}`);
}
export const meta=()=>[{ title:'世界信源详情 · 后台' }];
export default function WorldSourceAdmin({ loaderData:m }:{ loaderData:WorldSource }) {
  const { run,busy }=useAdminAction(),[open,setOpen]=useState(false),[allowed,setAllowed]=useState('false');
  const s=m.source;
  return <AdminPage title={s.name} subtitle={<><Link to="/admin/world/sources" className="text-accent">世界信源</Link> · {s.id} · 只读取 world 数据</>}>
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="采集状态" value={s.enabled?'启用':'暂停'} /><Stat label="已采集" value={m.stats.total} /><Stat label="七天新增" value={m.stats.last7d} /><Stat label="全文" value={s.site_fulltext?'允许':'关闭'} /></div>
    <Card title="摘要使用许可" right={<Button disabled={busy} onClick={()=>{ setAllowed(String(m.permission?.summary_allowed ?? false));setOpen(true); }}>记录许可依据</Button>} className="mb-5">
      <Badge tone={m.permission?.summary_allowed?'ok':'warn'}>{m.permission?.summary_allowed?'已记录摘要许可':m.permission?'摘要许可已撤销':'尚未记录许可'}</Badge>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-2">{m.permission?.permission_reference ?? '可获取 RSS 不代表已取得发布授权；不要把测试成功当作许可依据。'}</p>
      {m.permission && <p className="mt-2 text-xs text-ink-3">{m.permission.reviewed_by} · <Time at={m.permission.reviewed_at} /></p>}
    </Card>
    <Card title="采集配置" className="mb-5"><Json value={s.config} /><p className="mt-3 text-sm text-ink-3">首版只使用 RSS／列表实际文字，不自动抓全文。采集开关、启停及试抓操作将接入独立世界执行入口，不使用 AI 操作接口。</p></Card>
    <Card title="最近采集运行" pad={false} scrollable className="mb-5"><DataTable rows={m.runs} rowKey={r=>r.id} empty="尚未采集" columns={[
      { key:'at',label:'时间',render:r=><Time at={r.started_at} /> },{ key:'status',label:'状态',render:r=>r.status },{ key:'found',label:'发现',render:r=>r.found_count ?? '—' },{ key:'new',label:'新增',render:r=>r.new_count ?? '—' },{ key:'error',label:'错误',render:r=>r.error ?? '—' },
    ]} /></Card>
    <Card title="本来源材料" pad={false} scrollable><DataTable rows={m.items} rowKey={r=>r.id} empty="尚无材料" columns={[
      { key:'title',label:'标题',render:r=>r.title_zh ?? r.title },{ key:'state',label:'处理',render:r=>r.processing_state },{ key:'at',label:'原文发布',render:r=><Time at={r.published_at} /> },
    ]} /></Card>
    <ReasonDialog open={open} title="记录世界信源摘要许可" description="这里只记录摘要使用依据，不启用全文或采集。撤销许可将立即影响公开读取。" confirmLabel="保存许可依据" busy={busy} onClose={()=>setOpen(false)}
      onSubmit={async reference=>await run('POST',`/api/admin/world/sources/${encodeURIComponent(s.id)}/permission`,{ summaryAllowed:allowed==='true',reference },{ success:'世界摘要许可记录已更新' })!==null}>
      <Field label="摘要使用状态"><Select aria-label="摘要使用状态" value={allowed} onChange={e=>setAllowed(e.target.value)}><option value="false">不允许／撤销</option><option value="true">允许（必须提供依据）</option></Select></Field>
    </ReasonDialog>
  </AdminPage>;
}
