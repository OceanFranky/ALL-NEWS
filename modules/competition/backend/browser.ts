import { chromium } from "playwright";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { parseHtml } from "./materials.ts";
import type { Material } from "./schema.ts";

export function publicReadPostAllowed(target: string, origin: string, body: Buffer | null): boolean {
  const url = new URL(target);
  if (url.origin !== new URL(origin).origin || !body || body.byteLength > 64 * 1024) return false;
  const form = new URLSearchParams(body.toString("utf8"));
  const operations: Record<string, string[]> = {
    "/index.do": ["matchlist", "simlist", "getmatch", "matchinfo"],
    "/news.do": ["tablist", "indexnews"],
  };
  return !!operations[url.pathname]?.includes(form.get("op") ?? "")
    && [...form.keys()].every(key => ["op", "type", "_id", "title"].includes(key));
}

export async function collectDynamic(url: string): Promise<Material> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    // Browser traffic uses the same bounded SSRF-checked fetch path as static collection.
    await context.route("**/*", async route => {
      const req = route.request();
      const method = req.method();
      if (!["GET", "POST"].includes(method) || ["image", "font", "media"].includes(req.resourceType())) return route.abort();
      const body = method === "POST" ? req.postDataBuffer() : null;
      // Public competition SPAs commonly load their notices through same-origin form POSTs. The
      // browser has no credentials, and we deliberately forward only a small public request body.
      if (method === "POST" && !publicReadPostAllowed(req.url(), url, body)) return route.abort();
      try {
        const requestHeaders = req.headers();
        const headers: Record<string, string> = {};
        for (const name of ["accept", "content-type", "user-agent"] as const) if (requestHeaders[name]) headers[name] = requestHeaders[name];
        const response = await guardedFetch(req.url(), {
          method,
          headers,
          body: body?.toString("utf8"),
          timeoutMs: 15000,
          maxBytes: 4 * 1024 * 1024,
        });
        await route.fulfill({ status: response.status, body: response.body, contentType: response.headers.get("content-type") ?? "application/octet-stream" });
      } catch { await route.abort(); }
    });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response || response.status() !== 200) throw new Error(`Dynamic material HTTP ${response?.status() ?? "unavailable"}`);
    // DOMContentLoaded only means the SPA shell exists. Give its bounded public API calls a chance
    // to finish before a readable navigation shell is mistaken for the competition material.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    await page.waitForFunction(`() => {
      const body = document.body?.cloneNode(true);
      if (!body) return false;
      body.querySelectorAll('script,style,noscript,nav,header,footer').forEach(n => n.remove());
      return (body.textContent ?? '').replace(/\\s+/g, ' ').trim().length >= 500;
    }`, null, { timeout: 20000 });
    // SPA redirects can replace the document just after the readiness check succeeds.
    for (let attempt = 0; attempt < 12; attempt++) {
      const html = await page.content();
      try {
        const material = parseHtml(page.url(), html);
        return { ...material, contentType: "text/html; rendered=chromium" };
      } catch (error) {
        if (attempt === 11) throw error;
        await page.waitForTimeout(400);
      }
    }
    throw new Error("Dynamic material has no usable content");
  } finally { await browser.close(); }
}
