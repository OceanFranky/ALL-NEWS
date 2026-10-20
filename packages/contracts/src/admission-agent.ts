import { z } from "zod";
import { linkSchema, stages, type AdmissionSchool, type PublicNotice } from "./admission.ts";

export const baoyanStages = { summer: "夏令营", pre: "预推免", recommendation: "正式推免" } as const;
export const agentGoalSchema = z.strictObject({
  schoolId: z.string().regex(/^s\d{3}$/),
  keywords: z.array(z.string().trim().min(1).max(30)).max(4).default([]),
  year: z.number().int().min(2020).max(2100),
  stages: z.array(z.enum(Object.keys(stages) as [keyof typeof stages, ...(keyof typeof stages)[]])).min(1).max(4),
  track: z.enum(["baoyan", "kaoyan"]).optional(),
  urls: z.array(linkSchema).max(2).default([]),
  searchWeb: z.boolean().optional(),
});
export const agentSubmissionSchema = agentGoalSchema.extend({ schoolId: agentGoalSchema.shape.schoolId.optional(), source: z.string().trim().min(2).max(2000).optional() });
export type AgentGoal = z.infer<typeof agentGoalSchema>;
export const agentStatusLabels = {
  queued: "等待执行", discovering: "发现官网线索", extracting: "提取与校验", supplementing: "补查相关材料",
  completed: "本轮检查完成", partial: "本轮部分完成", "budget-paused": "模型额度不足", "awaiting-model": "等待启用模型",
  "needs-review": "等待人工核对", failed: "本轮读取失败", paused: "管理员已暂停",
} as const;
export type AgentStatus = keyof typeof agentStatusLabels;
export interface AgentStep {
  id: number; cycle: number; stage: string; status: string; at: string;
  url: string | null; title: string; detail: string;
}
export interface AgentTask {
  id: string; goal: AgentGoal; school: AdmissionSchool; enabled: boolean; status: AgentStatus;
  cycle: number; createdAt: string; checkedAt: string | null; nextCheckAt: string;
  stats: { pages: number; candidates: number; processed: number; remaining: number; failed: number };
  gaps: string[]; steps: AgentStep[]; notices: PublicNotice[]; references: PublicNotice[];
  changes: { noticeId: string; title: string; kind: string; fields: string[]; at: string }[];
  search?: AgentSearch;
  brief?: AgentBrief;
}
export interface AgentBrief {
  title: string; overview: string; asOf: string; checkedAt: string | null;
  state: "ready" | "waiting" | "empty";
  current: number; closed: number;
  items: { notice: PublicNotice; reason: string; action: string }[];
  references: PublicNotice[];
  timeline: { noticeId: string; date: string; time: string | null; kind: "opens" | "deadline"; title: string; url: string; past: boolean }[];
  unknownDates: number;
}
export type AgentSearch = {
  provider: "360搜索"; checkedAt: string;
  queries: { query: string; url: string; status: "pending" | "running" | "ready" | "empty" | "failed"; returned: number; accepted: number }[];
  links: { url: string; title: string }[];
}
export interface AgentTasks {
  items: AgentTask[]; budget: { limitCny: number; accountedUpperCny: number };
}
