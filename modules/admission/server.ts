import { defineServerModule } from "@aihot/backend/modules";
import { admissionRoutes } from "./api/routes.ts";
import { readNotices, readNotice, readSchools, readImports } from "./backend/publication.ts";
import { importQueue, scheduleAdmissions } from "./jobs.ts";
import { automationEnabled } from "./backend/automation.ts";
import { readMonitor, readDaily } from "./backend/updates.ts";
export default defineServerModule({ name: "admission", http: admissionRoutes,
  queues: [importQueue], schedules: [{ name: "admission.schedule", cron: "* * * * *", when: automationEnabled, run: scheduleAdmissions }],
  publications: { list: readNotices, detail: readNotice, schools: readSchools, monitor: readMonitor, daily: readDaily, imports: readImports } });
