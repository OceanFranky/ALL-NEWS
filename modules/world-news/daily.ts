import { generateSectionDaily,refreshSectionDaily } from "@aihot/backend/reports/section-daily";
import { sql } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";

// World editorial capacity, not the legacy AI daily's size or source thresholds.
export const WORLD_DAILY_POLICY=Object.freeze({ focusLimit:6,flashLimit:6,maxFocusPerSource:2 });
export const generateWorldDaily=(date:string,actor:string)=>generateSectionDaily('world',date,WORLD_DAILY_POLICY,actor);

export async function refreshWorldDaily(now=new Date()) {
  const [setting]=await sql<{ value:{ automatic?:boolean } }[]>`SELECT value FROM settings WHERE key='sections.world.daily'`;
  if(setting?.value?.automatic!==true) return { status:'disabled' as const,changed:false };
  return refreshSectionDaily('world',beijingDate(now),WORLD_DAILY_POLICY,'worker.world-daily');
}
