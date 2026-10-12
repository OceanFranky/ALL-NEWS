import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateWorldSelection, type CalibrationCase } from '../review/calibration.ts';

function cases(): CalibrationCase[] {
  return Array.from({ length: 100 }, (_, index) => ({
    caseId: `fixture-${index}`, eventGroup: `event-${index}`, split: index < 80 ? 'development' : 'holdout',
    reviewedDuringRuleDevelopment: false,
    gold: { decision: index % 2 ? 'reject' : 'select', annotator: 'synthetic-test', reason: 'Not real human gold' },
    result: { relevance: 'PASS', materialSufficient: true, scores: index % 2 ? [20, 20] : [80, 80], error: null },
  }));
}

test('world calibration uses development F2 and reports fixed-threshold holdout without production writes', () => {
  const result = calibrateWorldSelection(cases());
  assert.equal(result.threshold, 21);
  assert.equal(result.development.f2, 1);
  assert.equal(result.holdout.f2, 1);
  assert.equal(result.productionChanged, false);
  const changed = cases();
  changed.slice(80).forEach(row => { row.result.scores = [0, 0]; });
  assert.equal(calibrateWorldSelection(changed).threshold, result.threshold);
});

test('event leakage, duplicate identities, reviewed holdout and incomplete labels are rejected', () => {
  for (const mutation of [
    (rows: CalibrationCase[]) => { rows[80]!.eventGroup = rows[0]!.eventGroup; },
    (rows: CalibrationCase[]) => { rows[80]!.caseId = rows[0]!.caseId; },
    (rows: CalibrationCase[]) => { rows[80]!.reviewedDuringRuleDevelopment = true; },
    (rows: CalibrationCase[]) => { rows[0]!.gold.annotator = ''; },
  ]) {
    const rows = cases(); mutation(rows);
    assert.throws(() => calibrateWorldSelection(rows));
  }
  assert.throws(() => calibrateWorldSelection(cases().slice(0, 99)));
  const failed = cases();
  failed.forEach(row => { row.result.error = 'No model result'; });
  assert.throws(() => calibrateWorldSelection(failed), /no completed decisive results/);
});

test('unknown, insufficient text and failed scoring remain visible in coverage and complete F2', () => {
  const rows = cases();
  rows[0]!.result.relevance = 'UNKNOWN';
  rows[2]!.result.materialSufficient = false;
  rows[4]!.result.error = 'provider failed';
  const result = calibrateWorldSelection(rows);
  assert.equal(result.development.failures.length, 3);
  assert.equal(result.development.coverage, 0.963);
  assert.ok(result.development.completeF2 < result.development.f2);
});

test('BLOCK is a valid rejection without scores; either is excluded but failures are reported', () => {
  const rows = cases();
  rows[1]!.result = { relevance: 'BLOCK', materialSufficient: null, scores: null, error: null };
  rows[3]!.gold.decision = 'either'; rows[3]!.result.error = 'invalid response';
  const result = calibrateWorldSelection(rows);
  assert.equal(result.development.either, 1);
  assert.equal(result.development.eitherErrors, 1);
  assert.equal(result.development.decisiveErrors, 0);
});

test('F2 prefers retaining positives over a higher-precision threshold and does not floor dual scores', () => {
  const rows = cases();
  for (const [index, row] of rows.entries()) {
    if (index % 4 === 0) row.result.scores = [50, 50];
    if (index % 10 === 1) row.result.scores = [60, 60];
  }
  const result = calibrateWorldSelection(rows);
  assert.equal(result.threshold, 21);
  assert.equal(result.development.recall, 1);
  assert.ok(result.development.precision < 1);
  assert.ok(result.development.f2 > result.developmentScan[61]!.f2);
  const boundary = cases();
  boundary[0]!.result.scores = [20, 21];
  const measured = calibrateWorldSelection(boundary).developmentScan[21]!;
  assert.equal(measured.fn, 1);
});
