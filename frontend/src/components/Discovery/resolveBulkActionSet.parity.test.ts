/**
 * FRONTEND half of the shared-fixture behavioral PARITY guard
 * (Spec 2026-06-05-reject-cascade-correctness, Task Group 4.2).
 *
 * Runs the FRONTEND `resolveBulkActionSet` MIRROR over the ONE shared input that
 * the gateway half also uses, and diff-asserts its FULL output against the SAME
 * shared {@link PARITY_EXPECTED} snapshot. The shared fixture lives in the gateway
 * tree (the CANONICAL home); this test imports it via a relative
 * `../../../../gateway/...` path — the established cross-package contract idiom
 * (`frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts` reaches
 * into the gateway tree for its canonical JSON the same way; `resolveJsonModule` +
 * `esModuleInterop` are on in `frontend/tsconfig.json`, and this is plain TS data).
 *
 * Because the gateway half and THIS half both assert byte-equal against the SAME
 * single expected object, the two `resolveBulkActionSet` copies are proven
 * BEHAVIORALLY IDENTICAL on the reject-cascade logic (exclusivity + peer rule +
 * cycle + Group-3 surfacing). If either copy drifts, exactly one half fails — the
 * only guard against the mirrors diverging on the new logic (Confirmed Decision 5).
 */

import { describe, it, expect } from 'vitest';

import { resolveBulkActionSet } from './resolveBulkActionSet';
import type { ReviewModel } from '../../api/discoveryApi';
// Cross-package import of the SHARED canonical fixture from the gateway tree.
// Path resolves five levels up: Discovery -> components -> src -> frontend ->
// repo root -> gateway/...
import {
  PARITY_INPUT,
  PARITY_REVIEW_MODEL,
  PARITY_EXPECTED,
  PARITY_EXPECTED_FLAT_CANDIDATE_IDS,
} from '../../../../gateway/src/services/discovery/__tests__/rejectCascadeParityFixture';

describe('resolveBulkActionSet — shared-fixture behavioral parity (frontend half, Group 4.2)', () => {
  it('produces the ONE canonical resolved set the gateway home also produces (proves the two mirrors have not drifted)', () => {
    const result = resolveBulkActionSet(
      { seedCandidateIds: [...PARITY_INPUT.seedCandidateIds], action: PARITY_INPUT.action },
      PARITY_REVIEW_MODEL as unknown as ReviewModel,
    );

    // FULL structural diff against the SAME shared snapshot the gateway half
    // asserts. Identical output from both copies => no behavioral drift.
    expect(result).toEqual(PARITY_EXPECTED);

    // The flat marked candidate-id set the atomic cascade endpoint persists
    // `rejected` — pinned explicitly per the Task 4.2 brief.
    expect(result.candidates.map((c) => c.candidate_id)).toEqual(
      PARITY_EXPECTED_FLAT_CANDIDATE_IDS,
    );
  });
});
