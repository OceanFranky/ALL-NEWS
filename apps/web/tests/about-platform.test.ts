import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { load } from "cheerio";
import { startWebServer } from "./web-server.ts";

test("about counts retain each board's public scope, real zero and unavailable state", async () => {
  const api = createServer((request, response) => {
    const path = new URL(request.url!, "http://fixture").pathname;
    response.setHeader("Content-Type", "application/json");
    if (path === "/api/site/meta" || path === "/api/site/contact") return response.end("{}");
    if (path === "/api/site/stats") return response.end(JSON.stringify({ selected: 8, sources: 18 }));
    if (path === "/api/v1/world/items") return response.end(JSON.stringify({ sectionId: "world", count: 0, items: [], pagination: { page: 1, limit: 1, total: 0, hasMore: false }, days: [] }));
    if (path === "/api/v1/competitions") return response.end(JSON.stringify({ total: 31 }));
    response.statusCode = 503; response.end(JSON.stringify({ error: "unavailable" }));
  });
  const web = await startWebServer(api);
  try {
    const response = await fetch(web.origin + "/about");
    assert.equal(response.status, 200);
    const $ = load(await response.text());
    const cards = $("#platform-sections > div > a");
    assert.equal(cards.length, 4);
    assert.match(cards.eq(0).text(), /8条行业精选/);
    assert.match(cards.eq(1).text(), /0条世界动态/);
    assert.match(cards.eq(2).text(), /31项竞赛届次/);
    assert.match(cards.eq(3).text(), /数量暂未取得/);
    assert.equal(cards.eq(3).find(".num").length, 0);
    assert.deepEqual(cards.map((_, node) => $(node).attr("href")).get(), ["/", "/world", "/competitions", "/admissions"]);
    assert(!$("main").text().includes("18个信源"));
  } finally { await web.stop(); }
});
