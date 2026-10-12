import { defineServerModule } from "@aihot/backend/modules";
import { WORLD_RULES } from "./rules.ts";
import { worldAnalysisQueue, worldGroupQueue,worldCollectQueue,worldDigestQueue,scheduleWorldCollections } from "./jobs.ts";
import { registerWorldPublic } from "./api/public.ts";
import { registerWorldAdmin } from "./api/admin.ts";
import { computeSectionHot } from "@aihot/backend/events/section-hot";
import { sectionContext } from "@aihot/backend/sections/context";
import { sectionSelectionThreshold } from "@aihot/backend/sections/rules";

// Collection follows each enabled world's due time; automatic hot publication still requires calibration.
export const worldNewsModule = defineServerModule({ name: "world-news", sections: [WORLD_RULES], queues: [worldAnalysisQueue,worldGroupQueue,worldCollectQueue,worldDigestQueue],
  schedules:[{ name:"world-news.collect",cron:"* * * * *",run:scheduleWorldCollections,
    when:()=>process.env.COLLECT_ENABLED==='true' },
  { name:"world-news.hot",cron:"*/5 * * * *",run:()=>computeSectionHot("world","worker"),
    when:()=>sectionSelectionThreshold(sectionContext("world"))!==null }],
  http:app=>{ registerWorldPublic(app);registerWorldAdmin(app); } });
