import { requireSectionId, assertSameSection, type SectionId } from "@aihot/contracts/sections";
import { sql, type Db } from "../db.ts";

export type SectionResource = { kind: "article" | "source"; id: string } | { kind: "story"; id: number };

/** Check persisted ownership, not just the task's claimed section, before a paid call or mutation. */
export async function assertSectionResource(db: Db, sectionId: SectionId, resource: SectionResource): Promise<void> {
  requireSectionId(sectionId);
  const table = resource.kind === "article" ? "articles" : resource.kind === "source" ? "sources" : resource.kind === "story" ? "stories" : null;
  if (!table || (resource.kind === "story" ? !Number.isSafeInteger(resource.id) || Number(resource.id) <= 0 : typeof resource.id !== "string" || !resource.id)) {
    throw new Error("invalid section resource");
  }
  const [row] = await db<{ section_id: string }[]>`
    SELECT section_id FROM ${sql(table)} WHERE id = ${resource.id} FOR SHARE`;
  if (!row) throw new Error(`section ${sectionId}: resource not found`);
  assertSameSection(sectionId, requireSectionId(row.section_id));
}
