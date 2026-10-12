import { data } from 'react-router';
import { beijingDate } from '@aihot/contracts/time';
import { apiGet, loadOr404 } from '@aihot/web/lib/api.server';
import type { LoaderArgs } from '@aihot/web/lib/route-types';
import { categories, returnHref, type WorldDaily, type WorldHighlights, type WorldItem, type WorldItems, type WorldStory } from './reader-types';

// Publication permissions can change at any time; follow the public API's no-store policy.
export function readerHeaders() { return { 'Cache-Control': 'no-store' }; }
async function optionalRead<T>(path: string, signal: AbortSignal, missingAllowed = false) {
  try { return { value: await apiGet<T>(path, { signal }), failed: false }; }
  catch (error) {
    if (signal.aborted) throw error;
    const missing = missingAllowed && error instanceof Error && 'status' in error && error.status === 404;
    return { value: null, failed: !missing };
  }
}
export async function overviewLoader({ request }: LoaderArgs) {
  const [daily, highlights, latest] = await Promise.all([
    optionalRead<WorldDaily>(`/api/v1/world/daily/${beijingDate(new Date())}`, request.signal, true),
    optionalRead<WorldHighlights>('/api/v1/world/highlights', request.signal),
    optionalRead<WorldItems>('/api/v1/world/items?limit=8', request.signal),
  ]);
  if (daily.failed && highlights.failed && latest.failed) throw data({ message: 'unavailable' }, { status: 503 });
  const focusId = daily.value?.focus[0]?.itemId;
  const focusItem = focusId ? await optionalRead<{ item: WorldItem }>(`/api/v1/world/items/${encodeURIComponent(focusId)}`, request.signal, true) : null;
  return { daily: daily.value, highlights: highlights.value, latest: latest.value,
    focusItem: focusItem?.value?.item ?? null,
    errors: { daily: daily.failed, highlights: highlights.failed, latest: latest.failed } };
}
export async function timelineLoader({ request }: LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const category = params.get('category') ?? '', q = (params.get('q') ?? '').trim();
  const page = Number(params.get('page') ?? 1);
  if ((category && !categories.some(c => c.key === category)) || q.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
    throw data({ message: 'invalid_world_query' }, { status: 400 });
  }
  const query = new URLSearchParams({ page: String(page), limit: '20' });
  if (category) query.set('category', category);
  if (q) query.set('q', q);
  const result = await loadOr404<WorldItems>(`/api/v1/world/items?${query}`, { signal: request.signal });
  return { data: result, category, q };
}
export async function articleLoader({ request, params }: LoaderArgs) {
  const { item } = await loadOr404<{ item: WorldItem }>(`/api/v1/world/items/${encodeURIComponent(params.id ?? '')}`, { signal: request.signal });
  const story = item.storyPublicId ? await optionalRead<WorldStory>(`/api/v1/world/stories/${encodeURIComponent(item.storyPublicId)}`, request.signal, true) : { value: null, failed: false };
  return { item, story: story.value, storyError: story.failed, from: returnHref(new URL(request.url).searchParams.get('from')) };
}
