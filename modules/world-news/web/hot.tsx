import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,DataTable,Time } from '@aihot/web/features/admin/ui';
import { num } from '@aihot/web/features/admin/format';

interface WorldHot { sectionId:'world';status:string;id?:number;computedAt?:string;
  items:Array<{ rank:number;storyId:number;storyPublicId:string;title:string;representativeItemId:string;importance:number;
    heat:number;sourceCount:number;reportCount:number;latestProgressAt:string }> }
export async function loader({ request }:{ request:Request }) { return adminGet<WorldHot>(request,'/api/admin/world/hot'); }
export const meta=()=>[{ title:'世界新闻热点草稿 · 后台' }];
const statusLabel:Record<string,string>={ draft:'内部草稿',ready:'已发布', 'not-generated':'尚未生成','regeneration-required':'规则已变，需要重生成','calibration-required':'尚未完成校准' };
export default function WorldHotAdmin({ loaderData:m }:{ loaderData:WorldHot }) {
  const { run,busy }=useAdminAction();
  return <AdminPage title="世界新闻热点草稿" subtitle="重要性优先，来源覆盖热度与最新实质进展辅助排序；只统计已配置世界来源，不是全网热度或独立证实。"
    actions={<Button disabled={busy} onClick={()=>run('POST','/api/admin/world/hot/generate',{}, { success:'已追加世界热点快照' })}>生成新快照</Button>}>
    <Card title={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={m.status==='ready'?'ok':'warn'}>{statusLabel[m.status] ?? m.status}</Badge>{m.computedAt && <Time at={m.computedAt} />}</span>} pad={false} scrollable>
      <p className="px-4 py-3 text-sm text-ink-3">未校准时仅供后台预览，不开放自动推荐。读取实时重查撤回、材料修订和来源许可；生成不调用模型。</p>
      <DataTable rows={m.items} rowKey={i=>i.storyPublicId} empty="当前没有可展示的世界热点" columns={[
        { key:'rank',label:'排名',render:i=>i.rank },{ key:'title',label:'具体事件',render:i=>i.title },
        { key:'importance',label:'重要性',render:i=>num(i.importance,1) },{ key:'heat',label:'来源覆盖热度',render:i=>num(i.heat,2) },
        { key:'sources',label:'来源组',render:i=>i.sourceCount },{ key:'reports',label:'合格报道',render:i=>i.reportCount },
        { key:'progress',label:'实质进展',render:i=><Time at={i.latestProgressAt} /> },
      ]} />
    </Card>
  </AdminPage>;
}
