/**
 * GATEWAY half of the shared-fixture behavioral PARITY guard
 * (Spec 2026-06-05-reject-cascade-correctness, Task Group 4.2).
 *
 * Runs the CANONICAL gateway `resolveBulkActionSet` over the ONE shared input
 * (`rejectCascadeParityFixture.ts`) and diff-asserts its FULL output against the
 * ONE shared {@link PARITY_EXPECTED} snapshot. The frontend mirror's parity test
 * (`frontend/src/components/Discovery/resolveBulkActionSet.parity.test.ts`) runs
 * the SAME shared input through the FRONTEND copy and asserts the SAME snapshot.
 * Because both halves assert byte-equal against the single shared expected object,
 * any behavioral drift between the two copies fails one half loudly — this is the
 * only guard against the two mirrors diverging on the new reject-cascade logic
 * (Confirmed Decision 5). It is ADDED IN ADDITION to (not replacing) the wire-shape
 * contract test (Group 1) + the per-mirror exclusivity/surfacing unit tests
 * (Groups 2-3).
 */

import { resolveBulkActionSet } from '../resolveBulkActionSet';
import {
  PARITY_INPUT,
  PARITY_REVIEW_MODEL_GATEWAY,
  PARITY_EXPECTED,
  PARITY_EXPECTED_FLAT_CANDIDATE_IDS,
} from './rejectCascadeParityFixture';

describe('resolveBulkActionSet — shared-fixture behavioral parity (gateway half, Group 4.2)', () => {
  it('produces the ONE canonical resolved set (candidates + findings + flat marked id set + counts) the frontend mirror must also produce', () => {
    const result = resolveBulkActionSet(
      { seedCandidateIds: [...PARITY_INPUT.seedCandidateIds], action: PARITY_INPUT.action },
      PARITY_REVIEW_MODEL_GATEWAY,
    );

    // FULL structural diff against the shared snapshot: candidates (with exact
    // provenance + ordering), findings, retained seed ids, counts. If the gateway
    // copy drifts on exclusivity / the peer rule / cycle handling / Group-3
    // surfacing, this deep-equal fails.
    expect(result).toEqual(PARITY_EXPECTED);

    // The flat marked candidate-id set the atomic cascade endpoint persists
    // `rejected` — pinned explicitly per the Task 4.2 brief.
    expect(result.candidates.map((c) => c.candidate_id)).toEqual(
      PARITY_EXPECTED_FLAT_CANDIDATE_IDS,
    );
  });
});
