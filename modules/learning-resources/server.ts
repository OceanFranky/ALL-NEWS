import { defineServerModule } from "@aihot/backend/modules";
import { resourceRoutes } from "./api/routes.ts";
import { competitionResources } from "./backend/publication.ts";
import { maintenanceQueue, scheduleMaintenance } from "./backend/maintenance.ts";
export default defineServerModule({ name: "learning-resources", http: resourceRoutes, publications: { competition: competitionResources },
  queues: [maintenanceQueue], schedules: [{ name: "resources.maintain", cron: "40 3 * * *", missed: "once", run: scheduleMaintenance }],
});
