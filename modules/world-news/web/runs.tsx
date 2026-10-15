import { useState } from 'react';
import { Link,useRevalidator } from 'react-router';
import { adminGet } from '@aihot/web/lib/admin.server';
import { AdminPage,Card,DataTable,Stat,Badge,Time,Button,Field,Select,ReasonDialog } from '@aihot/web/features/admin/ui';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { bj,num } from '@aihot/web/features/admin/format';

interface WorldRuns {
  sectionId:'world'; checkedAt:string;
  counts:{ sources:number; articles:number; events:number };
  processing:Record<string,number>; grouping:Record<string,number>;
  queues:Array<{ name:string;state:string;n:number;oldest:string }>;
  failedJobs:Array<{ name:string;failed:number;last:string }>;
  sources:Array<{ id:string;name:string;enabled:boolean;health:string|null;fail_count:number;last_error:string|null;last_fetch_at:string|null }>;
  timeline:Array<{ id:number;job:string;started_at:string;finished_at:string|null;status:string;error:string|null }>;
  fetches:Array<{ id:number;source_id:string;started_at:string;status:string;error:string|null }>;
  receipts:{ counts:Record<string,number>;issues:Array<{ id:number;service:string;purpose:string;status:string;error:string|null;updated_at:string }> };
  budgetStatus:'configured'|'not-configured';
  budgets:Array<{ service:string;status:string;per_minute:number;per_hour:number;per_day:number;minute:number;hour:number;day:number }>;
}

export async function loader({ request }:{ request:Request }) {
  return adminGet<WorldRuns>(request,'/api/admin/world/runs');
}
export const meta=()=>[{ title:'世界新闻运行 · 后台' }];
const labels:Record<string,string>={ created:'排队',retry:'等待重试',active:'执行中',paused:'暂停',exhausted:'额度耗尽',ready:'可调用' };
export default function WorldRunsAdmin({ loaderData }:{ loaderData:WorldRuns }) {
  const refresh=useRevalidator(),r=loaderData,{ run,busy }=useAdminAction();
  const [command,setCommand]=useState<{ id:number;version:string;requestId:string }|null>(null),[billed,setBilled]=useState('');
  return <AdminPage title="世界新闻运行" subtitle={<>只统计世界新闻；AI 热点的数据、队列和费用不计入。检查时间 {bj(r.checkedAt)}</>}
    actions={<Button disabled={refresh.state!=='idle'} onClick={()=>refresh.revalidate()}>刷新状态</Button>}>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="世界信源" value={num(r.counts.sources)} hint={`${r.sources.filter(s=>!s.enabled).length} 个暂停`} />
      <Stat label="采集内容" value={num(r.counts.articles)} />
      <Stat label="具体事件" value={num(r.counts.events)} />
      <Stat label="队列任务" value={num(r.queues.reduce((sum,q)=>sum+q.n,0))} />
    </div>
    <Card title="世界请求预算" className="mb-5">
      <p className="mb-3 text-[13px] text-ink-3">这是调用次数限制，不是人民币费用上限；同时受共享服务预算约束。缺预算时暂停世界模型调用。</p>
      {r.budgetStatus==='not-configured' ? <Badge tone="warn">未配置 · 暂停调用</Badge> : <DataTable rows={r.budgets} rowKey={b=>b.service} columns={[
        { key:'service',label:'服务',render:b=>b.service },{ key:'status',label:'状态',render:b=><Badge tone={b.status==='ready'?'ok':'warn'}>{labels[b.status] ?? b.status}</Badge> },
        { key:'minute',label:'分钟',render:b=>`${b.minute} / ${b.per_minute}` },{ key:'hour',label:'小时',render:b=>`${b.hour} / ${b.per_hour}` },{ key:'day',label:'24 小时',render:b=>`${b.day} / ${b.per_day}` },
      ]} />}
    </Card>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="世界来源状态" pad={false} scrollable><DataTable rows={r.sources} rowKey={s=>s.id} empty="尚未登记世界来源" columns={[
        { key:'name',label:'来源',render:s=>s.name },{ key:'status',label:'状态',render:s=><Badge tone={!s.enabled?'muted':s.health==='failing'?'bad':'info'}>{!s.enabled?'暂停':s.health ?? '未抓取'}</Badge> },
        { key:'last',label:'最近采集',render:s=><Time at={s.last_fetch_at} /> },{ key:'error',label:'错误',render:s=>s.last_error ?? '—' },
      ]} /></Card>
      <Card title="处理与归组" ><div className="grid grid-cols-2 gap-4">{([['处理',r.processing],['归组',r.grouping]] as const).map(([title,states])=><div key={title}><h3 className="mb-2 text-sm font-medium">{title}</h3>{Object.entries(states).length ? Object.entries(states).map(([state,n])=><p key={state} className="text-sm text-ink-3">{state}：{n}</p>):<p className="text-sm text-ink-3">暂无内容</p>}</div>)}</div></Card>
      <Card title="世界任务队列" pad={false} scrollable><DataTable rows={r.queues} rowKey={q=>`${q.name}:${q.state}`} empty="队列为空" columns={[
        { key:'name',label:'任务',render:q=>q.name },{ key:'state',label:'状态',render:q=>labels[q.state] ?? q.state },{ key:'n',label:'数量',render:q=>num(q.n) },{ key:'oldest',label:'最早',render:q=><Time at={q.oldest} /> },
      ]} /></Card>
      <Card title="失败队列（24 小时）" pad={false} scrollable><DataTable rows={r.failedJobs} rowKey={q=>q.name} empty="没有失败队列" columns={[
        { key:'name',label:'任务',render:q=>q.name },{ key:'n',label:'失败',render:q=>num(q.failed) },{ key:'last',label:'最近',render:q=><Time at={q.last} /> },
      ]} /></Card>
      <Card title="需要核对的世界模型回执" pad={false} scrollable><DataTable rows={r.receipts.issues} rowKey={q=>q.id} empty="没有待核对回执" columns={[
        { key:'id',label:'回执',render:q=>`#${q.id}` },{ key:'purpose',label:'用途',render:q=>q.purpose },{ key:'status',label:'状态',render:q=><Badge tone="warn">{q.status}</Badge> },{ key:'error',label:'原因',render:q=>q.error ?? '—' },
        { key:'action',label:'操作',render:q=>q.status==='unknown' ? <Button disabled={busy} onClick={()=>{ setBilled('');setCommand({ id:q.id,version:q.updated_at,requestId:crypto.randomUUID() }); }}>核对并恢复</Button> : '—' },
      ]} /></Card>
      <Card title="采集运行" pad={false} scrollable><DataTable rows={r.fetches} rowKey={q=>q.id} empty="暂无采集运行" columns={[
        { key:'source',label:'来源',render:q=>r.sources.find(s=>s.id===q.source_id)?.name ?? q.source_id },{ key:'status',label:'状态',render:q=>q.status },{ key:'at',label:'时间',render:q=><Time at={q.started_at} /> },{ key:'error',label:'错误',render:q=>q.error ?? '—' },
      ]} /></Card>
    </div>
    <Card title="世界任务历史" className="mt-5" pad={false} scrollable><DataTable rows={r.timeline} rowKey={q=>q.id} empty="暂无世界任务" columns={[
      { key:'job',label:'任务',render:q=>q.job },{ key:'status',label:'状态',render:q=>q.status },{ key:'at',label:'开始',render:q=><Time at={q.started_at} /> },{ key:'error',label:'错误',render:q=>q.error ?? '—' },
    ]} /></Card>
    <p className="mt-4 text-sm text-ink-3">后台管理页面不触发模型调用；<Link to="/admin/sources" className="text-accent">返回 AI 热点后台</Link>。</p>
    <ReasonDialog open={command!==null} title={`核对世界回执 #${command?.id ?? ''}`} busy={busy}
      description="请先在供应商账单核对是否计费。恢复沿用原尝试身份，可能再次计费，仍受总预算和世界预算限制；材料版本或请求身份缺失时不会恢复。不会使用 AI 恢复队列。"
      onClose={()=>setCommand(null)} onSubmit={async reason=>{
        if(!command || !['yes','no'].includes(billed)) return false;
        return await run('POST',`/api/admin/world/receipts/${command.id}/release`,
          { version:command.version,requestId:command.requestId,billed:billed==='yes',reason },{ success:'世界回执核对完成，恢复任务已排队' })!==null;
      }}><Field label="供应商账单核对"><Select aria-label="供应商账单核对" required value={billed} onChange={e=>setBilled(e.target.value)}>
        <option value="">请选择核对结果</option><option value="yes">已计费，但结果未取回</option><option value="no">未计费</option>
      </Select></Field></ReasonDialog>
  </AdminPage>;
}
