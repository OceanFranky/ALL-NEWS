import { createHash } from "node:crypto";
import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import type { Material } from "./schema.ts";
import { parseFile } from "./files.ts";

export function parseHtml(url: string, html: string): Material {
  const $ = load(html);
  if ($("input[name='codeValue'],input#codeValue").length && /验证码/.test($("body").text())) throw new Error("Official material requires CAPTCHA verification");
  const links: Material["links"] = [];
  const images: string[] = [];
  const absolute = (s: string | undefined) => {
    try { const u = new URL(s ?? "", url); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
  };
  $("a[href]").each((_i, a) => {
    const href = absolute($(a).attr("href"));
    if (href) links.push({ url: href, title: $(a).text().trim().slice(0, 160) });
  });
  $("link[rel='alternate'][href]").each((_i, link) => {
    const type = ($(link).attr("type") ?? "").toLowerCase();
    const href = absolute($(link).attr("href"));
    if (href && /(rss|atom|xml)/.test(type)) links.push({ url: href, title: "官网订阅源" });
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

const list = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const plain = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return plain(row["#text"] ?? row.__cdata ?? row._text ?? "");
};

export function parseFeed(url: string, xml: string): Material {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", cdataPropName: "__cdata" }).parse(xml) as Record<string, unknown>;
  const rssChannel = (parsed.rss as { channel?: Record<string, unknown> } | undefined)?.channel;
  const atom = parsed.feed as Record<string, unknown> | undefined;
  const entries = list((rssChannel?.item ?? atom?.entry) as Record<string, unknown> | Record<string, unknown>[] | undefined).slice(0, 100);
  if (!entries.length) throw new Error("Feed has no readable entries");
  const links: Material["links"] = [];
  const images: string[] = [];
  const blocks: Material["blocks"] = [];
  const absolute = (raw: unknown) => {
    const text = plain(raw);
    try { const value = new URL(text, url); return /^https?:$/.test(value.protocol) ? value.href : null; } catch { return null; }
  };
  entries.forEach((entry, entryIndex) => {
    const linkValue = list(entry.link as unknown).map(link => typeof link === "object" && link ? (link as Record<string, unknown>)["@_href"] ?? link : link).map(absolute).find(Boolean);
    if (linkValue) links.push({ url: linkValue, title: plain(entry.title).slice(0, 160) });
    for (const enclosure of list(entry.enclosure as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
      const src = absolute(enclosure["@_url"]);
      if (src && String(enclosure["@_type"] ?? "").startsWith("image/")) images.push(src);
    }
    const rawBody = plain(entry["content:encoded"] ?? entry.content ?? entry.summary ?? entry.description);
    const body = load(`<body>${rawBody}</body>`)("body").text().replace(/\s+/g, " ").trim();
    const text = [plain(entry.title), plain(entry.pubDate ?? entry.published ?? entry.updated), body].filter(Boolean).join(" — ");
    for (let offset = 0, part = 1; offset < text.length; offset += 2000, part++) {
      blocks.push({ id: `entry-${entryIndex + 1}-block-${part}`, text: text.slice(offset, offset + 2000) });
    }
  });
  if (!blocks.length) throw new Error("Feed has no readable text");
  const hash = createHash("sha256").update(xml).digest("hex");
  const id = createHash("sha256").update(`${url}\n${hash}`).digest("hex");
  return { id, url, hash, fetchedAt: new Date().toISOString(), contentType: "application/feed+xml", blocks, links, images };
}

export async function collectMaterial(url: string): Promise<Material> {
  const response = await guardedFetch(url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
  if (response.status !== 200) {
    if (/^\s*ua blocked\s*$/i.test(response.text())) {
      const { collectDynamic } = await import("./browser.ts");
      return collectDynamic(response.url);
    }
    throw new Error(`Official material HTTP ${response.status}`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (type.startsWith("image/")) {
    const { parseImage } = await import("./images.ts");
    return parseImage(response.url, response.body);
  }
  if (/(?:rss|atom|xml)/i.test(type) || /^\s*<(?:\?xml[^>]*>\s*)?(?:rss|feed)\b/i.test(response.text().slice(0, 500))) return parseFeed(response.url, response.text());
  if (!type.includes("html") && !/^\s*<!doctype html|^\s*<html/i.test(response.text().slice(0, 200))) return parseFile(response.url, response.body, type);
  const $ = load(response.text());
  if ($("input[name='codeValue'],input#codeValue").length && /验证码/.test($("body").text())) throw new Error("Official material requires CAPTCHA verification");
  $("script,style,noscript").remove();
  const readableLength = $("body").text().replace(/\s+/g, " ").trim().length;
  if (readableLength < 80) {
    const { collectDynamic } = await import("./browser.ts");
    return collectDynamic(response.url);
  }
  return parseHtml(response.url, response.text());
}
