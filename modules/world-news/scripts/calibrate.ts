import { readFile } from 'node:fs/promises';
import { calibrateWorldSelection } from '../review/calibration.ts';

const path = process.argv[2];
if (!path || process.argv.length !== 3) throw new Error('Usage: node modules/world-news/scripts/calibrate.ts <labelled-results.json>');
process.stdout.write(JSON.stringify(calibrateWorldSelection(JSON.parse(await readFile(path, 'utf8'))), null, 2) + '\n');
