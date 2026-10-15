import type { CompetitionActivity, CompetitionNode, CompetitionRecord, CompetitionTime } from "@aihot/contracts/competitions";

export const activityLabels: Record<CompetitionActivity, string> = {
  registration_open: "正在报名", registration_upcoming: "报名未开始", registration_closed: "该范围报名已截止",
  competition_ongoing: "比赛进行中", competition_upcoming: "比赛未开始", competition_finished: "该赛段已结束", unknown: "时间待核验",
};
export const nodeLabels: Record<CompetitionNode["kind"], string> = {
  registration_start: "报名开始", registration_end: "报名截止", competition_start: "比赛开始", competition_end: "赛段结束",
};
export function competitionPath(item: Pick<CompetitionRecord, "competitionId" | "editionId">): string {
  return `/competitions/${item.competitionId}/editions/${item.editionId}`;
}
export function safeLink(value: string | null): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
export function displayDate(value: string, precision: CompetitionTime["precision"], timezone: string): string {
  if (precision === "day") return value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
  if (precision === "month") return value.replace(/^(\d{4})-(\d{2})$/, "$1年$2月");
  if (precision !== "minute") return value;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
export function libraryHref(params: URLSearchParams): string {
  const query = params.toString();
  return `/competitions/library${query ? `?${query}` : ""}`;
}
