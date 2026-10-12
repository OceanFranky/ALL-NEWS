import { z } from 'zod';
import { selectionMetrics } from '../../../scripts/eval-selection-core.ts';

const caseSchema = z.object({
  caseId: z.string().min(1),
  eventGroup: z.string().min(1),
  split: z.enum(['development', 'holdout']),
  reviewedDuringRuleDevelopment: z.boolean(),
  gold: z.object({
    decision: z.enum(['select', 'reject', 'either']),
    annotator: z.string().min(1),
    reason: z.string().min(1),
  }).strict(),
  result: z.object({
    relevance: z.enum(['PASS', 'BLOCK', 'UNKNOWN']).nullable(),
    materialSufficient: z.boolean().nullable(),
    scores: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]).nullable(),
    error: z.string().min(1).nullable(),
  }).strict(),
}).strict();

export type CalibrationCase = z.infer<typeof caseSchema>;

function available(row: CalibrationCase) {
  const result = row.result;
  return !result.error && (result.relevance === 'BLOCK' ||
    (result.relevance === 'PASS' && result.materialSufficient === true && result.scores !== null));
}

function metrics(rows: CalibrationCase[], threshold: number) {
  const decisions = rows.map(row => ({
    gold: row.gold.decision,
    decision: !available(row) ? null : row.result.relevance === 'PASS' &&
      row.result.scores![0] + row.result.scores![1] >= threshold * 2 ? 'select' as const : 'reject' as const,
  }));
  const base = selectionMetrics(decisions);
  const missedSelected = rows.filter((row, index) => row.gold.decision === 'select' && decisions[index].decision === null).length;
  return {
    threshold, ...base,
    f2: 5 * base.tp / Math.max(1, 5 * base.tp + 4 * base.fn + base.fp),
    completeF2: 5 * base.tp / Math.max(1, 5 * base.tp + 4 * (base.fn + missedSelected) + base.fp),
    failures: rows.filter(row => !available(row)).map(row => ({ caseId: row.caseId, result: row.result })),
    mistakes: rows.filter((row, index) => row.gold.decision !== 'either' &&
      decisions[index].decision !== null && decisions[index].decision !== row.gold.decision)
      .map(row => ({ caseId: row.caseId, gold: row.gold, result: row.result })),
  };
}

/** Offline only: never calls a provider, imports AI rules, or changes production thresholds. */
export function calibrateWorldSelection(input: unknown) {
  const rows = z.array(caseSchema).min(100).parse(input);
  const ids = new Set<string>();
  const groups = new Map<string, string>();
  for (const row of rows) {
    if (ids.has(row.caseId)) throw new Error(`Duplicate caseId: ${row.caseId}`);
    ids.add(row.caseId);
    if (groups.has(row.eventGroup) && groups.get(row.eventGroup) !== row.split)
      throw new Error(`Event appears in both splits: ${row.eventGroup}`);
    groups.set(row.eventGroup, row.split);
    if (row.reviewedDuringRuleDevelopment && row.split === 'holdout')
      throw new Error(`Previously reviewed case in holdout: ${row.caseId}`);
  }
  const development = rows.filter(row => row.split === 'development');
  const holdout = rows.filter(row => row.split === 'holdout');
  for (const split of [development, holdout]) {
    if (!split.some(row => row.gold.decision === 'select') || !split.some(row => row.gold.decision === 'reject'))
      throw new Error('Each split needs decisive positive and negative human labels');
  }
  if (!development.some(row => row.gold.decision !== 'either' && available(row)))
    throw new Error('Development has no completed decisive results; no threshold can be selected');
  // Rank exact ratios rather than the rounded values exposed by shared display metrics.
  const scan = Array.from({ length: 101 }, (_, threshold) => metrics(development, threshold));
  const ratio = (m: ReturnType<typeof metrics>, kind: 'recall' | 'precision') =>
    m.tp / Math.max(1, m.tp + (kind === 'recall' ? m.fn : m.fp));
  const best = [...scan].sort((a, b) => b.f2 - a.f2 || ratio(b, 'recall') - ratio(a, 'recall') ||
    ratio(b, 'precision') - ratio(a, 'precision') || a.threshold - b.threshold)[0]!;
  return {
    section: 'world', productionChanged: false,
    labelProvenance: 'Caller-supplied human labels; authenticity is not verified by this tool.',
    split: { development: development.length, holdout: holdout.length, targetDevelopmentFraction: 0.8,
      actualDevelopmentFraction: development.length / rows.length },
    threshold: best.threshold, development: best,
    // Holdout is evaluated once at the development-selected threshold, never scanned.
    holdout: metrics(holdout, best.threshold), developmentScan: scan,
  };
}
