import assert from "node:assert/strict";
import test from "node:test";
import { parseFeed, parseHtml } from "../backend/materials.ts";

test("official RSS entries become grounded text, links and images", () => {
  const material = parseFeed("https://contest.example/feed/", `<?xml version="1.0"?><rss><channel><item>
    <title>2026 竞赛报名通知</title><link>https://contest.example/notices/2026</link><pubDate>Tue, 14 Oct 2026 08:00:00 +0800</pubDate>
    <description><![CDATA[<p>每队三名学生，报名截止 10 月 30 日。</p>]]></description>
    <enclosure url="https://contest.example/poster.jpg" type="image/jpeg" />
  </item></channel></rss>`);
  assert.match(material.blocks[0]!.text, /每队三名学生/);
  assert.deepEqual(material.links, [{ url: "https://contest.example/notices/2026", title: "2026 竞赛报名通知" }]);
  assert.deepEqual(material.images, ["https://contest.example/poster.jpg"]);
});

test("official feed discovery links are retained from HTML", () => {
  const material = parseHtml("https://contest.example/", `<html><head><link rel="alternate" type="application/rss+xml" href="/feed/" /></head><body>${"竞赛官网正文".repeat(30)}</body></html>`);
  assert.ok(material.links.some(link => link.url === "https://contest.example/feed/" && link.title === "官网订阅源"));
});

test("an HTTP-success attachment CAPTCHA page cannot become competition evidence", () => {
  assert.throws(() => parseHtml("https://contest.example/download.jsp", `<html><body><h1>请输入验证码下载附件</h1><input name="codeValue" />${"下载帮助文字".repeat(30)}</body></html>`), /requires CAPTCHA verification/);
});
