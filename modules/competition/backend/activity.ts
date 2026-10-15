import type { CompetitionActivity, CompetitionNode, CompetitionTime } from "@aihot/contracts/competitions";
import type { Extracted } from "./schema.ts";

function dateAt(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (name: string) => parts.find(entry => entry.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function midnight(date: string, timezone: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (name: string) => Number(parts.find(entry => entry.type === name)!.value);
    const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    const difference = target - local;
    if (difference === 0) return instant;
    instant += difference;
  }
  return NaN;
}

export function timeBoundary(time: CompetitionTime, value: string | null, end: boolean): number | null {
  if (!value || !["day", "minute"].includes(time.precision)) return null;
  const date = time.precision === "day" && end
    ? new Date(Date.parse(`${value}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : value;
  const instant = time.precision === "minute" ? Date.parse(value) : midnight(date, time.timezone);
  return Number.isFinite(instant) ? instant : null;
}

export function competitionActivity(data: Pick<Extracted, "registrationTimes" | "competitionTimes">, now: Date) {
  const activity: Array<{ kind: "registration" | "competition"; scope: string; label: string; status: CompetitionActivity }> = [];
  const nodes: Array<{ at: number; node: CompetitionNode }> = [];
  for (const [kind, field] of [["registration", data.registrationTimes], ["competition", data.competitionTimes]] as const) {
    if (field.status !== "known") continue;
    for (const time of field.value ?? []) {
      const start = timeBoundary(time, time.start, false);
      const end = timeBoundary(time, time.end, true);
      const instant = now.getTime();
      let status: CompetitionActivity = "unknown";
      if (start !== null && instant < start) status = kind === "registration" ? "registration_upcoming" : "competition_upcoming";
      else if (end !== null && instant >= end) status = kind === "registration" ? "registration_closed" : "competition_finished";
      else if (start !== null && end !== null && instant >= start && instant < end) status = kind === "registration" ? "registration_open" : "competition_ongoing";
      activity.push({ kind, scope: time.scope, label: time.label, status });
      for (const [edge, at, value] of [["start", start, time.start], ["end", end, time.end]] as const) {
        if (at === null || at <= instant || !value) continue;
        const date = time.precision === "minute" ? dateAt(new Date(value), time.timezone) : value;
        const daysRemaining = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dateAt(now, time.timezone)}T00:00:00Z`)) / 86_400_000);
        nodes.push({ at, node: { kind: `${kind}_${edge}`, scope: time.scope, label: time.label, officialText: time.officialText, precision: time.precision as "day" | "minute", timezone: time.timezone, date: value, daysRemaining } });
      }
    }
  }
  if (!activity.length) activity.push({ kind: "registration", scope: "", label: "时间待核验", status: "unknown" });
  nodes.sort((left, right) => left.at - right.at || left.node.kind.localeCompare(right.node.kind) || left.node.scope.localeCompare(right.node.scope));
  return { activity, nextNodes: nodes.filter(entry => entry.at === nodes[0]?.at).map(entry => entry.node) };
}
