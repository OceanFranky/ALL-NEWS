import { defineServerModule } from "@aihot/backend/modules";
import { WORLD_RULES } from "./rules.ts";

// Registration is not collection or publication; no schedules, queues or routes yet.
export const worldNewsModule = defineServerModule({ name: "world-news", sections: [WORLD_RULES] });
