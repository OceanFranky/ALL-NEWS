import { z } from "zod";
import { defineQueue, type ModuleQueue } from "@aihot/backend/modules";
import { enqueueOn, recordRun } from "@aihot/backend/jobs/queue";
import { analyzeSectionArticle } from "@aihot/backend/editorial/section-analyze";
import { assertSectionResource } from "@aihot/backend/sections/resources";
import { sql } from "@aihot/backend/db";
import { groupSectionArticle } from "@aihot/backend/events/section-group";
import { projectSectionArticle } from "@aihot/backend/publication/section-publish";
import { collectSectionSource } from "@aihot/backend/sources/section-collect";
import { composeWorldStoryDigest } from "@aihot/backend/events/section-digest";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";
import { createHash } from "node:crypto";

export async function runWorldBudgeted<T extends object>(queue:ModuleQueue<T>,tasks:T[],run:(task:T)=>Promise<unknown>) {
  const results=[];
  for(const task of tasks) {
    try { results.push(await run(task)); }
    catch(error) {
      if(!(error instanceof BudgetExceededError)) throw error;
      const startAfter=new Date(Date.now()+error.retryAfterSeconds*1000);
      const identity=createHash('sha256').update(JSON.stringify(task)).digest('hex');
      const jobId=await enqueueOn(queue,task,{ startAfter,singletonKey:`budget:${identity}:${startAfter.toISOString().slice(0,16)}` });
      results.push({ deferred:true,retryAt:startAfter.toISOString(),jobId });
    }
  }
  return results;
}

export const WorldCollectTask=z.strictObject({ sectionId:z.literal('world'),sourceId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),force:z.boolean().optional() });
export async function runWorldCollectTask(raw:unknown) {
  const task=WorldCollectTask.parse(raw);
  await sql.begin(tx=>assertSectionResource(tx,'world',{ kind:'source',id:task.sourceId }));
  return recordRun('world-news.collect',async()=>{
    const result=await collectSectionSource('world',task.sourceId,{ force:task.force,onMaterial:articleId=>queueWorldAnalysis({ sectionId:'world',articleId }) });
    if(result.status==='failed') throw new Error(result.error);
    return result;
  },'world');
}
export const worldCollectQueue=defineQueue<z.infer<typeof WorldCollectTask>>({
  name:'world-news.collect',options:{ policy:'short',retryLimit:2,retryDelay:60,expireInSeconds:900 },
  worker:{ batchSize:1,localConcurrency:1,pollingIntervalSeconds:2 },
  run:async tasks=>{ const results=[];for(const task of tasks) results.push(await runWorldCollectTask(task));return results; },
});
export async function queueWorldCollection(raw:unknown) {
  const task=WorldCollectTask.parse(raw);
  await sql.begin(tx=>assertSectionResource(tx,'world',{ kind:'source',id:task.sourceId }));
  return enqueueOn(worldCollectQueue,task,{ singletonKey:`world:collect:${task.sourceId}` });
}

/** Enqueue enabled world sources when due; the source rows stay independent from the legacy AI scheduler. */
export async function scheduleWorldCollections() {
  if(process.env.COLLECT_ENABLED!=='true') return { enqueued:0,due:0 };
  return sql.begin(async tx=>{
    const due=await tx<{ id:string }[]>`SELECT id FROM sources
      WHERE section_id='world' AND enabled AND (next_fetch_at IS NULL OR next_fetch_at<=now())
      ORDER BY next_fetch_at NULLS FIRST,id LIMIT 20 FOR UPDATE SKIP LOCKED`;
    let enqueued=0;
    for(const source of due) {
      if(await enqueueOn(worldCollectQueue,{ sectionId:'world',sourceId:source.id },{ singletonKey:`world:collect:${source.id}` },tx)) enqueued+=1;
    }
    if(due.length) await tx`UPDATE sources SET next_fetch_at=now()+interval '10 minutes'
      WHERE section_id='world' AND id IN ${tx(due.map(source=>source.id))}`;
    return { enqueued,due:due.length };
  });
}

export const WorldAnalysisTask = z.strictObject({ sectionId: z.literal("world"), articleId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), attemptTag: z.string().max(100).optional() });
export type WorldAnalysisTaskData = z.infer<typeof WorldAnalysisTask>;

export async function runWorldAnalysisTask(raw: unknown) {
  const task = WorldAnalysisTask.parse(raw);
  // Consumer revalidates ownership; a queue payload is never proof of persisted section identity.
  return recordRun("world-news.analyze", () => analyzeSectionArticle(task.sectionId, task.articleId, task.attemptTag), "world");
}

export const worldAnalysisQueue:ModuleQueue<WorldAnalysisTaskData> = defineQueue<WorldAnalysisTaskData>({
  name: "world-news.analyze", options: { policy: "short", retryLimit: 2, retryDelay: 60, expireInSeconds: 900 },
  worker: { batchSize: 1, pollingIntervalSeconds: 2 },
  run: tasks => runWorldBudgeted(worldAnalysisQueue,tasks,async task=>{
      const result=await runWorldAnalysisTask(task);
      if (result.relevance==="pass" && !result.stale) await queueWorldGroup({ sectionId:"world",articleId:task.articleId });
      return result;
  }),
});

export const WorldGroupTask=WorldAnalysisTask.omit({ attemptTag:true });
export async function runWorldGroupTask(raw:unknown) {
  const task=WorldGroupTask.parse(raw);
  return recordRun("world-news.group",async()=>{
    const result=await groupSectionArticle(task.sectionId,task.articleId);
    await projectSectionArticle(task.sectionId,task.articleId);
    if(result.storyId) await queueWorldDigest({ sectionId:"world",storyId:result.storyId });
    return result;
  },"world");
}
export const worldGroupQueue:ModuleQueue<z.infer<typeof WorldGroupTask>>=defineQueue<z.infer<typeof WorldGroupTask>>({
  name:"world-news.group",options:{ policy:"short",retryLimit:2,retryDelay:60,expireInSeconds:900 },
  worker:{ batchSize:1,localConcurrency:1,pollingIntervalSeconds:2 },
  run:tasks=>runWorldBudgeted(worldGroupQueue,tasks,runWorldGroupTask),
});
export async function queueWorldGroup(raw:unknown) {
  const task=WorldGroupTask.parse(raw);
  await sql.begin(tx=>assertSectionResource(tx,"world",{ kind:"article",id:task.articleId }));
  return enqueueOn(worldGroupQueue,task,{ singletonKey:`world:group:${task.articleId}` });
}

export const WorldDigestTask=z.strictObject({ sectionId:z.literal("world"),storyId:z.number().int().positive() });
export const worldDigestQueue:ModuleQueue<z.infer<typeof WorldDigestTask>>=defineQueue<z.infer<typeof WorldDigestTask>>({
  name:"world-news.digest",options:{ policy:"short",retryLimit:2,retryDelay:60,expireInSeconds:900 },
  worker:{ batchSize:1,localConcurrency:1,pollingIntervalSeconds:2 },
  run:tasks=>runWorldBudgeted(worldDigestQueue,tasks,runWorldDigestTask),
});
export async function runWorldDigestTask(raw:unknown) {
  const task=WorldDigestTask.parse(raw);
  return recordRun("world-news.digest",()=>composeWorldStoryDigest(task.storyId),"world");
}
export async function queueWorldDigest(raw:unknown) {
  const task=WorldDigestTask.parse(raw);
  await sql.begin(tx=>assertSectionResource(tx,"world",{ kind:"story",id:task.storyId }));
  return enqueueOn(worldDigestQueue,task,{ singletonKey:`world:digest:${task.storyId}` });
}

export async function queueWorldAnalysis(raw: unknown): Promise<string | null> {
  const task = WorldAnalysisTask.parse(raw);
  const revision=await sql.begin(async tx=>{
    await assertSectionResource(tx,"world",{ kind:"article",id:task.articleId });
    const [a]=await tx<{ revision:number }[]>`SELECT revision FROM articles WHERE section_id='world' AND id=${task.articleId}`;
    return a!.revision;
  });
  return enqueueOn(worldAnalysisQueue, task, { singletonKey: `world:article:${task.articleId}:${revision}:${task.attemptTag ?? "0"}` });
}
