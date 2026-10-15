import { requireSectionId, type SectionId } from "@aihot/contracts/sections";
import type { PromptPack } from "./prompts.ts";

export const SECTION_MODEL_STEPS = ["prefilter", "score", "structure", "understand", "summarize", "group", "groupReview", "digest"] as const;
export type SectionModelStep = (typeof SECTION_MODEL_STEPS)[number];
export interface SectionHotPolicy { readonly windowHours:number;readonly halfLifeHours:number;readonly limit:number;readonly version:string }

export interface SectionRules {
  readonly hot?:SectionHotPolicy;
  readonly id: SectionId;
  readonly categories: readonly { readonly key: string; readonly label: string }[];
  readonly prompts: PromptPack;
  readonly models: Readonly<Partial<Record<SectionModelStep, string>>>;
  readonly selection: {
    readonly thresholds: Readonly<Record<string, number>> | null;
    readonly understandFloor: number | null;
  };
}

/** Copy before freezing: a module cannot change another in-flight task's rules. */
export function freezeSectionRules(input: SectionRules): SectionRules {
  requireSectionId(input.id);
  if(input.hot && (!input.hot.version.trim() || !Number.isFinite(input.hot.windowHours) || input.hot.windowHours<=0
    || !Number.isFinite(input.hot.halfLifeHours) || input.hot.halfLifeHours<=0 || !Number.isSafeInteger(input.hot.limit)
    || input.hot.limit<1 || input.hot.limit>100)) throw new Error('invalid section hot policy');
  if (input.prompts.sectionId !== input.id) throw new Error("prompt pack section mismatch");
  if (!input.categories.length) throw new Error("section categories must not be empty");
  const keys = input.categories.map((c) => c.key);
  if (keys.some((key) => !/^[a-z][a-z0-9-]*$/.test(key)) || new Set(keys).size !== keys.length
    || input.categories.some((c) => !c.label.trim())) throw new Error("invalid section categories");
  const thresholds = input.selection.thresholds;
  if (thresholds !== null && Object.values(thresholds).some((n) => !Number.isFinite(n) || n < 0 || n > 100)) {
    throw new Error("invalid section selection thresholds");
  }
  // Non-legacy calibration produces one uniform threshold, never AI source-tier thresholds.
  if (input.id !== "ai" && thresholds !== null &&
    (Object.keys(thresholds).length !== 1 || !Object.hasOwn(thresholds, "default"))) {
    throw new Error("section selection thresholds must contain only default");
  }
  const floor = input.selection.understandFloor;
  if (floor !== null && (!Number.isFinite(floor) || floor < 0 || floor > 100)) throw new Error("invalid section understanding floor");
  if (Object.entries(input.models).some(([key, value]) => !SECTION_MODEL_STEPS.includes(key as SectionModelStep) || !value?.trim())) {
    throw new Error("invalid section model configuration");
  }
  return Object.freeze({
    ...(input.hot ? { hot:Object.freeze({ ...input.hot }) } : {}),
    id: input.id,
    categories: Object.freeze(input.categories.map((category) => Object.freeze({ ...category }))),
    prompts: input.prompts,
    models: Object.freeze({ ...input.models }),
    selection: Object.freeze({ thresholds: thresholds === null ? null : Object.freeze({ ...thresholds }), understandFloor: floor }),
  });
}

export function configuredSectionModel(rules: SectionRules, step: SectionModelStep): string {
  const model = rules.models[step];
  if (!model) throw new Error(`section ${rules.id}: model step ${step} is not configured`);
  return model;
}

/** Null means not calibrated, not "use the AI threshold". */
export function sectionThreshold(rules: SectionRules, tier: string): number | null {
  return rules.selection.thresholds?.[tier] ?? null;
}

/** Non-legacy F2 calibration is uniform across sources. Null keeps automatic nomination off. */
export function sectionSelectionThreshold(rules: SectionRules): number | null {
  if (rules.id === "ai") throw new Error("use the legacy AI selection entry point");
  return rules.selection.thresholds?.default ?? null;
}
