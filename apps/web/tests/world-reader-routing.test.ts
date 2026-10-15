import assert from 'node:assert/strict';
import { test } from 'node:test';
import { returnHref, timelineHref, itemHref } from '../../../modules/world-news/web/reader-types.ts';

test('world reader keeps category, query and page context without accepting external return targets', () => {
  const from = timelineHref('economy', '贸易 & 产业', 2);
  assert.equal(new URL(from, 'https://local.invalid').searchParams.get('q'), '贸易 & 产业');
  assert.equal(returnHref(from), from);
  assert.equal(new URL(itemHref('example', from), 'https://local.invalid').searchParams.get('from'), from);
  for (const value of ['https://example.com/world', '//example.com/world', '/admin', '/world/items/example', 'http://[', 'javascript:alert(1)']) {
    assert.equal(returnHref(value), '/world');
  }
  assert.equal(returnHref('/starred'), '/starred');
});
