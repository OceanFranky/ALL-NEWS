import { z } from "zod";
import { competitionCategories } from "./taxonomy.ts";

export const activities = ["registration_open", "registration_upcoming", "registration_closed", "competition_ongoing", "competition_upcoming", "competition_finished", "unknown"] as const;
const integer = (maximum: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(maximum));
const multiple = z.string().min(1).transform(value => value.split(","));
export const competitionQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  category: multiple.pipe(z.array(z.enum(competitionCategories))).optional(),
  schoolLevel: multiple.pipe(z.array(z.string().min(1).max(50))).optional(),
  year: z.union([z.literal("unknown"), z.string().regex(/^\d{4}$/).transform(Number).pipe(z.number().min(2000).max(2200))]).optional(),
  activity: multiple.pipe(z.array(z.enum(activities))).optional(),
  sort: z.enum(["catalogue", "year_desc", "next_node"]).default("catalogue"),
  page: integer(1_000_000).default(1),
  pageSize: integer(100).default(20),
}).strict();
export type CompetitionQuery = z.infer<typeof competitionQuerySchema>;
export const competitionIdSchema = z.string().regex(/^competition-\d{3}$/);
export const editionIdSchema = z.uuid();
export const displayInputSchema = z.object({
  revisionId: z.string().min(1).nullable(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
