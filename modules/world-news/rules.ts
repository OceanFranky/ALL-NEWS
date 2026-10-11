import path from "node:path";
import { createPromptPack } from "@aihot/backend/sections/prompts";
import { freezeSectionRules, SECTION_MODEL_STEPS } from "@aihot/backend/sections/rules";

export const WORLD_RULES = freezeSectionRules({
  id: "world",
  categories: [
    { key: "politics", label: "政治与国际关系" },
    { key: "economy", label: "经济与产业" },
    { key: "security", label: "冲突与安全" },
  ],
  prompts: createPromptPack("world", path.join(import.meta.dirname, "prompts"), "世界新闻"),
  // Explicit independent choices, reusing only the operator's approved provider credentials.
  models: Object.fromEntries(SECTION_MODEL_STEPS.map((step) => [step, "default"])),
  selection: { thresholds: null, understandFloor: null },
});
