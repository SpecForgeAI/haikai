/**
 * Gateway-only rich cascade-preview builder for the discovery-review conversation
 * (Spec 2026-06-06-discovery-review-room-agenda-redesign-2, S2 / Task Group 2).
 *
 * Builds the structured {@link CascadePreview} a FAMILY chunk renders: the
 * full-cascade `total` plus a per-`candidate_type` breakdown, each type carrying
 * the full-cascade `count` of that type and the three already-* sub-counts
 * (`alreadyApproved` / `alreadyRejected` / `alreadyDeferred`).
 *
 * MECHANISM (no new cascade algorithm):
 *   1. The full-cascade touched set is computed by REUSING the parity-tested pure
 *      resolver `resolveBulkActionSet` AS-IS on the family seed for the
 *      `'approved'` action (the "Approve All" reach). The resolver is NOT modified
 *      and its wire is NOT widened — the preview is purely gateway-side.
 *   2. Each touched candidate id is mapped to its FULL model node
 *      (`FullReviewModelWire` nodes carry `candidate_type` + `review_status`), so
 *      the breakdown can group by `candidate_type` and read each member's
 *      persisted `review_status`. A touched id that is NOT a model node (a
 *      relationship-ROW / edge candidate Spec A surfaces on REJECT) carries no
 *      `candidate_type`; "Approve All" never surfaces rows (Group 3 is reject-only),
 *      but the builder still tolerates one defensively — it is grouped under a
 *      stable `''` (unknown) type bucket rather than dropped, so `total` always
 *      equals the resolver's touched-candidate count.
 *   3. `total` = the size of the full touched candidate set (the
 *      "Review the current N candidates" line).
 *
 * PURITY CONTRACT (load-bearing — do NOT break), mirroring the sequencer +
 * `deriveFamilyForSeed`:
 *   - No fetch, no LLM, no clock, no global state, no I/O.
 *   - A pure function of (seed ids, review model).
 *   - CYCLE-SAFE: the only graph walk is delegated to `resolveBulkActionSet`,
 *     which is itself cycle-safe (its visited-set bounds the transitive
 *     blast-radius walk on a cyclic dependency graph); the builder's own work is a
 *     single linear pass over the resolver's touched set + an O(1) node lookup, so
 *     a `parent_child` cycle terminates.
 *
 * The breakdown is type-driven from `candidate_type`, so a DATABASE-scan family (a
 * physical entity/table → its columns + cross-scan logical↔physical mappings)
 * renders analogously to a code-scan family (an interface → its endpoints +
 * associated logical entities/attributes) with NO type-specific branching here.
 */

import { resolveBulkActionSet } from '../discovery/resolveBulkActionSet';
import type { FullReviewModelWire, ReviewModelNode } from './reviewModelFull';
import { toResolverModel } from './reviewModelFull';
import type { CascadePreview, CascadePreviewByType } from './reviewTurnShape';

/**
 * The three terminal dispositions a member can already be in. The verbatim AMS
 * `review_status` values; anything else (e.g. `pending_review`) counts as
 * actionable and contributes to NONE of the already-* sub-counts.
 */
const APPROVED_STATUS = 'approved';
const REJECTED_STATUS = 'rejected';
const DEFERRED_STATUS = 'deferred';

/**
 * Per-type accumulator (mutable during the single pass; frozen into the immutable
 * {@link CascadePreviewByType} wire row on output).
 */
interface ByTypeAccumulator {
  type: string;
  count: number;
  alreadyApproved: number;
  alreadyRejected: number;
  alreadyDeferred: number;
}

/**
 * Build the rich {@link CascadePreview} for a FAMILY chunk from its seed
 * (typically the single family parent id; the resolver's `'approved'` cascade
 * pulls in the `parent_child` children + the associated logical entities/attributes
 * — exactly the "Approve All" reach). PURE + CYCLE-SAFE.
 *
 * @param seedCandidateIds the family seed (the parent id(s) the "Approve All"
 *   cascade expands from). De-duplicated by the resolver; order-insensitive.
 * @param model the FULL review model the coordinator already holds.
 * @returns the structured preview: `total` (full-cascade distinct-candidate count)
 *   + the per-`candidate_type` breakdown with the three already-* sub-counts.
 */
export function buildCascadePreview(
  seedCandidateIds: readonly string[],
  model: FullReviewModelWire,
): CascadePreview {
  // 1. The full-cascade touched set — the EXACT "Approve All" reach. Reuse the
  //    parity-tested resolver verbatim (cycle-safe); the preview never re-derives
  //    the cascade itself.
  const resolved = resolveBulkActionSet(
    { seedCandidateIds, action: APPROVED_STATUS },
    toResolverModel(model),
  );

  // 2. Index the full nodes by id so each touched candidate can be mapped to its
  //    `candidate_type` + persisted `review_status` (O(1) lookup; a pure read).
  const nodeById = new Map<string, ReviewModelNode>(
    (model.nodes ?? []).map((n) => [n.id, n]),
  );

  // 3. Group the touched set by `candidate_type`, accumulating the per-type count
  //    and the three already-* sub-counts from each member's `review_status`.
  //    First-seen type order is preserved (the resolver's deterministic
  //    seed-first-then-BFS candidate order), which keeps the rendered breakdown
  //    stable across calls.
  const byTypeAcc = new Map<string, ByTypeAccumulator>();

  const bump = (type: string, reviewStatus: string | undefined): void => {
    let acc = byTypeAcc.get(type);
    if (!acc) {
      acc = {
        type,
        count: 0,
        alreadyApproved: 0,
        alreadyRejected: 0,
        alreadyDeferred: 0,
      };
      byTypeAcc.set(type, acc);
    }
    acc.count += 1;
    switch (reviewStatus) {
      case APPROVED_STATUS:
        acc.alreadyApproved += 1;
        break;
      case REJECTED_STATUS:
        acc.alreadyRejected += 1;
        break;
      case DEFERRED_STATUS:
        acc.alreadyDeferred += 1;
        break;
      default:
        // pending_review (or any non-terminal status): actionable — not counted
        // into any already-* bucket.
        break;
    }
  };

  for (const candidate of resolved.candidates) {
    const node = nodeById.get(candidate.candidate_id);
    // A non-node touched id (a relationship-ROW / edge candidate) has no
    // `candidate_type`; bucket it under the stable `''` unknown type so `total`
    // stays exact. "Approve All" never surfaces rows in practice (reject-only).
    const type = node?.candidate_type ?? '';
    bump(type, node?.review_status);
  }

  const byType: CascadePreviewByType[] = [...byTypeAcc.values()].map((acc) => ({
    type: acc.type,
    count: acc.count,
    alreadyApproved: acc.alreadyApproved,
    alreadyRejected: acc.alreadyRejected,
    alreadyDeferred: acc.alreadyDeferred,
  }));

  return {
    // `total` = the full-cascade distinct-candidate count (every touched
    // candidate, node or non-node row), so it always equals Σ byType[].count.
    total: resolved.candidates.length,
    byType,
  };
}
