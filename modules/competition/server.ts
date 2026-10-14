import { defineServerModule } from "@aihot/backend/modules";
import { competitionAutomationEnabled, competitionIngestQueue, scheduleCompetitionRefresh } from "./backend/daily.ts";

export default defineServerModule({
  name: "competition",
  queues: [competitionIngestQueue],
  schedules: [{
    name: "competition.refresh",
    cron: "20 2 * * *",
    missed: "once",
    when: competitionAutomationEnabled,
    run: scheduleCompetitionRefresh,
  }],
});
