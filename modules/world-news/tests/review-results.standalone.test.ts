import test from 'node:test';
import assert from 'node:assert/strict';
import { attachWorldResults } from '../review/results.ts';
import { reviewErrorMessage } from '../review/diagnostics.ts';

function fixtures() {
  const index = Array.from({ length: 100 }, (_, n) => ({ caseId: `fixture-${n}`, fingerprint: String(n).padStart(64,'0'), reviewedDuringRuleDevelopment: false }));
  const gold = index.map((row, n) => ({ caseId: row.caseId, eventGroup: `event-${n}`, split: n < 80 ? 'development' : 'holdout',
    reviewedDuringRuleDevelopment: false, gold: { decision: n % 2 ? 'reject' : 'select', annotator: 'synthetic-test', reason: 'Not human gold' },
    result: { relevance: null, materialSufficient: null, scores: null, error: null } }));
  const results = index.map(row => ({ caseId: row.caseId, fingerprint: row.fingerprint,
    result: { relevance: 'PASS', materialSufficient: true, scores: [70,80], error: null }, analysisId: 1, promptVersion: 'world:fixture' }));
  return { index, gold, results };
}

test('world result attachment preserves human decisions and failure coverage without model calls', () => {
  const { index, gold, results } = fixtures();
  const before = structuredClone(gold);
  results[0]!.result = { relevance: 'UNKNOWN', materialSufficient: false, scores: [], error: null };
  assert.throws(() => attachWorldResults(gold,index,results));
  const corrected: unknown[] = results.map((row,n) => n ? row : { ...row, result: { relevance: null, materialSufficient: null, scores: null, error: 'not analysed' } });
  const joined = attachWorldResults(gold,index,corrected);
  assert.equal(joined[0]!.result.error, 'not analysed');
  assert.deepEqual(joined.map(row=>row.gold), gold.map(row=>row.gold));
  assert.deepEqual(gold,before);
});

test('partial labels, stale results, duplicates and concealed reviewed holdout are rejected', () => {
  const { index, gold, results } = fixtures();
  assert.throws(() => attachWorldResults(gold.slice(0,99),index,results));
  assert.throws(() => attachWorldResults(gold,index,[...results,results[0]!]));
  const stale = structuredClone(results); stale[0]!.fingerprint = 'f'.repeat(64);
  assert.throws(() => attachWorldResults(gold,index,stale), /stale/);
  index[80]!.reviewedDuringRuleDevelopment = true;
  assert.throws(() => attachWorldResults(gold,index,results), /holdout/);
});

test('invalid review input gives a bounded diagnostic rather than hundreds of stack entries', () => {
  const { index, gold, results } = fixtures();
  const blank = gold.map(row=>({ ...row, gold:null, eventGroup:null, split:null }));
  try {
    attachWorldResults(blank,index,results);
    assert.fail('Blank input must fail');
  } catch (error) {
    const message = reviewErrorMessage(error);
    assert.match(message,/300 invalid fields/);
    assert.ok(message.length<1000);
    assert.ok(!message.includes('99.gold'));
  }
});
