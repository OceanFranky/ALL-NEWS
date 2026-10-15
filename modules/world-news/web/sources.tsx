import { Form,Link } from 'react-router';
import type { AdminSources } from '@aihot/contracts/admin';
import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,DataTable,Input,Stat,Time,Pager } from '@aihot/web/features/admin/ui';

export async function loader({ request }:{ request:Request }) {
  return adminGet<AdminSources>(request,`/api/admin/world/sources${new URL(request.url).search}`);
}
export const meta=()=>[{ title:'世界新闻信源 · 后台' }];
export default function WorldSourcesAdmin({ loaderData:m }:{ loaderData:AdminSources }) {
  const { run,busy }=useAdminAction();
  return <AdminPage title="世界新闻信源" subtitle="六个候选源独立登记；接入不等于公开，摘要许可单独记录，全文保持关闭。登记不启用采集。"
    actions={<Button disabled={busy} onClick={()=>run('POST','/api/admin/world/sources/install',{}, { success:'世界六源已登记（默认暂停）' })}>登记六个候选源</Button>}>
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="世界来源" value={m.totals.total} /><Stat label="启用" value={m.totals.enabled} /><Stat label="失败" value={m.totals.failing} /><Stat label="不稳定" value={m.totals.degraded} /></div>
    <Card pad={false}><Form method="get" className="flex gap-2 border-b border-line p-3"><Input aria-label="搜索世界信源" name="q" placeholder="名称、ID 或地址" /><Button type="submit">搜索</Button></Form>
      <DataTable rows={m.rows} rowKey={s=>s.id} empty="尚未登记世界来源" columns={[
        { key:'name',label:'来源',render:s=><Link to={`/admin/world/sources/${encodeURIComponent(s.id)}`} className="text-accent">{s.name}</Link> },
        { key:'kind',label:'读取方式',render:s=>s.kind },{ key:'status',label:'状态',render:s=><Badge tone={!s.enabled?'muted':s.health==='failing'?'bad':'info'}>{!s.enabled?'暂停':s.health}</Badge> },
        { key:'last',label:'最近采集',render:s=><Time at={s.last_fetch_at} /> },
      ]} />
      <Pager page={m.page} hasMore={m.rows.length===100} />
    </Card>
  </AdminPage>;
}
