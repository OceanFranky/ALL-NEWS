// Legacy AI entry points keep their wording, includes and version hashes unchanged.
import path from "node:path";
import { SITE } from "@aihot/site";
import { REPO_ROOT } from "../config.ts";
import { createPromptPack } from "../sections/prompts.ts";

export const aiPrompts = createPromptPack("ai", path.join(REPO_ROOT, "industry/prompts"), SITE.name);

export function promptText(name: string, values: Record<string, string> = {}): string {
  return aiPrompts.text(name, values);
}

export function promptFromText(label: string, text: string, values: Record<string, string> = {}): string {
  return aiPrompts.fromText(label, text, values);
}

export function promptVersion(...names: string[]): string {
  return aiPrompts.version(...names);
}
