import { Form,Link,useSearchParams } from 'react-router';
import type { AdminContentSearch } from '@aihot/contracts/admin';
import { adminGet } from '@aihot/web/lib/admin.server';
import { AdminPage,Card,DataTable,Input,Button,Time } from '@aihot/web/features/admin/ui';

export async function loader({ request }:{ request:Request }) {
  const q=new URL(request.url).searchParams.get('q') ?? '';
  return adminGet<AdminContentSearch>(request,`/api/admin/world/content?q=${encodeURIComponent(q)}`);
}
export const meta=()=>[{ title:'世界新闻内容 · 后台' }];
export default function WorldContent({ loaderData:m }:{ loaderData:AdminContentSearch }) {
  const [sp]=useSearchParams();
  return <AdminPage title="世界新闻内容" subtitle="只搜索世界材料；查看原始 RSS 文字、模型分析、公开结果及事件归属。">
    <Card pad={false}><Form method="get" className="flex gap-2 border-b border-line p-3"><Input key={sp.get('q')} name="q" aria-label="搜索世界内容" defaultValue={sp.get('q') ?? ''} placeholder="标题、原文地址或内容 ID" /><Button type="submit">搜索</Button></Form>
      <DataTable rows={m.rows} rowKey={r=>r.id} empty="没有匹配的世界内容" columns={[
        { key:'title',label:'材料',render:r=><Link className="text-accent" to={`/admin/world/content/${encodeURIComponent(r.id)}`}>{r.title}</Link> },
        { key:'source',label:'来源',render:r=>r.source },{ key:'state',label:'处理',render:r=>r.processing_state },
        { key:'visibility',label:'公开状态',render:r=>r.visibility ?? '未投影' },{ key:'score',label:'重要性',render:r=>r.score ?? '未评分' },
        { key:'date',label:'发现',render:r=><Time at={r.discovered_at} /> },
      ]} />
    </Card>
  </AdminPage>;
}
