import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { buildWorldReviewPool, type PoolMaterial } from '../review/pool.ts';

const target = new URL(process.env.DATABASE_URL ?? 'postgres://unset/unset');
if (target.hostname !== '127.0.0.1' || target.pathname !== '/world_real_trial_test')
  throw new Error('Use the owned local world_real_trial_test database, not a business database');
if (process.argv.slice(2).some(arg => arg !== '--private')) throw new Error('Only optional --private is supported');
const initial = JSON.parse(await readFile(new URL('../review/samples.json', import.meta.url), 'utf8')) as {
  samples: { url: string }[];
};
const db = postgres(target.toString(), { max: 1 });
try {
  const rows = await db<PoolMaterial[]>`
    SELECT section_id AS "sectionId", id AS "articleId", source_id AS "sourceId", url, title, excerpt,
      to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "publishedAt",
      to_char(discovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "discoveredAt",
      revision, content_hash AS "contentHash"
    FROM articles WHERE section_id='world'`;
  const analysed = await db<{ url: string }[]>`
    SELECT DISTINCT a.url FROM articles a JOIN analyses n ON n.article_id=a.id AND n.section_id=a.section_id
    WHERE a.section_id='world'`;
  const pool = buildWorldReviewPool(rows, [...initial.samples.map(row => row.url), ...analysed.map(row => row.url)], new Date().toISOString());
  // --private prints copyrighted RSS material for local review only. Never commit that output.
  process.stdout.write(JSON.stringify(process.argv.includes('--private') ? pool : pool.manifest) + '\n');
} finally { await db.end(); }
