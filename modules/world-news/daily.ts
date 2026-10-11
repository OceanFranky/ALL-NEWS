import { generateSectionDaily } from "@aihot/backend/reports/section-daily";

// World editorial capacity, not the legacy AI daily's size or source thresholds.
export const WORLD_DAILY_POLICY=Object.freeze({ focusLimit:6,flashLimit:6,maxFocusPerSource:2 });
export const generateWorldDaily=(date:string,actor:string)=>generateSectionDaily('world',date,WORLD_DAILY_POLICY,actor);
