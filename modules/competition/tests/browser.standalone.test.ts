import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

test("dynamic parser waits for actual asynchronous content rather than navigation text", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<html><body><nav>${"Menu ".repeat(120)}</nav><article></article><div id="main"></div><script>setTimeout(() => document.getElementById('main').textContent = ${JSON.stringify("Competition official notice: team size three, deadline in October 2026. ".repeat(20))}, 500)</script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
      const { collectDynamic } = await import('./modules/competition/backend/browser.ts');
      const m = await collectDynamic('http://127.0.0.1:${port}/');
      console.log(JSON.stringify({ type: m.contentType, text: m.blocks.map(b => b.text).join(' ') }));
    `], { env: { ...process.env, ALLOW_PRIVATE_NETWORK_FETCH: "true", MODEL_CALLS_ENABLED: "false", COLLECT_ENABLED: "false" }, timeout: 35000 });
    const parsed = JSON.parse(stdout);
    assert.match(parsed.type, /rendered=chromium/);
    assert.match(parsed.text, /team size three/);
    assert.ok(!parsed.text.includes("Menu Menu"));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
