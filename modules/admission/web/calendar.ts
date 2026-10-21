import type { PublicNotice } from "@aihot/contracts/admission";
const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
function fold(line: string) {
  const encoder = new TextEncoder(); const lines: string[] = []; let current = ""; let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) { lines.push(current); current = " "; bytes = 1; }
    current += char; bytes += size;
  }
  return [...lines, current].join("\r\n");
}
export function calendarEvent(item: PublicNotice, now = new Date()): string | null {
  if (!item.deadline) return null;
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dates = item.deadlineTime
    ? [`DTSTART:${stamp(new Date(`${item.deadline}T${item.deadlineTime}:00+08:00`))}`]
    : [`DTSTART;VALUE=DATE:${item.deadline.replaceAll("-", "")}`, `DTEND;VALUE=DATE:${new Date(Date.parse(`${item.deadline}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10).replaceAll("-", "")}`];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ALL-NEWS//Admission//ZH", "BEGIN:VEVENT", `UID:admission-${item.id}-v${item.version}@all-news.local`, `DTSTAMP:${stamp(now)}`, ...dates, `SUMMARY:${escape(`${item.school.name} · ${item.title} · 截止`)}`, `DESCRIPTION:${escape(`${item.year}级 ${item.department} ${item.programme} ${item.batch}\n${item.dateNote}\n${item.deadlineTime ? "北京时间" : "具体截止时刻未说明，请核对原文"}\n${item.source.url}`)}`, "END:VEVENT", "END:VCALENDAR", ""].map(fold).join("\r\n");
}
