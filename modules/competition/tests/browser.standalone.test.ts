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

test("dynamic parser permits bounded same-origin public POST data loads", async () => {
  const server = createServer(async (req, res) => {
    if (req.url === "/index.do" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.equal(body, "op=matchlist");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ text: "2026 official competition registration and final schedule. ".repeat(20) }));
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(`<html><body><main id="main"></main><script>
      fetch('/index.do', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'op=matchlist' })
        .then(r => r.json()).then(data => document.getElementById('main').textContent = data.text);
    </script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
      const { collectDynamic } = await import('./modules/competition/backend/browser.ts');
      const m = await collectDynamic('http://127.0.0.1:${port}/');
      console.log(JSON.stringify({ text: m.blocks.map(b => b.text).join(' ') }));
    `], { env: { ...process.env, ALLOW_PRIVATE_NETWORK_FETCH: "true", MODEL_CALLS_ENABLED: "false", COLLECT_ENABLED: "false" }, timeout: 35000 });
    assert.match(JSON.parse(stdout).text, /registration and final schedule/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("dynamic parser forwards the browser identity without cookies or authorization", async () => {
  const server = createServer((req, res) => {
    assert.match(req.headers["user-agent"] ?? "", /Chrome/);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    res.setHeader("content-type", "text/html");
    res.end(`<html><body>${"Official 2026 competition notice readable to a browser. ".repeat(20)}</body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
      const { collectDynamic } = await import('./modules/competition/backend/browser.ts');
      const m = await collectDynamic('http://127.0.0.1:${port}/');
      console.log(JSON.stringify({ text: m.blocks.map(b => b.text).join(' ') }));
    `], { env: { ...process.env, ALLOW_PRIVATE_NETWORK_FETCH: "true", MODEL_CALLS_ENABLED: "false", COLLECT_ENABLED: "false" }, timeout: 35000 });
    assert.match(JSON.parse(stdout).text, /Official 2026 competition notice/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
