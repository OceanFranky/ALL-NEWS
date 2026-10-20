import { randomUUID } from "node:crypto";
import type { ManagedResource, ResourceDetail, ResourceList, ResourceReview, ResourceTarget, ResourceWrite } from "@aihot/contracts/learning-resources";
import { resourceWriteSchema, resourceReviewSchema } from "@aihot/contracts/learning-resources";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";

export async function getResource(id: string, db: Db = sql): Promise<ManagedResource | null> {
  const [row] = await db`SELECT id,data,status,version,updated_at FROM learning_resources WHERE id=${id}`;
  if (!row) return null;
  const links = await db`SELECT competition_id AS "competitionId",edition_id AS "editionId",year,scope,reason FROM learning_resource_links WHERE resource_id=${id} ORDER BY position`;
  return { id: row.id, data: row.data, status: row.status, version: row.version, updatedAt: new Date(row.updated_at).toISOString(), links: links as unknown as ManagedResource["links"] };
}
export async function resourceDetail(id: string): Promise<ResourceDetail | null> {
  const resource = await getResource(id);
  if (!resource) return null;
  const history = await sql`SELECT version,actor,reason,snapshot,created_at FROM learning_resource_history WHERE resource_id=${id} ORDER BY version DESC LIMIT 100`;
  return { resource, history: history.map(row => ({ version: row.version, actor: row.actor, reason: row.reason, snapshot: row.snapshot, createdAt: new Date(row.created_at).toISOString() })) };
}
export async function listResources(q: string, page: number): Promise<ResourceList> {
  const [rows, counts] = await Promise.all([
    sql`SELECT id FROM learning_resources WHERE ${q}='' OR strpos(lower(data->>'title'),lower(${q}))>0 OR strpos(lower(url),lower(${q}))>0 ORDER BY updated_at DESC,id LIMIT 30 OFFSET ${(page - 1) * 30}`,
    sql`SELECT count(*)::int AS total FROM learning_resources WHERE ${q}='' OR strpos(lower(data->>'title'),lower(${q}))>0 OR strpos(lower(url),lower(${q}))>0`,
  ]);
  return { page, total: counts[0].total, items: await Promise.all(rows.map(row => getResource(row.id).then(value => value!))) };
}
async function record(id: string, actor: string, reason: string, before: ManagedResource | null, action: string, db: Db) {
  const after = (await getResource(id, db))!;
  await db`INSERT INTO learning_resource_history (resource_id,version,actor,reason,snapshot) VALUES (${id},${after.version},${actor},${reason},${db.json(after as never)})`;
  await audit(actor, `resource.${action}`, `resource:${id}`, reason, before, after, { db });
  return after;
}
export async function saveResource(id: string | null, raw: ResourceWrite, actor: string): Promise<ManagedResource | null> {
  const input = resourceWriteSchema.parse(raw);
  try {
    return await sql.begin(async tx => {
      const resourceId = id ?? randomUUID();
      if (id) await tx`SELECT id FROM learning_resources WHERE id=${id} FOR UPDATE`;
      const before = id ? await getResource(id, tx) : null;
      if (id && !before) return null;
      if ((before?.version ?? 0) !== input.expectedVersion) throw new Conflict("资源版本已变化，请刷新后重新保存");
      for (const link of input.links) {
        const [competition] = await tx`SELECT id FROM competition_catalogue WHERE id=${link.competitionId} FOR KEY SHARE`;
        if (!competition) throw new Conflict("关联竞赛不存在");
        if (link.editionId) {
          const [edition] = await tx`SELECT id FROM competition_editions WHERE competition_id=${link.competitionId} AND id=${link.editionId} FOR KEY SHARE`;
          if (!edition) throw new Conflict("届次不属于该竞赛");
          const years = await tx`SELECT DISTINCT r.year FROM competition_edition_revisions e JOIN competition_revisions r ON r.competition_id=e.competition_id AND r.id=e.revision_id WHERE e.competition_id=${link.competitionId} AND e.edition_id=${link.editionId} AND r.year IS NOT NULL`;
          if (link.year !== null && years.some(row => row.year !== link.year)) throw new Conflict("适用年份与竞赛届次不一致");
        }
      }
      if (before) {
        await tx`UPDATE learning_resources SET url=${input.data.url},data=${tx.json(input.data)},status='draft',version=version+1,updated_at=now() WHERE id=${resourceId}`;
        await tx`DELETE FROM learning_resource_links WHERE resource_id=${resourceId}`;
      } else {
        await tx`INSERT INTO learning_resources (id,url,data) VALUES (${resourceId},${input.data.url},${tx.json(input.data)})`;
      }
      for (const [position, link] of input.links.entries()) await tx`INSERT INTO learning_resource_links (resource_id,position,competition_id,edition_id,year,scope,reason)
        VALUES (${resourceId},${position},${link.competitionId},${link.editionId},${link.year},${link.scope},${link.reason})`;
      return record(resourceId, actor, input.reason, before, "save", tx);
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Conflict("此原文链接已收录，请编辑已有资源");
    throw error;
  }
}
export async function reviewResource(id: string, raw: ResourceReview, actor: string): Promise<ManagedResource | null> {
  const input = resourceReviewSchema.parse(raw);
  return sql.begin(async tx => {
    await tx`SELECT id FROM learning_resources WHERE id=${id} FOR UPDATE`;
    const before = await getResource(id, tx);
    if (!before) return null;
    if (before.version !== input.expectedVersion) throw new Conflict("资源版本已变化，请刷新后重新审核");
    if (input.action === "publish" && (before.data.verification !== "verified" || before.data.availability === "invalid" || !before.links.length)) throw new Conflict("发布前须完成核验、关联竞赛，并确认资源未失效");
    await tx`UPDATE learning_resources SET status=${input.action === "publish" ? "published" : "withdrawn"},version=version+1,updated_at=now() WHERE id=${id}`;
    return record(id, actor, input.reason, before, input.action, tx);
  });
}
export async function resourceTargets(): Promise<ResourceTarget[]> {
  const rows = await sql`SELECT c.id,c.name,coalesce(jsonb_agg(jsonb_build_object('id',e.id,'year',r.year) ORDER BY e.id) FILTER (WHERE e.id IS NOT NULL),'[]'::jsonb) AS editions
    FROM competition_catalogue c LEFT JOIN competition_editions e ON e.competition_id=c.id
    LEFT JOIN competition_displays d ON d.competition_id=e.competition_id AND d.edition_id=e.id
    LEFT JOIN competition_revisions r ON r.competition_id=d.competition_id AND r.id=d.revision_id
    GROUP BY c.id,c.name ORDER BY c.id`;
  return rows.map(row => ({ competitionId: row.id, name: row.name, editions: row.editions }));
}
