import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { dateSchema, type AdmissionMonitor, type AdmissionDaily, type AdmissionNotice } from "@aihot/contracts/admission";
import { schoolById } from "../schools.ts";
import { sourceConfigs } from "./sources.ts";
import { readNotice } from "./publication.ts";

export const dailyQuery = z.strictObject({ date: dateSchema.optional() });
export async function readMonitor(): Promise<AdmissionMonitor> {
  const sources = await sql<{ school_id: string; status: string; last_checked_at: Date | null; last_ok_at: Date | null; detail: { links?: unknown[]; errors?: string[] } }[]>`SELECT school_id,status,last_checked_at,last_ok_at,detail FROM admission_sources`;
  const docs = await sql<{ school_id: string; status: string; count: number }[]>`SELECT school_id,status,count(*)::int AS count FROM admission_documents GROUP BY school_id,status`;
  const notices = await sql<{ published: AdmissionNotice }[]>`SELECT published FROM admission_notices WHERE published IS NOT NULL`;
  return { checkedAt: new Date().toISOString(), schools: sourceConfigs.map(config => {
    const source = sources.find(s => s.school_id === config.schoolId), published = notices.filter(n => n.published.schoolId === config.schoolId);
    return { school: schoolById.get(config.schoolId)!, urls: config.urls, status: source?.status ?? "pending",
      checkedAt: source?.last_checked_at?.toISOString() ?? null, lastOkAt: source?.last_ok_at?.toISOString() ?? null,
      candidates: source?.detail.links?.length ?? 0, documents: Object.fromEntries(docs.filter(d => d.school_id === config.schoolId).map(d => [d.status, d.count])),
      notices: published.length, baoyan: published.filter(n => n.published.track === "baoyan").length, kaoyan: published.filter(n => n.published.track === "kaoyan").length,
      errors: source?.detail.errors ?? [] };
  }) };
}
export async function readDaily(input: unknown): Promise<AdmissionDaily> {
  const query = dailyQuery.parse(input);
  const date = query.date ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00+08:00`), end = new Date(start.getTime() + 86400_000);
  const rows = await sql<{ notice_id: string; kind: string; fields: string[]; created_at: Date }[]>`SELECT c.notice_id,c.kind,c.fields,c.created_at FROM admission_changes c JOIN admission_notices n ON n.id=c.notice_id
    WHERE c.created_at>=${start} AND c.created_at<${end} AND n.published IS NOT NULL ORDER BY c.created_at DESC LIMIT 200`;
  const changes: AdmissionDaily["changes"] = [];
  for (const row of rows) {
    if (changes.some(c => c.notice.id === row.notice_id)) continue;
    const notice = await readNotice(row.notice_id); if (notice) changes.push({ kind: row.kind, at: row.created_at.toISOString(), fields: row.fields, notice });
  }
  const limit = new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86400_000).toISOString().slice(0, 10);
  const upcoming = await sql<{ id: string }[]>`SELECT id FROM admission_notices WHERE published IS NOT NULL AND published->>'deadline'>=${date} AND published->>'deadline'<${limit} ORDER BY published->>'deadline',id LIMIT 60`;
  const deadlines = (await Promise.all(upcoming.map(n => readNotice(n.id)))).filter(n => n !== null);
  return { date, generatedAt: new Date().toISOString(), changes, deadlines };
}
