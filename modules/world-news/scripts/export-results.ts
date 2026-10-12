import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import type { PoolMaterial } from '../review/pool.ts';

const target = new URL(process.env.DATABASE_URL ?? 'postgres://unset/unset');
if (target.hostname !== '127.0.0.1' || target.pathname !== '/world_real_trial_test' || !target.port)
  throw new Error('Use the dedicated local real trial test database');
const index = JSON.parse(await readFile(new URL('../review/formal-pool.json', import.meta.url), 'utf8')) as {
  cases: { caseId: string; articleId: string; fingerprint: string }[];
};
const db = postgres(target.toString(), { max: 1 });
try {
  const materials = await db<PoolMaterial[]>`
    SELECT section_id AS "sectionId", id AS "articleId", source_id AS "sourceId", url, title, excerpt,
      to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "publishedAt",
      to_char(discovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "discoveredAt",
      revision, content_hash AS "contentHash" FROM articles WHERE section_id='world'`;
  const byId = new Map(materials.map(row => [row.articleId, row]));
  const results = [];
  for (const row of index.cases) {
    const material = byId.get(row.articleId);
    if (!material || createHash('sha256').update(JSON.stringify(material)).digest('hex') !== row.fingerprint)
      throw new Error(`Frozen material changed or missing: ${row.caseId}`);
    const [analysis] = await db<{ id: number; relevance: string; output: { materialSufficient?: boolean; scores?: number[] }; prompt_version: string }[]>`
      SELECT id,relevance,output,prompt_version FROM analyses
      WHERE section_id='world' AND article_id=${row.articleId} AND input_revision=${material.revision}
      ORDER BY id DESC LIMIT 1`;
    results.push({ caseId: row.caseId, fingerprint: row.fingerprint,
      result: { relevance: analysis ? analysis.relevance.toUpperCase() : null,
        materialSufficient: analysis ? analysis.output.materialSufficient === true : null,
        scores: analysis?.output.scores?.length === 2 ? analysis.output.scores : null,
        error: analysis ? null : 'not analysed' },
      analysisId: analysis?.id ?? null, promptVersion: analysis?.prompt_version ?? null });
  }
  process.stdout.write(JSON.stringify(results) + '\n');
} finally { await db.end(); }
