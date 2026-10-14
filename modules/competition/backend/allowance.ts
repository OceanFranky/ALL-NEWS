import { sql } from "@aihot/backend/db";

// The user explicitly authorised a separate second 10 CNY round on 2026-10-14.
// Never rotate this identifier automatically or discard the first round's pending reservations.
export const ACCEPTANCE_BATCH = "second-live-acceptance";

export class CompetitionBudgetExhaustedError extends Error {
  constructor() { super(`Competition acceptance budget exhausted (10 CNY; ${ACCEPTANCE_BATCH})`); }
}

// Peak prices, confirmed on 2026-10-14 from the provider's official pricing page.
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
export function upperCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 2 + outputTokens * 8) / 1_000_000;
}

export async function reserveAllowance(requestKey: string, upperCny: number): Promise<void> {
  if (!(upperCny > 0 && upperCny <= 10)) throw new Error("Invalid competition model reservation");
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`competition:${ACCEPTANCE_BATCH}`}))`;
    const [existing] = await tx`SELECT batch FROM competition_model_allowance WHERE request_key = ${requestKey}`;
    if (existing) {
      if (existing.batch !== ACCEPTANCE_BATCH) throw new Error("Competition reservation belongs to another budget round");
      return;
    }
    const [sum] = await tx`SELECT coalesce(sum(coalesce(actual_upper_cny, reserved_cny)), 0)::float AS spent FROM competition_model_allowance WHERE batch = ${ACCEPTANCE_BATCH}`;
    if (Number(sum.spent) + upperCny > 10) throw new CompetitionBudgetExhaustedError();
    await tx`INSERT INTO competition_model_allowance (request_key, batch, reserved_cny) VALUES (${requestKey}, ${ACCEPTANCE_BATCH}, ${upperCny})`;
  });
}

export async function recordAllowance(requestKey: string, receiptId: number, usage: Record<string, unknown> | null) {
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  const amount = typeof input === "number" && typeof output === "number" && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0 ? upperCost(input, output) : null;
  await sql`UPDATE competition_model_allowance SET receipt_id = ${receiptId}, actual_upper_cny = ${amount} WHERE request_key = ${requestKey}`;
}
