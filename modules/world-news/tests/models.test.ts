import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { invalidateModelCache, modelFor, sectionModelFor } from "@aihot/backend/editorial/models";
import { WORLD_RULES } from "../rules.ts";

after(closeDb);

test("world model selection reuses providers, not AI switches or caches", async () => {
  process.env.SCORE_MODEL = "qwen3.7-flash";
  invalidateModelCache();
  assert.equal(await modelFor("score"), "qwen3.7-flash");
  assert.equal(await sectionModelFor(WORLD_RULES, "score"), "default");
  await sql`INSERT INTO settings (key, value) VALUES
    ('models.score', '{"model":"deepseek-flash"}'),
    ('sections.world.models.score', '{"model":"glm-5.3-flash"}')`;
  invalidateModelCache();
  const choices = await Promise.all(Array.from({ length: 30 }, (_, i) => i % 2
    ? modelFor("score") : sectionModelFor(WORLD_RULES, "score")));
  choices.forEach((choice, i) => assert.equal(choice, i % 2 ? "deepseek-flash" : "glm-5.3-flash"));
  await sql`UPDATE settings SET value = '{"model":"missing-model"}' WHERE key = 'sections.world.models.score'`;
  invalidateModelCache();
  await assert.rejects(sectionModelFor(WORLD_RULES, "score"), /invalid model setting/);
  assert.equal(await modelFor("score"), "deepseek-flash");
  await sql`DELETE FROM settings WHERE key = 'sections.world.models.score'`;
  invalidateModelCache();
  assert.equal(await sectionModelFor(WORLD_RULES, "score"), "default");
  assert.equal(await modelFor("score"), "deepseek-flash");
});
