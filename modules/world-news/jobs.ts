import { z } from "zod";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn, recordRun } from "@aihot/backend/jobs/queue";
import { analyzeSectionArticle } from "@aihot/backend/editorial/section-analyze";
import { assertSectionResource } from "@aihot/backend/sections/resources";
import { sql } from "@aihot/backend/db";

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
  run: async tasks => { const results = []; for (const task of tasks) results.push(await runWorldAnalysisTask(task)); return results; },
});

export async function queueWorldAnalysis(raw: unknown): Promise<string | null> {
  const task = WorldAnalysisTask.parse(raw);
  await sql.begin(tx => assertSectionResource(tx, "world", { kind: "article", id: task.articleId }));
  return enqueueOn(worldAnalysisQueue, task, { singletonKey: `world:article:${task.articleId}:${task.attemptTag ?? "0"}` });
}
