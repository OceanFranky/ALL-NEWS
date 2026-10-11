import { useState } from 'react';
import { Form,Link,useSearchParams } from 'react-router';
import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,DataTable,Field,Input,ReasonDialog,Select,Time } from '@aihot/web/features/admin/ui';

interface EventRow { id:number;public_id:string;title:string;version:number;origin:string;latest_at:string|null;fact_count:number }
interface EventList { sectionId:'world';rows:EventRow[] }
interface EventDetail { sectionId:'world';story:{ id:number;public_id:string;title:string;version:number;merged_into:number|null;first_report_at:string|null;latest_at:string|null };
  facts:Array<{ id:number;public_id:string;title:string;occurred_at:string|null;version:number }>;
  reports:Array<{ fact_id:number;article_id:string;role:string;manual:boolean;title:string;revision:number;grouping_status:string }> }
type PageData={ list:EventList;detail:EventDetail|null };
export async function loader({ request,params }:{ request:Request;params:Record<string,string|undefined> }):Promise<PageData> {
  const q=new URL(request.url).searchParams.get('q') ?? '';
  const [list,detail]=await Promise.all([
    adminGet<EventList>(request,`/api/admin/world/events?q=${encodeURIComponent(q)}`),
    params.id ? adminGet<EventDetail>(request,`/api/admin/world/events/${encodeURIComponent(params.id)}`) : Promise.resolve(null),
  ]);
  return { list,detail };
}
export const meta=()=>[{ title:'世界新闻事件 · 后台' }];
export default function WorldEvents({ loaderData:m }:{ loaderData:PageData }) {
  const [sp]=useSearchParams(),{ run,busy }=useAdminAction();
  const [command,setCommand]=useState<{ id:number;version:number;requestId:string }|null>(null),[target,setTarget]=useState('');
  const d=m.detail;
  if(!d) return <AdminPage title="世界新闻事件" subtitle="只归组具体发生的事情及直接进展，不把整个国家或战争合为一个事件。最多展示最近 100 个匹配事件。">
    <Card pad={false}><Form method="get" className="flex gap-2 border-b border-line p-3"><Input aria-label="搜索世界事件" name="q" key={sp.get('q')} defaultValue={sp.get('q') ?? ''} placeholder="具体事件标题" /><Button type="submit">搜索</Button></Form>
      <DataTable rows={m.list.rows} rowKey={r=>r.id} empty="没有匹配的世界事件" columns={[
        { key:'title',label:'事件',render:r=><Link className="text-accent" to={`/admin/world/events/${r.id}`}>{r.title}</Link> },{ key:'version',label:'版本',render:r=>r.version },
        { key:'facts',label:'事实',render:r=>r.fact_count },{ key:'latest',label:'最新报道',render:r=><Time at={r.latest_at} /> },
      ]} />
    </Card>
  </AdminPage>;
  return <AdminPage title={d.story.title} subtitle={<><Link to="/admin/world/events" className="text-accent">世界事件</Link> · #{d.story.id} · 版本 {d.story.version}</>}
    actions={!d.story.merged_into && <Button disabled={busy} onClick={()=>{ setTarget('');setCommand({ id:d.story.id,version:d.story.version,requestId:crypto.randomUUID() }); }}>合并到另一世界事件</Button>}>
    {d.story.merged_into && <Card className="mb-5"><Badge>已合并</Badge><Link to={`/admin/world/events/${d.story.merged_into}`} className="ml-2 text-accent">查看存续事件</Link></Card>}
    {!d.story.merged_into && <Form method="get" className="mb-5 flex gap-2"><Input aria-label="查找合并目标" name="q" key={sp.get('q')} defaultValue={sp.get('q') ?? ''} placeholder="按标题查找目标世界事件" /><Button type="submit">查找合并目标</Button></Form>}
    <Card title="事实与直接进展" pad={false} scrollable className="mb-5"><DataTable rows={d.facts} rowKey={f=>f.id} empty="没有事实" columns={[
      { key:'title',label:'事实',render:f=>f.title },{ key:'id',label:'公开 ID（改归属时使用）',render:f=><span className="break-all">{f.public_id}</span> },
      { key:'time',label:'发生时间',render:f=><Time at={f.occurred_at} /> },{ key:'version',label:'版本',render:f=>f.version },
    ]} /></Card>
    <Card title="报道与评论关联" pad={false} scrollable><DataTable rows={d.reports} rowKey={r=>`${r.fact_id}:${r.article_id}:${r.role}`} empty="没有报道" columns={[
      { key:'title',label:'材料',render:r=><Link className="text-accent" to={`/admin/world/content/${encodeURIComponent(r.article_id)}`}>{r.title}</Link> },
      { key:'role',label:'关系',render:r=>r.role },{ key:'manual',label:'决定',render:r=>r.manual?'人工':'自动' },{ key:'revision',label:'材料修订',render:r=>r.revision },
    ]} /></Card>
    <ReasonDialog open={command!==null} title="合并世界事件" description="当前事件将合并到目标事件，双方版本必须仍一致；只合并同一具体事件，不因国家或战争相同而合并。" busy={busy} onClose={()=>setCommand(null)}
      onSubmit={async reason=>{
        const into=m.list.rows.find(r=>String(r.id)===target);
        if(!command || !into) return false;
        return await run('POST',`/api/admin/world/events/${command.id}/merge`,{ intoId:Number(into.id),fromVersion:command.version,intoVersion:into.version,requestId:command.requestId,reason },{ success:'世界事件已合并' })!==null;
      }}><Field label="存续目标事件"><Select aria-label="存续目标事件" value={target} onChange={e=>setTarget(e.target.value)} required>
        <option value="">选择目标世界事件</option>{m.list.rows.filter(r=>String(r.id)!==String(d.story.id)).map(r=><option key={r.id} value={r.id}>#{r.id} · {r.title} · v{r.version}</option>)}
      </Select></Field><p className="text-xs text-ink-3">列表为最近 100 个匹配存续事件；可先用详情页上方的“查找合并目标”缩小范围，不输入任意全站 ID。</p></ReasonDialog>
  </AdminPage>;
}
