import { useState } from 'react';
import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,DataTable,Field,FilterChips,ReasonDialog,Select,Time } from '@aihot/web/features/admin/ui';
import { money,num } from '@aihot/web/features/admin/format';

const STEP_LABEL={ prefilter:'相关性判断',score:'独立评分',structure:'材料结构',understand:'材料充分性',
  summarize:'中文标题摘要',group:'事件关系',groupReview:'事件独立复核',digest:'事件综述' } as const;
type Step=keyof typeof STEP_LABEL;
interface Capability { key:Step;defaultModel:string;current:{ model:string;source:'admin'|'section-default' } }
interface WorldModels {
  sectionId:'world';days:number;capabilities:Capability[];
  choices:Array<{ key:string;service:string;vision:boolean }>;
  usage:Array<{ purpose:string;model:string;promptVersion:string|null;calls:number;ok:number;failed:number;unknown:number;
    p50:number|null;p95:number|null;tokensIn:number;tokensOut:number;actualCost:number|null;currency:string|null }>;
  history:Array<{ at:string;actor:string;subject:string;reason:string;before:{ model:string }|null;after:{ model:string } }>;
}

export async function loader({ request }:{ request:Request }) {
  const days=new URL(request.url).searchParams.get('days') ?? '7';
  return adminGet<WorldModels>(request,`/api/admin/world/models?days=${encodeURIComponent(days)}`);
}
export const meta=()=>[{ title:'世界新闻模型 · 后台' }];
const latency=(ms:number|null)=>ms===null ? '—' : `${(ms/1000).toFixed(1)} s`;

export default function WorldModelsAdmin({ loaderData:m }:{ loaderData:WorldModels }) {
  const { run,busy }=useAdminAction();
  const [target,setTarget]=useState<Capability|null>(null),[choice,setChoice]=useState('');
  return <AdminPage title="世界新闻模型" subtitle="仅修改世界新闻的步骤配置。服务连接复用现有配置，AI 热点步骤不变；切换不重算已有内容，不发起模型调用。"
    actions={<FilterChips param="days" options={[{ value:'1',label:'24 小时' },{ value:'',label:'7 天' },{ value:'30',label:'30 天' }]} />}>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {m.capabilities.map(c=><Card key={c.key} title={STEP_LABEL[c.key]} right={<Button size="sm" aria-label={`切换${STEP_LABEL[c.key]}`} onClick={()=>{ setTarget(c);setChoice(c.current.source==='admin' ? c.current.model : ''); }}>切换</Button>}>
        <p className="mb-2 break-all font-mono text-sm" data-testid={`world-model-${c.key}`}>{c.current.model}</p>
        <Badge tone={c.current.source==='admin'?'accent':'muted'}>{c.current.source==='admin'?'世界后台覆盖':'世界规则默认'}</Badge>
      </Card>)}
    </div>
    <Card title={`${m.days} 天世界模型用量`} pad={false} scrollable>
      <p className="px-4 py-3 text-[13px] text-ink-3">只统计世界回执，不合计不同币种。未报告费用不当作零元；这里不是 5 元费用熔断。</p>
      <DataTable rows={m.usage} rowKey={u=>`${u.purpose}|${u.model}|${u.promptVersion ?? ''}|${u.currency ?? ''}`} empty="本时间范围没有世界模型调用" columns={[
        { key:'purpose',label:'用途',render:u=>u.purpose },{ key:'model',label:'模型',render:u=>u.model },
        { key:'version',label:'提示词版本',render:u=>u.promptVersion ?? '—' },{ key:'calls',label:'调用',render:u=>num(u.calls) },
        { key:'ok',label:'成功率',render:u=><span title={`失败 ${u.failed} · 结果未知 ${u.unknown}`}>{u.calls ? `${Math.round(u.ok/u.calls*1000)/10}%` : '—'}</span> },
        { key:'time',label:'耗时 p50 / p95',render:u=>`${latency(u.p50)} / ${latency(u.p95)}` },
        { key:'tokens',label:'输入 / 输出 token',render:u=>`${num(u.tokensIn)} / ${num(u.tokensOut)}` },
        { key:'cost',label:'实际费用',render:u=>u.actualCost===null ? <span className="text-ink-4">未报告</span> : `${money(u.actualCost,u.currency ?? '')}${u.currency ? ` ${u.currency}` : '（币种未报告）'}` },
      ]} />
    </Card>
    <Card title="世界模型切换记录" className="mt-5" pad={false} scrollable><DataTable rows={m.history} rowKey={(h)=>`${h.at}|${h.subject}|${h.actor}`} empty="尚未切换世界模型" columns={[
      { key:'at',label:'时间',render:h=><Time at={h.at} /> },{ key:'step',label:'步骤',render:h=>STEP_LABEL[h.subject.replace('world:model:','') as Step] ?? h.subject },
      { key:'model',label:'切换后',render:h=>h.after.model },{ key:'actor',label:'操作人',render:h=>h.actor },{ key:'reason',label:'原因',render:h=>h.reason },
    ]} /></Card>
    <ReasonDialog open={target!==null} title={`切换世界新闻 · ${target ? STEP_LABEL[target.key] : ''}`} description="恢复默认仅删除当前世界步骤的覆盖设置，不修改 AI 热点或服务连接。" busy={busy}
      onClose={()=>setTarget(null)} onSubmit={async reason=>{
        if(!target) return false;
        const result=await run('POST',`/api/admin/world/models/${target.key}`,{ model:choice || null,reason },{ success:'世界模型配置已保存' });
        return result!==null;
      }}>
      <Field label="世界步骤模型"><Select aria-label="世界步骤模型" value={choice} onChange={e=>setChoice(e.target.value)}>
        <option value="">恢复世界规则默认（{target?.defaultModel ?? 'default'}）</option>
        {m.choices.map(c=><option key={c.key} value={c.key}>{c.key} · {c.service}</option>)}
      </Select></Field>
    </ReasonDialog>
  </AdminPage>;
}
