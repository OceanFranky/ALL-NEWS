// Dedicated preview worker: installs only admissions queues and schedules on the shared infrastructure.
import { installModules } from "@aihot/backend/modules";
import { getBoss, ensureQueue, workModuleQueues, stopBoss, recordRun } from "@aihot/backend/jobs/queue";
import { closeDb } from "@aihot/backend/db";
import admission from "../modules/admission/server.ts";
import { automationEnabled } from "../modules/admission/backend/automation.ts";

installModules([admission]);
if (!automationEnabled()) throw new Error("Admissions automation is disabled");
const boss = await getBoss();
await workModuleQueues(boss);
for (const schedule of admission.schedules ?? []) {
  if (schedule.when && !schedule.when()) continue;
  const queue = `cron.${schedule.name}`;
  await ensureQueue(queue, { policy: "singleton", retryLimit: 0, expireInSeconds: 300 });
  await boss.schedule(queue, schedule.cron, {}, { tz: "Asia/Shanghai" });
  await boss.work(queue, { pollingIntervalSeconds: 15 }, () => recordRun(schedule.name, schedule.run));
  await recordRun(schedule.name, schedule.run);
}
console.log(JSON.stringify({ level: "info", msg: "admission worker started" }));
let stopping = false;
async function shutdown() { if (stopping) return; stopping = true; await stopBoss(); await closeDb(); process.exit(0); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
