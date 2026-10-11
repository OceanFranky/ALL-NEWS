// Explicit non-legacy collection reuses the same readers; dates, cursors and material stay scoped.
import { requireSectionId,type SectionId } from "@aihot/contracts/sections";
import { sql } from "../db.ts";
import { sectionContext } from "../sections/context.ts";
import { identityKeyFor,upsertMaterial,STALE_ON_DISCOVERY_MS } from "../content/materials.ts";
import { identityKeyForUrl } from "../lib/url.ts";
import { fetchRss,type RssRead } from "./rss.ts";
import { fetchWebList } from "./web-list.ts";
import { fetchJsonList } from "./json-list.ts";
import { admitListing } from "./filters.ts";
import { assertSupportedConfig } from "./config-keys.ts";
import type { Candidate,SourceRow } from "./types.ts";

export interface SectionCollectResult {
  sectionId:SectionId;
  sourceId:string;
  status:'ok'|'skipped'|'failed';
  found:number;
  created:number;
  revised:number;
  error?:string;
}

export async function collectSectionSource(sectionId:SectionId,sourceId:string,
  options:{ force?:boolean;onMaterial?:(articleId:string)=>Promise<unknown> }={}):Promise<SectionCollectResult> {
  requireSectionId(sectionId);
  if(sectionId==='ai') throw new Error('use the legacy AI collection entry point');
  sectionContext(sectionId);
  const [source]=await sql<SourceRow[]>`SELECT * FROM sources WHERE id=${sourceId} AND section_id=${sectionId}`;
  if(!source) throw new Error('section source not found');
  const counts={ found:0,created:0,revised:0 };
  if(process.env.COLLECT_ENABLED!=='true') return { sectionId,sourceId,status:'skipped',...counts,error:'collection-disabled' };
  if(!source.enabled && !options.force) return { sectionId,sourceId,status:'skipped',...counts,error:'paused' };
  const connection=await sql.reserve();
  const key=`collect:${sectionId}:${sourceId}`;
  let locked=false,runId:number|undefined;
  try {
    const [lock]=await connection<{ locked:boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended(${key},0)) AS locked`;
    locked=lock!.locked;
    if(!locked) return { sectionId,sourceId,status:'skipped',...counts,error:'already-running' };
    // Reload after the lock so a concurrent preceding run's validator cannot be lost.
    const [current]=await sql<SourceRow[]>`SELECT * FROM sources WHERE id=${sourceId} AND section_id=${sectionId}`;
    Object.assign(source,current);
    if(!source.enabled && !options.force) return { sectionId,sourceId,status:'skipped',...counts,error:'paused' };
    const [run]=await sql<{ id:number }[]>`INSERT INTO fetch_runs (section_id,source_id) VALUES (${sectionId},${sourceId}) RETURNING id`;
    runId=run!.id;
    assertSupportedConfig(source.kind,source.config);
    if(!['rss','web_list','json_list'].includes(source.kind)) throw new Error('section collector supports RSS, HTML and JSON only');
    // This workflow is free listing text only; do not silently buy Jina or fetch original/detail pages.
    if(source.config.detail || /(?:^|\/)r\.jina\.ai\//.test(String(source.config.url ?? source.config.feedUrl))) throw new Error('world workflow does not fetch paid rendering or detail pages');
    let candidates:Candidate[],validator:RssRead['validator']|undefined;
    if(source.kind==='rss') {
      const read=await fetchRss(source,{ force:options.force });candidates=read.candidates;validator=read.validator;
    } else candidates=source.kind==='web_list' ? await fetchWebList(source) : await fetchJsonList(source);
    counts.found=candidates.length;
    const unique=new Map<string,Candidate>();
    for(const c of admitListing(candidates,source)) {
      const identity=c.identityKey ?? (source.config.preserveUrlFragment===true ? identityKeyForUrl(c.url,{ keepFragment:true }) : null)
        ?? identityKeyFor({ ...c,sourceId,via:'fetch' });
      if(!unique.has(identity)) unique.set(identity,{ ...c,identityKey:identity });
    }
    const initialized=source.cursor?.initializedAt ? Date.parse(source.cursor.initializedAt) : null;
    const known=initialized===null ? new Set<string>() : new Set((await sql<{ identity_key:string }[]>`
      SELECT identity_key FROM articles WHERE section_id=${sectionId} AND identity_key=ANY(${[...unique.keys()]}::text[])`).map(r=>r.identity_key));
    for(const [identity,c] of unique) {
      if(initialized!==null && c.publishedAt && c.publishedAt.getTime()<initialized-STALE_ON_DISCOVERY_MS && !known.has(identity)) continue;
      // Use only text actually supplied by the listing. Never invoke the legacy body extraction path.
      const material=await upsertMaterial({ sectionId,sourceId,via:'fetch',url:c.url,title:c.title,identityKey:identity,author:c.author,
        language:c.language,publishedAt:c.publishedAt,sourceUpdatedAt:c.sourceUpdatedAt,excerpt:c.excerpt,raw:c.raw,bodyStatus:'none' });
      if(material.created) counts.created++;
      if(material.revised) counts.revised++;
    }
    // Enqueue unprocessed current revisions, including a previous queue failure or an HTTP 304 run.
    if(options.onMaterial) {
      const pending=await sql<{ id:string }[]>`SELECT a.id FROM articles a WHERE a.section_id=${sectionId} AND a.source_id=${sourceId}
        AND (a.processing_state IN ('new','failed') OR NOT EXISTS (SELECT 1 FROM analyses an
          WHERE an.section_id=a.section_id AND an.article_id=a.id AND an.input_revision=a.revision)) ORDER BY a.discovered_at,a.id`;
      for(const a of pending) await options.onMaterial(a.id);
    }
    const cursor={ ...source.cursor,initializedAt:source.cursor?.initializedAt ?? new Date().toISOString(),...(validator ? { rss:validator } : {}) };
    await sql.begin(async tx=>{
      const updated=await tx`UPDATE sources SET cursor=${tx.json(cursor as never)},last_fetch_at=now(),last_ok_at=now(),fail_count=0,last_error=NULL,
        health=CASE WHEN enabled THEN 'ok' ELSE 'paused' END,next_fetch_at=CASE WHEN enabled THEN now()+make_interval(mins=>interval_minutes) ELSE NULL END,updated_at=now()
        WHERE section_id=${sectionId} AND id=${sourceId} AND config=${tx.json(source.config)} RETURNING id`;
      if(!updated.length) throw new Error('source configuration changed during collection; cursor was not advanced');
      await tx`UPDATE fetch_runs SET status='ok',finished_at=now(),found_count=${counts.found},new_count=${counts.created},
        detail=${tx.json({ revised:counts.revised,admitted:unique.size })} WHERE section_id=${sectionId} AND id=${runId!}`;
    });
    return { sectionId,sourceId,status:'ok',...counts };
  } catch(error) {
    const message=String(error).slice(0,1000);
    if(runId) await sql.begin(async tx=>{
      await tx`UPDATE sources SET last_fetch_at=now(),last_error=${message},fail_count=fail_count+1,
        health=CASE WHEN NOT enabled THEN 'paused' WHEN fail_count+1>=5 THEN 'failing' ELSE 'degraded' END,
        next_fetch_at=CASE WHEN enabled THEN now()+make_interval(mins=>LEAST(interval_minutes*(fail_count+2),360)) ELSE NULL END
        WHERE section_id=${sectionId} AND id=${sourceId}`;
      await tx`UPDATE fetch_runs SET status='failed',finished_at=now(),found_count=${counts.found},new_count=${counts.created},error=${message}
        WHERE section_id=${sectionId} AND id=${runId!}`;
    });
    return { sectionId,sourceId,status:'failed',...counts,error:message };
  } finally {
    try { if(locked) await connection`SELECT pg_advisory_unlock(hashtextextended(${key},0))`; } finally { connection.release(); }
  }
}
