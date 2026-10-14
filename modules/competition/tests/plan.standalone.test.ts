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

test("image followups may inspect discovered posters but not fabricate or revisit image URLs", () => {
  const image = "https://contest.example/poster.png";
  const material = { id: "m", url: "https://contest.example/", hash: "h", fetchedAt: new Date().toISOString(), contentType: "text/html", blocks: [], images: [image], links: [] };
  assert.deepEqual(checkPlan([{ url: image, reason: "核对宣传图届次" }, { url: "https://contest.example/invented.png", reason: "猜测" }], [material]), [{ url: image, reason: "核对宣传图届次" }]);
  assert.deepEqual(checkPlan([{ url: image, reason: "重复" }], [material, { ...material, id: "image", url: image }]), []);
});
