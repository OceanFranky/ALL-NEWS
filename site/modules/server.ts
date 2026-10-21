// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { worldNewsModule } from "@aihot/world-news/server";
import competition from "@aihot/competition/server";
import admission from "@aihot/admission/server";
import learningResources from "@aihot/learning-resources/server";
import "./competition-resources.ts";
import { withPlatformAgent } from "./agent.ts";

export const SERVER_MODULES: readonly ServerModule[] = [worldNewsModule, competition, admission, learningResources].map(withPlatformAgent);

export const WORKER_MODULES: readonly ServerModule[] = [worldNewsModule, admission];
