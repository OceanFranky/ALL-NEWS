import assert from "node:assert/strict";
import test from "node:test";
import { checkPlan } from "../backend/plan.ts";

test("followups cannot fabricate a URL or revisit a collected material", () => {
  const m = { id: "m", url: "https://example.org/current", hash: "h", fetchedAt: new Date().toISOString(), contentType: "text/html", blocks: [], images: [], links: [{ url: "https://example.org/rules", title: "Rules" }] };
  const urls = checkPlan([
    { url: "https://example.org/current", reason: "repeat" },
    { url: "https://made-up.org", reason: "invented" },
    { url: "https://example.org/rules", reason: "missing team size" },
  ], [m]);
  assert.deepEqual(urls, [{ url: "https://example.org/rules", reason: "missing team size" }]);
});
