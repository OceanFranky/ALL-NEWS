import type { CompetitionDetail, CompetitionField, CompetitionFilters, CompetitionList, CompetitionRecord } from "@aihot/contracts/competitions";
import { sql } from "@aihot/backend/db";
import { competitionActivity, timeBoundary } from "./activity.ts";
import { activities, competitionQuerySchema, type CompetitionQuery } from "./query.ts";
import { extractedSchema, type Extracted } from "./schema.ts";
import { competitionCategories } from "./taxonomy.ts";

const explanations = { known: "", unknown: "资料不足，待核验", not_stated: "已查材料未说明", not_applicable: "不适用", pending: "官方安排待公布", conflict: "材料存在冲突，待核验" };
function field<T>(input: { value: T | null; status: keyof typeof explanations }): CompetitionField<T> {
  return { value: input.status === "known" ? input.value : null, status: input.status, reason: explanations[input.status] };
}

export async function publishedCompetitions(now: Date): Promise<CompetitionRecord[]> {
  const rows = await sql`SELECT d.competition_id,d.edition_id,d.revision_id,d.version,d.published_at,c.name AS catalogue_name,r.data,
    coalesce((SELECT jsonb_agg(jsonb_build_object('url',m.url,'fetchedAt',m.fetched_at) ORDER BY m.url,m.id)
      FROM competition_materials m WHERE m.competition_id=r.competition_id AND r.material_ids @> jsonb_build_array(m.id)), '[]'::jsonb) AS sources
    FROM competition_displays d JOIN competition_catalogue c ON c.id=d.competition_id
    JOIN competition_revisions r ON r.competition_id=d.competition_id AND r.id=d.revision_id
    WHERE r.status <> 'rejected' AND r.validation->>'valid'='true'
    ORDER BY d.competition_id,d.edition_id`;
  return rows.map(row => {
    const data: Extracted = extractedSchema.parse(Object.fromEntries(Object.keys(extractedSchema.shape).map(key => [key, row.data[key]])));
    return {
      competitionId: row.competition_id, catalogueName: row.catalogue_name, editionId: row.edition_id, revisionId: row.revision_id,
      version: row.version, publishedAt: new Date(row.published_at).toISOString(),
      name: field(data.name), year: field(data.year), promotionImage: field(data.promotionImage), categories: field(data.categories),
      schoolRecognition: { schoolLevel: row.data.schoolLevel ?? null, schoolLevelByScope: row.data.schoolLevelByScope ?? [], schoolRecognitionText: row.data.schoolRecognitionText ?? null },
      participantLimit: field(data.participantLimit), teacherLimit: field(data.teacherLimit), registrationTimes: field(data.registrationTimes), competitionTimes: field(data.competitionTimes),
      stages: field(data.stages), officialWebsite: field(data.officialWebsite), files: field(data.files), introduction: field(data.introduction),
      ...competitionActivity(data, now), sources: row.sources.map((source: { url: string; fetchedAt: string }) => ({ url: source.url, fetchedAt: new Date(source.fetchedAt).toISOString() })),
    };
  });
}

function nextInstant(record: CompetitionRecord): number {
  const node = record.nextNodes[0];
  return node ? timeBoundary({ ...node, start: node.date, end: node.date }, node.date, node.kind.endsWith("_end")) ?? Infinity : Infinity;
}

export function filterPublished(records: CompetitionRecord[], query: CompetitionQuery): CompetitionRecord[] {
  const keyword = query.q.toLocaleLowerCase();
  return records.filter(record => {
    const levels = [record.schoolRecognition.schoolLevel, ...record.schoolRecognition.schoolLevelByScope.map(entry => entry.level)];
    return (!keyword || `${record.catalogueName} ${record.name.value ?? ""}`.toLocaleLowerCase().includes(keyword))
      && (!query.category || query.category.some(category => record.categories.value?.includes(category)))
      && (!query.schoolLevel || query.schoolLevel.some(level => levels.includes(level)))
      && (query.year === undefined || (query.year === "unknown" ? record.year.value === null : record.year.value?.primary === query.year))
      && (!query.activity || query.activity.some(status => record.activity.some(entry => entry.status === status)));
  }).sort((left, right) => {
    if (query.sort === "year_desc") {
      const difference = (right.year.value?.primary ?? 0) - (left.year.value?.primary ?? 0);
      if (difference) return difference;
    }
    if (query.sort === "next_node") {
      const difference = nextInstant(left) - nextInstant(right);
      if (difference && Number.isFinite(difference)) return difference;
      if (nextInstant(left) !== nextInstant(right)) return nextInstant(left) < nextInstant(right) ? -1 : 1;
    }
    return left.competitionId.localeCompare(right.competitionId) || left.editionId.localeCompare(right.editionId);
  });
}

export function publicFilters(records: CompetitionRecord[]): CompetitionFilters {
  return { categories: [...competitionCategories],
    schoolLevels: [...new Set(records.flatMap(record => [record.schoolRecognition.schoolLevel, ...record.schoolRecognition.schoolLevelByScope.map(entry => entry.level)]).filter((level): level is string => level !== null))].sort(),
    years: [...new Set(records.flatMap(record => record.year.value ? [record.year.value.primary] : []))].sort((left, right) => right - left),
    hasUnknownYear: records.some(record => record.year.value === null), activities: [...activities], sorts: ["catalogue", "year_desc", "next_node"] };
}

export async function readCompetitionPublication(input: unknown) {
  const query = competitionQuerySchema.parse(input);
  const now = new Date();
  const records = await publishedCompetitions(now);
  const options = publicFilters(records);
  if (query.schoolLevel?.some(level => !options.schoolLevels.includes(level))) throw Object.assign(new Error("Unknown school level"), { statusCode: 400 });
  const matches = filterPublished(records, query);
  return { items: matches.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: matches.length, page: query.page, pageSize: query.pageSize, computedAt: now.toISOString() } satisfies CompetitionList;
}

export async function readCompetitionDetail(input: unknown): Promise<CompetitionDetail | null> {
  const { competitionId, editionId } = input as { competitionId: string; editionId: string };
  const now = new Date();
  const records = (await publishedCompetitions(now)).filter(record => record.competitionId === competitionId);
  const item = records.find(record => record.editionId === editionId);
  return item ? { item, editions: records.map(record => ({ editionId: record.editionId, name: record.name.value, year: record.year.value?.primary ?? null })), computedAt: now.toISOString() } : null;
}

export async function readCompetitionFilters(): Promise<CompetitionFilters> {
  return publicFilters(await publishedCompetitions(new Date()));
}
