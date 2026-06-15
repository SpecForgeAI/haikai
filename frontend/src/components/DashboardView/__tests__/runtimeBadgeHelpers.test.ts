/**
 * runtimeBadgeHelpers pure unit tests
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 1.1.
 *
 * Strict scope: pure module tests over `getRuntimeBadgeFor`. No React, no
 * rendering, no mocks. The module imports nothing UI-related so test seams
 * are not required.
 *
 * Coverage:
 *  1. Unsupported candidate types ALWAYS return null regardless of context.
 *  2. Endpoint usage `>= HIGH_USAGE_ENDPOINT_THRESHOLD` -> "High usage".
 *     Endpoint usage `> 0 && < HIGH_USAGE` -> compact-formatted
 *     "Observed {compact}" using `Intl.NumberFormat({notation:'compact'})`.
 *  3. Endpoint with high usage AND `status5xxCount = 25` -> "Elevated
 *     errors" (precedence rule).
 *  4. Interface rollup `totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD`
 *     -> "High usage", success.
 *
 * Note on the spec test-list line "observedUsageCount = 1842 -> 'Observed
 * 1.8k'": with `HIGH_USAGE_ENDPOINT_THRESHOLD = 1000` (pinned), 1842
 * actually hits the "High usage" branch. The pinned threshold wins; the
 * compact-formatter intent is verified below with a sub-1000 value (Test 2).
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import type {
  InterfaceLogicalEntityRuntimeRollup,
  InterfaceRuntimeRollup,
  LogEnrichmentRuntimeBlock,
  LogicalDataEntityRuntimeRollup,
  MatchedRuntimeEvidence,
  RuntimeEvidenceContext,
  RuntimeEvidenceForCandidate,
} from '../candidateEvidenceTypes';
import { getRuntimeBadgeFor } from '../runtimeBadgeHelpers';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  id: string,
  candidateType: string,
  data: Record<string, unknown> = {}
): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-1',
    candidate_type: candidateType,
    name: id,
    confidence: 0.8,
    status: 'proposed',
    source_cluster_ids: [],
    data,
    synthesized_at: '2026-05-11T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  };
}

function makeMatched(
  overrides: Partial<MatchedRuntimeEvidence> = {}
): MatchedRuntimeEvidence {
  return {
    method: 'GET',
    codePathTemplate: '/owners/{ownerId}',
    normalizedLogPath: '/owners/123',
    observedUsageCount: 10,
    totalLogRequests: 100,
    status2xxCount: 9,
    status3xxCount: 1,
    status4xxCount: 0,
    status5xxCount: 0,
    matchConfidence: 0.95,
    matchReason: 'exact match',
    ...overrides,
  };
}

function emptyContext(): RuntimeEvidenceContext {
  return {
    byCandidateId: new Map<string, RuntimeEvidenceForCandidate>(),
    interfaceRollupByCandidateId: new Map<string, InterfaceRuntimeRollup>(),
    logicalDataEntityRollupByCandidateId: new Map<string, LogicalDataEntityRuntimeRollup>(),
    interfaceLogicalEntityRollupByCandidateId: new Map<
      string,
      InterfaceLogicalEntityRuntimeRollup
    >(),
  };
}

function contextWithEndpoint(
  candidateId: string,
  matched: MatchedRuntimeEvidence
): RuntimeEvidenceContext {
  const ctx = emptyContext();
  const block: LogEnrichmentRuntimeBlock = { matched };
  ctx.byCandidateId.set(candidateId, { runtime: block });
  return ctx;
}

function contextWithInterfaceRollup(
  candidateId: string,
  rollup: InterfaceRuntimeRollup
): RuntimeEvidenceContext {
  const ctx = emptyContext();
  ctx.interfaceRollupByCandidateId.set(candidateId, rollup);
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runtimeBadgeHelpers.getRuntimeBadgeFor', () => {
  it('Test 1: returns null for unsupported candidate types regardless of context contents', () => {
    // Even when we deliberately stuff entries into every map keyed by the
    // candidate id, an unsupported type must NEVER produce a badge.
    const candidate = makeCandidate('c-unsupported', 'totally_unsupported_type');
    const ctx = emptyContext();
    ctx.byCandidateId.set(candidate.id, {
      runtime: { matched: makeMatched({ observedUsageCount: 5000 }) },
    });
    ctx.interfaceRollupByCandidateId.set(candidate.id, {
      totalObservedCalls: 5000,
      observedEndpointCount: 1,
      totalEndpointCount: 1,
      topEndpoints: [],
      statusBreakdown: {
        status2xxCount: 0,
        status3xxCount: 0,
        status4xxCount: 0,
        status5xxCount: 0,
      },
    });

    expect(getRuntimeBadgeFor(candidate, ctx)).toBeNull();
  });

  it('Test 2: endpoint usage >= HIGH_USAGE_ENDPOINT_THRESHOLD -> "High usage"; sub-threshold uses compact "Observed N"', () => {
    const candidate = makeCandidate('ep-1', 'endpoints');

    // 1842 >= 1000 -> "High usage" (the spec's pinned threshold wins).
    const ctxHigh = contextWithEndpoint(
      candidate.id,
      makeMatched({ observedUsageCount: 1842 })
    );
    expect(getRuntimeBadgeFor(candidate, ctxHigh)).toEqual({
      label: 'High usage',
      variant: 'success',
    });

    // 842 < 1000 -> compact-formatted "Observed 842".
    const ctxLow = contextWithEndpoint(
      candidate.id,
      makeMatched({ observedUsageCount: 842 })
    );
    expect(getRuntimeBadgeFor(candidate, ctxLow)).toEqual({
      label: 'Observed 842',
      variant: 'success',
    });
  });

  it('Test 3: endpoint observedUsageCount = 1500 -> "High usage", success (>= HIGH_USAGE_ENDPOINT_THRESHOLD)', () => {
    const candidate = makeCandidate('ep-2', 'endpoints');
    const ctx = contextWithEndpoint(
      candidate.id,
      makeMatched({ observedUsageCount: 1500 })
    );

    expect(getRuntimeBadgeFor(candidate, ctx)).toEqual({
      label: 'High usage',
      variant: 'success',
    });
  });

  it('Test 4: endpoint with status5xxCount = 25 takes precedence over high observedUsageCount -> "Elevated errors", warning', () => {
    const candidate = makeCandidate('ep-3', 'endpoints');
    const ctx = contextWithEndpoint(
      candidate.id,
      makeMatched({
        observedUsageCount: 5000, // would otherwise win the High Usage branch
        totalLogRequests: 5025,
        status5xxCount: 25, // >= ELEVATED_5XX_COUNT_THRESHOLD (10)
      })
    );

    expect(getRuntimeBadgeFor(candidate, ctx)).toEqual({
      label: 'Elevated errors',
      variant: 'warning',
    });
  });

  it('Test 5: interface rollup totalObservedCalls >= INTERFACE_HIGH_USAGE_THRESHOLD -> "High usage", success', () => {
    const candidate = makeCandidate('iface-1', 'interfaces');
    const rollup: InterfaceRuntimeRollup = {
      totalObservedCalls: 1500,
      observedEndpointCount: 3,
      totalEndpointCount: 4,
      topEndpoints: [],
      statusBreakdown: {
        status2xxCount: 1500,
        status3xxCount: 0,
        status4xxCount: 0,
        status5xxCount: 0,
      },
    };
    const ctx = contextWithInterfaceRollup(candidate.id, rollup);

    expect(getRuntimeBadgeFor(candidate, ctx)).toEqual({
      label: 'High usage',
      variant: 'success',
    });
  });
});
