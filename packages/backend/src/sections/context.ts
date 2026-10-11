import { CATEGORIES } from "@aihot/industry/taxonomy";
import { SELECTION } from "@aihot/industry/selection";
import { requireSectionId, type SectionId } from "@aihot/contracts/sections";
import { aiPrompts } from "../editorial/prompts.ts";
import { serverModules } from "../modules.ts";
import { freezeSectionRules, type SectionRules } from "./rules.ts";

const AI_RULES = freezeSectionRules({ id: "ai", categories: CATEGORIES, prompts: aiPrompts, models: {}, selection: SELECTION });

/** Explicit per-task context; registry configuration is not a mutable current section. */
export function sectionContext(id: SectionId): SectionRules {
  requireSectionId(id);
  if (id === "ai") return AI_RULES;
  const matches = serverModules().flatMap((module) => module.sections ?? []).filter((rules) => rules.id === id);
  if (matches.length !== 1) throw new Error(`section ${id}: expected exactly one registered rule pack`);
  return matches[0];
}
