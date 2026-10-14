import { sql } from "@aihot/backend/db";

// Peak prices, confirmed on 2026-10-14 from the provider's official pricing page.
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
export function upperCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 2 + outputTokens * 8) / 1_000_000;
}

export async function reserveAllowance(requestKey: string, upperCny: number): Promise<void> {
  if (!(upperCny > 0 && upperCny <= 10)) throw new Error("Invalid competition model reservation");
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('competition:first-live-acceptance'))`;
    if ((await tx`SELECT 1 FROM competition_model_allowance WHERE request_key = ${requestKey}`).length) return;
    const [sum] = await tx`SELECT coalesce(sum(coalesce(actual_upper_cny, reserved_cny)), 0)::float AS spent FROM competition_model_allowance WHERE batch = 'first-live-acceptance'`;
    if (Number(sum.spent) + upperCny > 10) throw new Error("Competition first acceptance budget exhausted (10 CNY)");
    await tx`INSERT INTO competition_model_allowance (request_key, batch, reserved_cny) VALUES (${requestKey}, 'first-live-acceptance', ${upperCny})`;
  });
}

export async function recordAllowance(requestKey: string, receiptId: number, usage: Record<string, unknown> | null) {
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  const amount = typeof input === "number" && typeof output === "number" && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0 ? upperCost(input, output) : null;
  await sql`UPDATE competition_model_allowance SET receipt_id = ${receiptId}, actual_upper_cny = ${amount} WHERE request_key = ${requestKey}`;
}
