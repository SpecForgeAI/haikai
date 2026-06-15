/**
 * Test helper that mirrors the by-id lookup Stage 2.5 runtime evidence builds
 * over the deterministic candidates (`applyRuntimeEvidenceToCandidates` indexes
 * `candidate.id -> candidate` and mutates the matched survivor in place). Used
 * by the Group 5 wiring tests to assert the merge preserves survivor-id
 * reference semantics so runtime evidence keeps matching after the merge.
 */

import type { DiscoveryCandidate } from '../../../types/candidate';

export function buildCandidateIdentityShim(
  candidates: readonly DiscoveryCandidate[],
): Map<string, DiscoveryCandidate> {
  const byId = new Map<string, DiscoveryCandidate>();
  for (const c of candidates) byId.set(c.id, c);
  return byId;
}
