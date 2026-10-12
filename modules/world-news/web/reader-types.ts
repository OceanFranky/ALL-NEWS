export const categories = [
  { key: 'politics', label: '政治与国际关系' },
  { key: 'economy', label: '经济与产业' },
  { key: 'security', label: '冲突与安全' },
] as const;
export const categoryLabel = (key: string | null) => categories.find(c => c.key === key)?.label ?? '世界新闻';
export interface WorldItem {
  id: string; title: string; summary: string | null; reason: string | null; category: string | null;
  score: number | null; selected: boolean; source: { name: string }; links: { original: string };
  publishedAt: string | null; timelineAt: string; storyPublicId: string | null;
  image: { url: string; srcSet?: string; width: number | null; height: number | null } | null;
}
export interface WorldItems {
  sectionId: 'world'; items: WorldItem[]; count: number;
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
  days: { date: string; count: number }[];
}
export interface WorldStory {
  story: { publicId: string; title: string; latestAt: string | null; digest: string | null };
  reports: WorldItem[];
}
export interface DailyEntry {
  itemId: string; title: string; summary: string; category: string; sourceName: string; publishedAt: string;
}
export interface WorldDaily { focus: DailyEntry[]; flashes: DailyEntry[] }
export interface WorldHighlights {
  status: string; categories: { key: string; label: string; lead: WorldItem | null; briefs: WorldItem[] }[];
}
export const itemHref = (id: string, from?: string) => `/world/items/${encodeURIComponent(id)}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
export function timelineHref(category = '', q = '', page = 1) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  return `/world/timeline${params.size ? `?${params}` : ''}`;
}
export function returnHref(value: string | null) {
  if (!value) return '/world';
  let url: URL;
  try { url = new URL(value, 'https://local.invalid'); } catch { return '/world'; }
  return url.origin === 'https://local.invalid' && ['/world', '/world/timeline', '/starred'].includes(url.pathname)
    ? url.pathname + url.search : '/world';
}
