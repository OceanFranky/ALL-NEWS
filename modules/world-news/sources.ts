import { readFileSync } from "node:fs";
import { createSource } from "@aihot/backend/admin/sources";

export const WORLD_SOURCES:readonly { id:string;name:string;kind:'rss';tier:string;config:{ feedUrl:string } }[]=
  JSON.parse(readFileSync(new URL('./sources.json',import.meta.url),'utf8'));

export async function installWorldSources(actor:string) {
  const results=[];
  for(const source of WORLD_SOURCES) results.push(await createSource({ ...source,site_fulltext:false,syndicate_fulltext:false },actor,'world'));
  return { sectionId:'world',results };
}
