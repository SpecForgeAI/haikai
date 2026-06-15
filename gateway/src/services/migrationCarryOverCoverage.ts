/**
 * Carry-over completeness-gate coverage computation (gateway, per book-of-work).
 *
 * Spec: D4 — Carry-over Completeness Gate (2026-06-14, Spec 4 of 6) — Task
 * Group 2.
 *
 * The load-bearing insight of the whole program: RECONCILIATION IS API-ONLY.
 * Internal / non-API carry_over work (batch capabilities, stored procs,
 * scheduled jobs, monitoring, deployment) has NO downstream backstop — if it is
 * silently dropped during migration nothing ever catches it. D4 is that
 * backstop: a human must consciously ACCOUNT FOR every behaviour-bearing
 * carry_over capability / finding before Migrate unlocks, by either CITING it
 * into a story or DISMISSING it with a reason.
 *
 * This module is the PURE, deterministic heart of the gate. It is data-in /
 * data-out — no AMS, no LLM, no I/O — so it is exhaustively unit-testable. The
 * async fetch orchestration that feeds it lives in
 * {@link ./migrationCarryOverCoverageReads} and the gate that consumes it is
 * `evaluateHardBlock` in `migrationExecutionDriver.ts`.
 *
 * Coverage status model (D8):
 *   - A CAPABILITY is `cited-by-story` iff a work_item exists with
 *     `source_capability_id == capability.id` (the changeset-185 column).
 *   - A FINDING is `cited-by-story` iff its id appears in any book item's
 *     `discoveryFindingReferences` OR it rolls up under a covered/dismissed
 *     capability via `discovery_capability_member`.
 *   - EITHER is `dismissed` iff its `reviewStatus` / `review_status` is in
 *     {`rejected`, `dismissed`} WITH a non-empty reason (D4). `approved` /
 *     `pending_review` / `deferred` do NOT satisfy.
 *   - Everything else behaviour-bearing is `un-actioned` (and gates).
 *
 * Roll-up (D2, D9): a behaviour-bearing finding that is a MEMBER of a
 * covered-or-dismissed capability is accounted-for and is NOT double-counted —
 * only un-grouped behaviour-bearing findings gate on their own.
 *
 * Must-account set (D2): {behaviour-bearing capabilities} ∪ {behaviour-bearing
 * findings NOT a member of any capability}. `behaviourBearing == true` is the
 * SOLE inclusion predicate (read from `detail_json`); `false` is excluded
 * entirely and never gates.
 */

// ============================================================================
// Status vocabulary
// ============================================================================

/** Per-item coverage status (D8). */
export const COVERAGE_STATUS = {
  UN_ACTIONED: 'un-actioned',
  CITED_BY_STORY: 'cited-by-story',
  DISMISSED: 'dismissed',
} as const;

export type CoverageStatus = (typeof COVERAGE_STATUS)[keyof typeof COVERAGE_STATUS];

/** The dispositions that (with a non-empty reason) account for an item (D4). */
const DISMISSAL_DISPOSITIONS = new Set(['rejected', 'dismissed']);

// ============================================================================
// Inputs / outputs
// ============================================================================

/** One capability the gate evaluates (drawn from the AMS capabilities read). */
export interface CoverageCapabilityInput {
  /** The `discovery_capability` UUID. */
  id: string;
  /**
   * The aggregated `detail_json.behaviourBearing` hint (D2). Only `true` gates;
   * `false` / `null` is excluded from the must-account set entirely.
   */
  behaviourBearing: boolean | null;
  /** The `review_status` disposition (string-typed at the wire). */
  reviewStatus: string | null;
  /**
   * The dismissal reason store (`detail_json.reviewerNotes` for capabilities).
   * A dismissed/rejected capability only accounts-for itself with a non-empty
   * reason.
   */
  reviewerNotes: string | null;
  /**
   * The ids of the findings this capability absorbs (its
   * `discovery_capability_member` membership, `member_type='discovery_finding'`).
   * A behaviour-bearing finding in this set rolls UP and does not gate on its
   * own when the capability is covered/dismissed.
   */
  memberFindingIds: string[];
}

/** One finding the gate evaluates (drawn from the AMS findings read). */
export interface CoverageFindingInput {
  /** The `discovery_findings` UUID. */
  id: string;
  /** The `detailJson.behaviourBearing` hint (D2). Only `true` gates. */
  behaviourBearing: boolean | null;
  /** The `review_status` disposition. */
  reviewStatus: string | null;
  /** The dismissal reason store (`reviewerNotes`). */
  reviewerNotes: string | null;
}

/** A single resolved coverage item. */
export interface CoverageItem {
  kind: 'capability' | 'finding';
  id: string;
  status: CoverageStatus;
  /** True iff this item is behaviour-bearing (and therefore a gating candidate). */
  behaviourBearing: boolean;
  /**
   * True iff this finding is rolled up under a covered/dismissed capability
   * (so it does not independently gate). Always false for capabilities and for
   * un-grouped findings.
   */
  rolledUp?: boolean;
  /** A short human label for the offending list message (id only here). */
  label: string;
}

/** The full coverage computation result. */
export interface CarryOverCoverageResult {
  /** Every resolved item (capabilities + findings), behaviour-bearing or not. */
  items: CoverageItem[];
  /**
   * The must-account set: behaviour-bearing capabilities ∪ un-grouped
   * behaviour-bearing findings (rolled-up / grouped member findings are
   * EXCLUDED — the capability stands in for them).
   */
  mustAccount: CoverageItem[];
  /** The subset of {@link mustAccount} that is still `un-actioned` (gates). */
  unaccounted: CoverageItem[];
  /** Count of {@link mustAccount} items that ARE accounted-for. */
  accountedCount: number;
  /** Size of {@link mustAccount}. */
  totalMustAccount: number;
  /** True iff nothing in the must-account set is un-actioned (gate passes). */
  ok: boolean;
}

export interface ComputeCarryOverCoverageInput {
  capabilities: CoverageCapabilityInput[];
  findings: CoverageFindingInput[];
  /**
   * The capability ids cited by a story: a `work_item.source_capability_id`
   * matched the capability (the changeset-185 column join).
   */
  citedCapabilityIds: Set<string>;
  /**
   * The finding ids cited DIRECTLY by a book item's
   * `discoveryFindingReferences` (the finding-citation mechanism, reused as-is).
   */
  citedFindingIds: Set<string>;
}

// ============================================================================
// behaviourBearing predicate (read from detail_json) — the SOLE gating predicate
// ============================================================================

/**
 * Read `detail_json.behaviourBearing` for a capability. Only an explicit `true`
 * counts; a missing / non-boolean / `false` value is NOT behaviour-bearing and
 * therefore never gates (D2). Tolerant of the free-form JSONB blob.
 */
export function capabilityBehaviourBearing(
  detailJson: Record<string, unknown> | null | undefined
): boolean {
  return readBehaviourBearing(detailJson);
}

/**
 * Read `detailJson.behaviourBearing` for a finding (D1/D2 hint). Same predicate
 * as the capability side: only explicit `true` gates.
 */
export function findingBehaviourBearing(
  detailJson: Record<string, unknown> | null | undefined
): boolean {
  return readBehaviourBearing(detailJson);
}

function readBehaviourBearing(
  detailJson: Record<string, unknown> | null | undefined
): boolean {
  if (!detailJson || typeof detailJson !== 'object') return false;
  return (detailJson as Record<string, unknown>).behaviourBearing === true;
}

/** True iff the disposition + reason account for an item by dismissal (D4). */
function isDismissedByDisposition(
  reviewStatus: string | null,
  reviewerNotes: string | null
): boolean {
  if (!reviewStatus || !DISMISSAL_DISPOSITIONS.has(reviewStatus)) return false;
  return typeof reviewerNotes === 'string' && reviewerNotes.trim().length > 0;
}

// ============================================================================
// Coverage computation (PURE)
// ============================================================================

/**
 * Compute per-item carry_over coverage + the must-account / un-accounted sets.
 * PURE and deterministic — exported for direct unit-testing and consumed by the
 * `carry_over_not_accounted` hard-block reason in `evaluateHardBlock`.
 */
export function computeCarryOverCoverage(
  input: ComputeCarryOverCoverageInput
): CarryOverCoverageResult {
  const { capabilities, findings, citedCapabilityIds, citedFindingIds } = input;

  // ---- Pass 1: resolve each capability's status. ----
  const capabilityStatusById = new Map<string, CoverageStatus>();
  const capabilityItems: CoverageItem[] = [];
  for (const c of capabilities) {
    const bb = c.behaviourBearing === true;
    const status = resolveCapabilityStatus(c, citedCapabilityIds);
    capabilityStatusById.set(c.id, status);
    capabilityItems.push({
      kind: 'capability',
      id: c.id,
      status,
      behaviourBearing: bb,
      label: c.id,
    });
  }

  // ---- Build the roll-up index: finding id -> the absorbing parent's status.
  //      A member of a covered/dismissed capability is absorbed (accounted-for)
  //      and must NOT gate on its own (D2, D9). The absorbed finding inherits its
  //      parent's accounted-for semantics: a cited parent makes the member
  //      `cited-by-story`, a dismissed parent makes it `dismissed`. When a
  //      finding is a member of multiple absorbing capabilities, ANY citing
  //      story wins over a dismissal (any citing story counts as accounted-for
  //      — D8). `groupedFindingIds` is the set of findings that are a MEMBER of
  //      ANY capability (covered or NOT): a member of an un-actioned capability
  //      is still grouped (the capability gates, not the finding), so it stays
  //      out of the standalone must-account set and is surfaced via its parent.
  const absorbedFindingStatus = new Map<string, CoverageStatus>();
  const groupedFindingIds = new Set<string>();
  for (const c of capabilities) {
    const status = capabilityStatusById.get(c.id);
    const absorbs =
      status === COVERAGE_STATUS.CITED_BY_STORY || status === COVERAGE_STATUS.DISMISSED;
    for (const fid of c.memberFindingIds ?? []) {
      if (typeof fid !== 'string' || fid.length === 0) continue;
      groupedFindingIds.add(fid);
      if (!absorbs || !status) continue;
      const prior = absorbedFindingStatus.get(fid);
      // Prefer cited-by-story over dismissed when multiple parents absorb it.
      if (prior === COVERAGE_STATUS.CITED_BY_STORY) continue;
      absorbedFindingStatus.set(fid, status);
    }
  }

  // ---- Pass 2: resolve each finding's status. ----
  const findingItems: CoverageItem[] = [];
  for (const f of findings) {
    const bb = f.behaviourBearing === true;
    const absorbedStatus = absorbedFindingStatus.get(f.id) ?? null;
    const status = resolveFindingStatus(f, citedFindingIds, absorbedStatus);
    findingItems.push({
      kind: 'finding',
      id: f.id,
      status,
      behaviourBearing: bb,
      rolledUp: absorbedStatus !== null,
      label: f.id,
    });
  }

  const items = [...capabilityItems, ...findingItems];

  // ---- The must-account set: behaviour-bearing capabilities ∪ un-grouped
  //      behaviour-bearing findings. behaviourBearing=false is excluded. ----
  const mustAccount: CoverageItem[] = [];
  for (const item of capabilityItems) {
    if (item.behaviourBearing) mustAccount.push(item);
  }
  for (const item of findingItems) {
    if (!item.behaviourBearing) continue;
    if (groupedFindingIds.has(item.id)) continue; // rolled into a capability — not standalone
    mustAccount.push(item);
  }

  const unaccounted = mustAccount.filter(
    (i) => i.status === COVERAGE_STATUS.UN_ACTIONED
  );

  return {
    items,
    mustAccount,
    unaccounted,
    accountedCount: mustAccount.length - unaccounted.length,
    totalMustAccount: mustAccount.length,
    ok: unaccounted.length === 0,
  };
}

/**
 * A capability's coverage status: `cited-by-story` (a work_item carries its
 * `source_capability_id`) > `dismissed` (disposition + reason) > `un-actioned`.
 * The cited check wins so a cited-then-also-dismissed capability reads as cited.
 */
function resolveCapabilityStatus(
  c: CoverageCapabilityInput,
  citedCapabilityIds: Set<string>
): CoverageStatus {
  if (citedCapabilityIds.has(c.id)) return COVERAGE_STATUS.CITED_BY_STORY;
  if (isDismissedByDisposition(c.reviewStatus, c.reviewerNotes)) {
    return COVERAGE_STATUS.DISMISSED;
  }
  return COVERAGE_STATUS.UN_ACTIONED;
}

/**
 * A finding's coverage status: `cited-by-story` iff its id is directly cited via
 * `discoveryFindingReferences`; else, if it rolls up under a covered/dismissed
 * capability, it inherits that parent's accounted-for status; else `dismissed`
 * (own disposition + reason); else `un-actioned`.
 */
function resolveFindingStatus(
  f: CoverageFindingInput,
  citedFindingIds: Set<string>,
  absorbedStatus: CoverageStatus | null
): CoverageStatus {
  // A direct citation always wins (any citing story counts as accounted-for).
  if (citedFindingIds.has(f.id)) return COVERAGE_STATUS.CITED_BY_STORY;
  // Rolled up under a covered/dismissed capability — inherit the parent's
  // accounted-for status (cited parent -> cited member; dismissed parent ->
  // dismissed member).
  if (absorbedStatus !== null) return absorbedStatus;
  if (isDismissedByDisposition(f.reviewStatus, f.reviewerNotes)) {
    return COVERAGE_STATUS.DISMISSED;
  }
  return COVERAGE_STATUS.UN_ACTIONED;
}
