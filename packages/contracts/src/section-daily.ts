import { z } from "zod";
import { isValidDate } from "./time.ts";

export const SectionDailyDate=z.string().refine(isValidDate,"invalid calendar date");
export const SectionDailyParams=z.strictObject({ date:SectionDailyDate });
export const SectionDailyGenerate=z.strictObject({});
export const SectionDailyPolicy=z.strictObject({ focusLimit:z.number().int().min(0).max(100),flashLimit:z.number().int().min(0).max(100),
  maxFocusPerSource:z.number().int().min(1).max(100) });
export type SectionDailyPolicyInput=z.infer<typeof SectionDailyPolicy>;
export const SectionDailyReview=z.strictObject({ revision:z.number().int().positive(),action:z.enum(['approve','withdraw']),reason:z.string().trim().min(1).max(1000) });
export const SectionDailyEntry=z.strictObject({ itemId:z.string(),analysisId:z.number().int(),storyPublicId:z.string().nullable(),
  title:z.string(),summary:z.string(),reason:z.string().nullable(),category:z.string(),score:z.number().nullable(),
  sourceId:z.string(),sourceName:z.string(),originalUrl:z.string(),publishedAt:z.string(),admittedAt:z.string() });
export type SectionDailyEntryData=z.infer<typeof SectionDailyEntry>;
export const SectionDailyContent=z.strictObject({ date:SectionDailyDate,policy:SectionDailyPolicy,
  focus:z.array(SectionDailyEntry),flashes:z.array(SectionDailyEntry),status:z.enum(['ready','no-qualified-content']) });
export type SectionDailyContentData=z.infer<typeof SectionDailyContent>;
