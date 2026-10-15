import { createHash } from 'node:crypto';

export interface PoolMaterial {
  sectionId: string;
  articleId: string;
  sourceId: string;
  url: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  revision: number;
  contentHash: string;
}

export const POOL_QUOTAS = {
  'world-un-zh': 25, 'world-france24': 20, 'world-npr': 10,
  'world-fed': 20, 'world-ecb': 15, 'world-wto': 10,
} as const;

export function buildWorldReviewPool(materials: PoolMaterial[], reviewedUrls: readonly string[], capturedAt: string) {
  if (materials.some(row => row.sectionId !== 'world')) throw new Error('Review pool cannot contain AI material');
  if (new Set(materials.map(row => row.articleId)).size !== materials.length) throw new Error('Duplicate article identity');
  const reviewed = new Set(reviewedUrls);
  const selected: PoolMaterial[] = [];
  for (const [sourceId, count] of Object.entries(POOL_QUOTAS)) {
    const candidates = materials.filter(row => row.sourceId === sourceId).sort((a, b) =>
      (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.articleId.localeCompare(b.articleId));
    if (candidates.length < count) throw new Error(`Insufficient actual materials for ${sourceId}: ${candidates.length}/${count}`);
    selected.push(...candidates.slice(0, count));
  }
  const privateMaterials = selected.map((row, index) => {
    const caseId = `world-${String(index + 1).padStart(3, '0')}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    return {
      caseId, fingerprint, material: row,
      reviewedDuringRuleDevelopment: reviewed.has(row.url),
      eventGroup: null, split: null, gold: null, result: null,
    };
  });
  return {
    manifest: {
      sectionId: 'world', status: 'unlabelled-candidate-pool', capturedAt,
      method: 'Latest published material per source quota from the actual RSS reader; no gold labels or event split assigned.',
      quotas: POOL_QUOTAS,
      // Public Git index excludes third-party titles and excerpts. The private snapshot is authoritative material.
      cases: privateMaterials.map(({ caseId, fingerprint, material, reviewedDuringRuleDevelopment }) => ({
        caseId, fingerprint, articleId: material.articleId, sourceId: material.sourceId, url: material.url,
        publishedAt: material.publishedAt, discoveredAt: material.discoveredAt,
        revision: material.revision, contentHash: material.contentHash,
        rssTextCharacters: (material.excerpt ?? '').length,
        textBeyondTitle: !!material.excerpt?.trim() && material.excerpt.trim() !== material.title.trim(),
        reviewedDuringRuleDevelopment, eventGroup: null, split: null, gold: null,
      })),
    },
    privateMaterials,
  };
}
