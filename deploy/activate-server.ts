import assert from 'node:assert/strict';
import { sql, closeDb } from '@aihot/backend/db';
import { audit } from '@aihot/backend/audit';
import { installModules } from '@aihot/backend/modules';
import { SERVER_MODULES } from '@aihot/site/modules/server';
import { reviewSectionSourcePermission } from '@aihot/backend/publication/section-publish';

assert.equal(process.env.NODE_ENV, 'production');
assert.equal(process.env.COLLECT_ENABLED, 'true');
assert.equal(process.env.MODEL_CALLS_ENABLED, 'true');
assert.equal(new URL(process.env.LLM_BASE_URL!).hostname, 'api.deepseek.com');
assert.equal(process.env.LLM_MODEL, 'deepseek-flash');
assert.equal(process.env.FEISHU_INTERNAL_ENABLED, 'false');
assert.equal(process.env.FEISHU_CONTENT_PUSH_ENABLED, 'false');
assert.equal(process.env.INDEXNOW_SUBMIT_ENABLED, 'false');
installModules(SERVER_MODULES);
try {
  const [budget] = await sql`SELECT value FROM settings WHERE key='providers.daily_spend'`;
  assert.equal(budget?.value?.limitCny, 5);
  assert.ok(budget.value.startedAt);
  assert.equal(budget.value.endpointHost, 'api.deepseek.com');
  const permissions = await sql<{ source_id: string; permission_reference: string }[]>`
    SELECT source_id,permission_reference FROM section_source_permissions WHERE section_id='world' AND summary_allowed`;
  const previewPermissions = permissions.filter(row => row.permission_reference.includes('LOCALHOST-ONLY'));
  if (process.argv.includes('--operator-confirmed-public-summaries')) {
    const reference = 'Site operator explicitly directed public summary display during server migration on 2026-10-15. Scope: summaries and original links, not full text. Supersedes the operator-only LOCALHOST preview scope; third-party license/terms were not independently verified by the deployment agent.';
    for (const permission of previewPermissions) await reviewSectionSourcePermission('world', permission.source_id, {
      summaryAllowed: true, reference, actor: 'operator.server-deployment',
    });
  } else {
    assert.equal(previewPermissions.length, 0, 'LOCALHOST-only permissions require an explicit operator decision before public deployment');
  }
  await audit('operator.server-deployment', 'deployment.activate', 'server:main:ae6abe3',
    'User requested full database migration and live collection; local worker stopped before snapshot. Budget ledger copied without reset.',
    null, { release: 'ae6abe3', dailyLimitCny: budget.value.limitCny, startedAt: budget.value.startedAt,
      operatorPublicSummaryConfirmation: process.argv.includes('--operator-confirmed-public-summaries') });
  console.log(JSON.stringify({ release: 'ae6abe3', dailyLimitCny: 5, ledgerPreserved: true,
    updatedPreviewPermissions: process.argv.includes('--operator-confirmed-public-summaries') ? previewPermissions.length : 0 }));
} finally {
  await closeDb();
}
