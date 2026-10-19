import { z } from "zod";
import { defineQueue } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { automationEnabled } from "./backend/automation.ts";
import { runImport } from "./backend/imports.ts";
import { runAgent } from "./backend/agent.ts";

export const agentTask = z.strictObject({ taskId: z.uuid() });
export const agentQueue = defineQueue<z.infer<typeof agentTask>>({
  name: "admission.agent", options: { policy: "short", retryLimit: 0, expireInSeconds: 900 },
  worker: { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 5 },
  run: async tasks => { for (const task of tasks) await runAgent(agentTask.parse(task).taskId); },
});
export async function scheduleAdmissionAgents() {
  if (!automationEnabled()) return { enqueued: 0 };
  const due = await sql<{ id: string }[]>`SELECT id FROM admission_agent_tasks WHERE enabled AND next_check_at<=now()
    AND status NOT IN ('budget-paused','awaiting-model','needs-review') ORDER BY next_check_at,id LIMIT 20`;
  let enqueued = 0;
  for (const task of due) if (await enqueueOn(agentQueue, { taskId: task.id }, { singletonKey: task.id })) enqueued++;
  return { enqueued };
}

export const importTask = z.strictObject({ importId: z.uuid() });
export const importQueue = defineQueue<z.infer<typeof importTask>>({
  name: "admission.import", options: { policy: "short", retryLimit: 0, expireInSeconds: 2400 },
  worker: { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: 5 },
  run: async tasks => { for (const task of tasks) await runImport(importTask.parse(task).importId); },
});
export async function scheduleAdmissions() {
  if (!automationEnabled()) return { enqueued: 0 };
  const due = await sql<{ id: string }[]>`SELECT id FROM admission_imports WHERE enabled AND next_check_at<=now() ORDER BY next_check_at,id LIMIT 30`;
  let enqueued = 0;
  for (const source of due) if (await enqueueOn(importQueue, { importId: source.id }, { singletonKey: source.id })) enqueued++;
  return { enqueued };
}
