import { z } from "zod";
import { noticeSchema } from "@aihot/contracts/admission";
import type { Material } from "@aihot/backend/documents/types";

const { schoolId: _schoolId, source: _source, resources: _resources, ...extractedFields } = noticeSchema.shape;
export const extractedNoticeSchema = z.strictObject({ ...extractedFields,
  evidence: z.array(z.strictObject({ field: z.string().min(1).transform(field => field.replace(/^(eligibility|materials)\[(\d+)\]$/, "$1.$2")), materialId: z.string().min(1), blockId: z.string().min(1), quote: z.string().min(2).max(1000) })).min(1).max(60),
});
export const extractionSchema = z.strictObject({ relevant: z.boolean(), reason: z.string().max(500), notices: z.array(extractedNoticeSchema).max(4) });
export type ExtractedNotice = z.infer<typeof extractedNoticeSchema>;
export function validateScopeEvidence(notice: ExtractedNotice) {
  for (const field of ["department", "programme", "batch"] as const) {
    const value = notice[field];
    if (/^(全校（具体范围见原文）|适用专业见官方目录|校级通知)$/.test(value)) continue;
    const quotes = notice.evidence.filter(e => e.field === field).map(e => e.quote.replace(/\s/g, "")).join(" ");
    if (!quotes.includes(value.replace(/\s/g, ""))) throw new Error(`具体招生范围缺少原文逐字依据：${field}`);
  }
}
export function explicitSourceDate(value: string, context: string) {
  const text = context.replace(/\s/g, "");
  for (const match of text.matchAll(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})(?:日|号)?/g)) {
    const date = (month: string, day: string) => `${match[1]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (date(match[2], match[3]) === value) return true;
    const end = /^(?:上午|下午|中午|晚上)?(?:\d{1,2}[:：]\d{2})?(?:至|到|—|－|-|~|～)(?:(\d{1,2})[月./-])?(\d{1,2})(?:日|号)?/.exec(text.slice(match.index! + match[0].length));
    if (end && date(end[1] ?? match[2], end[2]) === value) return true;
  }
  return false;
}
export function alignEvidence(notice: ExtractedNotice, materials: Material[]) {
  for (const e of notice.evidence) {
    const material = materials.find(m => m.id === e.materialId);
    const normal = (text: string) => text.replace(/\s/g, "");
    if (material?.blocks.find(b => b.id === e.blockId && normal(b.text).includes(normal(e.quote)))) continue;
    const matches = material?.blocks.filter(b => normal(b.text).includes(normal(e.quote))) ?? [];
    // Correct only a unique position in the very same source; never rewrite the quote or search other documents.
    if (matches.length === 1) e.blockId = matches[0].id;
  }
  // “某专业硕士研究生” names a subject, not necessarily a professional degree.
  const degreeQuotes = notice.evidence.filter(e => e.field === "degree").map(e => e.quote.replace(/\s/g, "")).join(" ");
  const academic = /学术(?:型|学位)|学硕/.test(degreeQuotes), professional = /专业(?:型|学位)|专硕/.test(degreeQuotes);
  if (notice.degree === "academic" && !academic || notice.degree === "professional" && !professional
    || notice.degree === "both" && !(academic && professional)) notice.degree = "unknown";
}
export function validateEvidence(notice: ExtractedNotice, materials: Material[]) {
  const errors: string[] = [];
  for (const e of notice.evidence) {
    const block = materials.find(m => m.id === e.materialId)?.blocks.find(b => b.id === e.blockId);
    // PDF/OCR splits Chinese words with layout spaces. Ignore whitespace only; retain every character and punctuation.
    if (!block?.text.replace(/\s/g, "").includes(e.quote.replace(/\s/g, ""))) errors.push(`引用未匹配原文：${e.field}`);
  }
  const required = ["year", "track", "stage", "summary", ...["opensOn", "deadline", "deadlineTime"].filter(k => notice[k as keyof ExtractedNotice] !== null),
    ...notice.eligibility.map((_, i) => `eligibility.${i}`), ...notice.materials.map((_, i) => `materials.${i}`)];
  for (const field of required) if (!notice.evidence.some(e => e.field === field)) errors.push(`缺少字段依据：${field}`);
  const yearQuotes = notice.evidence.filter(e => e.field === "year").map(e => e.quote).join(" ");
  if (!yearQuotes.replace(/\s/g, "").includes(String(notice.year))) errors.push("入学年份未出现在引用中");
  for (const key of ["opensOn", "deadline"] as const) {
    const value = notice[key]; if (!value) continue;
    const quotes = notice.evidence.filter(e => e.field === key).map(e => e.quote.replace(/\s/g, "")).join(" ");
    const [, mm, dd] = value.split("-");
    if (!new RegExp(`(?:0?${Number(mm)}[月./-]0?${Number(dd)}(?:日|号)?|${Number(mm)}月0?${Number(dd)}|0?${Number(mm)}月\\d{1,2}日?(?:\\d{1,2}[:：]\\d{2})?(?:至|到|—|－|-)+0?${Number(dd)}日)`).test(quotes)) errors.push(`日期未匹配引用：${key}`);
    const context = notice.evidence.filter(e => e.field === key).map(e => materials.find(m => m.id === e.materialId)?.blocks.find(b => b.id === e.blockId)?.text ?? "").join(" ");
    // An admissions cohort (e.g. 2027级) does not establish the year of September registration.
    if (!explicitSourceDate(value, context)) errors.push(`日期年份缺少原文依据：${key}`);
  }
  if (notice.deadlineTime && !notice.evidence.filter(e => e.field === "deadlineTime").some(e => e.quote.replace(/\s/g, "").replace(/：/g, ":").includes(notice.deadlineTime!))) errors.push("截止时刻未匹配引用");
  if (errors.length) throw new Error(errors.join("；"));
}
