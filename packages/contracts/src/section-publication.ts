import { z } from "zod";

export const SectionResourceParams=z.strictObject({ id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/) });
export const SectionPermissionReview=z.strictObject({ summaryAllowed:z.boolean(),reference:z.string().trim().min(1).max(2000) });
export const SectionPublicationReview=z.strictObject({ revision:z.number().int().positive(),action:z.enum(['approve','withdraw']),reason:z.string().trim().min(1).max(1000) });
export type SectionPermissionReviewInput=z.infer<typeof SectionPermissionReview>;
export type SectionPublicationReviewInput=z.infer<typeof SectionPublicationReview>;
