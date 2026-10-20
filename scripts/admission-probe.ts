// Read-only live source verification. No database writes or model calls.
import { mkdirSync, writeFileSync } from "node:fs";
import { sourceConfigs, discover, readMaterials } from "../modules/admission/backend/sources.ts";
if (process.env.COLLECT_ENABLED !== "true") throw new Error("Set COLLECT_ENABLED=true for this explicit live probe");
const ids = process.argv.slice(2).filter(a => /^s\d{3}$/.test(a));
const queue = sourceConfigs.filter(s => !ids.length || ids.includes(s.schoolId));
const output: object[] = [];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const source = queue.shift()!;
    const result = await discover(source);
    const materials: object[] = [];
    if (process.argv.includes("--materials")) for (const link of result.links.slice(0, 2)) {
      try { const docs = await readMaterials(source.schoolId, link); materials.push({ url: link.url, status: "ok", attachments: docs.length - 1, chars: docs.reduce((n, d) => n + d.blocks.reduce((s, b) => s + b.text.length, 0), 0) }); }
      catch (error) { materials.push({ url: link.url, status: "failed", error: String(error) }); }
    }
    output.push({ schoolId: source.schoolId, ...result, materials });
    console.log(JSON.stringify({ schoolId: source.schoolId, pages: result.pages, found: result.links.length, errors: result.errors, materials }));
  }
}));
mkdirSync(".data/admission-research", { recursive: true });
writeFileSync(".data/admission-research/live-probe.json", JSON.stringify({ at: new Date().toISOString(), schools: output }, null, 2));
