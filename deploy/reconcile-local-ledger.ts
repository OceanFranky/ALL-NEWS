import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql, closeDb } from '@aihot/backend/db';
import { audit } from '@aihot/backend/audit';

const delta = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
assert.equal(delta.namespace, 'deployment-local-20261015:');
assert.ok(Array.isArray(delta.receipts) && Array.isArray(delta.attempts));
try {
  const result = await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('providers.daily_spend'))`;
    const receiptIds = new Map<number, number>();
    let receipts = 0, attempts = 0;
    for (const original of delta.receipts) {
      assert.ok(Number.isSafeInteger(original.id));
      const logicalKey = delta.namespace + original.logical_key;
      const [existing] = await tx`SELECT id FROM receipts WHERE logical_key=${logicalKey}`;
      if (existing) {
        receiptIds.set(original.id, existing.id);
        continue;
      }
      const [sequence] = await tx`SELECT nextval(pg_get_serial_sequence('receipts','id'))::int AS id`;
      const row = { ...original, id: sequence!.id, logical_key: logicalKey, purpose: 'deployment.local-ledger',
        subject: 'deployment:local-worker-after-snapshot', request: { ...original.request,
          deploymentLedger: { sourceReceiptId: original.id, originalLogicalKey: original.logical_key,
            originalPurpose: original.purpose, originalSubject: original.subject, accountingOnly: true } } };
      await tx`INSERT INTO receipts SELECT (jsonb_populate_record(NULL::receipts,${tx.json(row)})).*`;
      receiptIds.set(original.id, row.id);
      receipts++;
    }
    for (const original of delta.attempts) {
      const receiptId = receiptIds.get(original.receipt_id);
      assert.ok(receiptId);
      assert.equal(original.origin, 'live');
      const [existing] = await tx`SELECT id FROM receipt_attempts WHERE receipt_id=${receiptId} AND attempt=${original.attempt}`;
      if (existing) continue;
      const [sequence] = await tx`SELECT nextval(pg_get_serial_sequence('receipt_attempts','id'))::int AS id`;
      const row = { ...original, id: sequence!.id, receipt_id: receiptId };
      await tx`INSERT INTO receipt_attempts SELECT (jsonb_populate_record(NULL::receipt_attempts,${tx.json(row)})).*`;
      attempts++;
    }
    if (receipts || attempts) await audit('operator.server-deployment', 'deployment.ledger-reconcile', delta.namespace,
      'Local worker was found running after snapshot. Stop both workers, disable local restart, and retain all additional real attempts in the server daily ceiling without replaying content jobs.',
      null, { receipts, attempts, accountingOnly: true, unknownRetainsReservation: true }, { db: tx });
    return { receipts, attempts };
  });
  console.log(JSON.stringify(result));
} finally {
  await closeDb();
}
