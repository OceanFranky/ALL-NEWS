import { createHash } from "node:crypto";
import { load } from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import type { Material } from "./schema.ts";
import { parseFile } from "./files.ts";

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
  const candidate = $("main").first().length ? $("main").first() : $("article").first();
  const main = candidate.text().trim().length >= 80 ? candidate : $("body");
  // Preserve boundaries between rendered text nodes; adjacent blocks are not one domain or word.
  main.find("p,div,li,h1,h2,h3,h4,td,a,span").append(" ");
  const text = main.text().replace(/\s+/g, " ").trim();
  if (text.length < 80) throw new Error("HTML is empty or requires dynamic rendering");
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'）)；;,]+/g)) {
    const href = absolute(match[0]);
    if (href && !links.some(l => l.url === href)) links.push({ url: href, title: "正文中的官方资料网址" });
  }
  for (const match of text.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|edu|gov|cn|io)\b(?:\/[A-Za-z0-9%_.\/?=&#:+-]*)?/gi)) {
    const href = absolute(`https://${match[0]}`);
    if (href && !links.some(l => l.url === href)) links.push({ url: href, title: "正文中的网址，协议待官网核对" });
  }
  const blocks: Material["blocks"] = [];
  for (let i = 0; i < text.length; i += 2000) blocks.push({ id: `block-${blocks.length + 1}`, text: text.slice(i, i + 2000) });
  const hash = createHash("sha256").update(html).digest("hex");
  const id = createHash("sha256").update(`${url}\n${hash}`).digest("hex");
  return { id, url, hash, fetchedAt: new Date().toISOString(), contentType: "text/html", blocks, links, images };
}

export async function collectMaterial(url: string): Promise<Material> {
  const response = await guardedFetch(url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
  if (response.status !== 200) throw new Error(`Official material HTTP ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html") && !/^\s*<!doctype html|^\s*<html/i.test(response.text().slice(0, 200))) return parseFile(response.url, response.body, type);
  const $ = load(response.text());
  $("script,style,noscript").remove();
  const readableLength = $("body").text().replace(/\s+/g, " ").trim().length;
  if (readableLength < 80) {
    const { collectDynamic } = await import("./browser.ts");
    return collectDynamic(response.url);
  }
  return parseHtml(response.url, response.text());
}
