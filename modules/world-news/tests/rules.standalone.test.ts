import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { SITE } from "@aihot/site";
import { SELECTION } from "@aihot/industry/selection";
import { assertSameSection, isSectionId, requireSectionId } from "@aihot/contracts/sections";
import { installModules, serverModules } from "@aihot/backend/modules";
import { sectionContext } from "@aihot/backend/sections/context";
import { createPromptPack } from "@aihot/backend/sections/prompts";
import { configuredSectionModel, freezeSectionRules, sectionThreshold, sectionSelectionThreshold } from "@aihot/backend/sections/rules";
import { promptFromText, promptText, promptVersion } from "@aihot/backend/editorial/prompts";
import { WORLD_RULES } from "../rules.ts";
import { worldNewsModule } from "../server.ts";

afterEach(() => installModules([]));
const ROOT = path.resolve(import.meta.dirname, "../../..");
const AI_DIR = path.join(ROOT, "industry/prompts");

test("section validation never interprets missing or invalid input as AI or all", () => {
  assert.ok(isSectionId("ai"));
  assert.ok(isSectionId("world"));
  for (const value of [undefined, null, "all", "WORLD", " world ", 1, {}, ["world"]]) {
    assert.equal(isSectionId(value), false);
    assert.throws(() => requireSectionId(value));
  }
  assertSameSection("world", "world");
  assert.throws(() => assertSameSection("world", "ai"), /mismatch/);
});

test("missing, duplicate and malformed world packs fail rather than loading AI rules", () => {
  installModules([]);
  assert.throws(() => sectionContext("world"), /registered/);
  assert.equal(sectionContext("ai").id, "ai");
  assert.throws(() => installModules([worldNewsModule, { ...worldNewsModule, name: "duplicate" }]), /duplicate/);
  assert.throws(() => installModules([{ name: "override-ai", sections: [sectionContext("ai")] }]), /duplicate/);
  assert.throws(() => freezeSectionRules({ ...WORLD_RULES, prompts: sectionContext("ai").prompts }), /mismatch/);
  assert.throws(() => freezeSectionRules({ ...WORLD_RULES, categories: [{ key: "bad key", label: "坏类别" }] }), /categories/);
  assert.throws(() => freezeSectionRules({ ...WORLD_RULES, selection: { thresholds: { T1: NaN }, understandFloor: null } }), /threshold/);
});

test("world categories, thresholds and model defaults are independent and immutable", () => {
  installModules([worldNewsModule]);
  const world = sectionContext("world");
  const ai = sectionContext("ai");
  assert.deepEqual(world.categories.map((c) => c.key), ["politics", "economy", "security"]);
  assert.deepEqual(ai.selection.thresholds, SELECTION.thresholds);
  for (const tier of ["T1", "T1_5", "T2", "EXCLUDE_MP"]) assert.equal(sectionThreshold(world, tier), null);
  assert.equal(configuredSectionModel(world, "score"), "default");
  assert.throws(() => configuredSectionModel(freezeSectionRules({ ...world, models: {} }), "score"), /not configured/);
  assert.throws(() => { (world.models as Record<string, string>).score = "an-ai-model"; }, TypeError);
  assert.throws(() => { (world.categories[0] as { key: string }).key = "ai-models"; }, TypeError);
  assert.throws(() => { serverModules()[0]!.sections = []; }, TypeError);
  assert.equal(sectionThreshold(ai, "T1"), SELECTION.thresholds.T1);
});

test("world calibration uses one explicit uniform threshold and never an AI source tier", () => {
  const invalid:Record<string,number>[]=[{},{ T1:70 },{ default:70,T2:60 },{ default:Infinity }];
  for(const thresholds of invalid) {
    assert.throws(()=>freezeSectionRules({ ...WORLD_RULES,selection:{ thresholds,understandFloor:null } }),/threshold/);
  }
  const rules=freezeSectionRules({ ...WORLD_RULES,selection:{ thresholds:{ default:69.5 },understandFloor:null } });
  assert.equal(sectionSelectionThreshold(rules),69.5);
  assert.equal(sectionSelectionThreshold(WORLD_RULES),null);
  assert.equal(sectionThreshold(rules,'T1'),null);
  assert.throws(()=>sectionSelectionThreshold(sectionContext('ai')),/legacy/);
});

test("concurrent same-named prompts and includes stay in their own pack", async () => {
  installModules([worldNewsModule]);
  const outputs = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
    const context = sectionContext(i % 2 ? "ai" : "world");
    await Promise.resolve();
    return { id: context.id, text: context.prompts.text("prefilter"), version: context.prompts.version("prefilter") };
  }));
  for (const output of outputs) {
    if (output.id === "world") {
      assert.match(output.text, /政治与国际关系/);
      assert.match(output.text, /不可信材料/);
      assert.match(output.version, /^world:prefilter@/);
      assert.doesNotMatch(output.text, /宽召回的AI相关性/);
    } else {
      assert.match(output.text, /宽召回的AI相关性/);
      assert.equal(output.text, promptText("prefilter"));
      assert.equal(output.version, promptVersion("prefilter"));
    }
  }
});

test("a missing world file or include cannot fall back to an existing AI prompt", () => {
  assert.throws(() => WORLD_RULES.prompts.text("translate-body"), /ENOENT/);
  assert.throws(() => WORLD_RULES.prompts.fromText("candidate", "{{> translate-body}}"), /ENOENT/);
  assert.throws(() => WORLD_RULES.prompts.fromText("candidate", "{{missingValue}}"), /no value/);
  for (const name of ["../prefilter", "/prefilter", "a/../../prefilter", "..", "a..b"]) {
    assert.throws(() => WORLD_RULES.prompts.text(name), /invalid prompt name/);
  }
  const cycle = createPromptPack("world", path.join(import.meta.dirname, "fixtures/cycle"), "世界新闻");
  assert.throws(() => cycle.text("a"), /include cycle/);
});

test("detailed world prompts cover evidence, boundaries, writing and independent relation review", () => {
  for (const name of ["prefilter", "selection-score", "structure", "understand", "summarize", "group-pair", "group-review", "story-digest"]) {
    const rendered = WORLD_RULES.prompts.text(name);
    assert.ok(rendered.length > 1000, `${name}: must contain detailed operational guidance`);
    assert.match(rendered, /不可信材料/);
    assert.match(rendered, /归属/);
    assert.doesNotMatch(rendered, /\{\{(?:>|siteName)/);
    assert.match(WORLD_RULES.prompts.version(name), /^world:/);
  }
  assert.match(WORLD_RULES.prompts.text("prefilter"), /UNKNOWN/);
  assert.match(WORLD_RULES.prompts.text("structure"), /不能唯一承载/);
  assert.match(WORLD_RULES.prompts.text("understand"), /百分比.*百分点/);
  assert.match(WORLD_RULES.prompts.text("group-review"), /前一模型解释不是新的事实证据/);
  assert.match(WORLD_RULES.prompts.text("selection-score"), /4、2、2、1、1/);
  assert.match(WORLD_RULES.prompts.text("selection-score"), /3、3、2、1、1/);
});

// Recompute the old algorithm over every unchanged AI file, including its include graph.
test("every existing AI prompt keeps its exact rendered text and receipt version", () => {
  const token = /\{\{(>\s*)?([A-Za-z][\w.-]*)\s*\}\}/g;
  const raw = (name: string) => readFileSync(path.join(AI_DIR, `${name}.md`), "utf8");
  const expand = (name: string): { text: string; used: string[] } => {
    const used = [name];
    const text = raw(name).replace(token, (match, include: string | undefined, key: string) => {
      if (!include) return match;
      const inner = expand(key);
      used.push(...inner.used);
      return inner.text;
    });
    return { text, used };
  };
  for (const file of readdirSync(AI_DIR).filter((file) => file.endsWith(".md"))) {
    const name = file.slice(0, -3);
    const expanded = expand(name);
    const values = Object.fromEntries([...expanded.text.matchAll(token)].map((m) => [m[2], `test-${m[2]}`]));
    const all = { siteName: SITE.name, ...values };
    const expected = expanded.text.replace(token, (_match, _include, key: string) => all[key as keyof typeof all]);
    const hash = createHash("sha256");
    for (const included of [...new Set(expanded.used)].sort()) hash.update(`${included}\n${raw(included)}\n`);
    assert.equal(promptText(name, values), expected, name);
    assert.equal(promptVersion(name), `${name}@${hash.digest("hex").slice(0, 10)}`, name);
  }
  assert.equal(promptFromText("candidate", "{{siteName}}: {{value}}", { value: "原输入" }), `${SITE.name}: 原输入`);
});
