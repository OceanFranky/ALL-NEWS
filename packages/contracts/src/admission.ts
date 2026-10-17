import { z } from "zod";

export const tracks = { baoyan: "保研", kaoyan: "考研" } as const;
export const stages = { summer: "夏令营", pre: "预推免", recommendation: "正式推免", exam: "统考报名", prospectus: "招生简章", retest: "复试", adjustment: "调剂" } as const;
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "日期不存在");
export const linkSchema = z.string().trim().max(2000).url().refine(value => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "仅支持不带账号密码的 HTTP(S) 链接");
export const resourceSchema = z.object({
  kind: z.enum(["official", "experience", "video"]), title: z.string().trim().min(1).max(200), url: linkSchema,
  author: z.string().trim().max(100), year: z.number().int().min(2000).max(2100).nullable(),
  scope: z.string().trim().min(1).max(300), note: z.string().trim().max(500),
}).strict();
export const noticeSchema = z.object({
  schoolId: z.string().regex(/^s\d{3}$/), title: z.string().trim().min(4).max(200),
  track: z.enum(["baoyan", "kaoyan"]), stage: z.enum(Object.keys(stages) as [keyof typeof stages, ...(keyof typeof stages)[]]),
  year: z.number().int().min(2020).max(2100), department: z.string().trim().min(1).max(150),
  programme: z.string().trim().min(1).max(150), batch: z.string().trim().min(1).max(100),
  degree: z.enum(["academic", "professional", "both", "unknown"]), summary: z.string().trim().min(10).max(3000),
  opensOn: dateSchema.nullable(), deadline: dateSchema.nullable(),
  deadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  dateNote: z.string().trim().max(500),
  eligibility: z.array(z.string().trim().min(1).max(500)).max(30),
  materials: z.array(z.string().trim().min(1).max(300)).max(30),
  source: z.object({ title: z.string().trim().min(1).max(200), url: linkSchema,
    publishedOn: dateSchema.nullable(), checkedOn: dateSchema.nullable(),
    verified: z.boolean(), evidence: z.string().trim().max(2000),
    verification: z.enum(["manual", "machine"]).optional(),
  }).strict(),
  resources: z.array(resourceSchema).max(30),
}).strict().superRefine((value, ctx) => {
  if (value.deadlineTime && !value.deadline) ctx.addIssue({ code: "custom", path: ["deadlineTime"], message: "精确时刻需要截止日期" });
  if (value.opensOn && value.deadline && value.opensOn > value.deadline) ctx.addIssue({ code: "custom", path: ["deadline"], message: "截止日期早于开始日期" });
  if (value.track === "baoyan" && !["summer", "pre", "recommendation", "prospectus"].includes(value.stage)) ctx.addIssue({ code: "custom", path: ["stage"], message: "保研阶段不匹配" });
  if (value.track === "kaoyan" && ["summer", "pre", "recommendation"].includes(value.stage)) ctx.addIssue({ code: "custom", path: ["stage"], message: "考研阶段不匹配" });
});
export type AdmissionNotice = z.infer<typeof noticeSchema>;
export interface AdmissionSchool { id: string; name: string; province: string; tier: "985" | "211" | "other"; family: string; website: string | null }
export type NoticeStatus = "upcoming" | "open" | "closed" | "unknown";
export interface PublicNotice extends AdmissionNotice { id: string; version: number; updatedAt: string; demo: boolean; school: AdmissionSchool; status: NoticeStatus }
export interface NoticeList {
  items: PublicNotice[]; total: number; page: number; pages: number; dataset: "live" | "demo"; now: string;
  departments: string[]; programmes: string[]; schoolRules: PublicNotice[]; directory: AdmissionDirectoryLink[];
  coverage: { schools: number; entries: number; schools985: number; publishedSchools: number; notices: number };
}
export interface AdmissionDirectoryLink { schoolId: string; url: string; title: string; kind: "department" | "catalogue" | "rules-index"; parentUrl: string; checkedAt: string }
export interface AdminNotice { id: string; version: number; draft: AdmissionNotice; published: AdmissionNotice | null; updatedAt: string }
export interface AdmissionImport {
  id: string; school: AdmissionSchool; url: string; kind: "notice" | "listing"; status: string; title: string;
  createdAt: string; checkedAt: string | null; nextCheckAt: string; enabled: boolean;
  stats: { documents?: number; characters?: number; files?: number }; documentStates: Record<string, number>;
  notices: PublicNotice[]; message: string;
}
export interface AdmissionImports {
  items: AdmissionImport[];
  budget: { limitCny: number; accountedUpperCny: number };
}
export interface AdmissionMonitor {
  checkedAt: string;
  schools: { school: AdmissionSchool; urls: string[]; status: string; checkedAt: string | null; lastOkAt: string | null;
    candidates: number; documents: Record<string, number>; notices: number; baoyan: number; kaoyan: number; errors: string[] }[];
}
export interface AdmissionDaily {
  date: string; generatedAt: string; changes: { kind: string; at: string; fields: string[]; notice: PublicNotice }[];
  deadlines: PublicNotice[];
}
export const statusLabels: Record<NoticeStatus, string> = { upcoming: "尚未开始", open: "可关注", closed: "已截止", unknown: "时间待确认" };
