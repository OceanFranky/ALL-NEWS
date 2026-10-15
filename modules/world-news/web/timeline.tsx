import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLoaderData, useLocation } from 'react-router';
import { beijingDate, beijingTime } from '@aihot/contracts/time';
import type { Screen } from '@aihot/web/components/shell/screens';
import { monthDay, weekdayShort } from '@aihot/web/lib/format';
import { readSnapshot, restoreAnchor, useSaveOnLeave } from '@aihot/web/lib/restore';
import { pageMeta } from '@aihot/web/lib/seo';
import { IconChevronDown } from '@aihot/web/components/icons';
import { ReaderHeader, ItemCard, Empty } from './reader-parts';
import { categoryLabel, timelineHref, type WorldItem } from './reader-types';
import { timelineLoader } from './reader-api.server';
export { ErrorBoundary } from './reader-parts';
export { readerHeaders as headers } from './reader-api.server';
export const loader = timelineLoader;
export const handle: Screen = { tab: 'world', name: '世界新闻列表' };
export const meta = () => pageMeta({ title: '世界新闻时间线', path: '/world/timeline' });
export default function TimelinePage() {
  const { data, category, q } = useLoaderData<typeof loader>();
  const location = useLocation();
  return <Timeline key={location.key} data={data} category={category} q={q} historyKey={location.key} />;
}
function Timeline({ data, category, q, historyKey }: Awaited<ReturnType<typeof loader>> & { historyKey: string }) {
  const [collapsed, setCollapsed] = useState<string[]>([]), collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  useLayoutEffect(() => {
    const snapshot = readSnapshot<string[]>(historyKey);
    if (snapshot) { setCollapsed(snapshot.data); restoreAnchor(snapshot.anchor, snapshot.scrollY); }
  }, [historyKey]);
  useSaveOnLeave(historyKey, () => collapsedRef.current);
  const groups = new Map<string, WorldItem[]>();
  for (const item of data.items) {
    const day = beijingDate(item.timelineAt);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(item);
  }
  return <div className="pb-8"><ReaderHeader category={category} q={q} />
    <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-[19px] font-semibold text-ink">{category ? categoryLabel(category) : '全部新闻'}</h2><span className="text-[12.5px] text-ink-3">{data.pagination.total} 条 · 最新更新</span></div>
    {q && <p className="mb-4 text-[13px] text-ink-3">在{category ? categoryLabel(category) : '世界新闻'}中搜索“{q}” · <Link to={timelineHref(category)} className="text-accent">清除搜索</Link></p>}
    <p className="mb-4 text-[11.5px] text-ink-4">按本站时间线时间排列 · 北京时间</p>
    {!data.items.length && <Empty>{q ? '没有找到匹配的新闻。试试其他关键词。' : data.pagination.total ? '这一页暂无新闻，请返回上一页。' : '暂无可公开新闻。'}</Empty>}
    {[...groups].map(([day, items]) => {
      const closed = collapsed.includes(day), count = data.days.find(d => d.date === day)?.count ?? items.length;
      return <section key={day} className="mb-6"><button type="button" aria-expanded={!closed} aria-controls={`day-${day}`} onClick={() => setCollapsed(value => closed ? value.filter(d => d !== day) : [...value, day])} className="mb-3 flex min-h-10 items-center gap-3 text-ink"><span className="text-[17px] font-semibold">{monthDay(day)}</span><IconChevronDown size={15} className={closed ? '-rotate-90' : ''} /><span className="text-[12.5px] text-ink-3">{weekdayShort(day)} · {count} 条{count !== items.length ? `（本页 ${items.length} 条）` : ''}</span></button>
        <div id={`day-${day}`} hidden={closed} className="space-y-3">{items.map(item => <div key={item.id} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 lg:grid-cols-[64px_minmax(0,1fr)] lg:gap-5"><div className="relative border-r border-line pt-4"><time dateTime={item.timelineAt} className="num text-[12px] font-medium text-ink-3 lg:text-[14px]">{beijingTime(item.timelineAt)}</time><span className="absolute -right-1 top-5 size-2 rounded-full bg-accent ring-4 ring-bg" /></div><ItemCard item={item} /></div>)}</div>
      </section>;
    })}
    {(data.pagination.page > 1 || data.pagination.hasMore) && <nav aria-label="新闻分页" className="mt-6 flex items-center justify-center gap-6 text-[13px] text-accent">{data.pagination.page > 1 && <Link to={timelineHref(category, q, data.pagination.page - 1)}>上一页</Link>}<span className="text-ink-3">第 {data.pagination.page} 页</span>{data.pagination.hasMore && <Link to={timelineHref(category, q, data.pagination.page + 1)}>下一页</Link>}</nav>}
  </div>;
}
