import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { verifiedCandidate } from "./candidates.ts";

export async function createEdition(competitionId: string, revisionId: string, actor: string, reason: string, db: Db) {
  await verifiedCandidate(competitionId, revisionId, db);
  const [binding] = await db`SELECT edition_id FROM competition_edition_revisions WHERE competition_id=${competitionId} AND revision_id=${revisionId}`;
  if (binding) return String(binding.edition_id);
  const editionId = randomUUID();
  await db`INSERT INTO competition_editions (competition_id,id) VALUES (${competitionId},${editionId})`;
  await db`INSERT INTO competition_edition_revisions (competition_id,edition_id,revision_id) VALUES (${competitionId},${editionId},${revisionId})`;
  await db`INSERT INTO competition_displays (competition_id,edition_id) VALUES (${competitionId},${editionId})`;
  await audit(actor, "competition.edition.create", `competition:${competitionId}`, reason, null, { editionId, revisionId }, { db });
  return editionId;
}

export async function addEdition(competitionId: string, revisionId: string, actor: string, reason: string) {
  return sql.begin(async tx => {
    await tx`SELECT id FROM competition_catalogue WHERE id=${competitionId} FOR UPDATE`;
    return { editionId: await createEdition(competitionId, revisionId, actor, reason, tx) };
  });
}

export async function selectDisplay(competitionId: string, editionId: string, input: { revisionId: string | null; expectedVersion: number; reason: string }, actor: string, db?: Db) {
  const execute = async (tx: Db) => {
    await tx`SELECT id FROM competition_catalogue WHERE id=${competitionId} FOR UPDATE`;
    const [before] = await tx`SELECT revision_id,version,published_at FROM competition_displays WHERE competition_id=${competitionId} AND edition_id=${editionId} FOR UPDATE`;
    if (!before) return null;
    if (before.version !== input.expectedVersion) throw new Conflict("Display version changed; reload before selecting a revision");
    if (input.revisionId !== null) {
      const candidate = await verifiedCandidate(competitionId, input.revisionId, tx);
      if (candidate.revision!.edition_id && candidate.revision!.edition_id !== editionId) throw new Conflict("Revision belongs to a different edition");
      const [current] = await tx`SELECT r.year FROM competition_edition_revisions er JOIN competition_revisions r
        ON r.competition_id=er.competition_id AND r.id=er.revision_id
        WHERE er.competition_id=${competitionId} AND er.edition_id=${editionId} ORDER BY r.created_at,r.id LIMIT 1`;
      if (current?.year !== null && candidate.data.year.value && current?.year !== candidate.data.year.value.primary) {
        throw new Conflict("Different competition year; create a separate edition");
      }
      await tx`INSERT INTO competition_edition_revisions (competition_id,edition_id,revision_id)
        VALUES (${competitionId},${editionId},${input.revisionId}) ON CONFLICT (competition_id,revision_id) DO NOTHING`;
    }
    const [after] = await tx`UPDATE competition_displays SET revision_id=${input.revisionId}, version=version+1,
      published_at=${input.revisionId === null ? null : new Date()}
      WHERE competition_id=${competitionId} AND edition_id=${editionId} RETURNING edition_id,revision_id,version,published_at`;
    await audit(actor, input.revisionId === null ? "competition.display.withdraw" : "competition.display.select", `competition:${competitionId}`, input.reason, before, after, { db: tx });
    return after;
  };
  return db ? execute(db) : sql.begin(execute);
}
