import { readFileSync } from "node:fs";
import { closeDb, sql } from "@aihot/backend/db";
import { saveCatalogue } from "../backend/repository.ts";
import { catalogueEntrySchema } from "../backend/schema.ts";

try {
  const catalogue = JSON.parse(readFileSync(new URL("../catalogue.json", import.meta.url), "utf8"));
  for (const row of catalogue.entries) {
    await saveCatalogue(catalogueEntrySchema.parse({
      id: row.id, name: row.name, schoolLevel: row.schoolLevel,
      schoolLevelByScope: row.schoolLevelByScope, schoolRecognitionText: row.schoolRecognitionText,
      collectionScope: row.collectionScope,
    }));
  }
  const [count] = await sql`SELECT count(*)::int AS total FROM competition_catalogue`;
  console.log(JSON.stringify({ imported: catalogue.entries.length, persisted: count.total }));
} finally { await closeDb(); }
