import { Link, useLoaderData } from 'react-router';
import type { Screen } from '@aihot/web/components/shell/screens';
import { StarButton } from '@aihot/web/features/feed/parts';
import { IconExternal } from '@aihot/web/components/icons';
import { fullDateTime } from '@aihot/web/lib/format';
import { pageMeta } from '@aihot/web/lib/seo';
import { ReaderBack } from './reader-parts';
import { categoryLabel, itemHref, timelineHref } from './reader-types';
import { articleLoader } from './reader-api.server';
export { ErrorBoundary } from './reader-parts';
export { readerHeaders as headers } from './reader-api.server';
export const loader = articleLoader;
export const handle: Screen = { tab: 'world', name: '新闻详情' };
export const meta = ({ loaderData }: { loaderData?: Awaited<ReturnType<typeof loader>> }) => pageMeta({ title: loaderData?.item.title ?? '世界新闻详情', path: loaderData ? `/world/items/${loaderData.item.id}` : '/world' });
export default function Article() {
  const { item, story, storyError, from } = useLoaderData<typeof loader>();
  return <article className="py-4 lg:py-0">
    <div className="mb-7 flex items-center justify-between gap-3"><ReaderBack to={from} /><div className="flex items-center gap-3"><a href={item.links.original} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] text-ink-2 hover:text-accent">打开原文<IconExternal size={14} /></a><StarButton item={{ ...item, sectionId: 'world' }} className="size-10" /></div></div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-9">
      <div className="min-w-0"><p className="text-[12.5px] text-ink-3">{item.source.name} · {item.publishedAt ? `${fullDateTime(item.publishedAt)}（北京时间）` : '原文发布时间未知'}</p>
        <h1 data-page-title="" className="mb-7 mt-3 break-words text-[26px] font-semibold leading-[1.45] text-ink lg:text-[32px]">{item.title}</h1>
        {item.image && <figure className="mb-7 overflow-hidden rounded-card border border-line-soft bg-bg-sunk"><img src={item.image.url} srcSet={item.image.srcSet} sizes="(min-width: 1536px) 760px, (min-width: 1024px) calc(100vw - 524px), (min-width: 640px) 608px, calc(100vw - 32px)" width={item.image.width ?? undefined} height={item.image.height ?? undefined} alt="" loading="eager" fetchPriority="high" decoding="async" className="aspect-video w-full object-cover" /></figure>}
        {item.summary && <section className="mb-7"><h2 className="mb-3 text-[15px] font-semibold text-accent">新闻摘要</h2><div className="card px-5 py-4 text-[16px] leading-[1.95] text-ink-2 whitespace-pre-line">{item.summary}</div></section>}
        {story?.story.digest && <section className="mb-7"><h2 className="mb-3 text-[15px] font-semibold text-accent">事件综述</h2><div className="card whitespace-pre-line px-5 py-4 text-[15px] leading-[1.9] text-ink-2">{story.story.digest}</div></section>}
        <section id="reports" className="scroll-mt-20"><h2 className="mb-3 text-[15px] font-semibold text-accent">来源与相关报道</h2>
          <ul className="card divide-y divide-line-soft px-5">{(story?.reports.length ? story.reports : [item]).map(report => <li key={report.id} className="py-4"><div className="mb-1 flex items-center justify-between gap-3 text-[12px] text-ink-3"><span>{report.source.name}</span><a href={report.links.original} target="_blank" rel="noopener noreferrer" aria-label={`打开${report.source.name}原文`} className="text-accent"><IconExternal size={15} /></a></div>{report.id === item.id ? <p className="text-[14px] leading-6 text-ink">{report.title}</p> : <Link to={itemHref(report.id, from)} className="text-[14px] leading-6 text-ink hover:text-accent">{report.title}</Link>}<p className="mt-1 text-[11.5px] text-ink-4">{report.publishedAt ? fullDateTime(report.publishedAt) : '原文发布时间未知'}</p></li>)}</ul>
          {storyError && <p role="status" className="mt-3 text-[13px] text-ink-3">相关报道暂时无法加载，请刷新重试。</p>}
        </section>
      </div>
      <aside className="space-y-6 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        {item.reason && <section className="border-b border-line pb-6"><h2 className="mb-3 text-[15px] font-semibold text-ink">关注理由</h2><p className="text-[14px] leading-[1.9] text-ink-3">{item.reason}</p></section>}
        {item.category && <section className="border-b border-line pb-6"><h2 className="mb-3 text-[15px] font-semibold text-ink">分类</h2><Link to={timelineHref(item.category)} className="inline-block rounded-full border border-line px-3 py-1.5 text-[12.5px] text-ink-3 hover:text-accent">{categoryLabel(item.category)}</Link></section>}
        {story && <section><h2 className="mb-3 text-[15px] font-semibold text-ink">所属事件</h2><div className="card p-4"><h3 className="text-[16px] font-semibold leading-7 text-ink">{story.story.title}</h3><p className="mb-4 mt-2 text-[12px] text-ink-3">{story.reports.length} 条相关报道</p><a href="#reports" className="text-[13px] text-accent">查看事件报道</a></div></section>}
      </aside>
    </div>
  </article>;
}
