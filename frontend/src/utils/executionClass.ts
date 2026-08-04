/**
 * Execution-class unification (Spec 2026-08-04-1) — FRONTEND MIRROR.
 *
 * Mirrors `gateway/src/services/migrationExecutionClass.ts` VERBATIM and must
 * stay in sync with it. The gateway module is THE oracle deciding whether a
 * migration book-of-work item is `automated` (dispatched to the
 * implement-verify service as a spec) or `manual` (human work by design — it
 * may appear in the plan, visually distinct, but it NEVER generates a spec and
 * is NEVER dispatched). The tag literals are stable wire constants persisted
 * inside `book_of_work_json` blobs, duplicated here verbatim; the legacy
 * inference keeps already-persisted books classifying correctly without a
 * data migration.
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

/**
 * THE execution-class rule (mirror of the gateway oracle). Manual iff:
 *  - the canonical `execution:manual` tag is present, OR
 *  - (legacy) the code-stream manual-gate tag is present, OR
 *  - (legacy) the item is pack-provenance WITHOUT the verbatim-carriage tag
 *    (review gates, jobs re-homing, structural sign-offs — human procedures;
 *    rewrite-in-app stories are excepted: they are real implementation work), OR
 *  - (legacy) the item is a planner-declared prerequisite gate.
 * Everything else is automated.
 */
export function executionClassForTags(
  tags: string[] | null | undefined,
): ExecutionClass {
  const t = tags ?? [];
  if (t.includes(MANUAL_EXECUTION_TAG)) return 'manual';
  if (t.includes(LEGACY_MANUAL_GATE_TAG)) return 'manual';
  if (
    t.includes(PACK_PROVENANCE_TAG) &&
    !t.includes(SEED_DB_PACK_FILES_TAG) &&
    !t.includes(REWRITE_IN_APP_TAG)
  ) {
    return 'manual';
  }
  if (t.includes(PREREQUISITE_PROVENANCE_TAG)) return 'manual';
  return 'automated';
}

/** Convenience predicate for display/count call sites. */
export function isManualExecutionTags(
  tags: string[] | null | undefined,
): boolean {
  return executionClassForTags(tags) === 'manual';
}
