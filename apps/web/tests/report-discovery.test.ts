// Production SSR with a local health stub. Failure case: machine entry points for weekly and monthly
// reports exist but cannot be found from the access page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import * as cheerio from 'cheerio';
import { MCP_TOOL_NAMES } from '@aihot/contracts/mcp';
import { MODULE_AGENT_TOOLS } from '@aihot/site/agent';
import { startWebServer, type WebServer } from './web-server.ts';

let web: WebServer;
const api = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true }));
  if (req.url === '/api/site/meta') return res.end(JSON.stringify({ changelogVersion: '2026-01-01T00:00' }));
  res.statusCode = 404;
  res.end(JSON.stringify({ code: 'not_found' }));
});
before(async () => { web = await startWebServer(api); });
after(() => web.stop());

for (const [tab, names] of [
  ['rss', ['/feed/daily.xml', '/feed/weekly.xml', '/feed/monthly.xml']],
  ['api', ['/api/v1/dailies/latest', '/api/v1/weeklies/latest', '/api/v1/monthlies/latest']],
  ['mcp', [MCP_TOOL_NAMES.daily, MCP_TOOL_NAMES.weekly, MCP_TOOL_NAMES.monthly]],
] as const) {
  test(`the ${tab} panel exposes all report entry points`, async () => {
    const response = await fetch(`${web.origin}/agent?tab=${tab}`);
    assert.equal(response.status, 200, web.logs());
    const $ = cheerio.load(await response.text());
    const panel = $('#agent-panel').text();
    for (const name of names) assert.ok(panel.includes(name), `${tab} panel omits ${name}`);
    assert.equal($('[aria-label="四个板块的 Agent 能力"] article').length, 4);
    if (tab === 'mcp') for (const tool of MODULE_AGENT_TOOLS) assert.ok(panel.includes(`_${tool.tool}`), `MCP panel omits ${tool.tool}`);
    if (tab === 'rss') assert.ok(panel.includes('以下订阅仅覆盖行业信息'));
  });
}
