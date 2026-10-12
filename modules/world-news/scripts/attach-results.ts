import { readFile } from 'node:fs/promises';
import { attachWorldResults } from '../review/results.ts';
import { reviewErrorMessage } from '../review/diagnostics.ts';

const [goldPath, resultsPath] = process.argv.slice(2);
if (!goldPath || !resultsPath || process.argv.length !== 4)
  throw new Error('Usage: node modules/world-news/scripts/attach-results.ts <human-gold.json> <model-results.json>');
const index = JSON.parse(await readFile(new URL('../review/formal-pool.json', import.meta.url), 'utf8'));
const gold = JSON.parse(await readFile(goldPath, 'utf8'));
const results = JSON.parse(await readFile(resultsPath, 'utf8'));
try {
  process.stdout.write(JSON.stringify(attachWorldResults(gold, index.cases, results), null, 2) + '\n');
} catch (error) {
  process.stderr.write(reviewErrorMessage(error) + '\n');
  process.exitCode = 1;
}
