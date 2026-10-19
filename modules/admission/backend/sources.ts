import { load } from "cheerio";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { readable } from "@aihot/backend/content/extract";
import { parseFile } from "@aihot/backend/documents/files";
import type { Material } from "@aihot/backend/documents/types";
import { parseLooseDate } from "@aihot/backend/sources/dates";
import { schoolById } from "../schools.ts";
import type { AdmissionDirectoryLink } from "@aihot/contracts/admission";

const sourceSchema = z.strictObject({ schoolId: z.string(), urls: z.array(z.url()).min(1).max(6), intervalMinutes: z.number().int().min(30), maxNewDocuments: z.number().int().min(1).max(20) });
export const sourceConfigs = z.array(sourceSchema).parse(JSON.parse(readFileSync(new URL("../sources.json", import.meta.url), "utf8")));
export type AdmissionSource = z.infer<typeof sourceSchema>;
export type Link = { url: string; title: string; publishedOn: string | null };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const documentId = (schoolId: string, url: string) => hash(`${schoolId}\n${url}`);
export function officialUrl(schoolId: string, raw: string) {
  try {
    const url = new URL(raw), host = new URL(schoolById.get(schoolId)!.website!).hostname.replace(/^www\./, "");
    const aliases = schoolId === "s105" ? [host, "nwsuaf.edu.cn"] : [host];
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && aliases.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch { return false; }
}
const plain = (s: string) => s.replace(/\s+/g, " ").trim();
const admissionHeaders = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36" };
function dateFromText(s: string) {
  const hit = /20\d{2}[-./年]\s*\d{1,2}[-./月]\s*\d{1,2}日?/.exec(s);
  const date = hit ? parseLooseDate(hit[0], "+08:00") : null;
  return date ? new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10) : null;
}
export function directoryLinks(html: string, base: string, schoolId: string): AdmissionDirectoryLink[] {
  const $ = load(html), links = new Map<string, AdmissionDirectoryLink>();
  $("a[href]").each((_, node) => {
    const el = $(node), title = plain(el.attr("title") || el.text()).slice(0, 200);
    if (!title || /博士后|名单|公示|留学生|国际研究生|国际学生|成绩复核|资格查询|网报公告/.test(title)
      || (/博士/.test(title) && !/硕士|推免|免试/.test(title))) return;
    const kind = /专业目录|招生目录/.test(title) ? "catalogue" : /(?:各|院系|学院|培养单位).*(?:细则|招生|推免|复试|联系方式)|招生学院|招生单位|院系设置|院系导航|培养单位/.test(title) ? "rules-index"
      : /学院$|学系$|研究院$|研究所$/.test(title) && !/研究生院|继续教育|国际教育/.test(title) ? "department" : null;
    if (!kind) return;
    try {
      const url = new URL(el.attr("href")!, base); url.hash = "";
      if (officialUrl(schoolId, url.href) && url.href !== base) links.set(url.href, { schoolId, url: url.href, title, kind, parentUrl: base, checkedAt: new Date().toISOString() });
    } catch { /* malformed links are not sources */ }
  });
  return [...links.values()];
}
export async function readDirectoryIndexes(schoolId: string, seeds: AdmissionDirectoryLink[]) {
  const year = new Date().getUTCFullYear();
  const rank = (s: AdmissionDirectoryLink) => (s.title.includes(String(year + 1)) ? 10 : 0) + (/各.*(?:学院|院系)|汇总|院（系）/.test(s.title) ? 5 : 0);
  const pages = seeds.filter(s => s.kind === "rules-index" && !/\.(pdf|docx?|xlsx?|zip)(?:[?#]|$)/i.test(s.url)).sort((a, b) => rank(b) - rank(a)).slice(0, 4);
  const result = await readDirectoryPages(schoolId, pages);
  const links = new Map(seeds.map(link => [link.url, link]));
  for (const link of result.links) links.set(link.url, link);
  return { ...result, links: [...links.values()].slice(0, 300) };
}
export async function readDirectoryPages(schoolId: string, seeds: AdmissionDirectoryLink[]) {
  const links = new Map(seeds.map(link => [link.url, link])), notices = new Map<string, Link>(), errors: string[] = [];
  const year = new Date().getUTCFullYear();
  // Bounded reads of observed HTML pages. A PDF/catalogue link is not a parsed requirement.
  for (const seed of seeds.slice(0, 4)) {
    try {
      const response = await guardedFetch(seed.url, { timeoutMs: 20000, maxBytes: 3 * 1024 * 1024, headers: admissionHeaders });
      if (response.status !== 200 || !officialUrl(schoolId, response.url)) throw new Error(`HTTP ${response.status}`);
      for (const link of directoryLinks(response.text(), response.url, schoolId)) links.set(link.url, link);
      for (const notice of listingLinks(response.text(), response.url, schoolId).links) {
        if ([...notice.title.matchAll(/20\d{2}/g)].some(m => Number(m[0]) >= year && Number(m[0]) <= year + 1)) notices.set(notice.url, notice);
      }
    } catch (error) { errors.push(`${seed.url}: ${String(error).slice(0, 180)}`); }
  }
  return { links: [...links.values()].slice(0, 300), notices: [...notices.values()], errors };
}
export function listingLinks(html: string, base: string, schoolId: string) {
  const $ = load(html); const links = new Map<string, Link>(); const navigation = new Set<string>();
  // A configured concrete notice also serves as a seed while its parent listing keeps discovering new years.
  const ownTitle = plain($("h1,h2").filter((_, el) => /20\d{2}.*(?:硕士|推免|研究生)/.test($(el).text())).first().text() || $("title").text());
  if (/20\d{2}/.test(ownTitle)) $("body").append($("<a>").attr("href", base).text(ownTitle));
  $("a[href], [onclick]").each((_, node) => {
    const el = $(node); const raw = el.attr("href") ?? /(?:window\.open|(?:window\.)?location(?:\.href)?\s*=)\s*\(?\s*['"]([^'"]+)/.exec(el.attr("onclick") ?? "")?.[1];
    if (!raw) return;
    let url: URL; try { url = new URL(raw, base); } catch { return; }
    // USTC's observed public redirect wrapper embeds a real attachment URL.
    if (url.pathname === "/redirect/url" && url.searchParams.get("redirectUrl")) { try { url = new URL(url.searchParams.get("redirectUrl")!, base); } catch { return; } }
    url.hash = ""; if (!officialUrl(schoolId, url.href)) return;
    let title = plain(el.attr("title") || el.find("[title]").first().attr("title") || el.text()).replace(/^标题[：:]\s*/, "").replace(/\s*点击数[：:].*$/, "");
    // A faculty homepage in navigation is not a dated admissions notice. Only inherit
    // an index year for concrete article/file links inside its article body.
    if (/20\d{2}/.test(ownTitle) && /各学院|各院系|汇总|院（系）/.test(ownTitle) && /(?:学院|学系|研究院)(?:$|.*(?:细则|办法))/.test(title) && !/20\d{2}/.test(title)
      && el.closest(".v_news_content,.wp_articlecontent,#vsb_content,#vsb_content_2,article,.article-content,.content-detail,#content,table").length
      && /\/info\/\d+\/[^/]+\.(?:s?html?)$|\/\d{4}\/\d{4}\/c\d+a\d+\/page\.htm$|\.(?:pdf|docx?)(?:[?#]|$)/i.test(url.href)) title = `${title} ${ownTitle}`;
    if (/^(学历硕士|硕士招生|硕士研究生|硕士研究生招生|招生简章|招生章程|推免生|推免专栏|夏令营[／/]推免|通知公告|推免招生|推荐免试)$/.test(title)) navigation.add(url.href);
    if (!/20\d{2}/.test(title) || !/硕士|推免|推荐免试|免试攻读|夏令营|预报名|招生章程|招生简章/.test(title)) return;
    if (/名单|公示|查询|学籍|成绩复核|仅供|宣讲|宣传|讲座|工作会议|考试大纲|科目大纲|参考书|博士后|留学生|国际学生|微专业/.test(title) || (/专业目录|统考计划/.test(title) && !/招生简章|招生章程/.test(title))) return;
    if (/博士|直博/.test(title) && !/硕士|推免|推荐免试|免试攻读/.test(title)) return;
    const publishedOn = dateFromText(plain(el.closest("li, tr, .news, .list, .item").text()));
    const item = { url: url.href, title: title.slice(0, 200), publishedOn };
    const before = links.get(item.url); if (!before || before.title.length > title.length) links.set(item.url, item);
  });
  return { links: [...links.values()], navigation: [...navigation] };
}
export async function discover(source: AdmissionSource) {
  const urls = [...source.urls], links = new Map<string, Link>(), indexes = new Map<string, AdmissionDirectoryLink>(), errors: string[] = []; let pages = 0;
  for (let i = 0; i < urls.length && i < 6; i++) {
    const url = urls[i];
    try {
      const response = await guardedFetch(url, { timeoutMs: 20000, maxBytes: 3 * 1024 * 1024, headers: admissionHeaders });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      if (!officialUrl(source.schoolId, response.url)) throw new Error("unexpected official host");
      const parsed = listingLinks(response.text(), response.url, source.schoolId); pages++;
      for (const index of directoryLinks(response.text(), response.url, source.schoolId)) indexes.set(index.url, index);
      for (const item of parsed.links) links.set(item.url, item);
      for (const next of parsed.navigation) if (!urls.includes(next) && urls.length < 6) urls.push(next);
    } catch (error) { errors.push(`${url}: ${String(error).slice(0, 180)}`); }
  }
  const currentYear = new Date().getUTCFullYear();
  const candidates = [...links.values()].filter(l => [...l.title.matchAll(/20\d{2}/g)].some(m => Number(m[0]) >= currentYear && Number(m[0]) <= currentYear + 1));
  // Stable prioritisation gives both tracks a chance in the first limited batch.
  const school = schoolById.get(source.schoolId)!.name;
  const rank = (l: Link) => (l.title.includes(String(currentYear + 1)) ? 10 : 0)
    + (l.title.startsWith(school) && new RegExp(`${currentYear + 1}年.*硕士.*(?:章程|简章)`).test(l.title) && !/学院/.test(l.title) ? 35 : 0)
    + (/招收优秀应届本科毕业生免试攻读研究生章程/.test(l.title) ? 30 : 0)
    + (/接收.*(?:优秀应届本科|推荐免试)|推荐免试.*(?:工作办法|录取办法)/.test(l.title) && !/学院|国优|专项/.test(l.title) ? 30 : 0)
    + (/接收|招生章程|招生简章|招生办法|工作办法|录取工作办法/.test(l.title) ? 8 : 0)
    - (/各院系|汇总|陆续更新/.test(l.title) ? 40 : 0)
    - (/专项|骨干|援藏|士兵|报考点|考点|国优|同等学力|强军|MBA|EMBA|MPA|学位论文/.test(l.title) ? 25 : 0);
  candidates.sort((a, b) => rank(b) - rank(a) || (b.publishedOn ?? "").localeCompare(a.publishedOn ?? ""));
  const distinct = candidates.filter((l, i) => candidates.findIndex(x => x.title === l.title) === i);
  const first = distinct[0], other = distinct.findIndex(l => /推免|推荐免试|免试攻读/.test(l.title) !== /推免|推荐免试|免试攻读/.test(first?.title ?? ""));
  if (other > 1) distinct.splice(1, 0, distinct.splice(other, 1)[0]);
  return { links: distinct, indexes: [...indexes.values()], pages, checkedUrls: urls.slice(0, 6), errors };
}
export function htmlMaterial(html: string, url: string): Material {
  const $ = load(html);
  // VSB's official PDF widget writes the viewer at runtime; read its literal file URL without executing code.
  const widgetFiles = [...html.matchAll(/showVsbpdfIframe\(\s*["']([^"']+\.pdf)["']/g)].map(m => ({ url: new URL(m[1], url).href, title: "官方正文附件" }));
  $("script,style,nav,header,footer,noscript").remove();
  const links: Material["links"] = [...widgetFiles];
  $("a[href],iframe[src],embed[src],object[data],[pdfsrc]").each((_, el) => {
    const raw = $(el).attr("href") ?? $(el).attr("src") ?? $(el).attr("data") ?? $(el).attr("pdfsrc");
    try {
      let href = new URL(raw!, url);
      const file = href.searchParams.get("file");
      if (/\/pdfjs\/.*viewer\.html$/.test(href.pathname) && file) href = new URL(file, url);
      if (["http:", "https:"].includes(href.protocol)) links.push({ url: href.href, title: plain($(el).text()).slice(0, 200) || "官方正文附件" });
    } catch { /* not a URL */ }
  });
  const body = $(".v_news_content, .wp_articlecontent, #vsb_content, #vsb_content_2, article, .article-content, .content-detail, #content").filter((_, el) => $(el).text().trim().length > 80).first();
  const text = plain(body.length ? body.text() : readable(html, url, "+08:00")?.text ?? $("body").text());
  const blocks: Material["blocks"] = [];
  const heading = $("h1,h2,h3,.arti_title,.Article_Title,.tit,.zkd-title").filter((_, el) => { const text = plain($(el).text()); return text.length <= 200 && /20\d{2}.*(?:硕士|推免|免试|研究生)/.test(text); }).first().text();
  const title = plain(heading || $("title").text() || $("h1").first().text()); if (title) blocks.push({ id: "title", text: title });
  for (let i = 0; i < text.length; i += 2000) blocks.push({ id: `block-${i / 2000 + 1}`, text: text.slice(i, i + 2000) });
  const contentHash = hash(JSON.stringify({ blocks, links: links.filter(l => /\.(pdf|docx?|zip)(?:[?#]|$)/i.test(l.url)) }));
  return { id: hash(url + contentHash), url, hash: contentHash, fetchedAt: new Date().toISOString(), contentType: "text/html", blocks, links, images: [] };
}
export async function readMaterials(schoolId: string, link: Link, options: { first?: Material; maxAttachments?: number } = {}) {
  async function read(url: string): Promise<Material> {
    if (!officialUrl(schoolId, url)) throw new Error("non-official material host");
    const response = await guardedFetch(url, { timeoutMs: 25000, maxBytes: 16 * 1024 * 1024, headers: admissionHeaders });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${url}`);
    if (!officialUrl(schoolId, response.url)) throw new Error("non-official material redirect");
    const type = response.headers.get("content-type") ?? "";
    return response.body.subarray(0, 5).toString() === "%PDF-" || /\.(pdf|docx?|zip)(?:[?#]|$)/i.test(response.url)
      ? parseFile(response.url, response.body, type, true, 16 * 1024 * 1024) : htmlMaterial(response.text(), response.url);
  }
  const first = options.first ?? await read(link.url); const materials = [first];
  const attachments = [...new Set(first.links.filter(l => /\.(pdf|docx?)(?:[?#]|$)/i.test(l.url) && officialUrl(schoolId, l.url)
    && !/宣传册|brochure|清华概览|专业目录|通讯录|学费标准/i.test(l.title + decodeURI(l.url))).map(l => l.url))];
  const maxAttachments = options.maxAttachments ?? 12;
  if (options.maxAttachments === undefined && attachments.length > maxAttachments) throw new Error(`附件${attachments.length}个，需缩小到具体公告，未将未读附件冒充完整材料`);
  for (const url of attachments.slice(0, maxAttachments)) {
    try { materials.push(await read(url)); }
    catch (error) {
      // A substantive HTML notice remains usable on its own. Expose the unread file explicitly;
      // never turn a title-only PDF viewer into a summary of a document we could not read.
      if (first.contentType !== "text/html" || first.blocks.reduce((n, b) => n + b.text.length, 0) < 2000) throw error;
      for (const item of first.links.filter(item => item.url === url)) item.title = `未解析附件：${item.title}`.slice(0, 200);
    }
  }
  if (materials.reduce((n, m) => n + m.blocks.reduce((s, b) => s + b.text.length, 0), 0) > 80000) throw new Error("材料超过本轮模型输入上限，待人工分段处理");
  if (materials.every(m => m.blocks.map(b => b.text).join("").length < 80)) throw new Error("正文不足或附件未解析");
  return materials;
}
