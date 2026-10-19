import { createHash } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { audit } from "@aihot/backend/audit";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { noticeSchema, type AdmissionNotice, type AdmissionDirectoryLink } from "@aihot/contracts/admission";
import type { Material } from "@aihot/backend/documents/types";
import { schoolById } from "../schools.ts";
import { sourceConfigs, discover, documentId, readMaterials, readDirectoryIndexes, readDirectoryPages, officialUrl, type Link, type AdmissionSource } from "./sources.ts";
import { extractAdmission, AdmissionBudgetError } from "./model.ts";
import { alignEvidence, validateEvidence, validateScopeEvidence, extractionSchema, type ExtractedNotice } from "./automation-schema.ts";
import { saveNotice, changePublication } from "./store.ts";
import { identityKey } from "./domain.ts";
import { doctoralOnly, outgoingRecommendation } from "./agent-planner.ts";

interface DocumentRow { id: string; school_id: string; url: string; title: string; published_on: string | null; content_hash: string | null; processed_hash: string | null; notice_ids: string[]; status: string; result: unknown }
export const automationEnabled = () => process.env.ADMISSION_AUTOMATION_ENABLED === "true" && process.env.COLLECT_ENABLED === "true";
export async function syncSources() {
  for (const source of sourceConfigs) await sql`INSERT INTO admission_sources(school_id,config) VALUES(${source.schoolId},${sql.json(source)}) ON CONFLICT(school_id) DO UPDATE SET config=EXCLUDED.config`;
}
export async function collectSchool(source: AdmissionSource) {
  if (process.env.COLLECT_ENABLED !== "true") return { status: "disabled", schoolId: source.schoolId };
  const result = await discover(source);
  const directory = await readDirectoryIndexes(source.schoolId, result.indexes);
  const knownUrls = new Set(result.links.map(link => link.url));
  result.links.push(...directory.notices.filter(link => !knownUrls.has(link.url)));
  for (const link of directory.links) await sql`INSERT INTO admission_directory(school_id,url,title,kind,parent_url,checked_at) VALUES(${link.schoolId},${link.url},${link.title},${link.kind},${link.parentUrl},${link.checkedAt}) ON CONFLICT(school_id,url) DO UPDATE SET title=EXCLUDED.title,kind=EXCLUDED.kind,parent_url=EXCLUDED.parent_url,checked_at=EXCLUDED.checked_at`;
  // Rotate through observed faculty listings across runs; popular computing fields go first.
  const faculties = await sql<{ url: string; title: string; parent_url: string; checked_at: Date }[]>`SELECT url,title,parent_url,checked_at FROM admission_directory WHERE school_id=${source.schoolId} AND kind='department'
    ORDER BY (last_read_at IS NULL) DESC,(title ~ '计算机|软件|人工智能|电子信息|信息工程|网络空间') DESC,last_read_at NULLS FIRST,url LIMIT 4`;
  const facultySeeds: AdmissionDirectoryLink[] = faculties.map(row => ({ schoolId: source.schoolId, url: row.url, title: row.title, kind: "department", parentUrl: row.parent_url, checkedAt: row.checked_at.toISOString() }));
  const faculty = await readDirectoryPages(source.schoolId, facultySeeds);
  for (const row of faculties) await sql`UPDATE admission_directory SET last_read_at=now() WHERE school_id=${source.schoolId} AND url=${row.url}`;
  const candidateUrls = new Set(result.links.map(link => link.url));
  result.links.push(...faculty.notices.filter(link => !candidateUrls.has(link.url)));
  for (const link of faculty.links) await sql`INSERT INTO admission_directory(school_id,url,title,kind,parent_url,checked_at) VALUES(${link.schoolId},${link.url},${link.title},${link.kind},${link.parentUrl},${link.checkedAt}) ON CONFLICT(school_id,url) DO UPDATE SET title=EXCLUDED.title,kind=EXCLUDED.kind,parent_url=EXCLUDED.parent_url,checked_at=EXCLUDED.checked_at`;
  result.errors.push(...faculty.errors);
  result.errors.push(...directory.errors);
  for (const [priority, link] of result.links.entries()) {
    await sql`INSERT INTO admission_documents(id,school_id,url,title,published_on,priority) VALUES(${documentId(source.schoolId, link.url)},${source.schoolId},${link.url},${link.title},${link.publishedOn},${priority})
      ON CONFLICT(school_id,url) DO UPDATE SET title=EXCLUDED.title,priority=EXCLUDED.priority,published_on=coalesce(admission_documents.published_on,EXCLUDED.published_on)`;
  }
  const status = !result.pages ? "failed" : !result.links.length ? "no-matching-notices" : result.errors.length ? "partial" : "ok";
  await sql`UPDATE admission_sources SET last_checked_at=now(),last_ok_at=coalesce(${result.pages ? new Date() : null},last_ok_at),next_check_at=now()+make_interval(mins=>${source.intervalMinutes}),status=${status},detail=${sql.json({ ...result, indexes: result.indexes.map(link => ({ ...link })) })} WHERE school_id=${source.schoolId}`;
  return { schoolId: source.schoolId, status, found: result.links.length, errors: result.errors };
}
function toNotice(schoolId: string, row: Pick<DocumentRow, "url" | "published_on">, extracted: ExtractedNotice, materials: Material[]): AdmissionNotice {
  validateEvidence(extracted, materials);
  const { evidence, ...fields } = extracted;
  const checkedOn = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const files = new Map(materials.filter(m => m.contentType !== "text/html").map(m => [m.url, { url: m.url, title: "官方正文附件", read: true }]));
  for (const material of materials) for (const link of material.links) if (officialUrl(schoolId, link.url) && /\.(pdf|docx?|zip|xlsx?)(?:[?#]|$)/i.test(link.url)) files.set(link.url, { url: link.url, title: link.title, read: materials.some(m => m.url === link.url) });
  const resources = [...files.values()].slice(0, 30).map(file => ({ kind: "official" as const, title: file.title.slice(0, 200), url: file.url, author: schoolById.get(schoolId)!.name, year: fields.year, scope: `${fields.department}／${fields.programme}`, note: file.read ? "已读取用于提取；以官方原文件为准。" : "此补充附件未解析，摘要不包含其独有规定，请打开官方文件核对。" }));
  const unread = resources.filter(r => r.note.includes("未解析")).length;
  return noticeSchema.parse({ ...fields, schoolId, resources, source: { title: fields.title, url: row.url, publishedOn: row.published_on, checkedOn, verified: false, verification: "machine",
    evidence: `机器提取并经程序核对原文引用，尚未经人工复核。${unread ? `${unread}份补充附件未解析，摘要仅依据已读取正文。` : ""}${evidence.slice(0, 5).map(e => `【${e.field}】${e.quote}`).join("；")}`.slice(0, 2000) } });
}
export async function publishResult(row: Pick<DocumentRow, "id" | "school_id" | "url" | "title" | "published_on" | "notice_ids">, extractions: ExtractedNotice[], materials: Material[], contentHash: string, receiptId?: number) {
  if (extractions.length && (doctoralOnly(row.title) || outgoingRecommendation(row.title))) throw new Error("仅博士或本校推荐资格通知不属于硕士接收招生机会");
  const notices = extractions.map(item => toNotice(row.school_id, row, item, materials));
  return sql.begin(async tx => {
  const old = row.notice_ids.length ? await tx<{ id: string; draft: AdmissionNotice; published: AdmissionNotice | null; version: number }[]>`SELECT id,draft,published,version FROM admission_notices WHERE id IN ${tx(row.notice_ids)} FOR UPDATE` : [];
  // A source revision never restores a manual withdrawal or silently overwrites a manual correction.
  const protectedIds = row.notice_ids.length ? await tx`SELECT 1 FROM audit_log WHERE subject IN ${tx(row.notice_ids.map(id => `admission:${id}`))} AND actor<>'worker.admission' LIMIT 1` : [];
  if (protectedIds.length || old.some(n => n.draft.source.verification !== "machine")) throw new Error("原公告已人工撤回或修改，自动结果保留待处理");
  if (old.length && (old.length !== notices.length || old.some(n => !notices.some(notice => identityKey(notice) === identityKey(n.draft))))) throw new Error("原文范围或身份变化，保留待核对，未替换旧机会");
  const ids: string[] = [];
  for (let notice of notices) {
    let existing = old.find(n => identityKey(n.draft) === identityKey(notice));
    if (!existing) {
      const [duplicate] = await tx<{ id: string; draft: AdmissionNotice; published: AdmissionNotice | null; version: number }[]>`SELECT id,draft,published,version FROM admission_notices WHERE identity_key=${identityKey(notice)} FOR UPDATE`;
      if (duplicate) {
        // Category mirrors may repeat the same link. A different source with the same identity needs review.
        const correction = /延期|延长|更正/.test(row.title) && notice.deadline && duplicate.published
          && materials.some(m => m.links.some(l => l.url === duplicate.draft.source.url));
        if ((!correction && duplicate.draft.source.url !== row.url) || duplicate.draft.source.verification !== "machine" || (!duplicate.published && duplicate.version > 1)) throw new Error("相同招生范围已存在不同来源或人工记录，待核对关联，未覆盖");
        if (correction) notice = { ...duplicate.draft, deadline: notice.deadline, deadlineTime: notice.deadlineTime,
          summary: `${notice.summary}\n原公告：${duplicate.draft.source.url}`.slice(0, 3000), dateNote: notice.dateNote,
          source: notice.source, resources: [...notice.resources, { kind: "official", title: "变更前的官方原公告", url: duplicate.draft.source.url, author: schoolById.get(row.school_id)!.name, year: notice.year, scope: notice.programme, note: "截止日期按明确关联的更正公告更新；其他条件沿用原公告。" }] };
        existing = duplicate;
      }
    }
    const saved = await saveNotice({ ...(existing ? { id: existing.id, expectedVersion: existing.version } : {}), notice, reason: `官方材料版本 ${contentHash.slice(0, 12)} 证据核对通过` }, "worker.admission", tx);
    ids.push(saved.id);
    await changePublication(saved.id, "publish", { expectedVersion: saved.version, reason: "升学自动提取及字段引用校验通过；机器校验不等于人工核验" }, "worker.admission", tx);
  }
  // Commit every extracted notice and its document links together, or publish none of this revision.
  await tx`UPDATE admission_documents SET notice_ids=${tx.json(ids)} WHERE id=${row.id}`;
  if (receiptId !== undefined) {
    await tx`UPDATE admission_documents SET processed_hash=${contentHash},status=${ids.length ? "published" : "irrelevant"},error=NULL WHERE id=${row.id}`;
    await completeReceipt(tx, receiptId);
    await audit("worker.admission", "admission.process", `admission-document:${row.id}`, null, null, { contentHash, notices: ids, receiptId }, { db: tx });
  }
  return ids;
  });
}
export async function processDocument(id: string, force = false, suppliedMaterials?: Material[], requireScopeEvidence = false) {
  if (!automationEnabled()) return { status: "disabled" };
  const connection = await sql.reserve(); const key = `admission-document:${id}`;
  const [lock] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended(${key},0)) AS locked`;
  if (!lock.locked) { connection.release(); return { status: "running" }; }
  try {
    const [row] = await sql<DocumentRow[]>`SELECT * FROM admission_documents WHERE id=${id}`;
    if (!row) throw new Error("unknown document");
    const link: Link = { url: row.url, title: row.title, publishedOn: row.published_on };
    const materials = suppliedMaterials ?? await readMaterials(row.school_id, link);
    if (row.title === "用户添加的官方公告") {
      row.title = materials[0]?.blocks.find(b => b.id === "title")?.text.slice(0, 200) || row.title;
      await sql`UPDATE admission_documents SET title=${row.title} WHERE id=${id}`;
    }
    const contentHash = createHash("sha256").update(JSON.stringify(materials.map(m => [m.url, m.hash]))).digest("hex");
    await sql`INSERT INTO admission_snapshots(document_id,hash,material) VALUES(${id},${contentHash},${sql.json(materials as never)}) ON CONFLICT DO NOTHING`;
    await sql`UPDATE admission_documents SET content_hash=${contentHash},last_checked_at=now(),last_ok_at=now() WHERE id=${id}`;
    if (!force && row.processed_hash === contentHash) {
      if (requireScopeEvidence) for (const notice of extractionSchema.parse(row.result).notices) { validateEvidence(notice, materials); validateScopeEvidence(notice); }
      return { status: "unchanged" };
    }
    if (!force && row.content_hash === contentHash && row.status === "needs-review") return { status: "needs-review" };
    if (process.env.MODEL_CALLS_ENABLED !== "true") { await sql`UPDATE admission_documents SET status='awaiting-model' WHERE id=${id}`; return { status: "awaiting-model" }; }
    let result = await extractAdmission(schoolById.get(row.school_id)!.name, row.title, row.id, materials);
    const prepare = () => {
      if (result.data.relevant !== (result.data.notices.length > 0)) throw new Error("相关性与提取条数不一致");
      if (result.data.notices.length && (doctoralOnly(row.title) || outgoingRecommendation(row.title))) throw new Error("仅博士或本校推荐资格通知应返回relevant=false及空notices");
      // A prospectus often only links to separate recommendation rules. Do not create a second opportunity for that pointer.
      if (!row.notice_ids.length && result.data.notices.length > 1) {
        const primary = /推免|推荐免试|免试攻读/.test(row.title) ? "baoyan" : /硕士/.test(row.title) ? "kaoyan" : null;
        if (primary && result.data.notices.some(n => n.track === primary)) result.data.notices = result.data.notices.filter(n => n.track === primary);
      }
      for (const notice of result.data.notices) {
        alignEvidence(notice, materials); toNotice(row.school_id, row, notice, materials);
        if (requireScopeEvidence) validateScopeEvidence(notice);
      }
    };
    try { prepare(); }
    catch (error) {
      // Exactly one bounded correction, with the original response retained in receipts. Same input reuses both receipts.
      result = await extractAdmission(schoolById.get(row.school_id)!.name, row.title, row.id, materials, { previous: result.data, error: String(error) });
      prepare();
    }
    await sql`UPDATE admission_documents SET result=${sql.json(result.data)} WHERE id=${id}`;
    const ids = await publishResult(row, result.data.notices, materials, contentHash, result.receiptId);
    return { status: ids.length ? "published" : "irrelevant", notices: ids };
  } catch (error) {
    const status = error instanceof AdmissionBudgetError ? "budget-paused" : "needs-review";
    await sql`UPDATE admission_documents SET status=${status},error=${String(error).slice(0, 1000)},last_checked_at=now() WHERE id=${id}`;
    return { status, error: String(error) };
  } finally { try { await connection`SELECT pg_advisory_unlock(hashtextextended(${key},0))`; } finally { connection.release(); } }
}
export async function refreshSchool(schoolId: string) {
  if (!automationEnabled()) return { status: "disabled" };
  const source = sourceConfigs.find(s => s.schoolId === schoolId); if (!source) throw new Error("unconfigured school");
  const collection = await collectSchool(source);
  // Pending items first, then rotate old successes to detect same-URL and attachment changes.
  const documents = await sql<{ id: string }[]>`SELECT id FROM admission_documents WHERE school_id=${schoolId}
    ORDER BY (last_checked_at IS NULL) DESC,(processed_hash IS NULL AND status NOT IN ('needs-review','budget-paused')) DESC,
      (title ~ '计算机|软件|人工智能|电子信息|信息工程|网络空间') DESC,
      CASE WHEN last_checked_at IS NULL THEN priority END,last_checked_at NULLS FIRST,priority,id LIMIT ${source.maxNewDocuments}`;
  const results = []; for (const doc of documents) results.push({ id: doc.id, ...await processDocument(doc.id) });
  return { collection, results };
}
