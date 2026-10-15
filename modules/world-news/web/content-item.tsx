import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminContentChain } from '@aihot/contracts/admin';
import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,DataTable,Field,Input,Json,ReasonDialog,Time } from '@aihot/web/features/admin/ui';

type WorldContent=AdminContentChain & { sectionId:'world';material:{ excerpt:string|null;grouping_status:string };
  analysisDetails:Array<{ id:number;summary_zh:string|null;output:unknown }> };
type Command={ action:'approve'|'withdraw'|'detach'|'move'|'regroup'|'analyze';id:string;revision:number;requestId:string };
const labels={ approve:'审核发布',withdraw:'撤回内容',detach:'移出事件',move:'改归属',regroup:'重新归组',analyze:'重新分析' };
export async function loader({ request,params }:{ request:Request;params:Record<string,string|undefined> }) {
  return adminGet<WorldContent>(request,`/api/admin/world/content/${encodeURIComponent(params.id ?? '')}`);
}
export const meta=()=>[{ title:'世界内容详情 · 后台' }];
export default function WorldContentItem({ loaderData:m }:{ loaderData:WorldContent }) {
  const { run,busy }=useAdminAction(),[command,setCommand]=useState<Command|null>(null),[fact,setFact]=useState('');
  const a=m.article,p=m.publication;
  function open(action:Command['action']) { setFact('');setCommand({ action,id:a.id,revision:a.revision,requestId:crypto.randomUUID() }); }
  return <AdminPage title={p?.title ?? a.title} subtitle={<><Link to="/admin/world/content" className="text-accent">世界内容</Link> · 第 {a.revision} 次材料修订 · {a.id}</>}>
    <div className="mb-5 flex flex-wrap gap-2">{(Object.keys(labels) as Command['action'][]).map(action=><Button key={action} disabled={busy} tone={action==='withdraw'?'danger':'secondary'} onClick={()=>open(action)}>{labels[action]}</Button>)}</div>
    <div className="mb-5 flex flex-wrap gap-2"><Badge>{a.processing_state}</Badge><Badge>{m.material.grouping_status}</Badge><Badge tone={p?.visibility==='public'?'ok':'muted'}>{p?.visibility ?? '未投影'}</Badge>{a.backfill && <Badge>归档材料</Badge>}</div>
    <Card title="原始列表材料" className="mb-5">
      <h3 className="font-medium">{a.title}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{m.material.excerpt || '未提供摘要：保留待补，不凭标题编写事实。'}</p>
      <p className="mt-3 text-xs text-ink-3"><Link to={`/admin/world/sources/${encodeURIComponent(a.source_id)}`} className="text-accent">{a.source_name}</Link> · 原文发布 <Time at={a.published_at} /> · <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-accent">打开原文</a></p>
      {a.processing_error && <p className="mt-2 text-sm text-hot">处理错误：{a.processing_error}</p>}
    </Card>
    <Card title="当前摘要投影" className="mb-5"><p className="whitespace-pre-wrap text-sm leading-relaxed">{p?.summary ?? '尚无中文摘要'}</p>{p?.reason && <p className="mt-2 text-sm text-accent">阅读理由：{p.reason}</p>}
      <p className="mt-2 text-xs text-ink-3">分类 {p?.category ?? '待判断'} · 评分 {p?.score ?? '未评分'}。管理员看到投影不等于已公开，公开接口还会核对当前材料、分析和来源许可。</p>
    </Card>
    <Card title="事件归属" className="mb-5" pad={false} scrollable><DataTable rows={m.membership} rowKey={r=>`${r.fact_id}:${r.role}`} empty="没有事件归属" columns={[
      { key:'event',label:'事件',render:r=>r.story_id ? <Link className="text-accent" to={`/admin/world/events/${r.story_id}`}>{r.story_title ?? r.story_id}</Link> : '—' },{ key:'fact',label:'事实',render:r=>r.fact_title },{ key:'id',label:'事实公开 ID',render:r=><span className="break-all">{r.fact_public_id}</span> },
      { key:'role',label:'关系',render:r=>r.role },{ key:'manual',label:'决定',render:r=>r.manual?'人工':'自动' },
    ]} /></Card>
    <div className="space-y-4">{m.analyses.map(an=><Card key={an.id} title={`分析 #${an.id} · 材料修订 ${an.input_revision}`}>
      <p className="text-sm text-ink-3">{an.relevance ?? '待判断'} · {an.category ?? '未分类'} · {an.score ?? '未评分'} · <Time at={an.created_at} /></p>
      <p className="mt-2 text-sm">{an.title_zh ?? '无中文标题'}</p><p className="mt-2 whitespace-pre-wrap text-sm">{m.analysisDetails.find(d=>d.id===an.id)?.summary_zh ?? '无中文摘要'}</p>
      <Json value={m.analysisDetails.find(d=>d.id===an.id)?.output ?? null} label="结构／证据／双评分" />
      <DataTable rows={an.receipts} rowKey={r=>r.id} empty="没有模型回执" columns={[
        { key:'id',label:'回执',render:r=>`#${r.id}` },{ key:'model',label:'模型',render:r=>r.model ?? r.service },{ key:'state',label:'状态',render:r=>r.status },
      ]} />
    </Card>)}</div>
    <ReasonDialog open={command!==null} title={command ? `世界内容 · ${labels[command.action]}` : ''} description={command?.action==='analyze' ? '重新分析会排队执行新的付费判断，仍受世界模型配置、总预算和板块预算限制；存在结果未知的回执时先核对恢复。不会抓取原文或自动授予发布许可。' : '核对指定材料修订后执行。发布不能绕过来源许可或充分性检查；人工事件决定保留，评论不能变成已发生事实。'}
      busy={busy} danger={command?.action==='withdraw'} onClose={()=>setCommand(null)} onSubmit={async reason=>{
        if(!command) return false;
        const { id,revision,action,requestId }=command;
        if(action==='analyze') return await run('POST',`/api/admin/world/items/${encodeURIComponent(id)}/rerun`,
          { revision,requestId,reason },{ success:'世界新闻重新分析已排队' })!==null;
        const review=action==='approve' || action==='withdraw';
        return await run('POST',`/api/admin/world/items/${encodeURIComponent(id)}/${review?'review':'grouping'}`,
          review ? { revision,action,reason } : { revision,action,reason,requestId,...(action==='move'?{ factPublicId:fact.trim() }:{}) },{ success:'世界内容操作已完成' })!==null;
      }}>{command?.action==='move' && <Field label="目标事实公开 ID"><Input aria-label="目标事实公开 ID" value={fact} onChange={e=>setFact(e.target.value)} required maxLength={80} /></Field>}</ReasonDialog>
  </AdminPage>;
}
