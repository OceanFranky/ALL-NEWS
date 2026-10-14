import { createHash } from "node:crypto";
import { load } from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import type { Material } from "./schema.ts";

export function parseHtml(url: string, html: string): Material {
  const $ = load(html);
  const links: Material["links"] = [];
  const images: string[] = [];
  const absolute = (s: string | undefined) => {
    try { const u = new URL(s ?? "", url); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
  };
  $("a[href]").each((_i, a) => {
    const href = absolute($(a).attr("href"));
    if (href) links.push({ url: href, title: $(a).text().trim().slice(0, 160) });
  });
  $("img").each((_i, img) => {
    const src = absolute($(img).attr("src") || $(img).attr("data-src"));
    if (src) images.push(src);
  });
  $("script,style,noscript,nav,footer").remove();
  const main = $("article").first().length ? $("article").first() : $("body");
  const text = main.text().replace(/\s+/g, " ").trim();
  if (text.length < 80) throw new Error("HTML is empty or requires dynamic rendering");
  const blocks: Material["blocks"] = [];
  for (let i = 0; i < text.length; i += 2000) blocks.push({ id: `block-${blocks.length + 1}`, text: text.slice(i, i + 2000) });
  const hash = createHash("sha256").update(html).digest("hex");
  const id = createHash("sha256").update(`${url}\n${hash}`).digest("hex");
  return { id, url, hash, fetchedAt: new Date().toISOString(), contentType: "text/html", blocks, links, images };
}

export async function collectHtml(url: string): Promise<Material> {
  const response = await guardedFetch(url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
  if (response.status !== 200) throw new Error(`Official material HTTP ${response.status}`);
  if (!(response.headers.get("content-type") ?? "").includes("html")) throw new Error("Material requires a file parser");
  return parseHtml(response.url, response.text());
}
