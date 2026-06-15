/**
 * displayConfidence pure unit tests
 *
 * Spec 7 (2026-05-11): Confidence, Tier, and Runtime Badges -- Task Group 2.1.
 *
 * Strict scope: pure module tests over `getDisplayConfidence`. No React, no
 * rendering, no mocks. The module imports nothing UI-related so test seams
 * are not required.
 *
 * Coverage (8 focused tests; spec §"Test Plan" → displayConfidence.test.ts):
 *  1. Null `candidate.confidence` -> displayConfidence: null, uplift: 0,
 *     all label / reason fields empty.
 *  2. Unsupported candidate type -> displayConfidence === baseConfidence,
 *     uplift: 0.
 *  3. Adapter endpoint, observedUsageCount = 100 -> +4 uplift in pp.
 *  4. Adapter endpoint, observedUsageCount = 1000, baseConfidence = 0.97
 *     -> displayConfidence = 0.99 (capped at MAX_LOG_CORROBORATED_CONFIDENCE).
 *     The applied uplift becomes +2 (cap clipped from raw +5).
 *  5. LLM endpoint, observedUsageCount = 1, baseConfidence = 0.93
 *     -> +5 raw, capped at 0.95 -> applied uplift +2.
 *  6. Adapter endpoint, observedUsageCount = 0, status5xxCount = 50
 *     -> +0 (4xx/5xx-only does NOT uplift; observedUsageCount drives the rule).
 *  7. Interface rollup observedEndpointCount = 1, totalEndpointCount = 4
 *     -> +2.
 *  8. interface_logical_entities rollup with
 *     (requestBodyUsageCount + responseBodyUsageCount) > 0 -> +2.
 */

import { describe, expect, it } from 'vitest';
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
import { getDisplayConfidence } from '../displayConfidence';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  id: string,
  candidateType: string,
  confidence: number | null,
  data: Record<string, unknown> = {}
): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-1',
    candidate_type: candidateType,
    name: id,
    confidence,
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
    observedUsageCount: 0,
    totalLogRequests: 0,
    status2xxCount: 0,
    status3xxCount: 0,
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

function contextWithInterfaceLogicalEntityRollup(
  candidateId: string,
  rollup: InterfaceLogicalEntityRuntimeRollup
): RuntimeEvidenceContext {
  const ctx = emptyContext();
  ctx.interfaceLogicalEntityRollupByCandidateId.set(candidateId, rollup);
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('displayConfidence.getDisplayConfidence', () => {
  it('Test 1: null candidate.confidence -> displayConfidence null, uplift 0, all labels empty', () => {
    const candidate = makeCandidate('ep-null', 'endpoints', null, {
      _addedBy: 'spring-boot-adapter',
    });
    const ctx = contextWithEndpoint(
      candidate.id,
      makeMatched({ observedUsageCount: 5000, totalLogRequests: 5000, status2xxCount: 5000 })
    );

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.baseConfidence).toBeNull();
    expect(result.displayConfidence).toBeNull();
    expect(result.uplift).toBe(0);
    expect(result.baseLabel).toBe('');
    expect(result.baseReason).toBe('');
    expect(result.upliftLabel).toBe('');
    expect(result.upliftReason).toBe('');
  });

  it('Test 2: unsupported candidate type -> displayConfidence === baseConfidence, uplift 0', () => {
    const candidate = makeCandidate('cap-1', 'capabilities', 0.7, {
      _addedBy: 'spring-boot-adapter',
    });
    const ctx = emptyContext();

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.baseConfidence).toBe(0.7);
    expect(result.displayConfidence).toBe(0.7);
    expect(result.uplift).toBe(0);
    expect(result.baseLabel).toBe('');
    expect(result.baseReason).toBe('');
    expect(result.upliftLabel).toBe('');
    expect(result.upliftReason).toBe('');
  });

  it('Test 3: adapter endpoint, observedUsageCount = 100 -> +4 uplift', () => {
    const candidate = makeCandidate('ep-100', 'endpoints', 0.8, {
      _addedBy: 'spring-boot-adapter',
    });
    const ctx = contextWithEndpoint(
      candidate.id,
      makeMatched({ observedUsageCount: 100, totalLogRequests: 100, status2xxCount: 100 })
    );

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.baseConfidence).toBe(0.8);
    expect(result.uplift).toBe(4);
    expect(result.displayConfidence).toBeCloseTo(0.84, 5);
    expect(result.baseLabel).toBe('Base confidence');
    expect(result.baseReason).toBe('Deterministic code adapter evidence.');
    expect(result.upliftLabel).toBe('Confidence increased');
    expect(result.upliftReason).toBe(
      'Runtime logs observed 100 successful/redirect calls matching this candidate.'
    );
  });

  it('Test 4: adapter endpoint, observedUsageCount = 1000, baseConfidence = 0.97 -> displayConfidence capped at 0.99 (+2 applied)', () => {
    const candidate = makeCandidate('ep-cap', 'endpoints', 0.97, {
      _addedBy: 'spring-boot-adapter',
    });
    const ctx = contextWithEndpoint(
      candidate.id,
      makeMatched({ observedUsageCount: 1000, totalLogRequests: 1000, status2xxCount: 1000 })
    );

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.baseConfidence).toBe(0.97);
    expect(result.displayConfidence).toBeCloseTo(0.99, 5);
    // Raw uplift would be +5 (>= 1000); capped to 0.99 means applied = +2 pp.
    expect(result.uplift).toBe(2);
    expect(result.upliftLabel).toBe('Confidence increased');
    expect(result.upliftReason).toBe(
      'Runtime logs observed 1,000 successful/redirect calls matching this candidate.'
    );
  });

  it('Test 5: LLM endpoint, observedUsageCount = 1, baseConfidence = 0.93 -> displayConfidence capped at 0.95 (+2 applied)', () => {
    const candidate = makeCandidate('ep-llm', 'endpoints', 0.93, {
      _addedBy: 'llm-gap-fill',
    });
    const ctx = contextWithEndpoint(
      candidate.id,
      makeMatched({ observedUsageCount: 1, totalLogRequests: 1, status2xxCount: 1 })
    );

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.baseConfidence).toBe(0.93);
    expect(result.displayConfidence).toBeCloseTo(0.95, 5);
    // Raw uplift would be +5; LLM cap at 0.95 -> applied = +2 pp.
    expect(result.uplift).toBe(2);
    expect(result.baseLabel).toBe('Base confidence');
    expect(result.baseReason).toBe('Initial LLM-derived confidence.');
    expect(result.upliftLabel).toBe('Confidence increased');
    expect(result.upliftReason).toBe(
      'Runtime logs observed 1 successful/redirect calls matching this candidate.'
    );
  });

  it('Test 6: adapter endpoint, observedUsageCount = 0, status5xxCount = 50 -> +0 (4xx/5xx-only does NOT uplift)', () => {
    const candidate = makeCandidate('ep-5xx', 'endpoints', 0.8, {
      _addedBy: 'spring-boot-adapter',
    });
    const ctx = contextWithEndpoint(
      candidate.id,
      makeMatched({
        observedUsageCount: 0,
        totalLogRequests: 50,
        status5xxCount: 50,
      })
    );

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.baseConfidence).toBe(0.8);
    expect(result.displayConfidence).toBe(0.8);
    expect(result.uplift).toBe(0);
    expect(result.baseLabel).toBe('');
    expect(result.baseReason).toBe('');
    expect(result.upliftLabel).toBe('');
    expect(result.upliftReason).toBe('');
  });

  it('Test 7: interface rollup observedEndpointCount = 1, totalEndpointCount = 4 -> +2', () => {
    const candidate = makeCandidate('iface-1', 'interfaces', 0.75, {
      _addedBy: 'spring-boot-adapter',
    });
    const rollup: InterfaceRuntimeRollup = {
      totalObservedCalls: 12,
      observedEndpointCount: 1,
      totalEndpointCount: 4,
      topEndpoints: [],
      statusBreakdown: {
        status2xxCount: 12,
        status3xxCount: 0,
        status4xxCount: 0,
        status5xxCount: 0,
      },
    };
    const ctx = contextWithInterfaceRollup(candidate.id, rollup);

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.uplift).toBe(2);
    expect(result.baseConfidence).toBe(0.75);
    expect(result.displayConfidence).toBeCloseTo(0.77, 5);
    expect(result.baseLabel).toBe('Base confidence');
    expect(result.baseReason).toBe('Deterministic code adapter evidence.');
    expect(result.upliftLabel).toBe('Confidence increased');
    expect(result.upliftReason).toBe('Related endpoint runtime usage observed.');
  });

  it('Test 8: interface_logical_entities rollup with (requestBodyUsageCount + responseBodyUsageCount) > 0 -> +2', () => {
    const candidate = makeCandidate('ile-1', 'interface_logical_entities', 0.6, {
      _addedBy: 'spring-boot-adapter',
    });
    const rollup: InterfaceLogicalEntityRuntimeRollup = {
      supportingEndpointCount: 2,
      requestBodyUsageCount: 5,
      responseBodyUsageCount: 0,
      unknownRoleUsageCount: 0,
      totalObservedContractUsage: 5,
    };
    const ctx = contextWithInterfaceLogicalEntityRollup(candidate.id, rollup);

    const result = getDisplayConfidence(candidate, ctx);

    expect(result.uplift).toBe(2);
    expect(result.baseConfidence).toBe(0.6);
    expect(result.displayConfidence).toBeCloseTo(0.62, 5);
    expect(result.baseLabel).toBe('Base confidence');
    expect(result.baseReason).toBe('Deterministic code adapter evidence.');
    expect(result.upliftLabel).toBe('Confidence increased');
    expect(result.upliftReason).toBe('Related endpoint runtime usage observed.');
  });
});
