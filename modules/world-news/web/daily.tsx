import { useState } from 'react';
import { Form,data } from 'react-router';
import { beijingDate,isValidDate } from '@aihot/contracts/time';
import type { SectionDailyContentData } from '@aihot/contracts/section-daily';
import { adminGet } from '@aihot/web/lib/admin.server';
import { useAdminAction } from '@aihot/web/features/admin/action';
import { AdminPage,Badge,Button,Card,Empty,Input,ReasonDialog,Time } from '@aihot/web/features/admin/ui';

interface Revision { id:number;revision:number;status:'draft'|'approved'|'withdrawn';content:SectionDailyContentData;
  generated_by:string;generated_at:string;approved_by:string|null;approved_at:string|null }
interface WorldDaily { sectionId:'world';date:string;revisions:Revision[] }
export async function loader({ request }:{ request:Request }) {
  const date=new URL(request.url).searchParams.get('date') ?? beijingDate(Date.now());
  if(!isValidDate(date)) throw data({ message:'无效的日报日期' },{ status:400 });
  return adminGet<WorldDaily>(request,`/api/admin/world/daily/${date}`);
}
export const meta=()=>[{ title:'世界新闻日报 · 后台' }];
const statusLabel={ draft:'待审草稿',approved:'已批准',withdrawn:'已撤回' };
export default function WorldDailyAdmin({ loaderData:m }:{ loaderData:WorldDaily }) {
  const { run,busy }=useAdminAction();
  const [review,setReview]=useState<{ date:string;revision:number;action:'approve'|'withdraw' }|null>(null);
  return <AdminPage title="世界新闻日报" subtitle="按北京时间首次进入可发布集合的日期编排；生成只追加草稿，不自动批准，也不调用模型。"
    actions={<Button disabled={busy} onClick={()=>run('POST',`/api/admin/world/daily/${m.date}/generate`,{}, { success:'已追加世界日报草稿' })}>生成新草稿</Button>}>
    <Form method="get" className="mb-5 flex flex-wrap items-center gap-2">
      <Input key={m.date} aria-label="日报日期（北京时间）" type="date" name="date" defaultValue={m.date} required className="!w-auto" />
      <Button type="submit">查看日期</Button>
      <span className="text-sm text-ink-3">最多六条重点＋六条快讯，同一来源最多主导两条重点，不凑数量。</span>
    </Form>
    {m.revisions.length ? <div className="space-y-5">{m.revisions.map(r=><Card key={r.id} title={<span className="inline-flex flex-wrap items-center gap-2">{m.date} · 第 {r.revision} 版<Badge tone={r.status==='approved'?'ok':r.status==='draft'?'warn':'muted'}>{statusLabel[r.status]}</Badge></span>}
      right={<div className="flex gap-2">{r.status==='draft' && <Button size="sm" aria-label={`批准第${r.revision}版`} disabled={busy} onClick={()=>setReview({ date:m.date,revision:r.revision,action:'approve' })}>批准</Button>}
        {r.status!=='withdrawn' && <Button size="sm" tone="danger" aria-label={`撤回第${r.revision}版`} disabled={busy} onClick={()=>setReview({ date:m.date,revision:r.revision,action:'withdraw' })}>撤回</Button>}</div>}>
      <p className="mb-4 text-sm text-ink-3">生成：{r.generated_by} · <Time at={r.generated_at} />{r.approved_at && <> · 批准：{r.approved_by} · <Time at={r.approved_at} /></>}</p>
      {r.content.status==='no-qualified-content' && <Empty>当天没有合格内容；不补写新闻、不凑栏目。</Empty>}
      {([['重点',r.content.focus],['快讯',r.content.flashes]] as const).map(([label,entries])=><section key={label} className="mb-4">
        <h3 className="mb-2 text-sm font-semibold">{label} · {entries.length}</h3>
        {entries.map(e=><article key={e.itemId} className="border-t border-line py-3">
          <h4 className="font-medium text-ink">{e.title}</h4><p className="mt-1 text-sm leading-relaxed text-ink-2">{e.summary}</p>
          {e.reason && <p className="mt-1 text-sm text-accent">阅读理由：{e.reason}</p>}
          <p className="mt-2 text-xs text-ink-3">{e.sourceName} · 原文发布 <Time at={e.publishedAt} /> · <a href={e.originalUrl} target="_blank" rel="noopener noreferrer" className="text-accent">打开原文</a></p>
        </article>)}
      </section>)}
      <p className="text-xs text-ink-4">此处为保存的版本材料；批准时再次核对当前内容和许可，失效引用不能通过。</p>
    </Card>)}</div> : <Card><Empty>{m.date} 尚未生成世界日报草稿。</Empty></Card>}
    <ReasonDialog open={review!==null} title={`${review?.action==='approve'?'批准':'撤回'}世界日报 · 第 ${review?.revision ?? ''} 版`}
      description="操作针对指定日期和版本，不覆盖其他修订或 AI 日报。" danger={review?.action==='withdraw'} busy={busy} onClose={()=>setReview(null)}
      onSubmit={async reason=>{
        if(!review) return false;
        return await run('POST',`/api/admin/world/daily/${review.date}/review`,{ revision:review.revision,action:review.action,reason },{ success:'世界日报状态已更新' })!==null;
      }} />
  </AdminPage>;
}
