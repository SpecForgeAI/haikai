/**
 * Deterministic findings-coverage computation.
 *
 * Spec 2026-06-11 Deterministic Findings-Coverage Verification + Gap
 * Wayfinding — Task Group 2.
 *
 * THE single on-read coverage implementation. The gateway snapshots the
 * accepted (review_status=approved) critical/high discovery findings into
 * `generationSummary.findingsCoverage` at plan CREATE time; this module
 * grades that snapshot against the union of
 * `book_of_work_json.items[].discoveryFindingReferences` ON READ. Because
 * epic-expansion appends keep `discoveryFindingReferences` current, the
 * computed coverage self-updates as stories land — no recompute writes,
 * no hooks, and NO LLM involvement anywhere in the grade.
 *
 * Every coverage-rendering surface (wizard readiness cards, the review
 * workspace's unaddressed-findings panel, the progress summary, the draft
 * list, the dashboard delivery cards) imports `computeFindingsCoverage`
 * from here — per-surface re-derivations are a defect.
 *
 * Back-compat rule (D8): drafts WITHOUT the snapshot (legacy drafts, and
 * drafts whose snapshot fetch fail-softed at create) return `null` and
 * consumers hide their coverage section entirely — no "not computed"
 * badges, no fallback derivation from references alone.
 */

/** One accepted critical/high finding in the create-time snapshot. */
export interface FindingsCoverageSnapshotFinding {
  id: string;
  title: string;
  severity: string;
  runId: string;
  /**
   * Spec 2026-06-14 D4 (Carry-over Completeness Gate) re-key: the
   * `detail_json.behaviourBearing` hint -- the SOLE gating predicate for the
   * ACTIVE carry_over completeness gate. Mirrors the gateway
   * `AcceptedFindingSnapshotEntry` re-key (which ADDED this field alongside
   * `severity` rather than replacing it, so the legacy create-time snapshot
   * round-trips byte-for-byte). OPTIONAL + omitted-when-undefined; the ENFORCING
   * carry_over computation lives gateway-side in `migrationCarryOverCoverage.ts`
   * and keys on this, not on `severity`. This read-side grade still matches by
   * id only -- carrying the field keeps the snapshot shape aligned for any
   * surface that reads behaviourBearing off the snapshot.
   */
  behaviourBearing?: boolean;
}

/** The snapshot wire shape persisted by the gateway at create. */
export interface FindingsCoverageSnapshot {
  findings: FindingsCoverageSnapshotFinding[];
}

/** The computed on-read coverage grade. */
export interface FindingsCoverageResult {
  /** Total accepted critical/high findings in the create-time snapshot. */
  total: number;
  /** Snapshot findings referenced by at least one book-of-work item. */
  addressedCount: number;
  /** Snapshot findings referenced by NO book-of-work item. */
  notAddressedCount: number;
  /** The unreferenced snapshot findings (title + severity + runId intact). */
  unaddressed: FindingsCoverageSnapshotFinding[];
}

/** Loose input shapes — tolerant of the open-ended JSONB blobs. */
type GenerationSummaryLike = Record<string, unknown> | null | undefined;
// NOTE: deliberately NOT intersected with `Record<string, unknown>` —
// interfaces (e.g. `MigrationBookOfWorkItem`) carry no implicit index
// signature, so the surfaces' typed item arrays must stay assignable.
type BookOfWorkItemLike = { discoveryFindingReferences?: unknown };

/** Trimmed, case-insensitive matching key. Deterministic — never fuzzy. */
function matchKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalize a raw snapshot entry. Entries without a usable string id are
 * dropped (they can never be matched); other fields coerce to ''.
 */
function normalizeSnapshotFinding(
  raw: unknown,
): FindingsCoverageSnapshotFinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
    return null;
  }
  const normalized: FindingsCoverageSnapshotFinding = {
    id: entry.id,
    title: typeof entry.title === 'string' ? entry.title : '',
    severity: typeof entry.severity === 'string' ? entry.severity : '',
    runId: typeof entry.runId === 'string' ? entry.runId : '',
  };
  // D4 re-key: carry the behaviourBearing hint through WHEN present (omitted
  // otherwise so the legacy snapshot shape stays byte-identical).
  if (typeof entry.behaviourBearing === 'boolean') {
    normalized.behaviourBearing = entry.behaviourBearing;
  }
  return normalized;
}

/**
 * Compute the deterministic findings coverage for a draft.
 *
 * Returns `null` when `generationSummary.findingsCoverage.findings` is not
 * an array — i.e. for legacy drafts, fetch-failed drafts, or a missing
 * summary. Consumers hide their coverage section entirely on `null` (D8).
 *
 * Otherwise grades the snapshot against the union of
 * `items[].discoveryFindingReferences` across the draft's book-of-work
 * items (missing / non-array reference fields are tolerated as empty).
 * Matching is trimmed, case-insensitive id equality ONLY.
 */
export function computeFindingsCoverage(
  generationSummary: GenerationSummaryLike,
  items: BookOfWorkItemLike[] | null | undefined,
): FindingsCoverageResult | null {
  const snapshot =
    generationSummary && typeof generationSummary === 'object'
      ? (generationSummary as Record<string, unknown>).findingsCoverage
      : undefined;
  const rawFindings =
    snapshot && typeof snapshot === 'object'
      ? (snapshot as Record<string, unknown>).findings
      : undefined;
  if (!Array.isArray(rawFindings)) {
    // No snapshot (legacy / fail-softed draft) — hide, don't approximate.
    return null;
  }

  const findings = rawFindings
    .map(normalizeSnapshotFinding)
    .filter((f): f is FindingsCoverageSnapshotFinding => f !== null);

  // Referenced set: union of items[].discoveryFindingReferences.
  const referenced = new Set<string>();
  for (const item of items ?? []) {
    const refs = item?.discoveryFindingReferences;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      if (typeof ref === 'string' && ref.trim().length > 0) {
        referenced.add(matchKey(ref));
      }
    }
  }

  const unaddressed = findings.filter((f) => !referenced.has(matchKey(f.id)));
  return {
    total: findings.length,
    addressedCount: findings.length - unaddressed.length,
    notAddressedCount: unaddressed.length,
    unaddressed,
  };
}
