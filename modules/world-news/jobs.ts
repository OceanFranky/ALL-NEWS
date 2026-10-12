import { z } from "zod";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn, recordRun } from "@aihot/backend/jobs/queue";
import { analyzeSectionArticle } from "@aihot/backend/editorial/section-analyze";
import { assertSectionResource } from "@aihot/backend/sections/resources";
import { sql } from "@aihot/backend/db";
import { groupSectionArticle } from "@aihot/backend/events/section-group";
import { projectSectionArticle } from "@aihot/backend/publication/section-publish";
import { collectSectionSource } from "@aihot/backend/sources/section-collect";
import { composeWorldStoryDigest } from "@aihot/backend/events/section-digest";

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

export const WorldAnalysisTask = z.strictObject({ sectionId: z.literal("world"), articleId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), attemptTag: z.string().max(100).optional() });
export type WorldAnalysisTaskData = z.infer<typeof WorldAnalysisTask>;

export async function runWorldAnalysisTask(raw: unknown) {
  const task = WorldAnalysisTask.parse(raw);
  // Consumer revalidates ownership; a queue payload is never proof of persisted section identity.
  return recordRun("world-news.analyze", () => analyzeSectionArticle(task.sectionId, task.articleId, task.attemptTag), "world");
}

export const worldAnalysisQueue = defineQueue<WorldAnalysisTaskData>({
  name: "world-news.analyze", options: { policy: "short", retryLimit: 2, retryDelay: 60, expireInSeconds: 900 },
  worker: { batchSize: 1, pollingIntervalSeconds: 2 },
  run: async tasks => {
    const results = [];
    for (const task of tasks) {
      const result=await runWorldAnalysisTask(task);
      if (result.relevance==="pass" && !result.stale) await queueWorldGroup({ sectionId:"world",articleId:task.articleId });
      results.push(result);
    }
    return results;
  },
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
export const worldGroupQueue=defineQueue<z.infer<typeof WorldGroupTask>>({
  name:"world-news.group",options:{ policy:"short",retryLimit:2,retryDelay:60,expireInSeconds:900 },
  worker:{ batchSize:1,localConcurrency:1,pollingIntervalSeconds:2 },
  run:async tasks=>{ const results=[]; for(const task of tasks) results.push(await runWorldGroupTask(task)); return results; },
});
export async function queueWorldGroup(raw:unknown) {
  const task=WorldGroupTask.parse(raw);
  await sql.begin(tx=>assertSectionResource(tx,"world",{ kind:"article",id:task.articleId }));
  return enqueueOn(worldGroupQueue,task,{ singletonKey:`world:group:${task.articleId}` });
}

export const WorldDigestTask=z.strictObject({ sectionId:z.literal("world"),storyId:z.number().int().positive() });
export const worldDigestQueue=defineQueue<z.infer<typeof WorldDigestTask>>({
  name:"world-news.digest",options:{ policy:"short",retryLimit:2,retryDelay:60,expireInSeconds:900 },
  worker:{ batchSize:1,localConcurrency:1,pollingIntervalSeconds:2 },
  run:async tasks=>{ const results=[];for(const task of tasks) results.push(await runWorldDigestTask(task));return results; },
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
