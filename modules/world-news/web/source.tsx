import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminSourceDetail,AdminSourcePreview } from '@aihot/contracts/admin';
import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,DataTable,Field,Input,Json,ReasonDialog,Select,Stat,Time } from '@aihot/web/features/admin/ui';

type WorldSource=AdminSourceDetail & { sectionId:'world';permission:null|{ summary_allowed:boolean;permission_reference:string;reviewed_by:string;reviewed_at:string } };
export async function loader({ request,params }:{ request:Request;params:Record<string,string|undefined> }) {
  return adminGet<WorldSource>(request,`/api/admin/world/sources/${encodeURIComponent(params.id ?? '')}`);
}
export const meta=()=>[{ title:'世界信源详情 · 后台' }];
export default function WorldSourceAdmin({ loaderData:m }:{ loaderData:WorldSource }) {
  const { run,busy }=useAdminAction(),[open,setOpen]=useState(false),[allowed,setAllowed]=useState('false');
  const [operation,setOperation]=useState<'settings'|'fetch'|null>(null),[enabled,setEnabled]=useState('false'),[interval,setInterval]=useState('30');
  const [preview,setPreview]=useState<AdminSourcePreview|null>(null);
  const s=m.source;
  return <AdminPage title={s.name} subtitle={<><Link to="/admin/world/sources" className="text-accent">世界信源</Link> · {s.id} · 只读取 world 数据</>}>
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="采集状态" value={s.enabled?'启用':'暂停'} /><Stat label="已采集" value={m.stats.total} /><Stat label="七天新增" value={m.stats.last7d} /><Stat label="全文" value={s.site_fulltext?'允许':'关闭'} /></div>
    <Card title="摘要使用许可" right={<Button disabled={busy} onClick={()=>{ setAllowed(String(m.permission?.summary_allowed ?? false));setOpen(true); }}>记录许可依据</Button>} className="mb-5">
      <Badge tone={m.permission?.summary_allowed?'ok':'warn'}>{m.permission?.summary_allowed?'已记录摘要许可':m.permission?'摘要许可已撤销':'尚未记录许可'}</Badge>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-2">{m.permission?.permission_reference ?? '可获取 RSS 不代表已取得发布授权；不要把测试成功当作许可依据。'}</p>
      {m.permission && <p className="mt-2 text-xs text-ink-3">{m.permission.reviewed_by} · <Time at={m.permission.reviewed_at} /></p>}
    </Card>
    <Card title="采集配置" className="mb-5"><Json value={s.config} />
      <p className="mt-3 text-sm text-ink-3">只读 RSS／列表文字，不抓详情或全文。启用不会新建定时计划；手动采集可对暂停来源执行一次，但试抓和采集均要求采集总开关开启。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={()=>{ setEnabled(String(s.enabled));setInterval(String(s.interval_minutes));setOperation('settings'); }}>修改启停与频率</Button>
        <Button disabled={busy} onClick={async()=>{
          setPreview(null);const result=await run<AdminSourcePreview>('POST',`/api/admin/world/sources/${encodeURIComponent(s.id)}/preview`,{}, { revalidate:false });
          if(result) setPreview(result);
        }}>只读试抓</Button>
        <Button disabled={busy} onClick={()=>setOperation('fetch')}>采集一次</Button>
      </div>
    </Card>
    {preview && <Card title={`试抓结果 · ${preview.count} 条（最多显示 20 条）`} className="mb-5" pad={false} scrollable>
      <DataTable rows={preview.items} rowKey={i=>i.url} empty="本次没有条目" columns={[
        { key:'title',label:'原文标题',render:i=>i.title },{ key:'excerpt',label:'实际列表摘要',render:i=>i.excerpt || '未提供摘要' },
        { key:'date',label:'发布时间',render:i=><Time at={i.publishedAt} /> },
      ]} /><p className="px-4 py-3 text-xs text-ink-3">试抓未保存材料、游标或采集历史，不调用模型。</p>
    </Card>}
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
    <ReasonDialog open={operation!==null} title={operation==='settings'?'修改世界来源启停与频率':'世界来源采集一次'}
      description={operation==='settings'?'只修改当前世界来源，不改 AI 来源或全文许可。':'排入世界采集队列；worker 执行列表采集，后续分析仍受模型开关和世界预算限制。'} busy={busy} onClose={()=>setOperation(null)}
      onSubmit={async reason=>{
        if(operation==='settings') return await run('PATCH',`/api/admin/world/sources/${encodeURIComponent(s.id)}`,{
          version:s.updated_at,reason,patch:{ enabled:enabled==='true',interval_minutes:Number(interval) } },{ success:'世界来源设置已保存' })!==null;
        if(operation==='fetch') return await run('POST',`/api/admin/world/sources/${encodeURIComponent(s.id)}/fetch`,{ reason },{ success:'世界采集请求已处理，请在运行页核对队列' })!==null;
        return false;
      }}>
      {operation==='settings' && <><Field label="来源状态"><Select aria-label="来源状态" value={enabled} onChange={e=>setEnabled(e.target.value)}><option value="false">暂停</option><option value="true">启用</option></Select></Field>
        <Field label="采集间隔（分钟）"><Input aria-label="采集间隔（分钟）" type="number" min={1} max={1440} required value={interval} onChange={e=>setInterval(e.target.value)} /></Field></>}
    </ReasonDialog>
  </AdminPage>;
}
