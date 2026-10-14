import { z } from "zod";
import { competitionChat } from "./model.ts";
import { extractionPrompt } from "./extract.ts";
import { extractedSchema, type CatalogueEntry, type Extracted, type Material, type ValidationReport } from "./schema.ts";

export function repairFieldNames(report: ValidationReport): Array<keyof Extracted> {
  const fields = new Set<string>(report.errors.map(error => error.split(":")[0]!));
  if (fields.has("time")) { fields.add("registrationTimes"); fields.add("competitionTimes"); }
  return Object.keys(extractedSchema.shape).filter(field => fields.has(field)) as Array<keyof Extracted>;
}

export function missingFieldReview(report: ValidationReport): ValidationReport {
  return { ...report, errors: [...report.errors, ...report.missing.map(field => `${field.split(":")[0]}: 重新核对已有官方材料中的缺口；只有原文明确支持时补值，不推断未知信息。`)] };
}

export function repairMaterialIds(previous: Extracted, recorded: string[]): string[] {
  return [...new Set([...recorded, ...Object.values(previous).flatMap(field => field.evidence.map(ref => ref.materialId))])];
}

export function mergeFieldRepair(previous: Extracted, fields: Array<keyof Extracted>, patch: Record<string, unknown>): Extracted {
  const schema = z.object(Object.fromEntries(fields.map(field => [field, extractedSchema.shape[field]]))).strict();
  return extractedSchema.parse({ ...previous, ...schema.parse(patch) });
}

export async function repairMaterials(entry: CatalogueEntry, materials: Material[], previous: Extracted, report: ValidationReport, approvedCategories: string[]) {
  const fields = repairFieldNames(report);
  if (!fields.length) throw new Error("No supported fields in validation repair report");
  const schema = z.object(Object.fromEntries(fields.map(field => [field, extractedSchema.shape[field]]))).strict();
  const result = await competitionChat({
    model: "default", purpose: "competition.repair", subject: `competition:${entry.id}`,
    promptVersion: "competition-field-repair-v1", maxTokens: 6000, temperature: 0,
    system: extractionPrompt + "\n本次只返回outputSchema中的失败字段，不返回其他字段。quote必须逐字复制对应block；不得把链接标题、URL或改写后的文字当正文quote。若找不到连续原文，将该字段标为unknown，evidence为空，并说明原因。",
    user: JSON.stringify({ catalogue: entry, approvedCategories, validationErrors: report.errors,
      previousFailedFields: Object.fromEntries(fields.map(field => [field, previous[field]])),
      materials: materials.map(({ fetchedAt: _fetchedAt, ...material }) => material), outputSchema: z.toJSONSchema(schema) }),
    schema, timeoutMs: 120000,
  });
  return { ...result, data: mergeFieldRepair(previous, fields, result.data) };
}
