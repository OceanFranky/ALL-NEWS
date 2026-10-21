import "./setup.ts";
import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MCP_TOOLS, mcpToolName } from "@aihot/contracts/mcp";
import { installModules } from "@aihot/backend/modules";
import { sql, closeDb } from "@aihot/backend/db";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { MODULE_AGENT_TOOLS } from "@aihot/site/agent";
import { registerMcp } from "../apps/api/src/routes/mcp.ts";
import { registerAgent } from "../apps/api/src/routes/agent.ts";
import { testNotices } from "../modules/admission/tests/fixtures.ts";
import { saveNotice, changePublication } from "../modules/admission/backend/store.ts";

test("four-section MCP and Markdown share published reads, filters and immediate withdrawal", async () => {
  installModules(SERVER_MODULES);
  const app = Fastify(); registerMcp(app); registerAgent(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const client = new Client({ name: "platform-test", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const uuid = "00000000-0000-4000-8000-000000000001";
  const samples: Record<string, Record<string, unknown>> = {
    get_world_item: { id: "missing-world-item" }, get_world_event: { publicId: uuid },
    get_competition: { competitionId: "competition-001", editionId: uuid },
    get_competition_resources: { competitionId: "competition-001", editionId: uuid }, get_admission: { noticeId: uuid },
    get_competitions: { category: "数字媒体", page: 1, pageSize: 5 },
    get_admissions: { track: "baoyan", year: 2027 },
    get_world_news: { category: "economy", q: "test", page: 2, limit: 5 },
  };
  const call = async (tool: string, args: Record<string, unknown> = {}) => await client.callTool({ name: mcpToolName(tool), arguments: args }) as { isError?: boolean; structuredContent?: { found: boolean; data: unknown } };
  try {
    const before = await sql`SELECT count(*)::int AS count FROM receipts`;
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/api/mcp`)));
    const tools = (await client.listTools()).tools;
    const openapi = JSON.parse(readFileSync(new URL("../site/public/openapi-v1.json", import.meta.url), "utf8"));
    assert.deepEqual(tools.map(t => t.name).sort(), [...MCP_TOOLS.map(t => t.name), ...MODULE_AGENT_TOOLS.map(t => mcpToolName(t.tool))].sort());
    for (const info of MODULE_AGENT_TOOLS) {
      assert.deepEqual(openapi.paths[`/api/v1/agent${info.path}`].get.parameters.map((p: { name: string }) => p.name).sort(), Object.keys(tools.find(t => t.name === mcpToolName(info.tool))!.inputSchema.properties ?? {}).sort(), "OpenAPI and MCP parameter discovery must agree");
      const args = samples[info.tool] ?? {};
      const result = await call(info.tool, args);
      assert(!result.isError, `${info.tool}: ${JSON.stringify(result)}`);
      assert(result.structuredContent && "found" in result.structuredContent);
      const query = new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]));
      const response = await app.inject(`/api/v1/agent${info.path}${query.size ? `?${query}` : ""}`);
      assert.equal(response.statusCode, 200, info.tool);
      assert.equal(response.headers["cache-control"], "no-store");
      const expected = result.structuredContent!;
      assert(response.body.includes(`"found": ${expected.found}`));
      assert(tools.find(t => t.name === mcpToolName(info.tool))?.annotations?.readOnlyHint);
    }
    assert.equal((await app.inject("/api/v1/agent/admissions?year=not-a-year")).statusCode, 400);
    assert.equal((await app.inject("/api/v1/agent/competition")).statusCode, 400);
    assert.equal((await app.inject("/api/v1/agent/world/news?extra=1")).statusCode, 400);
    assert((await call("get_world_news", { limit: 101 })).isError);

    const { id: _id, ...fixture } = testNotices[0];
    const notice = { ...fixture, source: { ...fixture.source, url: "https://yz.tsinghua.edu.cn/info/1001/99999.htm", verified: true, checkedOn: "2026-10-17", publishedOn: "2026-09-01", evidence: "用于隔离自动化测试的官方来源依据，学校、院系与申请要求均为测试材料。" } };
    const saved = await saveNotice({ notice, reason: "Agent publication fixture" }, "test");
    assert.equal(((await call("get_admissions")).structuredContent!.data as { total: number }).total, 0);
    await changePublication(saved.id, "publish", { expectedVersion: 1, reason: "Agent fixture publish" }, "test");
    const published = await call("get_admissions", { q: "计算机", year: 2027 });
    assert.equal((published.structuredContent!.data as { total: number }).total, 1);
    assert.equal((await call("get_admission", { noticeId: saved.id })).structuredContent!.found, true);
    await changePublication(saved.id, "withdraw", { expectedVersion: 2, reason: "Agent fixture withdraw" }, "test");
    assert.equal((await call("get_admission", { noticeId: saved.id })).structuredContent!.found, false);
    assert.equal(((await call("get_admissions", { q: "计算机", year: 2027 })).structuredContent!.data as { total: number }).total, 0);
    assert.deepEqual(await sql`SELECT count(*)::int AS count FROM receipts`, before, "reads must never call paid models");
  } finally {
    await client.close(); app.server.closeAllConnections(); await app.close(); installModules([]); await closeDb();
  }
});
