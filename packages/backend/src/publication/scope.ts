// Public scope at read time. Every query that decides whether a report is public now,
// listed, selected, or evidence of its fact uses these predicates over `publications p` (and, for
// evidence, `fact_articles fa`); no other module spells visibility, the release time or the composite
// rule in SQL, and grouping takes the composite rule from here too. What a publication holds is
// derived once, at publish time, by publish.ts and rules.ts.
import { sql } from "../db.ts";
import { requireSectionId, type SectionId } from "@aihot/contracts/sections";

/** Legacy public outlets belong to AI; an explicit invalid section never means all sections. */
export function sectionCondition(sectionId: SectionId = "ai") {
  return sql`p.section_id = ${requireSectionId(sectionId)}`;
}

/**
 * Only confirmed news enters p.selected (publish.ts). The release timestamp also supports
 * historical imports and ensures every outlet uses the same actual publication time.
 */
export function releasedCondition(now: Date) {
  return sql`(NOT p.selected OR p.visible_after <= ${now})`;
}

/** Listed on public surfaces at `now`: public, pool eligible, and released by then. */
export function listedCondition(now: Date, sectionId: SectionId = "ai") {
  return sql`${sectionCondition(sectionId)} AND p.visibility = 'public' AND p.eligible AND ${releasedCondition(now)} AND ${sectionProjectionCondition(sectionId)}`;
}

/** Non-legacy readers recheck the original, latest judgement and permission, even between tasks. */
export function sectionProjectionCondition(sectionId: SectionId) {
  requireSectionId(sectionId);
  if (sectionId === "ai") return sql`true`;
  return sql`EXISTS (SELECT 1 FROM articles current_article JOIN analyses current_analysis
    ON current_analysis.section_id=current_article.section_id AND current_analysis.article_id=current_article.id
      AND current_analysis.input_revision=current_article.revision
    JOIN sources current_source ON current_source.section_id=current_article.section_id AND current_source.id=current_article.source_id
    JOIN section_source_permissions permission ON permission.section_id=current_source.section_id AND permission.source_id=current_source.id
    WHERE current_article.section_id=p.section_id AND current_article.id=p.article_id AND current_analysis.id=p.analysis_id
      AND current_analysis.id=(SELECT max(latest.id) FROM analyses latest WHERE latest.section_id=p.section_id
        AND latest.article_id=p.article_id AND latest.input_revision=current_article.revision)
      AND current_analysis.relevance='pass' AND current_article.grouping_status='complete'
      AND current_source.participation_mode='editorial' AND permission.summary_allowed)`;
}

/** Story reports include older editorial material outside the pool, but never withdrawn or not yet released content. */
export function storyReportCondition(now: Date, sectionId: SectionId = "ai") {
  return sql`${sectionCondition(sectionId)} AND p.visibility = 'public' AND s.participation_mode = 'editorial' AND ${releasedCondition(now)}`;
}

/** Selected set as the website shows it (home timeline, reading groups, topics): every selected report. */
export function selectedCondition(now: Date, sectionId: SectionId = "ai") {
  return sql`${sectionCondition(sectionId)} AND p.visibility = 'public' AND p.selected AND p.visible_after <= ${now}`;
}

/**
 * The selected set as machines receive it (v1, RSS, the sync ledger): one seat per fact, held by its
 * representative (publish.ts settleSeats).
 */
export function seatedCondition(now: Date, sectionId: SectionId = "ai") {
  return sql`${sectionCondition(sectionId)} AND p.visibility = 'public' AND p.selected AND p.seat AND p.visible_after <= ${now}`;
}

/** The report was published from a composite (multi-topic) analysis: it only mentions facts. */
export function compositeCondition() {
  return sql`EXISTS (SELECT 1 FROM analyses evidence_an WHERE evidence_an.id = p.analysis_id AND evidence_an.output->>'scope' = 'composite')`;
}

/**
 * The same rule over the latest analysis of report `article`, for grouping (recall, story roots,
 * consolidation) and for publish.ts when it picks a publication's fact. They decide from the newest
 * analysis, which `p.analysis_id` only points to once the publication is rebuilt from it, and recall
 * also meets reports without a publication. Missing scope is unknown, never composite.
 */
export function latestCompositeCondition(article: ReturnType<typeof sql>) {
  return sql`(SELECT scope_analysis.output->>'scope' = 'composite' FROM analyses scope_analysis
    WHERE scope_analysis.article_id = ${article}
    ORDER BY scope_analysis.input_revision DESC, scope_analysis.id DESC LIMIT 1) IS TRUE`;
}

/** `fa` links report `p` to a fact as evidence: a primary or report membership, never a composite. */
export function evidenceCondition() {
  return sql`fa.role <> 'mention' AND NOT ${compositeCondition()}`;
}

/**
 * Report `p` is still evidence of its own fact (`publications.fact_id`, written at publish time): a
 * membership removed or turned into a mention since then no longer counts.
 */
export function ownFactEvidenceCondition() {
  return sql`EXISTS (SELECT 1 FROM fact_articles fa WHERE fa.fact_id = p.fact_id AND fa.article_id = p.article_id AND ${evidenceCondition()})`;
}
