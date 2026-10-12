import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldReviewPool, POOL_QUOTAS, type PoolMaterial } from '../review/pool.ts';

function fixtures(): PoolMaterial[] {
  return Object.entries(POOL_QUOTAS).flatMap(([sourceId, count]) =>
    Array.from({ length: count + 1 }, (_, index) => ({
      sectionId: 'world', articleId: `${sourceId}-${index}`, sourceId,
      url: `https://example.test/${sourceId}/${index}`, title: `Synthetic title ${index}`,
      excerpt: index % 2 ? `Synthetic title ${index}` : 'Synthetic RSS details',
      publishedAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString(),
      discoveredAt: '2026-10-11T15:00:00Z', revision: 1, contentHash: `fixture-${index}`,
    })));
}

test('review pool selects 100 deterministically, preserves revisions and leaves human labels and splits empty', () => {
  const rows = fixtures();
  const output = buildWorldReviewPool(rows, [rows[1]!.url], 'fixed-capture');
  assert.equal(output.manifest.cases.length, 100);
  assert.equal(output.privateMaterials.length, 100);
  assert.deepEqual(output, buildWorldReviewPool([...rows].reverse(), [rows[1]!.url], 'fixed-capture'));
  assert.ok(output.manifest.cases.some(row => row.reviewedDuringRuleDevelopment));
  assert.ok(output.manifest.cases.every(row => row.gold === null && row.eventGroup === null && row.split === null));
  assert.ok(output.manifest.cases.every(row => !('title' in row) && !('excerpt' in row)));
  assert.ok(output.privateMaterials.every(row => row.material.contentHash && row.fingerprint.length === 64));
});

test('mixed sections, duplicate identities and missing source material cannot be padded into a pool', () => {
  const rows = fixtures();
  const mixed = structuredClone(rows); mixed[0]!.sectionId = 'ai';
  assert.throws(() => buildWorldReviewPool(mixed, [], 'now'), /AI material/);
  assert.throws(() => buildWorldReviewPool([...rows, rows[0]!], [], 'now'), /Duplicate/);
  assert.throws(() => buildWorldReviewPool(rows.filter(row => row.sourceId !== 'world-fed'), [], 'now'), /Insufficient/);
});

test('changed RSS material changes fingerprint, and title-only text is not marked as extra evidence', () => {
  const rows = fixtures();
  const original = buildWorldReviewPool(rows, [], 'now');
  const changed = structuredClone(rows);
  changed.forEach(row => { row.excerpt = row.title; row.revision = 2; });
  const updated = buildWorldReviewPool(changed, [], 'now');
  assert.ok(updated.manifest.cases.every(row => !row.textBeyondTitle));
  assert.notEqual(original.manifest.cases[0]!.fingerprint, updated.manifest.cases[0]!.fingerprint);
});
