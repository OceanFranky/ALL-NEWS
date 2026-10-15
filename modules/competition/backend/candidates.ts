import { sql, type Db } from "@aihot/backend/db";
import { isDeepStrictEqual } from "node:util";
import { extractedSchema, validateExtraction, catalogueEntrySchema, type Material } from "./schema.ts";
import { competitionCategories } from "./taxonomy.ts";
import type { CompetitionQuery } from "./query.ts";

export async function candidateList(query: CompetitionQuery) {
  const rows = await sql`SELECT c.id, c.name, c.recognition, r.id AS revision_id, r.status, r.year, r.validation, r.created_at,
    (SELECT edition_id FROM competition_edition_revisions WHERE competition_id=c.id AND revision_id=r.id) AS edition_id
    FROM competition_catalogue c LEFT JOIN LATERAL (
      SELECT * FROM competition_revisions WHERE competition_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) r ON true
    WHERE position(lower(${query.q}) in lower(c.name || ' ' || coalesce(r.name,''))) > 0
    ORDER BY c.id`;
  return { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize };
}

export async function candidateDetail(competitionId: string, revisionId?: string, db: Db = sql) {
  const [catalogue] = await db`SELECT id,name,recognition FROM competition_catalogue WHERE id=${competitionId}`;
  if (!catalogue) return null;
  const [revision] = await db`SELECT r.*, er.edition_id FROM competition_revisions r
    LEFT JOIN competition_edition_revisions er ON er.competition_id=r.competition_id AND er.revision_id=r.id
    WHERE r.competition_id=${competitionId} AND (${revisionId ?? null}::text IS NULL OR r.id=${revisionId ?? null})
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1`;
  if (!revision) return revisionId ? null : { catalogue, revision: null, materials: [], sources: [], revisions: [], displays: [] };
  const materials = await db`SELECT id,url,content_hash,fetched_at,content FROM competition_materials
    WHERE competition_id=${competitionId} AND id = ANY(${db.array(revision.material_ids as string[])}::text[])`;
  const sources = await db`SELECT url,status,evidence,checked_at FROM competition_sources WHERE competition_id=${competitionId} ORDER BY url`;
  const revisions = await db`SELECT r.id,r.status,r.year,r.name,r.validation,r.created_at,er.edition_id
    FROM competition_revisions r LEFT JOIN competition_edition_revisions er ON er.competition_id=r.competition_id AND er.revision_id=r.id
    WHERE r.competition_id=${competitionId} ORDER BY r.created_at DESC,r.id DESC`;
  const displays = await db`SELECT edition_id,revision_id,version,published_at FROM competition_displays WHERE competition_id=${competitionId} ORDER BY edition_id`;
  return { catalogue, revision, materials, sources, revisions, displays };
}

export async function verifiedCandidate(competitionId: string, revisionId: string, db: Db = sql) {
  const candidate = await candidateDetail(competitionId, revisionId, db);
  if (!candidate?.revision) throw Object.assign(new Error("Candidate not found"), { statusCode: 400 });
  const data = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, candidate.revision!.data[key]])));
  const materials = candidate.materials.map(material => material.content as Material);
  const validation = validateExtraction(data, materials, [...competitionCategories]);
  const entry = catalogueEntrySchema.parse({ id: competitionId, name: candidate.catalogue.name, ...candidate.catalogue.recognition });
  const recognition = candidate.revision.data;
  if (!validation.valid || data.name.status !== "known" || candidate.revision.status === "rejected") {
    throw Object.assign(new Error("Candidate failed publication validation"), { statusCode: 400 });
  }
  if (recognition.schoolLevel !== entry.schoolLevel || !isDeepStrictEqual(recognition.schoolLevelByScope, entry.schoolLevelByScope)
    || (recognition.schoolRecognitionText ?? null) !== (entry.schoolRecognitionText ?? null)) {
    throw Object.assign(new Error("Candidate school recognition differs from catalogue"), { statusCode: 400 });
  }
  return { ...candidate, data, validation };
}
