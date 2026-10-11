// Sections are content domains, not article channels or a mutable process-wide mode.
export const SECTION_IDS = ["ai", "world"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export function isSectionId(value: unknown): value is SectionId {
  return value === "ai" || value === "world";
}

/** An omitted legacy request is handled by its caller, never by this validator. */
export function requireSectionId(value: unknown): SectionId {
  if (!isSectionId(value)) throw new Error("invalid content section: expected ai or world");
  return value;
}

export function assertSameSection(expected: SectionId, actual: unknown): void {
  requireSectionId(expected);
  if (requireSectionId(actual) !== expected) throw new Error("content section mismatch");
}
