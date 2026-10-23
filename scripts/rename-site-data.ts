// Explicit maintenance step for stored site-owned labels; never rewrites third-party prose.
// Usage: DATABASE_URL=... node scripts/rename-site-data.ts <previous site name>
import postgres from "postgres";
import { SITE } from "@aihot/site";
import { sha256, stableJson } from "../packages/backend/src/lib/ids.ts";

const previous = process.argv[2];
if (!previous || !process.env.DATABASE_URL) throw new Error("DATABASE_URL and previous site name are required");
const db = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const counts = await db.begin(async tx => {
    let reports = 0;
    const rows = await tx`SELECT id, content->>'title' AS title FROM reports WHERE lower(left(content->>'title', ${previous.length})) = lower(${previous}) FOR UPDATE`;
    for (const row of rows) {
      const suffix = String(row.title).slice(previous.length);
      if (suffix && !/^[\s·—-]/u.test(suffix)) continue;
      await tx`UPDATE reports SET content = jsonb_set(content, '{title}', to_jsonb(${SITE.name + suffix}::text)) WHERE id=${row.id}`;
      reports++;
    }
    const ledger = await tx`UPDATE selected_ledger SET payload=jsonb_set(payload, '{attribution,name}', to_jsonb(${SITE.name}::text))
      WHERE lower(payload->'attribution'->>'name')=lower(${previous}) RETURNING seq, payload`;
    for (const row of ledger) {
      await tx`UPDATE selected_state SET payload_hash=${sha256(stableJson(row.payload))} WHERE last_seq=${row.seq} AND in_set`;
    }
    return { reports, ledger: ledger.length };
  });
  console.log(JSON.stringify({ site: SITE.name, ...counts }));
} finally { await db.end(); }
