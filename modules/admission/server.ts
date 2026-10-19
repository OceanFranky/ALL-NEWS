import { defineServerModule } from "@aihot/backend/modules";
import { admissionRoutes } from "./api/routes.ts";
import { readNotices, readNotice, readSchools, readImports, readAgents } from "./backend/publication.ts";
import { importQueue, scheduleAdmissions, agentQueue, scheduleAdmissionAgents } from "./jobs.ts";
import { automationEnabled } from "./backend/automation.ts";
import { readMonitor, readDaily } from "./backend/updates.ts";
export default defineServerModule({ name: "admission", http: admissionRoutes,
  queues: [importQueue, agentQueue], schedules: [{ name: "admission.schedule", cron: "* * * * *", when: automationEnabled, run: scheduleAdmissions },
    { name: "admission.agent.schedule", cron: "* * * * *", when: automationEnabled, run: scheduleAdmissionAgents }],
  publications: { list: readNotices, detail: readNotice, schools: readSchools, monitor: readMonitor, daily: readDaily, imports: readImports, agents: readAgents } });
