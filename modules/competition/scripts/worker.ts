// Dedicated competition/resource worker; the news worker keeps its existing isolation.
import { closeDb } from "@aihot/backend/db";
import "@aihot/site/modules/competition-resources";
import { assertProductionSecrets } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { getBoss, stopBoss, workModuleQueues } from "@aihot/backend/jobs/queue";
import competition from "../server.ts";
import resources from "@aihot/learning-resources/server";

installModules([competition, resources]);
assertProductionSecrets([["auth", "IMG_PROXY_SIGN_SECRET"]]);
const boss = await getBoss();
await workModuleQueues(boss);
console.log(JSON.stringify({ level: "info", msg: "competition resource worker started", queues: ["competition.ingest", "resources.maintain"], scheduled: false }));
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await stopBoss();
  await closeDb();
  process.exit(0);
});
