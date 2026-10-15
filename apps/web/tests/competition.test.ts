import assert from "node:assert/strict";
import test from "node:test";
import { competitionPath, displayDate, libraryHref, safeLink } from "../../../modules/competition/web/format.ts";

test("competition links keep edition identity, and external links only accept public web schemes", () => {
  assert.equal(competitionPath({ competitionId: "competition-001", editionId: "same-year-edition" }), "/competitions/competition-001/editions/same-year-edition");
  for (const value of [null, "javascript:alert(1)", "data:text/html,unsafe", "https://user:secret@example.org", "/relative"]) assert.equal(safeLink(value), undefined);
  assert.equal(safeLink("https://example.org/notice.pdf"), "https://example.org/notice.pdf");
});

test("competition date display preserves precision and respects the supplied timezone", () => {
  assert.equal(displayDate("2026-10", "month", "Asia/Shanghai"), "2026年10月");
  assert.equal(displayDate("2026-10-15", "day", "Asia/Shanghai"), "2026年10月15日");
  assert.equal(displayDate("十月中旬", "approximate", "Asia/Shanghai"), "十月中旬");
  assert.match(displayDate("2026-10-15T18:00:00Z", "minute", "Asia/Shanghai"), /2026\/10\/16 02:00/);
  const params = new URLSearchParams({ q: "软件杯", category: "软件开发", page: "2" });
  assert.equal(new URL(libraryHref(params), "https://example.org").searchParams.get("q"), "软件杯");
});
