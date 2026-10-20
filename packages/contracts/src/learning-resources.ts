import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const resourceUrlSchema = z.string().trim().max(2000).url().refine(value => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, "只接受不含账号密码的 HTTP/HTTPS 原文链接").transform(value => {
  const url = new URL(value);
  // Keep hash-router paths used by official learning portals; ordinary anchors do not identify a resource.
  if (!/^#!?\//.test(url.hash)) url.hash = "";
  return url.toString();
});
export const resourceDataSchema = z.object({
  kind: z.enum(["experience", "video"]),
  title: text(300), url: resourceUrlSchema, author: text(200).nullable(), platform: text(100),
  contentType: z.enum(["participation", "beginner", "tutorial", "retrospective"]),
  topic: text(300), summary: text(2000), summaryBasis: text(2000),
  official: z.boolean(), verification: z.enum(["unverified", "verified"]),
  publishedDate: z.iso.date().nullable(), publishedYear: z.number().int().min(1900).max(2200).nullable(),
  durationSeconds: z.number().int().positive().max(604800).nullable(),
  coverUrl: resourceUrlSchema.nullable(), coverPermission: text(1000).nullable(),
  availability: z.enum(["available", "temporarily_unreachable", "invalid"]), availabilityReason: z.string().trim().max(1000),
}).strict().superRefine((value, ctx) => {
  if (value.publishedDate && value.publishedYear && Number(value.publishedDate.slice(0, 4)) !== value.publishedYear) ctx.addIssue({ code: "custom", path: ["publishedYear"], message: "年份与发布日期不一致" });
  if (value.coverUrl && !value.coverPermission) ctx.addIssue({ code: "custom", path: ["coverPermission"], message: "封面需要记录使用依据" });
  if (value.availability !== "available" && !value.availabilityReason) ctx.addIssue({ code: "custom", path: ["availabilityReason"], message: "请记录访问失败或失效原因" });
});
export const resourceLinkSchema = z.object({
  competitionId: z.string().regex(/^competition-\d{3}$/), editionId: z.uuid().nullable(),
  year: z.number().int().min(1900).max(2200).nullable(),
  scope: text(500), reason: text(1000),
}).strict();
export const resourceWriteSchema = z.object({
  expectedVersion: z.number().int().min(0), reason: text(1000), data: resourceDataSchema,
  links: z.array(resourceLinkSchema).max(100),
}).strict().superRefine((value, ctx) => {
  const keys = value.links.map(link => JSON.stringify([link.competitionId, link.editionId, link.year, link.scope]));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["links"], message: "存在重复关联" });
});
export const resourceReviewSchema = z.object({
  expectedVersion: z.number().int().positive(), action: z.enum(["publish", "withdraw"]), reason: text(1000),
}).strict();
export type ResourceData = z.infer<typeof resourceDataSchema>;
export type ResourceLink = z.infer<typeof resourceLinkSchema>;
export type ResourceWrite = z.infer<typeof resourceWriteSchema>;
export type ResourceReview = z.infer<typeof resourceReviewSchema>;
export type ManagedResource = { id: string; version: number; status: "draft" | "published" | "withdrawn"; data: ResourceData; links: ResourceLink[]; updatedAt: string };
export type ResourceHistory = { version: number; actor: string; reason: string; snapshot: ManagedResource; createdAt: string };
export type ResourceDetail = { resource: ManagedResource; history: ResourceHistory[] };
export type ResourceList = { items: ManagedResource[]; page: number; total: number };
export type ResourceTarget = { competitionId: string; name: string; editions: { id: string; year: number | null }[] };
export type ResourceCoverage = { competitionId: string; name: string; experience: number; video: number; reason: string };
export type PublicResource = { id: string; data: Omit<ResourceData, "coverPermission" | "availabilityReason"> & { availabilityMessage: string }; links: Omit<ResourceLink, "reason">[] };
export type CompetitionResources = { experience: PublicResource[]; video: PublicResource[] };

export const maintenanceSourceSchema = z.object({
  competitionId: z.string().regex(/^competition-\d{3}$/), name: text(300), enabled: z.boolean(),
  urls: z.array(resourceUrlSchema).max(4), keywords: z.array(text(80)).min(1).max(10),
}).strict();
export const maintenanceConfigSchema = z.object({
  enabled: z.boolean(), competitionAgentEnabled: z.boolean().default(true), intervalDays: z.union([z.literal(1), z.literal(7)]),
  maxSources: z.number().int().min(0).max(10), maxChecks: z.number().int().min(0).max(50),
  maxCandidates: z.number().int().min(0).max(20), maxRequests: z.number().int().min(1).max(60),
  sources: z.array(maintenanceSourceSchema).max(31),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sources.map(s => s.competitionId)).size !== value.sources.length) ctx.addIssue({ code: "custom", message: "竞赛来源配置重复" });
});
export const maintenanceWriteSchema = z.object({ expectedVersion: z.number().int().min(0), reason: text(1000), config: maintenanceConfigSchema }).strict();
export type MaintenanceConfig = z.infer<typeof maintenanceConfigSchema>;
export type MaintenanceSettings = { version: number; config: MaintenanceConfig };
export type CompetitionMaintenanceContext = { competitionId: string; runId: string; name: string; collectionScope?: string };
export type CompetitionResourceMaterial = { id: string; url: string; links: { title: string; url: string }[] };
export type CompetitionResourceResult = { status: string; maintenanceRunId: string | null; reason?: string; requests?: number; created?: number; duplicates?: number };
export type CompetitionResourceStage = (context: CompetitionMaintenanceContext, materials: CompetitionResourceMaterial[]) => Promise<CompetitionResourceResult>;
export type ResourceCandidate = { competitionId: string; url: string; title: string; sourceUrl: string; materialId?: string };
export type MaintenancePlan = { settings: MaintenanceSettings; sources: { competitionId: string; name: string; keywords: string[]; url: string }[]; resourceIds: string[]; collectionEnabled: boolean; competition?: CompetitionMaintenanceContext; candidates?: ResourceCandidate[] };
export type MaintenanceObservation = { type: "source" | "resource" | "candidate"; url: string; outcome: string; note: string; resourceId?: string; historical?: boolean };
export type MaintenanceReport = { requests: number; created: number; duplicates: number; observations: MaintenanceObservation[] };
export type MaintenanceRun = { id: string; status: "queued" | "running" | "succeeded" | "cancelled" | "failed"; actor: string; createdAt: string; updatedAt: string; cancelRequested: boolean; plan: MaintenancePlan; report: MaintenanceReport };
export type MaintenanceOverview = { settings: MaintenanceSettings; collectionEnabled: boolean; runs: MaintenanceRun[] };
