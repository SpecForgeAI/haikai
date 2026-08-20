/**
 * Planner-provenance line for the book-of-work review header (2026-08-20).
 *
 * Epic expansion uses the SCL corpus planner automatically when a structural
 * scan exists, silently falling back to the legacy planner otherwise — a
 * fallback the screen previously never disclosed. Corpus-derived stories
 * carry the `provenance:scl_corpus` tag (sclSpecCarriage.SCL_CORPUS_STORY_TAG,
 * persisted on the work item), so the plan itself is the source of truth:
 * derive the line from the loaded items, no new wire calls.
 */

/** Mirrors gateway sclSpecCarriage.SCL_CORPUS_STORY_TAG (persisted on items). */
export const SCL_CORPUS_STORY_TAG = 'provenance:scl_corpus';

export interface PlannerProvenanceItem {
  type?: string | null;
  tags?: string[] | null;
}

/**
 * One short header phrase, or null when the plan has no stories yet (nothing
 * honest to claim before expansion).
 */
export function derivePlannerProvenance(
  items: readonly PlannerProvenanceItem[] | null | undefined,
): string | null {
  const stories = (items ?? []).filter((i) => i.type === 'story');
  if (stories.length === 0) return null;
  const corpusCount = stories.filter((s) =>
    (s.tags ?? []).includes(SCL_CORPUS_STORY_TAG),
  ).length;
  if (corpusCount > 0) {
    return `Planner: structural corpus (${corpusCount} corpus ${
      corpusCount === 1 ? 'story' : 'stories'
    })`;
  }
  return 'Planner: legacy (no structural corpus at expansion time)';
}
