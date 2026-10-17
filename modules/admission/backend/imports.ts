import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { audit } from "@aihot/backend/audit";
import { schools } from "../schools.ts";
import { officialUrl, documentId, listingLinks, type Link } from "./sources.ts";
import { automationEnabled, processDocument } from "./automation.ts";

export const importSchema = z.strictObject({ url: z.string().trim().url().max(2000), kind: z.enum(["notice", "listing"]) });
export const importIds = z.strictObject({ ids: z.string().max(800).default("").transform(s => s ? s.split(",") : []).pipe(z.array(z.uuid()).max(20)) });
export const importCommand = z.strictObject({ action: z.enum(["retry", "pause", "resume"]) });
export function resolveOfficialImport(input: unknown) {
  const value = importSchema.parse(input), url = new URL(value.url);
  if (url.port || url.username || url.password || /(?:token|password|secret|session|auth|ticket|key)/i.test([...url.searchParams.keys()].join(" "))) throw Object.assign(new Error("请使用不带登录凭据或特殊端口的公开官网链接。"), { statusCode: 400 });
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^from$|^spm$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const school = schools.find(s => officialUrl(s.id, url.href));
  if (!school) throw Object.assign(new Error("暂未识别该官方域名，请使用院校目录中学校的官网或学院官网链接。"), { statusCode: 400 });
  return { ...value, url: url.href, schoolId: school.id };
}
export async function submitImport(input: unknown) {
  const value = resolveOfficialImport(input);
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('admission-import-submit',0))`;
    const [existing] = await tx<{ id: string; kind: string }[]>`SELECT id,kind FROM admission_imports WHERE url=${value.url}`;
    if (existing) {
      if (existing.kind !== value.kind) throw Object.assign(new Error("该链接已按另一种类型添加，请使用已有记录，或请管理员调整来源。"), { statusCode: 409 });
      return { id: existing.id, reused: true };
    }
    const [count] = await tx<{ recent: number; total: number }[]>`SELECT count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int AS recent,count(*)::int AS total FROM admission_imports`;
    if (count.recent >= 30 || count.total >= 500) throw Object.assign(new Error("当前添加来源较多，请稍后再试或联系管理员清理停用来源。"), { statusCode: 429 });
    await tx`INSERT INTO admission_sources(school_id,config) VALUES(${value.schoolId},${tx.json({ schoolId: value.schoolId, urls: [value.url] })}) ON CONFLICT DO NOTHING`;
    const [row] = await tx<{ id: string }[]>`INSERT INTO admission_imports(school_id,url,kind) VALUES(${value.schoolId},${value.url},${value.kind}) RETURNING id`;
    return { id: row.id, reused: false };
  });
}
export async function commandImport(id: string, input: unknown, actor: string) {
  z.uuid().parse(id); const { action } = importCommand.parse(input);
  return sql.begin(async tx => {
    const [lock] = await tx<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`admission-import:${id}`},0)) AS locked`;
    if (!lock.locked) throw Object.assign(new Error("来源正在处理，请完成后再操作。"), { code: "conflict" });
    const [row] = await tx`SELECT id,status,enabled FROM admission_imports WHERE id=${id} FOR UPDATE`;
    if (!row) throw Object.assign(new Error("来源不存在"), { statusCode: 400 });
    await tx`UPDATE admission_imports SET enabled=${action !== "pause"},status=${action === "pause" ? "paused" : "queued"},force_retry=${action === "retry"},next_check_at=now() WHERE id=${id}`;
    await audit(actor, `admission.import.${action}`, `admission-import:${id}`, null, null, { previous: row.status }, { db: tx });
    return { id, action };
  });
}
export async function runImport(id: string) {
  if (!automationEnabled()) return { status: "disabled" };
  const connection = await sql.reserve(), key = `admission-import:${id}`;
  const [lock] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended(${key},0)) AS locked`;
  if (!lock.locked) { connection.release(); return { status: "running" }; }
  try {
    const [row] = await sql<{ id: string; school_id: string; url: string; kind: string; enabled: boolean; force_retry: boolean }[]>`SELECT * FROM admission_imports WHERE id=${id}`;
    if (!row?.enabled) return { status: "paused" };
    await sql`UPDATE admission_imports SET status='reading',error=NULL,force_retry=false,next_check_at=now()+interval '1 hour' WHERE id=${id}`;
    let title = "用户添加的官方公告", links: Link[] = [{ url: row.url, title, publishedOn: null }];
    if (row.kind === "listing") {
      const response = await guardedFetch(row.url, { timeoutMs: 20000, maxBytes: 3 * 1024 * 1024 });
      if (response.status !== 200 || !officialUrl(row.school_id, response.url)) throw new Error("listing-unavailable");
      if (!/html/i.test(response.headers.get("content-type") ?? "")) throw new Error("listing-not-html");
      title = "用户添加的招生栏目";
      const year = new Date().getUTCFullYear();
      links = listingLinks(response.text(), response.url, row.school_id).links.filter(link => [...link.title.matchAll(/20\d{2}/g)].some(m => Number(m[0]) >= year && Number(m[0]) <= year + 1))
        .sort((a, b) => Number(/计算机|软件|人工智能|电子信息/.test(b.title)) - Number(/计算机|软件|人工智能|电子信息/.test(a.title))).slice(0, 50);
    }
    const ids: string[] = [];
    for (const link of links) {
      const document = documentId(row.school_id, link.url); ids.push(document);
      await sql`INSERT INTO admission_documents(id,school_id,url,title,published_on) VALUES(${document},${row.school_id},${link.url},${link.title},${link.publishedOn}) ON CONFLICT(school_id,url) DO NOTHING`;
    }
    await sql`UPDATE admission_imports SET document_ids=${sql.json(ids)},title=${title} WHERE id=${id}`;
    const pending = ids.length ? await sql<{ id: string }[]>`SELECT id FROM admission_documents WHERE id IN ${sql(ids)} ORDER BY last_checked_at NULLS FIRST,id LIMIT 2` : [];
    for (const doc of pending) await processDocument(doc.id, row.force_retry);
    const materials = ids.length ? await sql<{ material: Array<{ contentType: string; blocks: Array<{ id: string; text: string }> }> }[]>`SELECT DISTINCT ON(document_id) material FROM admission_snapshots WHERE document_id IN ${sql(ids)} ORDER BY document_id,created_at DESC LIMIT 50` : [];
    const all = materials.flatMap(m => m.material), characters = all.reduce((n, m) => n + m.blocks.reduce((sum, b) => sum + b.text.length, 0), 0);
    if (row.kind === "notice") title = all[0]?.blocks.find(b => b.id === "title")?.text.slice(0, 200) || title;
    const [failed] = ids.length ? await sql`SELECT count(*)::int AS count FROM admission_documents WHERE id IN ${sql(ids)} AND last_ok_at IS NULL AND last_checked_at IS NOT NULL` : [{ count: 0 }];
    const [unread] = ids.length ? await sql`SELECT count(*)::int AS count FROM admission_documents WHERE id IN ${sql(ids)} AND last_checked_at IS NULL` : [{ count: 0 }];
    const status = unread.count ? "queued" : ids.length && failed.count === ids.length ? "failed" : "ready";
    await sql`UPDATE admission_imports SET status=${status},title=${title},stats=${sql.json({ documents: ids.length, characters, files: all.filter(m => m.contentType !== "text/html").length })},checked_at=now(),next_check_at=now()+make_interval(mins=>${unread.count ? 1 : 60}) WHERE id=${id}`;
    return { status, documents: ids.length };
  } catch (error) {
    await sql`UPDATE admission_imports SET status='failed',error=${String(error).slice(0, 300)},checked_at=now() WHERE id=${id}`;
    return { status: "failed" };
  } finally {
    try { await connection`SELECT pg_advisory_unlock(hashtextextended(${key},0))`; } finally { connection.release(); }
  }
}
