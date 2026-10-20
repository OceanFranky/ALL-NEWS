// Dedicated resource maintenance entry point; does not start the site's other workers.
import { parseArgs } from "node:util";
import { closeDb } from "@aihot/backend/db";
import { previewMaintenance, createMaintenanceRun, executeMaintenance } from "../backend/maintenance.ts";

const { values } = parseArgs({ options: { run: { type: "boolean", default: false }, "allow-network": { type: "boolean", default: false } }, strict: true });
try {
  if (values.run && !values["allow-network"]) throw new Error("实际执行必须显式指定 --run --allow-network；默认只预览");
  if (values.run) {
    // Explicit permission applies only to this dedicated process, never to .env or other workers.
    process.env.COLLECT_ENABLED = "true";
    const id = await createMaintenanceRun("resource-maintenance-cli");
    console.log(JSON.stringify(id ? await executeMaintenance(id) : { skipped: "没有到期的来源或资源" }, null, 2));
  } else console.log(JSON.stringify(await previewMaintenance(), null, 2));
} finally { await closeDb(); }
