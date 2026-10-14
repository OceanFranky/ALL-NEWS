import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { credential } from "@aihot/backend/config";
import { chatJson, MODELS, type ChatJsonOptions } from "@aihot/backend/providers/llm";
import { reserveAllowance, recordAllowance, upperCost } from "./allowance.ts";

export async function competitionChat<S extends z.ZodType>(options: ChatJsonOptions<S>) {
  options = { ...options, system: options.system + "\nRespond with a valid JSON object only." };
  const spec = MODELS.default;
  const base = credential("models", spec.baseUrlEnv);
  if (!base || new URL(base).hostname !== "api.deepseek.com" || spec.model !== "deepseek-flash") throw new Error("Acceptance pricing is only verified for configured official deepseek-flash");
  if (options.model !== "default" || !options.purpose.startsWith("competition.") || !options.subject.startsWith("competition:competition-")) throw new Error("Competition model scope mismatch");
  if (["max_tokens", "max_completion_tokens", "model", "messages"].some(key => key in (spec.extra ?? {}))) throw new Error("Model extras cannot override the acceptance token budget");
  const requestKey = randomUUID();
  const user = typeof options.user === "string" ? options.user : JSON.stringify(options.user);
  const reservation = upperCost(Buffer.byteLength(options.system + user) + 1024, Math.max(options.maxTokens ?? 1500, 512) + (spec.reasoningTokens ?? 0));
  await reserveAllowance(requestKey, reservation);
  const result = await chatJson(options);
  await recordAllowance(requestKey, result.receiptId, result.reused ? { prompt_tokens: 0, completion_tokens: 0 } : result.usage);
  return result;
}
