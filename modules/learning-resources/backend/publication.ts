import { resourceDataSchema, type CompetitionResources, type PublicResource, type ResourceCoverage, type ResourceLink } from "@aihot/contracts/learning-resources";
import { sql } from "@aihot/backend/db";
import { z } from "zod";
const targetSchema = z.object({ competitionId: z.string().regex(/^competition-\d{3}$/), editionId: z.uuid() }).strict();

export async function competitionResources(raw: unknown): Promise<CompetitionResources | null> {
  const { competitionId, editionId } = targetSchema.parse(raw);
  const [edition] = await sql`SELECT r.year FROM competition_displays d JOIN competition_revisions r ON r.id=d.revision_id AND r.competition_id=d.competition_id
    WHERE d.competition_id=${competitionId} AND d.edition_id=${editionId} AND r.status<>'rejected' AND r.validation->>'valid'='true'`;
  if (!edition) return null;
  const rows = await sql`SELECT r.id,r.data,jsonb_agg(jsonb_build_object('competitionId',l.competition_id,'editionId',l.edition_id,'year',l.year,'scope',l.scope) ORDER BY l.position) AS links
    FROM learning_resources r JOIN learning_resource_links l ON l.resource_id=r.id
    WHERE r.status='published' AND r.data->>'verification'='verified' AND r.data->>'availability'<>'invalid'
      AND l.competition_id=${competitionId} AND (l.edition_id IS NULL OR l.edition_id=${editionId}) AND (l.year IS NULL OR l.year=${edition.year ?? null})
    GROUP BY r.id ORDER BY (r.data->>'official')::boolean DESC,coalesce(r.data->>'publishedDate',r.data->>'publishedYear') DESC NULLS LAST,r.data->>'title',r.id`;
  const items: PublicResource[] = rows.map(row => {
    const { coverPermission: _permission, availabilityReason: _reason, ...data } = resourceDataSchema.parse(row.data);
    // Internal verification notes and link reasons stay in the administrator view.
    return { id: row.id, data: { ...data, availabilityMessage: data.availability === "temporarily_unreachable" ? "暂时无法访问，稍后重试" : "" }, links: row.links as Omit<ResourceLink, "reason">[] };
  });
  return { experience: items.filter(item => item.data.kind === "experience"), video: items.filter(item => item.data.kind === "video") };
}
export async function resourceCoverage(): Promise<ResourceCoverage[]> {
  const rows = await sql`SELECT c.id,c.name,
    count(DISTINCT r.id) FILTER (WHERE r.data->>'kind'='experience')::int AS experience,
    count(DISTINCT r.id) FILTER (WHERE r.data->>'kind'='video')::int AS video
    FROM competition_catalogue c LEFT JOIN learning_resource_links l ON l.competition_id=c.id
    LEFT JOIN learning_resources r ON r.id=l.resource_id AND r.status='published' AND r.data->>'verification'='verified' AND r.data->>'availability'<>'invalid'
    GROUP BY c.id,c.name ORDER BY c.id`;
  return rows.map(row => ({ competitionId: row.id, name: row.name, experience: row.experience, video: row.video,
    reason: !row.experience && !row.video ? "经验帖与教学视频均待补充" : !row.experience ? "经验帖待补充" : !row.video ? "教学视频待补充" : "按已发布关联统计，具体届次适用范围另核对" }));
}
