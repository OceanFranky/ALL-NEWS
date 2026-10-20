import { z } from "zod";
import { resourceDataSchema, resourceLinkSchema } from "@aihot/contracts/learning-resources";
import { sql } from "@aihot/backend/db";
import { getResource, reviewResource, saveResource } from "./repository.ts";

export const resourceManifestSchema = z.object({
  version: z.literal(1),
  checkedAt: z.iso.date(),
  resources: z.array(z.object({
    key: z.string().min(1).max(100),
    decision: z.enum(["publish", "draft"]),
    data: resourceDataSchema,
    links: z.array(resourceLinkSchema).min(1),
    evidence: z.array(z.object({
      url: z.url(), checkedAt: z.iso.date(),
      method: z.enum(["article", "video_page", "official_listing", "search_only"]),
      note: z.string().min(1).max(2000),
    }).strict()).min(1),
  }).strict()).min(1),
  gaps: z.array(z.object({ competitionId: z.string().regex(/^competition-\d{3}$/), note: z.string().min(1) }).strict()),
}).strict().superRefine((manifest, ctx) => {
  for (const field of ["key", "url"] as const) {
    const values = manifest.resources.map(item => field === "key" ? item.key : item.data.url);
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: `清单存在重复${field}` });
  }
  for (const [index, item] of manifest.resources.entries()) {
    if (item.decision === "publish" && (item.data.verification !== "verified" || item.data.availability === "invalid" || item.evidence.every(e => e.method === "search_only"))) {
      ctx.addIssue({ code: "custom", path: ["resources", index], message: "候选或失效资源不能预设发布" });
    }
  }
});
export type ResourceManifest = z.infer<typeof resourceManifestSchema>;

// Import through the same versioned writes and review rules as the administrator UI.
// Existing URLs, including withdrawn records, are never overwritten or republished.
export async function importResourceManifest(raw: unknown, options: { apply?: boolean; publish?: boolean; actor: string }) {
  const manifest = resourceManifestSchema.parse(raw);
  const targets = new Set(manifest.resources.flatMap(item => item.links.map(link => link.competitionId)));
  const catalogue = await sql`SELECT id FROM competition_catalogue WHERE id IN ${sql([...targets])}`;
  const known = new Set(catalogue.map(row => row.id));
  if ([...targets].some(id => !known.has(id))) throw new Error("清单关联的竞赛尚未导入，请先导入31项名录");
  const result: { key: string; id: string | null; action: "exists" | "would_publish" | "would_draft" | "published" | "draft" }[] = [];
  for (const item of manifest.resources) {
    const [existing] = await sql`SELECT id FROM learning_resources WHERE url=${item.data.url}`;
    if (existing) {
      const resource = (await getResource(existing.id))!;
      result.push({ key: item.key, id: resource.id, action: "exists" });
      continue;
    }
    const publish = options.publish === true && item.decision === "publish";
    if (!options.apply) {
      result.push({ key: item.key, id: null, action: publish ? "would_publish" : "would_draft" });
      continue;
    }
    const reason = `精选清单 ${manifest.checkedAt} / ${item.key}`;
    let resource = (await saveResource(null, { expectedVersion: 0, reason, data: item.data, links: item.links }, options.actor))!;
    if (publish) resource = (await reviewResource(resource.id, { expectedVersion: resource.version, action: "publish", reason }, options.actor))!;
    result.push({ key: item.key, id: resource.id, action: publish ? "published" : "draft" });
  }
  return { checkedAt: manifest.checkedAt, applied: options.apply === true, items: result };
}
