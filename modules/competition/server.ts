import { defineServerModule } from "@aihot/backend/modules";
import { competitionAutomationEnabled, competitionIngestQueue, scheduleCompetitionRefresh } from "./backend/daily.ts";
import { competitionRoutes } from "./api/routes.ts";
import { readCompetitionPublication, readCompetitionDetail, readCompetitionFilters, readCompetitionOverview } from "./backend/publication.ts";

export default defineServerModule({
  name: "competition",
  http: competitionRoutes,
  publications: { list: readCompetitionPublication, detail: readCompetitionDetail, filters: readCompetitionFilters, overview: readCompetitionOverview },
  queues: [competitionIngestQueue],
  schedules: [{
    name: "competition.refresh",
    cron: "20 2 * * *",
    missed: "once",
    when: competitionAutomationEnabled,
    run: scheduleCompetitionRefresh,
  }],
});
