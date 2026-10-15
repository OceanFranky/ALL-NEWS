import assert from "node:assert/strict";
import test from "node:test";
import { matchesCatalogueSearch, officialSearchQuery, sourceAuthorityDisclaimer } from "../backend/discovery.ts";
import { parseHtml } from "../backend/materials.ts";

test("official discovery uses only a Latin abbreviation explicitly present in the approved name", () => {
  assert.equal(officialSearchQuery("国际遗传工程机器竞赛（iGEM）"), '"iGEM" competition official');
  assert.equal(officialSearchQuery("全国大学生英语竞赛(NECCS)"), '"NECCS" competition official');
});

test("official discovery preserves full names without a usable abbreviation", () => {
  assert.equal(officialSearchQuery("“中国软件杯”大学生软件设计大赛"), '"中国软件杯大学生软件设计大赛" 官方网站');
  assert.equal(officialSearchQuery("计算机竞赛（含区域赛）"), '"计算机竞赛（含区域赛）" 官方网站');
});

test("name-only discovery can collect a matching English lead without declaring it official", () => {
  const name = "国际遗传工程机器竞赛（iGEM）";
  assert.equal(matchesCatalogueSearch(name, { url: "https://example.org/about", title: "About | iGEM Competition", description: "synthetic biology" }), true);
  assert.equal(matchesCatalogueSearch(name, { url: "https://example.org/news", title: "国际新闻", description: "全球资讯" }), false);
  assert.equal(matchesCatalogueSearch(name, { url: "https://example.org/product", title: "bigem software", description: "unrelated" }), false);
});

test("an explicit aggregation disclaimer prevents an automatic official-site assertion", () => {
  const material = parseHtml("https://example.org/notice", `<body>${"2026竞赛通知正文".repeat(30)}本站信息搜集整理自互联网，本站仅作分享！</body>`);
  assert.deepEqual(sourceAuthorityDisclaimer(material), { blockId: "block-1", quote: "本站信息搜集整理自互联网" });
  const primary = parseHtml("https://example.org/official", `<body>${"本届竞赛组委会正式通知".repeat(30)}</body>`);
  assert.equal(sourceAuthorityDisclaimer(primary), null);
});
