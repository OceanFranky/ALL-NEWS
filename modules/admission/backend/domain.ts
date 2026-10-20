import { z } from "zod";
import { noticeSchema, type AdmissionNotice, type NoticeStatus } from "@aihot/contracts/admission";
import { schoolById } from "../schools.ts";

export const querySchema = z.object({
  q: z.string().trim().max(200).default(""), track: z.enum(["", "baoyan", "kaoyan"]).default(""),
  stage: z.enum(["", "summer", "pre", "recommendation", "exam", "prospectus", "retest", "adjustment"]).default(""),
  school: z.preprocess(value => value === "" ? undefined : value, z.string().regex(/^s\d{3}$/).optional()), province: z.string().max(30).default(""),
  department: z.string().trim().max(150).default(""), programme: z.string().trim().max(150).default(""),
  tier: z.enum(["", "985", "211", "other"]).default(""), year: z.preprocess(value => value === "" ? undefined : value, z.coerce.number().int().min(2020).max(2100).optional()),
  status: z.enum(["", "upcoming", "open", "closed", "unknown"]).default(""),
  dataset: z.enum(["live", "demo"]).default("live"), page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
export const idSchema = z.string().uuid();
export const detailIdSchema = z.union([idSchema, z.string().regex(/^demo-[1-4]$/)]);
export const saveSchema = z.object({ id: idSchema.optional(), expectedVersion: z.number().int().min(1).optional(), notice: noticeSchema, reason: z.string().trim().min(1).max(500) }).strict();
export const commandSchema = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(1).max(500) }).strict();

export function identityKey(notice: AdmissionNotice): string {
  return JSON.stringify([notice.schoolId, notice.department, notice.programme, notice.year, notice.track, notice.stage, notice.batch]);
}
export function noticeStatus(notice: Pick<AdmissionNotice, "deadline" | "deadlineTime" | "opensOn">, now = new Date()): NoticeStatus {
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  if (notice.deadline) {
    const end = notice.deadlineTime ? Date.parse(`${notice.deadline}T${notice.deadlineTime}:00+08:00`) : Date.parse(`${notice.deadline}T23:59:59.999+08:00`);
    if (now.getTime() > end) return "closed";
  }
  if (notice.opensOn && today < notice.opensOn) return "upcoming";
  if (notice.opensOn && notice.deadline) return "open";
  return "unknown";
}
export function validateSchool(notice: AdmissionNotice) {
  if (!schoolById.has(notice.schoolId)) throw Object.assign(new Error("院校不在目录中，请先维护院校目录"), { statusCode: 400 });
}
export function validatePublication(notice: AdmissionNotice, now = new Date()) {
  validateSchool(notice);
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const host = new URL(notice.source.url).hostname;
  const schoolHost = new URL(schoolById.get(notice.schoolId)!.website!).hostname.replace(/^www\./, "");
  const roots = notice.schoolId === "s105" ? [schoolHost, "nwsuaf.edu.cn"] : [schoolHost];
  const official = roots.some(root => host === root || host.endsWith(`.${root}`)) || host === "yz.chsi.com.cn" || host.endsWith(".moe.gov.cn");
  if (!official || (!notice.source.verified && notice.source.verification !== "machine") || !notice.source.checkedOn || notice.source.checkedOn > today || (notice.source.publishedOn && notice.source.publishedOn > today) || notice.source.evidence.length < 20) {
    throw Object.assign(new Error("发布需要院校官网／研招网来源、非未来核验日期、人工核验或机器证据校验和至少20字事实依据；门户首页不能作为具体公告的依据"), { statusCode: 400 });
  }
  if (new URL(notice.source.url).pathname === "/") throw Object.assign(new Error("请提供具体公告链接，不要使用门户首页"), { statusCode: 400 });
}
