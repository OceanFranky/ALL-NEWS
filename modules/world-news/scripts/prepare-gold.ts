import { readFile } from 'node:fs/promises';

const index = JSON.parse(await readFile(new URL('../review/formal-pool.json', import.meta.url), 'utf8')) as {
  cases: { caseId: string; reviewedDuringRuleDevelopment: boolean }[];
};
process.stdout.write(JSON.stringify(index.cases.map(row => ({
  caseId: row.caseId, eventGroup: null, split: null,
  reviewedDuringRuleDevelopment: row.reviewedDuringRuleDevelopment,
  gold: null, result: { relevance: null, materialSufficient: null, scores: null, error: null },
})), null, 2) + '\n');
