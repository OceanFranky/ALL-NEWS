import { defineServerModule } from "@aihot/backend/modules";
import { WORLD_RULES } from "./rules.ts";
import { worldAnalysisQueue } from "./jobs.ts";

// No automatic schedules or publication: analysis is explicitly queued by the world workflow.
export const worldNewsModule = defineServerModule({ name: "world-news", sections: [WORLD_RULES], queues: [worldAnalysisQueue] });
