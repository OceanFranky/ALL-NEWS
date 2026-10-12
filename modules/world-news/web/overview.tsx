import { Link, useLoaderData } from 'react-router';
import type { Screen } from '@aihot/web/components/shell/screens';
import { pageMeta } from '@aihot/web/lib/seo';
import { monthDayTime } from '@aihot/web/lib/format';
import { ReaderHeader, SectionTitle, Empty } from './reader-parts';
import { categoryLabel, itemHref, timelineHref } from './reader-types';
import { overviewLoader } from './reader-api.server';
export { ErrorBoundary } from './reader-parts';
export { readerHeaders as headers } from './reader-api.server';
export const loader = overviewLoader;
export const handle: Screen = { tab: 'world', name: '世界新闻' };
export const meta = () => pageMeta({ title: '世界新闻', path: '/world' });
export default function Overview() {
  const { daily, highlights, latest, focusItem, errors } = useLoaderData<typeof loader>();
  const focus = daily?.focus[0];
  const allFlashes = [...(daily?.focus.slice(1) ?? []), ...(daily?.flashes ?? [])];
  const flashes = allFlashes.slice(0, 8);
  return <div className="pb-8"><ReaderHeader overview />
    <div className={`grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] ${focusItem?.image ? 'items-stretch' : 'items-start'}`}>
      <section className="card flex min-w-0 flex-col p-5 lg:h-full lg:p-6"><SectionTitle>今日重点</SectionTitle>
        {errors.daily ? <Empty>今日重点获取失败，请刷新重试。</Empty> : focus ? <div className="flex flex-1 flex-col">
          <h2 className="mt-2 text-[23px] font-semibold leading-[1.5] text-ink lg:text-[28px]"><Link to={itemHref(focus.itemId, '/world')} className="hover:text-accent">{focus.title}</Link></h2>
          {focusItem?.image && <Link to={itemHref(focus.itemId, '/world')} className="group mt-5 block min-h-52 flex-1 overflow-hidden rounded-card border border-line-soft bg-bg-sunk">
            <img src={focusItem.image.url} srcSet={focusItem.image.srcSet} sizes="(min-width: 1024px) calc(67vw - 112px), calc(100vw - 72px)" width={focusItem.image.width ?? undefined} height={focusItem.image.height ?? undefined} alt="" loading="eager" fetchPriority="high" decoding="async" className="aspect-video h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.01] lg:aspect-auto" />
          </Link>}
          <p className="mb-6 mt-4 whitespace-pre-line text-[15px] leading-[1.9] text-ink-2">{focus.summary}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-ink-3"><span>{focus.sourceName} · {monthDayTime(focus.publishedAt)}</span><Link to={itemHref(focus.itemId, '/world')} className="text-accent">阅读新闻</Link></div>
        </div> : <Empty>今日日报尚无已发布内容。</Empty>}
      </section>
      <section className="card min-w-0 p-5"><SectionTitle>今日速览</SectionTitle>
        {errors.daily ? <Empty>今日速览获取失败，请刷新重试。</Empty> : flashes.length ? <ul className="divide-y divide-line-soft">{flashes.map(entry => <li key={entry.itemId} className="py-3"><span className="text-[11px] text-accent">{categoryLabel(entry.category)}</span><Link to={itemHref(entry.itemId, '/world')} className="mt-1 block text-[14px] font-medium leading-6 text-ink hover:text-accent">{entry.title}</Link><time dateTime={entry.publishedAt} className="mt-1 block text-[11.5px] text-ink-4">{monthDayTime(entry.publishedAt)}</time></li>)}</ul> : <Empty>暂无今日速览。</Empty>}
      </section>
    </div>
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {errors.highlights ? <section className="card p-5"><Empty>分类新闻获取失败，请刷新重试。</Empty></section> : highlights?.categories.map(category => <section key={category.key} className="card min-w-0 p-5">
        <SectionTitle to={timelineHref(category.key)}>{category.label}</SectionTitle>
        {category.lead && <h3 className="mb-3 text-[17px] font-semibold leading-7 text-ink"><Link to={itemHref(category.lead.id, '/world')} className="hover:text-accent">{category.lead.title}</Link></h3>}
        {category.briefs.length ? <ul className="divide-y divide-line-soft">{category.briefs.map(item => <li key={item.id} className="py-2.5"><Link to={itemHref(item.id, '/world')} className="text-[14px] leading-6 text-ink-2 hover:text-accent">{item.title}</Link><p className="mt-1 text-[11.5px] text-ink-4">{item.source.name}</p></li>)}</ul> : !category.lead && <Empty>暂无可公开新闻。</Empty>}
      </section>)}
    </div>
    <section className="card mt-6 p-5"><SectionTitle to="/world/timeline" linkText="查看全部新闻">最新更新</SectionTitle>
      {errors.latest ? <Empty>最新新闻获取失败，请刷新重试。</Empty> : latest?.items.length ? <ul className="divide-y divide-line-soft">{latest.items.map(item => <li key={item.id} className="flex items-start gap-3 py-3 text-[13px] lg:gap-5"><time dateTime={item.timelineAt} title="本站时间线时间（北京时间）" className="num w-24 shrink-0 text-ink-4">{monthDayTime(item.timelineAt)}</time><div className="min-w-0"><Link to={itemHref(item.id, '/world')} className="font-medium leading-6 text-ink hover:text-accent">{item.title}</Link><span className="mt-1 block text-[12px] text-ink-4">{item.source.name}</span></div></li>)}</ul> : <Empty>暂无可公开新闻，稍后再来看看。</Empty>}
    </section>
  </div>;
}
