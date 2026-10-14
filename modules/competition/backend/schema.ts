import { z } from "zod";

export const catalogueEntrySchema = z.object({
  id: z.string().regex(/^competition-\d{3}$/),
  name: z.string().min(1),
  schoolLevel: z.string().nullable(),
  schoolLevelByScope: z.array(z.object({ scope: z.string(), level: z.string() }).strict()),
  schoolRecognitionText: z.string().nullable().optional(),
}).strict();

export const evidenceSchema = z.object({
  materialId: z.string().min(1),
  blockId: z.string().min(1),
  quote: z.string().min(1).max(1000),
}).strict();

const statuses = z.enum(["known", "unknown", "not_stated", "not_applicable", "pending", "conflict"]);
function field<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullable(),
    status: statuses,
    reason: z.string(),
    evidence: z.array(evidenceSchema),
  }).strict().superRefine((f, ctx) => {
    const value = (f as unknown as { value: unknown }).value;
    if (f.status === "known" && (value === null || f.evidence.length === 0)) {
      ctx.addIssue({ code: "custom", message: "Known fields require a value and source evidence" });
    }
    if (f.status !== "known" && !f.reason.trim()) {
      ctx.addIssue({ code: "custom", message: "Missing fields require an explicit reason" });
    }
    if (["unknown", "not_stated", "not_applicable", "pending", "conflict"].includes(f.status) && value !== null) {
      ctx.addIssue({ code: "custom", message: "Unverified fields cannot carry a verified value" });
    }
    if (["not_stated", "not_applicable", "pending"].includes(f.status) && !f.evidence.length) {
      ctx.addIssue({ code: "custom", message: "Claimed missingness requires official evidence" });
    }
  });
}

const limit = z.object({
  scope: z.string().min(1),
  text: z.string().min(1),
  minimum: z.number().int().nonnegative().nullable(),
  maximum: z.number().int().nonnegative().nullable(),
  counts: z.enum(["students", "teachers", "total_including_teacher", "teacher_group", "other"]),
}).strict().refine(v => v.minimum === null || v.maximum === null || v.minimum <= v.maximum, "Invalid count range");

const time = z.object({
  scope: z.string().min(1),
  label: z.string().min(1),
  officialText: z.string().min(1),
  precision: z.enum(["minute", "day", "month", "approximate"]),
  timezone: z.string().min(1),
  start: z.string().nullable(),
  end: z.string().nullable(),
}).strict();

// The model cannot set school recognition; it is merged from the user's catalogue after extraction.
export const extractedSchema = z.object({
  name: field(z.string().min(1)),
  year: field(z.object({ primary: z.number().int().min(2000).max(2200), officialText: z.string().min(1) }).strict()),
  promotionImage: field(z.string().url()),
  categories: field(z.array(z.string().min(1))),
  participantLimit: field(z.array(limit).min(1)),
  teacherLimit: field(z.array(limit).min(1)),
  registrationTimes: field(z.array(time).min(1)),
  competitionTimes: field(z.array(time).min(1)),
  stages: field(z.array(z.string().min(1)).min(1)),
  officialWebsite: field(z.string().url()),
  files: field(z.array(z.object({ title: z.string().min(1), url: z.string().url() }).strict())),
  introduction: field(z.string().min(1)),
}).strict();

export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;
export type Extracted = z.infer<typeof extractedSchema>;
export interface Material {
  id: string;
  url: string;
  hash: string;
  fetchedAt: string;
  contentType: string;
  blocks: Array<{ id: string; text: string }>;
  links: Array<{ url: string; title: string }>;
  images: string[];
}

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  missing: string[];
  readyForReview: boolean;
}

export function validateExtraction(data: Extracted, materials: Material[], categories: string[]): ValidationReport {
  const errors: string[] = [];
  const missing: string[] = [];
  for (const [name, f] of Object.entries(data)) {
    if (f.status !== "known") missing.push(`${name}:${f.status}`);
    for (const ref of f.evidence) {
      const block = materials.find(m => m.id === ref.materialId)?.blocks.find(b => b.id === ref.blockId);
      if (!block || !block.text.replace(/\s+/g, " ").includes(ref.quote.replace(/\s+/g, " "))) {
        errors.push(`${name}: evidence does not match the collected material`);
      }
    }
  }
  for (const c of data.categories.value ?? []) if (!categories.includes(c)) errors.push(`categories: unapproved tag ${c}`);
  const discovered = new Set(materials.flatMap(m => [m.url, ...m.links.map(l => l.url)]));
  if (data.officialWebsite.value && !discovered.has(data.officialWebsite.value)) errors.push("officialWebsite: URL not collected or linked");
  for (const f of data.files.value ?? []) if (!discovered.has(f.url)) errors.push(`files: undiscovered URL ${f.url}`);
  if (data.promotionImage.value && !materials.some(m => m.images.includes(data.promotionImage.value!))) errors.push("promotionImage: undiscovered image URL");
  for (const f of [data.registrationTimes, data.competitionTimes]) {
    for (const t of f.value ?? []) {
      try { new Intl.DateTimeFormat("en", { timeZone: t.timezone }); } catch { errors.push(`time: invalid timezone ${t.timezone}`); }
      const pattern = t.precision === "month" ? /^\d{4}-\d{2}$/ : t.precision === "day" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
      for (const v of [t.start, t.end]) if (v && (t.precision === "approximate" || !pattern.test(v))) errors.push("time: precision and normalized value disagree");
      if (t.start && t.end && t.start > t.end) errors.push("time: start is after end");
    }
  }
  const readyForReview = errors.length === 0 && data.name.status === "known" && data.year.status === "known"
    && [data.registrationTimes.status, data.competitionTimes.status].every(s => s === "known" || s === "pending");
  return { valid: !errors.length, errors, missing, readyForReview };
}
