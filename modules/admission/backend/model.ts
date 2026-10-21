import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "@aihot/backend/db";
import { chatJson, MODELS } from "@aihot/backend/providers/llm";
import { credential, config, isProduction } from "@aihot/backend/config";
import { extractionSchema } from "./automation-schema.ts";
import type { Material } from "@aihot/backend/documents/types";
import { admissionLimit } from "./budget.ts";

// One user-approved total allowance. Never rotate this batch on restart or at midnight.
export const BATCH = "985-first-20261017";
export const LIMIT_CNY = admissionLimit(process.env.ADMISSION_BUDGET_CNY);
export class AdmissionBudgetError extends Error { constructor() { super(`升学本轮${LIMIT_CNY}元额度已用完，采集继续，模型处理暂停`); } }
export const upperCost = (input: number, output: number) => Math.ceil((input * 2 + output * 8) * 1e6 / 1e6) / 1e6;
export async function reserveAdmission(key: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > LIMIT_CNY) throw new Error("invalid admission reservation");
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`admission:${BATCH}`},0))`;
    const [sum] = await tx<{ used: number }[]>`SELECT coalesce(sum(coalesce(actual_cny,reserved_cny)),0)::float8 AS used FROM admission_allowance WHERE batch=${BATCH}`;
    if (sum.used + amount > LIMIT_CNY) throw new AdmissionBudgetError();
    await tx`INSERT INTO admission_allowance(request_key,batch,reserved_cny) VALUES(${key},${BATCH},${amount})`;
  });
}
export async function admissionCost() {
  const [sum] = await sql<{ used: number; requests: number }[]>`SELECT coalesce(sum(coalesce(actual_cny,reserved_cny)),0)::float8 AS used,count(*)::int AS requests FROM admission_allowance WHERE batch=${BATCH}`;
  return { batch: BATCH, limitCny: LIMIT_CNY, accountedUpperCny: sum.used, attempts: sum.requests };
}
export async function extractAdmission(school: string, title: string, id: string, materials: Material[], repair?: { previous: unknown; error: string }) {
  if (process.env.MODEL_CALLS_ENABLED !== "true") throw new Error("model-disabled");
  const spec = MODELS.default;
  const base = credential("models", spec.baseUrlEnv);
  const localTest = !isProduction && config.allowPrivateNetworkFetch && base && new URL(base).hostname === "127.0.0.1";
  if (!base || (!localTest && (new URL(base).hostname !== "api.deepseek.com" || new URL(base).protocol !== "https:")) || spec.model !== "deepseek-flash") throw new Error("本轮计价仅适用于已核对的官方deepseek-flash");
  if (["model", "messages", "max_tokens", "max_completion_tokens"].some(k => k in (spec.extra ?? {}))) throw new Error("model extras override admission budget");
  const system = readFileSync(new URL("../prompts/extract.md", import.meta.url), "utf8");
  const user = JSON.stringify({ school, title, materials: materials.map(({ id, url, blocks }) => ({ id, url, blocks })), ...(repair ? { repair: { ...repair, instruction: "上次结果未通过检查。请仅根据原文修正，返回完整JSON。摘要100至150字；资格和材料各最多3项。evidence.field必须逐项使用eligibility.0、eligibility.1及materials.0等，禁止只写eligibility或materials。year、track、stage、summary必须有证据，非空日期和每项资格／材料也必须有证据。每段quote取指定块中20至100字的连续原句，忽略空格外不得改写，不能替换或省略中间字词。请仔细核对materialId和blockId，禁止把自己概括的阶段、批次名当作原文引用。日期年份不明确请填null并说明，不能推断。资格／材料没有逐项证据请删除该项；只保留本文主要招生路径，不为仅指向另一份通知的链接创建第二条。" } } : {}) });
  const maxTokens = 4500;
  const amount = upperCost(Buffer.byteLength(system + user) + 4096, maxTokens + (spec.reasoningTokens ?? 0));
  const key = randomUUID(); await reserveAdmission(key, amount);
  const result = await chatJson({ model: "default", purpose: "admission.extract", subject: `admission:${id}`,
    promptVersion: createHash("sha256").update(system).digest("hex"), system, user, schema: extractionSchema, maxTokens, timeoutMs: 120000 });
  const input = result.usage?.prompt_tokens, output = result.usage?.completion_tokens;
  const actual = result.reused ? 0 : Number.isSafeInteger(input) && Number.isSafeInteger(output) && Number(input) >= 0 && Number(output) >= 0 ? upperCost(Number(input), Number(output)) : null;
  await sql`UPDATE admission_allowance SET receipt_id=${result.receiptId},actual_cny=${actual} WHERE request_key=${key}`;
  return result;
}
