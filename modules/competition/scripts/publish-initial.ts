import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { sql, closeDb } from "@aihot/backend/db";
import { initialDisplay } from "../backend/initial-display.ts";

try {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
  const snapshot = JSON.parse(await readFile(new URL("../verification/2026-10-14-final-ingestion.json", import.meta.url), "utf8"));
  if (snapshot.entries.length !== 31) throw new Error("Expected accepted 31-entry snapshot");
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM competition_catalogue`;
  if (count !== 31) throw new Error("Initial publication requires the accepted 31-entry catalogue");
  console.log(JSON.stringify({ apply: values.apply, entries: await initialDisplay(snapshot.entries, "script:competition-initial-display", values.apply) }, null, 2));
} finally { await closeDb(); }
