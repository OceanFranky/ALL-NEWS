// Read-only prerequisites for restoring or regenerating competition details.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { sql, closeDb } from "@aihot/backend/db";
import { config, credential } from "@aihot/backend/config";
import { MODELS } from "@aihot/backend/providers/llm";

try {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  const [counts] = await sql`SELECT
    (SELECT count(*)::int FROM competition_catalogue) catalogue,
    (SELECT count(*)::int FROM competition_materials) materials,
    (SELECT count(*)::int FROM competition_revisions) revisions,
    (SELECT count(*)::int FROM competition_displays WHERE revision_id IS NOT NULL) displays,
    (SELECT count(*)::int FROM competition_runs) runs,
    (SELECT count(*)::int FROM receipts) receipts,
    (SELECT count(*)::int FROM learning_resources) resources`;
  const budgets = await sql`SELECT batch,count(*)::int calls,
    coalesce(sum(coalesce(actual_upper_cny,reserved_cny)),0)::float allocated_cny
    FROM competition_model_allowance GROUP BY batch ORDER BY batch`;
  const entries = await sql`SELECT c.id,c.name,
    (SELECT count(*)::int FROM competition_materials m WHERE m.competition_id=c.id) materials,
    (SELECT count(*)::int FROM competition_revisions r WHERE r.competition_id=c.id) revisions,
    (SELECT count(*)::int FROM competition_displays d WHERE d.competition_id=c.id AND d.revision_id IS NOT NULL) displays
    FROM competition_catalogue c ORDER BY c.id`;
  const spec = MODELS.default;
  const base = credential("models", spec.baseUrlEnv);
  let official = false;
  try { official = !!base && new URL(base).hostname === "api.deepseek.com"; } catch { /* Report invalid configuration without exposing it. */ }
  const report = {
    checkedAt: new Date().toISOString(), counts, entries, budgets,
    model: { name: spec.model, baseConfigured: !!base, keyConfigured: !!credential("models", spec.apiKeyEnv), supportedByExistingPricing: official && spec.model === "deepseek-flash" },
    switches: { collection: process.env.COLLECT_ENABLED === "true", models: config.modelCallsEnabled },
    warning: "空开发库不代表旧预算已清零；历史记录需从原库恢复，新一轮真实调用须有当前授权。仅检查配置存在性，不验证密钥有效性，不发出模型请求。",
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (values.output) { await mkdir(path.dirname(values.output), { recursive: true }); await writeFile(values.output, text); }
  console.log(text);
} finally { await closeDb(); }
