/**
 * Execution-class unification (Spec 2026-08-04-1).
 *
 * ONE first-class distinction for every book-of-work item: `automated` work is
 * dispatched to the implement-verify service as a spec; `manual` work is human
 * work by design — it may appear in the migration plan (visually distinct) but
 * it NEVER generates a spec and is NEVER dispatched from the Start Stage
 * buttons. Before this spec the distinction lived in three divergent
 * mechanisms, only the first of which was enforced:
 *
 *   1. `execution:manual-gate` (code-stream capture/closure) — enforced by the
 *      driver's spec gate + dispatch-set builder.
 *   2. db-pack review stories (pack-provenance without the verbatim-carriage
 *      tag) — "never dispatched" was a doc comment; they received
 *      deterministic `generated` specs and WERE dispatchable.
 *   3. `provenance:prerequisite` stories — run-blocking `insufficient_context`
 *      spec rows.
 *
 * This module is a dependency-free LEAF: the tag literals are stable wire
 * constants (persisted inside `book_of_work_json` blobs), duplicated here
 * verbatim rather than imported so the planners can import THIS module without
 * cycles. The legacy inference keeps already-persisted books classifying
 * correctly without a data migration.
 */

export type ExecutionClass = 'automated' | 'manual';

/**
 * Canonical manual marker (Spec 2026-08-04-1). Planners stamp this on every
 * human work item they emit; the legacy tags below remain as provenance.
 */
export const MANUAL_EXECUTION_TAG = 'execution:manual';

/** Legacy code-stream manual marker (Spec 2026-07-06-g). */
const LEGACY_MANUAL_GATE_TAG = 'execution:manual-gate';
/** DB-pack provenance tag (every deterministically pack-derived item). */
const PACK_PROVENANCE_TAG = 'provenance:pack';
/** DB-pack verbatim file-carriage marker — the pack stories that ARE IVS work. */
const SEED_DB_PACK_FILES_TAG = 'seed_db_pack_files';
/** Planner-declared prerequisite gate marker. */
const PREREQUISITE_PROVENANCE_TAG = 'provenance:prerequisite';
/**
 * Rewrite-in-app translation stories: pack-provenance WITHOUT verbatim files,
 * yet genuinely automated — the object's logic is reimplemented in the target
 * service tier. The pack-without-carriage inference must not catch them.
 */
const REWRITE_IN_APP_TAG = 'rewrite_in_app';

/** The minimal item slice the classifier reads. */
export interface ExecutionClassifiable {
  tags?: string[] | null;
}

/**
 * THE execution-class oracle. Manual iff:
 *  - the canonical `execution:manual` tag is present, OR
 *  - (legacy) the code-stream manual-gate tag is present, OR
 *  - (legacy) the item is pack-provenance WITHOUT the verbatim-carriage tag
 *    (review gates, jobs re-homing, structural sign-offs — human procedures;
 *    rewrite-in-app stories are excepted: they are real implementation work), OR
 *  - (legacy) the item is a planner-declared prerequisite gate.
 * Everything else is automated.
 */
export function executionClassForItem(item: ExecutionClassifiable): ExecutionClass {
  const tags = item.tags ?? [];
  if (tags.includes(MANUAL_EXECUTION_TAG)) return 'manual';
  if (tags.includes(LEGACY_MANUAL_GATE_TAG)) return 'manual';
  if (
    tags.includes(PACK_PROVENANCE_TAG) &&
    !tags.includes(SEED_DB_PACK_FILES_TAG) &&
    !tags.includes(REWRITE_IN_APP_TAG)
  ) {
    return 'manual';
  }
  if (tags.includes(PREREQUISITE_PROVENANCE_TAG)) return 'manual';
  return 'automated';
}

/** Convenience predicate for the enforcement choke points. */
export function isManualExecutionItem(item: ExecutionClassifiable): boolean {
  return executionClassForItem(item) === 'manual';
}

/**
 * Manual work that carries a RUNBOOK (2026-08-30).
 *
 * A narrow subset of `manual`: the code-stream capture/closure gates tagged
 * `execution:manual-gate`. These have a concrete, writable procedure --
 * "open the capture wizard, capture these N endpoints, promote to baseline" --
 * which `buildManualGateSpecText` (migrationCodeSpecCarriage) already renders.
 * Persisting that procedure puts the runbook WITH the story instead of only
 * in a cutover doc.
 *
 * <p>This does NOT weaken the manual rule: `manual` still means never
 * dispatched — the execution driver's skip is TAG-based
 * (`migrationExecutionDriver` -> {@link isManualExecutionItem}), not
 * spec-row-based, so a persisted procedure row cannot make these
 * dispatchable. The original ruling's concern was dispatchability plus
 * "hollow 'this is human work' text"; a numbered procedure with a gate
 * condition is neither.</p>
 *
 * <p>Deliberately excludes the OTHER manual shapes — pack review gates
 * (`provenance:pack` without verbatim carriage) and prerequisite gates —
 * whose story record (description + acceptanceCriteria +
 * traceabilitySummary) is already the whole specification and for which no
 * procedure text exists.</p>
 */
export function isManualGateRunbookItem(item: ExecutionClassifiable): boolean {
  return (item.tags ?? []).includes(LEGACY_MANUAL_GATE_TAG);
}

/**
 * The honest `recommendedNextAction` for an item, by execution class.
 *
 * Manual items previously inherited the automated default
 * ("Generate the focused shape-spec for this story."), which instructs the
 * operator to do something {@link isManualExecutionItem} forbids — the plan
 * told you to press a button that would never produce anything. Manual-gate
 * items get their procedure persisted, so they point at the procedure; other
 * manual items point at their own acceptance criteria, which ARE their spec.
 */
export function recommendedNextActionForItem(item: ExecutionClassifiable): string {
  if (isManualGateRunbookItem(item)) {
    return 'Work the persisted manual-gate procedure; complete when its gate condition holds.';
  }
  if (isManualExecutionItem(item)) {
    return 'Manual work item — no spec is generated. Complete the task and satisfy its acceptance criteria.';
  }
  return 'Generate the focused shape-spec for this story.';
}
