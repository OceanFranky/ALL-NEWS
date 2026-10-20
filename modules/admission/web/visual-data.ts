import type { PublicNotice } from "@aihot/contracts/admission";

const dayMs = 86_400_000;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / dayMs;
const dateAt = (value: number) => new Date(value * dayMs).toISOString().slice(0, 10);

// Calendar-day coordinates, not inferred opening times or precise deadline instants.
export function timelineScale(items: Pick<PublicNotice, "opensOn" | "deadline">[]) {
  const days = items.flatMap(item => [item.opensOn, item.deadline].filter((value): value is string => value !== null).map(day));
  if (!days.length) return null;
  const min = Math.min(...days); const max = Math.max(...days);
  const padding = Math.max(1, Math.ceil((max - min) * 0.04));
  const start = min - padding; const end = max + padding;
  return {
    start: dateAt(start), end: dateAt(end),
    ticks: [dateAt(start), dateAt(Math.floor((start + end) / 2)), dateAt(end)],
    position: (date: string) => (day(date) - start) / (end - start) * 100,
  };
}

export function sharedDeadlineDates(items: Pick<PublicNotice, "deadline">[]) {
  const dates = new Map<string, number>();
  for (const item of items) if (item.deadline) dates.set(item.deadline, (dates.get(item.deadline) ?? 0) + 1);
  return [...dates].filter(([, count]) => count > 1).sort(([a], [b]) => a.localeCompare(b));
}

export function materialRows(items: Pick<PublicNotice, "id" | "materials">[]) {
  const rows = new Map<string, { text: string; targetIds: string[] }>();
  for (const item of items) for (const text of new Set(item.materials)) {
    const row = rows.get(text) ?? { text, targetIds: [] };
    row.targetIds.push(item.id); rows.set(text, row);
  }
  // Exact text only: do not strip qualifications, quantities or template requirements.
  return [...rows.values()].sort((a, b) => b.targetIds.length - a.targetIds.length);
}
