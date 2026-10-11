import { z } from "zod";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn, recordRun } from "@aihot/backend/jobs/queue";
import { analyzeSectionArticle } from "@aihot/backend/editorial/section-analyze";
import { assertSectionResource } from "@aihot/backend/sections/resources";
import { sql } from "@aihot/backend/db";
import { groupSectionArticle } from "@aihot/backend/events/section-group";
import { projectSectionArticle } from "@aihot/backend/publication/section-publish";

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

export async function queueWorldAnalysis(raw: unknown): Promise<string | null> {
  const task = WorldAnalysisTask.parse(raw);
  await sql.begin(tx => assertSectionResource(tx, "world", { kind: "article", id: task.articleId }));
  return enqueueOn(worldAnalysisQueue, task, { singletonKey: `world:article:${task.articleId}:${task.attemptTag ?? "0"}` });
}
