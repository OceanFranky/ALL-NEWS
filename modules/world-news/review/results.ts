import { z } from 'zod';
import { validateWorldCalibrationCases } from './calibration.ts';

const observation = z.object({
  caseId: z.string().min(1),
  fingerprint: z.string().length(64),
  result: z.object({
    relevance: z.enum(['PASS', 'BLOCK', 'UNKNOWN']).nullable(),
    materialSufficient: z.boolean().nullable(),
    scores: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]).nullable(),
    error: z.string().min(1).nullable(),
  }).strict(),
  analysisId: z.number().int().positive().nullable(),
  promptVersion: z.string().nullable(),
}).strict();

export interface ReviewIndexCase { caseId: string; fingerprint: string; reviewedDuringRuleDevelopment: boolean }

/** Join real results to human decisions, never substitute a model decision for the gold label. */
export function attachWorldResults(goldInput: unknown, index: readonly ReviewIndexCase[], resultsInput: unknown) {
  const gold = validateWorldCalibrationCases(goldInput);
  const results = z.array(observation).parse(resultsInput);
  const byCase = new Map(results.map(row => [row.caseId, row]));
  const snapshots = new Map(index.map(row => [row.caseId, row]));
  if (byCase.size !== results.length || snapshots.size !== index.length)
    throw new Error('Duplicate observation or snapshot case identity');
  if (gold.length !== index.length || results.length !== index.length)
    throw new Error('Gold, observations and frozen index must cover exactly the same cases');
  return gold.map(row => {
    const snapshot = snapshots.get(row.caseId);
    const measured = byCase.get(row.caseId);
    if (!snapshot || !measured || snapshot.fingerprint !== measured.fingerprint)
      throw new Error(`Missing or stale material result: ${row.caseId}`);
    if (snapshot.reviewedDuringRuleDevelopment && (!row.reviewedDuringRuleDevelopment || row.split === 'holdout'))
      throw new Error(`Previously reviewed material cannot be hidden in holdout: ${row.caseId}`);
    return { ...row, result: measured.result };
  });
}
