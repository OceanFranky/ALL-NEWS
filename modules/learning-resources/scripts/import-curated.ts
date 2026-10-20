import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeDb } from "@aihot/backend/db";
import { importResourceManifest } from "../backend/import.ts";

const { values } = parseArgs({ options: { file: { type: "string" }, apply: { type: "boolean", default: false }, publish: { type: "boolean", default: false } } });
try {
  const file = values.file ?? new URL("../seeds/competition-resources.json", import.meta.url);
  const result = await importResourceManifest(JSON.parse(readFileSync(file, "utf8")), {
    apply: values.apply, publish: values.publish, actor: "curated-resource-import",
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await closeDb(); }
