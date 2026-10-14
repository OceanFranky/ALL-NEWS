import assert from "node:assert/strict";
import test from "node:test";
import { sourceAuthorityDisclaimer } from "../backend/discovery.ts";
import { parseHtml } from "../backend/materials.ts";

test("an explicit aggregation disclaimer prevents an automatic official-site assertion", () => {
  const material = parseHtml("https://example.org/notice", `<body>${"2026竞赛通知正文".repeat(30)}本站信息搜集整理自互联网，本站仅作分享！</body>`);
  assert.deepEqual(sourceAuthorityDisclaimer(material), { blockId: "block-1", quote: "本站信息搜集整理自互联网" });
  const primary = parseHtml("https://example.org/official", `<body>${"本届竞赛组委会正式通知".repeat(30)}</body>`);
  assert.equal(sourceAuthorityDisclaimer(primary), null);
});
