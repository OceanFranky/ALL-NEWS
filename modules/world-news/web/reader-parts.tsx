import { Form, Link, isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';
import { PillTabs } from '@aihot/web/components/ui/Tabs';
import { PhoneBar } from '@aihot/web/components/shell/PhoneBar';
import { IconArrowLeft, IconArrowRight, IconSearch } from '@aihot/web/components/icons';
import { StarButton } from '@aihot/web/features/feed/parts';
import { fullDateTime } from '@aihot/web/lib/format';
import { categories, categoryLabel, itemHref, timelineHref, type WorldItem } from './reader-types';

export function ReaderHeader({ category = '', q = '', overview = false }: { category?: string; q?: string; overview?: boolean }) {
  return <>
    <PhoneBar title="世界新闻" />
    <header className="pb-5 pt-3 lg:pt-0">
      <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">世界新闻</h1>
      {overview && <p className="mt-1.5 text-[13px] text-ink-3">看见事件，也看懂背景</p>}
      <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <PillTabs label="世界新闻分类" layoutId="world-categories" active={overview ? 'all' : category} items={[
          { key: 'all', label: '全部', to: '/world', resetScroll: true },
          ...categories.map(c => ({ ...c, to: timelineHref(c.key, q), resetScroll: true })),
        ]} />
        <Form action="/world/timeline" role="search" className="flex h-10 min-w-0 items-center gap-2 rounded-full border border-line bg-field pl-3 pr-1 xl:w-60 xl:shrink-0">
          {category && <input type="hidden" name="category" value={category} />}
          <input key={`${category}:${q}`} aria-label={`搜索${category ? categoryLabel(category) : '世界新闻'}`} name="q" maxLength={200} defaultValue={q} placeholder="搜索标题、摘要…" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" />
          <button type="submit" aria-label="搜索" className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:text-accent"><IconSearch size={17} /></button>
        </Form>
      </div>
    </header>
  </>;
}
export function SectionTitle({ children, to, linkText = '查看全部' }: { children: React.ReactNode; to?: string; linkText?: string }) {
  return <div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink"><span className="size-1.5 rounded-full bg-accent" />{children}</h2>{to && <Link to={to} className="inline-flex items-center gap-1 text-[12.5px] text-accent">{linkText}<IconArrowRight size={14} /></Link>}</div>;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-7 text-[13.5px] leading-7 text-ink-3">{children}</p>;
}
export function ItemCard({ item }: { item: WorldItem }) {
  const location = useLocation();
  return <article data-card-key={item.id} className="card card-hover min-w-0 px-4 py-3.5 lg:px-[18px]">
    <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><span className="min-w-0 truncate">{item.source.name}</span>{item.selected && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] text-amber-ink">精选</span>}<div className="ml-auto"><StarButton item={{ ...item, sectionId: 'world' }} className="size-9 lg:size-[26px]" /></div></div>
    <h3 className="mt-1 text-[16px] font-[650] leading-[1.6] text-ink"><Link className="hover:text-accent" to={itemHref(item.id, location.pathname + location.search)}>{item.title}</Link></h3>
    {item.summary && <p className="mt-2 line-clamp-2 text-[14.5px] leading-[1.7] text-ink-3 lg:line-clamp-3 lg:text-[15px] lg:leading-[1.75]">{item.summary}</p>}
    <p className="mt-3 text-[11.5px] text-ink-4">{item.publishedAt ? `原文发布于 ${fullDateTime(item.publishedAt)}（北京时间）` : '原文发布时间未知'}</p>
  </article>;
}
export function ReaderBack({ to }: { to: string }) {
  const navigate = useNavigate();
  const label = to.startsWith('/starred') ? '返回收藏' : to.startsWith('/world/timeline') ? '返回新闻列表' : '返回世界新闻';
  return <Link to={to} onClick={event => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && window.history.state?.idx > 0) {
      event.preventDefault(); navigate(-1);
    }
  }} className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-accent"><IconArrowLeft size={16} />{label}</Link>;
}
export function ErrorBoundary() {
  const error = useRouteError(), location = useLocation();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  return <div className="py-14"><h1 className="text-[22px] font-semibold text-ink">{missing ? '这条新闻暂不可阅读' : invalid ? '筛选条件无效' : '世界新闻暂时无法加载'}</h1><p className="my-4 text-[14px] text-ink-3">{missing ? '内容可能已撤回、尚未公开，或链接不存在。' : invalid ? '请重新选择分类或搜索条件。' : '获取内容失败，请稍后重试。'}</p><div className="flex gap-5 text-[13px] text-accent">{!missing && !invalid && <Link reloadDocument to={location.pathname + location.search}>重新加载</Link>}<Link to="/world">返回世界新闻</Link></div></div>;
}
