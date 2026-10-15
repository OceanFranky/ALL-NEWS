// Each pack owns its file cache and include graph. No cross-pack lookup or fallback.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireSectionId, type SectionId } from "@aihot/contracts/sections";

const TOKEN = /\{\{(>\s*)?([A-Za-z][\w.-]*)\s*\}\}/g;

export interface PromptPack {
  readonly sectionId: SectionId;
  text(name: string, values?: Record<string, string>): string;
  fromText(label: string, text: string, values?: Record<string, string>): string;
  version(...names: string[]): string;
}

export function createPromptPack(sectionId: SectionId, directory: string, siteName: string): PromptPack {
  requireSectionId(sectionId);
  const files = new Map<string, string>();

  function raw(name: string): string {
    if (!/^[A-Za-z][\w.-]*$/.test(name) || name.includes("..")) throw new Error("invalid prompt name");
    let text = files.get(name);
    if (text === undefined) {
      text = readFileSync(path.join(directory, `${name}.md`), "utf8");
      files.set(name, text);
    }
    return text;
  }

  function expandText(text: string, seen: string[]): { text: string; used: string[] } {
    const used: string[] = [];
    const expanded = text.replace(TOKEN, (token, include: string | undefined, key: string) => {
      if (!include) return token;
      const inner = expand(key, seen);
      used.push(...inner.used);
      return inner.text;
    });
    return { text: expanded, used };
  }

  function expand(name: string, seen: string[] = []): { text: string; used: string[] } {
    if (seen.includes(name)) throw new Error(`prompt include cycle: ${[...seen, name].join(" → ")}`);
    const inner = expandText(raw(name), [...seen, name]);
    return { text: inner.text, used: [name, ...inner.used] };
  }

  function fill(name: string, text: string, values: Record<string, string>): string {
    const all: Record<string, string> = { siteName, ...values };
    return text.replace(TOKEN, (_token, _include, key: string) => {
      const value = all[key];
      if (value === undefined) throw new Error(`prompt ${name}: no value for {{${key}}}`);
      return value;
    });
  }

  return Object.freeze({
    sectionId,
    text: (name: string, values: Record<string, string> = {}) => fill(name, expand(name).text, values),
    fromText: (label: string, text: string, values: Record<string, string> = {}) => fill(label, expandText(text, []).text, values),
    version: (...names: string[]) => {
      const used = [...new Set(names.flatMap((n) => expand(n).used))].sort();
      const hash = createHash("sha256");
      for (const name of used) hash.update(`${name}\n${raw(name)}\n`);
      const legacy = `${names.join("+")}@${hash.digest("hex").slice(0, 10)}`;
      // Preserve existing AI receipt identities exactly; new domains never share them.
      return sectionId === "ai" ? legacy : `${sectionId}:${legacy}`;
    },
  });
}
