// Explicit free-network diagnostic. No database writes, detail-page fetches or model calls.
import { WORLD_SOURCES } from '../sources.ts';
import { fetchRss } from '@aihot/backend/sources/rss';
import { admitListing } from '@aihot/backend/sources/filters';
import type { SourceRow } from '@aihot/backend/sources/types';

const checkedAt=new Date().toISOString();
const results=await Promise.all(WORLD_SOURCES.map(async definition=>{
  const source:SourceRow={ ...definition,participation_mode:'editorial',first_party:false,
    interval_minutes:60,enabled:false,cursor:null,fail_count:0 };
  const start=Date.now();
  try {
    const read=await fetchRss(source,{ force:true }),items=admitListing(read.candidates,source);
    const missingSummary=items.filter(i=>!i.excerpt?.trim()).length;
    const repeatedTitle=items.filter(i=>i.excerpt?.replace(/\s/g,'')===i.title.replace(/\s/g,'')).length;
    return { id:source.id,name:source.name,url:source.config.feedUrl,status:'ok',ms:Date.now()-start,
      parsed:read.candidates.length,admitted:items.length,missingSummary,repeatedTitle,
      missingDate:items.filter(i=>!i.publishedAt).length,
      usableText:items.length-missingSummary-repeatedTitle,
      samples:items.slice(0,2).map(i=>({ title:i.title,url:i.url,publishedAt:i.publishedAt?.toISOString() ?? null,
        excerptCharacters:i.excerpt?.length ?? 0 })) };
  } catch(error) {
    return { id:source.id,name:source.name,url:source.config.feedUrl,status:'failed',ms:Date.now()-start,error:String(error).slice(0,500) };
  }
}));
console.log(JSON.stringify({ checkedAt,method:'project fetchRss + admitListing, free listing only',
  databaseWrites:false,modelCalls:0,permissionsVerified:false,results },null,2));
if(results.some(r=>r.status==='failed')) process.exitCode=1;
