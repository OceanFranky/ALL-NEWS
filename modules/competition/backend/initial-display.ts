import { sql } from "@aihot/backend/db";
import { Conflict } from "@aihot/backend/audit";
import { verifiedCandidate } from "./candidates.ts";
import { createEdition, selectDisplay } from "./display.ts";

export async function initialDisplay(entries: Array<{ id: string; revisionId: string }>, actor: string, apply: boolean) {
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("Duplicate initial competition identity");
  return sql.begin(async tx => {
    const plan = [];
    for (const entry of [...entries].sort((left, right) => left.id.localeCompare(right.id))) {
      await tx`SELECT id FROM competition_catalogue WHERE id=${entry.id} FOR UPDATE`;
      const [latest] = await tx`SELECT id FROM competition_revisions WHERE competition_id=${entry.id} ORDER BY created_at DESC,id DESC LIMIT 1`;
      if (latest?.id !== entry.revisionId) throw new Conflict(`Latest revision differs from accepted initial snapshot: ${entry.id}`);
      const candidate = await verifiedCandidate(entry.id, entry.revisionId, tx);
      const [display] = await tx`SELECT d.edition_id,d.revision_id,d.version FROM competition_edition_revisions er
        JOIN competition_displays d ON d.competition_id=er.competition_id AND d.edition_id=er.edition_id
        WHERE er.competition_id=${entry.id} AND er.revision_id=${entry.revisionId}`;
      if (display && display.version > 0) {
        plan.push({ competitionId: entry.id, revisionId: entry.revisionId, editionId: display.edition_id, action: "unchanged" });
        continue;
      }
      const reason = "使用者授权现有31项校验通过候选首次展示；缺失字段保留，后续更新另行选择";
      const editionId = apply ? await createEdition(entry.id, entry.revisionId, actor, reason, tx) : candidate.revision!.edition_id ?? null;
      if (apply) await selectDisplay(entry.id, editionId!, { revisionId: entry.revisionId, expectedVersion: 0, reason }, actor, tx);
      plan.push({ competitionId: entry.id, revisionId: entry.revisionId, editionId, action: apply ? "published" : "planned", missing: candidate.validation.missing });
    }
    return plan;
  });
}
