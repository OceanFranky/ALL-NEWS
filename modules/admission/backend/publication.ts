import { sql } from "@aihot/backend/db";
import type { AdmissionNotice, PublicNotice, NoticeList, AdmissionDirectoryLink, AdmissionImports, AdmissionImport } from "@aihot/contracts/admission";
import { schools, schoolById } from "../schools.ts";
import { demoNotices } from "./demo.ts";
import { detailIdSchema, noticeStatus, querySchema } from "./domain.ts";
import { importIds } from "./imports.ts";
import { admissionCost } from "./model.ts";

interface PublishedRow { id: string; published: AdmissionNotice; published_version: number; published_at: Date }
function fromRow(row: PublishedRow, now: Date): PublicNotice {
  return { ...row.published, id: row.id, version: row.published_version, updatedAt: row.published_at.toISOString(),
    school: schoolById.get(row.published.schoolId)!, status: noticeStatus(row.published, now), demo: false };
}
function demos(now: Date): PublicNotice[] {
  return demoNotices.map(notice => ({ ...notice, version: 1, updatedAt: "2026-10-17T00:00:00Z", school: schoolById.get(notice.schoolId)!, status: noticeStatus(notice, now), demo: true }));
}
export async function readSchools() { return schools; }
export async function readNotices(input: unknown): Promise<NoticeList> {
  const query = querySchema.parse(input);
  const now = new Date();
  const all = query.dataset === "demo" ? demos(now) : (await sql<PublishedRow[]>`SELECT id, published, published_version, published_at FROM admission_notices WHERE published IS NOT NULL ORDER BY published_at DESC, id`).map(row => fromRow(row, now));
  const words = query.q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const base = all.filter(item => (!query.track || item.track === query.track) && (!query.stage || item.stage === query.stage)
    && (!query.school || item.schoolId === query.school) && (!query.province || item.school.province === query.province)
    && (!query.tier || item.school.tier === query.tier || (query.tier === "211" && item.school.tier === "985"))
    && (!query.year || item.year === query.year) && (!query.status || item.status === query.status)
    && words.every(word => [item.title, item.school.name, item.department, item.programme, item.summary].join(" ").toLocaleLowerCase().includes(word)));
  const filtered = base.filter(item => (!query.department || item.department === query.department) && (!query.programme || item.programme === query.programme));
  const distinct = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const departments = query.school ? distinct(base.filter(n => !n.department.startsWith("全校")).map(n => n.department)) : [];
  const programmes = query.school ? distinct(base.filter(n => (!query.department || n.department === query.department) && !/适用专业见|详见.*目录|全校|全部专业/.test(n.programme)).map(n => n.programme)) : [];
  // Reference documents are a separate group: never copy their conditions into a specific programme.
  const schoolRules = query.school && (query.department || query.programme) ? all.filter(n => n.schoolId === query.school && n.department === "全校（具体范围见原文）"
    && (query.year ? n.year === query.year : filtered.some(item => item.year === n.year))
    && (query.track ? n.track === query.track : filtered.some(item => item.track === n.track))).slice(0, 12) : [];
  const directory = query.school && query.dataset === "live" ? (await sql<{ school_id: string; url: string; title: string; kind: AdmissionDirectoryLink["kind"]; parent_url: string; checked_at: Date }[]>`SELECT * FROM admission_directory WHERE school_id=${query.school} ORDER BY kind,title,url LIMIT 300`)
    .map(row => ({ schoolId: row.school_id, url: row.url, title: row.title, kind: row.kind, parentUrl: row.parent_url, checkedAt: row.checked_at.toISOString() })) : [];
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const page = Math.min(query.page, pages);
  return { items: filtered.slice((page - 1) * 12, page * 12), total: filtered.length, page, pages, departments, programmes, schoolRules, directory, dataset: query.dataset, now: now.toISOString(),
    coverage: { schools: new Set(schools.map(school => school.family)).size, entries: schools.length, schools985: schools.filter(s => s.tier === "985").length,
      publishedSchools: new Set(all.map(item => item.schoolId)).size, notices: all.length } };
}
export async function readNotice(input: unknown): Promise<PublicNotice | null> {
  const id = detailIdSchema.parse(input);
  const now = new Date();
  if (id.startsWith("demo-")) return demos(now).find(item => item.id === id) ?? null;
  const [row] = await sql<PublishedRow[]>`SELECT id, published, published_version, published_at FROM admission_notices WHERE id = ${id} AND published IS NOT NULL`;
  return row ? fromRow(row, now) : null;
}

export async function readImports(input: unknown, admin = false): Promise<AdmissionImports> {
  const { ids } = importIds.parse(input);
  const rows = admin ? await sql`SELECT * FROM admission_imports ORDER BY created_at DESC LIMIT 100`
    : ids.length ? await sql`SELECT * FROM admission_imports WHERE id IN ${sql(ids)} ORDER BY created_at DESC` : [];
  const items: AdmissionImport[] = [];
  for (const row of rows) {
    const documents = (row.document_ids as string[]).length ? await sql<{ status: string; notice_ids: string[] }[]>`SELECT status,notice_ids FROM admission_documents WHERE id IN ${sql(row.document_ids as string[])}` : [];
    const documentStates: Record<string, number> = {};
    for (const doc of documents) documentStates[doc.status] = (documentStates[doc.status] ?? 0) + 1;
    const noticeIds = [...new Set(documents.flatMap(d => d.notice_ids))];
    const notices = (await Promise.all(noticeIds.map(readNotice))).filter((n): n is PublicNotice => n !== null);
    let message = "已添加，后台将在约一分钟内开始读取。";
    if (row.status === "reading") message = "后台正在读取网页和附件。";
    else if (!row.enabled) message = "管理员已暂停此来源。";
    else if (row.status === "failed" || documentStates["needs-review"]) message = "网页或附件读取／整理未完成，请核对原文；管理员可查看原因并重新处理。";
    else if (documentStates["budget-paused"]) message = "来源已读取；本轮模型剩余额度不足，条件摘要等待后续处理。";
    else if (documentStates["awaiting-model"]) message = "网页已读取，自动整理尚未启用。";
    else if (row.status === "ready" && !documents.length) message = "本页未发现当年招生公告。请改用具体公告链接，或检查栏目是否需要点击其他分页。";
    else if (notices.length) message = "已有整理结果，可展开查看条件与材料。";
    else if (row.status === "ready") message = "来源已检查，尚无可发布的招生结果；仅专业目录或非招生内容不会生成公告。";
    items.push({ id: row.id, school: schoolById.get(row.school_id)!, url: row.url, kind: row.kind, status: row.status, title: row.title,
      createdAt: row.created_at.toISOString(), checkedAt: row.checked_at?.toISOString() ?? null, nextCheckAt: row.next_check_at.toISOString(), enabled: row.enabled,
      stats: row.stats, documentStates, notices, message: admin && row.error ? `${message} ${row.error}` : message });
  }
  return { items, budget: await admissionCost() };
}
