import { z } from 'zod';

const command={ revision:z.number().int().positive(),reason:z.string().trim().min(1).max(1000),
  requestId:z.string().regex(/^[\w-]{8,80}$/) };
export const SectionGroupingCorrection=z.discriminatedUnion('action',[
  z.strictObject({ ...command,action:z.literal('detach') }),
  z.strictObject({ ...command,action:z.literal('move'),factPublicId:z.string().min(1).max(80) }),
  z.strictObject({ ...command,action:z.literal('regroup') }),
]);
export type SectionGroupingCorrectionInput=z.infer<typeof SectionGroupingCorrection>;
export const SectionStoryParams=z.strictObject({ id:z.coerce.number().int().positive() });
export const SectionStoryMerge=z.strictObject({ intoId:z.number().int().positive(),fromVersion:z.number().int().positive(),
  intoVersion:z.number().int().positive(),reason:command.reason,requestId:command.requestId });
export type SectionStoryMergeInput=z.infer<typeof SectionStoryMerge>;
