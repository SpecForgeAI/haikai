/**
 * Pure unit tests for runtimeEvidenceContextBuilder.ts
 *
 * Spec 6 (2026-05-11): Log Evidence in Candidate Details UI — Task Group 2.1.
 *
 * Strict scope: pure module tests over the cross-candidate aggregator.
 * No React, no rendering, no mocks (`vi.mock`). The module has no React,
 * CSS, or API imports, so test seams are not required.
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import type {
  MatchedRuntimeEvidence,
  NoUsageRuntimeEvidence,
} from '../candidateEvidenceTypes';
import { buildRuntimeEvidenceContext } from '../runtimeEvidenceContextBuilder';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  id: string,
  candidateType: string,
  data: Record<string, unknown>,
  log_enrichment?: Record<string, unknown>
): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-1',
    candidate_type: candidateType,
    name: id,
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data,
    synthesized_at: '2026-05-11T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    log_enrichment,
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
    status2xxCount: 8,
    status3xxCount: 1,
    status4xxCount: 1,
    status5xxCount: 0,
    firstSeen: '2026-05-01T10:00:00Z',
    lastSeen: '2026-05-05T18:00:00Z',
    matchConfidence: 0.95,
    matchReason: 'exact match',
    ...overrides,
  };
}

function makeNoUsage(): NoUsageRuntimeEvidence {
  return {
    noUsageObserved: true,
    observedUsageCount: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    note: 'no observation in window',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildRuntimeEvidenceContext', () => {
  it('returns empty maps for all four context fields when given an empty candidate list', () => {
    const ctx = buildRuntimeEvidenceContext([]);

    expect(ctx.byCandidateId.size).toBe(0);
    expect(ctx.interfaceRollupByCandidateId.size).toBe(0);
    expect(ctx.logicalDataEntityRollupByCandidateId.size).toBe(0);
    expect(ctx.interfaceLogicalEntityRollupByCandidateId.size).toBe(0);
  });

  it('populates per-candidate map from endpoints with both matched and noUsageObserved runtime', () => {
    const matchedEndpoint = makeCandidate(
      'ep-matched',
      'endpoints',
      { controllerClassName: 'OwnerController', httpMethod: 'GET' },
      { runtime: { matched: makeMatched({ observedUsageCount: 42 }) } }
    );
    const noUsageEndpoint = makeCandidate(
      'ep-no-usage',
      'endpoints',
      { controllerClassName: 'OwnerController', httpMethod: 'POST' },
      { runtime: makeNoUsage() }
    );
    const noEnrichmentEndpoint = makeCandidate(
      'ep-bare',
      'endpoints',
      { controllerClassName: 'OwnerController', httpMethod: 'PUT' }
    );

    const ctx = buildRuntimeEvidenceContext([
      matchedEndpoint,
      noUsageEndpoint,
      noEnrichmentEndpoint,
    ]);

    expect(ctx.byCandidateId.size).toBe(2);

    const matchedSlice = ctx.byCandidateId.get('ep-matched');
    expect(matchedSlice).toBeDefined();
    expect('matched' in matchedSlice!.runtime).toBe(true);
    if ('matched' in matchedSlice!.runtime) {
      expect(matchedSlice!.runtime.matched.observedUsageCount).toBe(42);
    }

    const noUsageSlice = ctx.byCandidateId.get('ep-no-usage');
    expect(noUsageSlice).toBeDefined();
    expect('noUsageObserved' in noUsageSlice!.runtime).toBe(true);

    expect(ctx.byCandidateId.has('ep-bare')).toBe(false);
  });

  it('aggregates the interface rollup by controllerClassName ↔ className', () => {
    const ifaceCandidate = makeCandidate('iface-1', 'interfaces', {
      className: 'OwnerController',
    });
    const ep1 = makeCandidate(
      'ep-1',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
        pathTemplate: '/owners',
      },
      {
        runtime: {
          matched: makeMatched({
            method: 'GET',
            codePathTemplate: '/owners',
            observedUsageCount: 100,
            status2xxCount: 90,
            status3xxCount: 5,
            status4xxCount: 5,
            status5xxCount: 0,
            firstSeen: '2026-05-01T00:00:00Z',
            lastSeen: '2026-05-04T00:00:00Z',
          }),
        },
      }
    );
    const ep2 = makeCandidate(
      'ep-2',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
        pathTemplate: '/owners/{id}',
      },
      {
        runtime: {
          matched: makeMatched({
            method: 'GET',
            codePathTemplate: '/owners/{id}',
            observedUsageCount: 250,
            status2xxCount: 200,
            status3xxCount: 0,
            status4xxCount: 50,
            status5xxCount: 0,
            firstSeen: '2026-04-30T00:00:00Z',
            lastSeen: '2026-05-06T00:00:00Z',
          }),
        },
      }
    );
    const ep3NoEvidence = makeCandidate('ep-3', 'endpoints', {
      controllerClassName: 'OwnerController',
      httpMethod: 'POST',
      pathTemplate: '/owners',
    });
    // Different controller — must NOT be included.
    const epOther = makeCandidate(
      'ep-other',
      'endpoints',
      {
        controllerClassName: 'PetController',
        httpMethod: 'GET',
        pathTemplate: '/pets',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 999 }) } }
    );

    const ctx = buildRuntimeEvidenceContext([
      ifaceCandidate,
      ep1,
      ep2,
      ep3NoEvidence,
      epOther,
    ]);

    const rollup = ctx.interfaceRollupByCandidateId.get('iface-1');
    expect(rollup).toBeDefined();
    expect(rollup!.totalObservedCalls).toBe(350);
    expect(rollup!.observedEndpointCount).toBe(2);
    expect(rollup!.totalEndpointCount).toBe(3);
    expect(rollup!.topEndpoints).toHaveLength(1);
    expect(rollup!.topEndpoints[0]).toEqual({
      method: 'GET',
      pathTemplate: '/owners/{id}',
      observedUsageCount: 250,
    });
    expect(rollup!.statusBreakdown).toEqual({
      status2xxCount: 290,
      status3xxCount: 5,
      status4xxCount: 55,
      status5xxCount: 0,
    });
    expect(rollup!.firstSeen).toBe('2026-04-30T00:00:00Z');
    expect(rollup!.lastSeen).toBe('2026-05-06T00:00:00Z');
  });

  it('builds the logical-data-entity rollup with read-like vs write-like split by HTTP method', () => {
    const entity = makeCandidate('entity-1', 'logical_data_entities', {
      className: 'Owner',
    });
    const ile = makeCandidate('ile-1', 'interface_logical_entities', {
      logicalEntityName: 'Owner',
      interfaceClassName: 'OwnerController',
    });
    const getEp = makeCandidate(
      'ep-get',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
      },
      {
        runtime: {
          matched: makeMatched({
            observedUsageCount: 100,
            firstSeen: '2026-05-01T00:00:00Z',
            lastSeen: '2026-05-03T00:00:00Z',
          }),
        },
      }
    );
    const headEp = makeCandidate(
      'ep-head',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'HEAD',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 5 }) } }
    );
    const postEp = makeCandidate(
      'ep-post',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'POST',
      },
      {
        runtime: {
          matched: makeMatched({
            observedUsageCount: 30,
            firstSeen: '2026-04-29T00:00:00Z',
            lastSeen: '2026-05-08T00:00:00Z',
          }),
        },
      }
    );
    const deleteEp = makeCandidate(
      'ep-del',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'DELETE',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 7 }) } }
    );

    const ctx = buildRuntimeEvidenceContext([
      entity,
      ile,
      getEp,
      headEp,
      postEp,
      deleteEp,
    ]);

    const rollup = ctx.logicalDataEntityRollupByCandidateId.get('entity-1');
    expect(rollup).toBeDefined();
    expect(rollup!.totalObservedCalls).toBe(142);
    expect(rollup!.relatedEndpointCount).toBe(4);
    expect(rollup!.readLikeCount).toBe(105); // 100 (GET) + 5 (HEAD)
    expect(rollup!.writeLikeCount).toBe(37); // 30 (POST) + 7 (DELETE)
    expect(rollup!.firstSeen).toBe('2026-04-29T00:00:00Z');
    expect(rollup!.lastSeen).toBe('2026-05-08T00:00:00Z');
  });

  it('classifies interface_logical_entities role buckets, including same endpoint contributing to BOTH request and response', () => {
    const ile = makeCandidate('ile-1', 'interface_logical_entities', {
      logicalEntityName: 'Owner',
      interfaceClassName: 'OwnerController',
    });
    // Endpoint where Owner is BOTH request body AND response body — same
    // endpoint must contribute to both buckets.
    const dualEp = makeCandidate(
      'ep-dual',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'PUT',
        requestBodyType: 'Owner',
        responseType: 'Owner',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 20 }) } }
    );
    // Endpoint where Owner is response only (via responseType).
    const responseOnlyEp = makeCandidate(
      'ep-resp',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
        responseType: 'Owner',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 30 }) } }
    );
    // Endpoint where Owner is response via fallback unwrappedReturnType.
    const fallbackResponseEp = makeCandidate(
      'ep-resp-fallback',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
        unwrappedReturnType: 'Owner',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 5 }) } }
    );
    // Endpoint where Owner is request only.
    const requestOnlyEp = makeCandidate(
      'ep-req',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'POST',
        requestBodyType: 'Owner',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 10 }) } }
    );
    // Endpoint with matched evidence but NEITHER body matches Owner — Unknown.
    const unknownEp = makeCandidate(
      'ep-unknown',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
        requestBodyType: 'SomethingElse',
        responseType: 'AnotherThing',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 3 }) } }
    );

    const ctx = buildRuntimeEvidenceContext([
      ile,
      dualEp,
      responseOnlyEp,
      fallbackResponseEp,
      requestOnlyEp,
      unknownEp,
    ]);

    const rollup = ctx.interfaceLogicalEntityRollupByCandidateId.get('ile-1');
    expect(rollup).toBeDefined();
    expect(rollup!.supportingEndpointCount).toBe(5);
    expect(rollup!.requestBodyUsageCount).toBe(30); // 20 (dual) + 10 (req)
    expect(rollup!.responseBodyUsageCount).toBe(55); // 20 (dual) + 30 (resp) + 5 (fallback)
    expect(rollup!.unknownRoleUsageCount).toBe(3);
    expect(rollup!.totalObservedContractUsage).toBe(88); // 30 + 55 + 3
  });

  it('degrades gracefully when controllerClassName / requestBodyType / responseType are missing', () => {
    const ile = makeCandidate('ile-1', 'interface_logical_entities', {
      logicalEntityName: 'Owner',
      interfaceClassName: 'OwnerController',
    });
    // Endpoint with matched evidence but missing requestBodyType / responseType.
    const epNoBodyTypes = makeCandidate(
      'ep-no-body',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
      },
      { runtime: { matched: makeMatched({ observedUsageCount: 12 }) } }
    );
    // Endpoint with no controllerClassName — should NOT match the rollup chain at all.
    const epNoController = makeCandidate(
      'ep-no-ctrl',
      'endpoints',
      { httpMethod: 'GET', requestBodyType: 'Owner' },
      { runtime: { matched: makeMatched({ observedUsageCount: 999 }) } }
    );
    // Interface with no className — rollup should still emit (zero counts).
    const ifaceNoClassName = makeCandidate('iface-empty', 'interfaces', {});

    const ctx = buildRuntimeEvidenceContext([
      ile,
      epNoBodyTypes,
      epNoController,
      ifaceNoClassName,
    ]);

    const ileRollup = ctx.interfaceLogicalEntityRollupByCandidateId.get('ile-1');
    expect(ileRollup).toBeDefined();
    expect(ileRollup!.supportingEndpointCount).toBe(1);
    expect(ileRollup!.requestBodyUsageCount).toBe(0);
    expect(ileRollup!.responseBodyUsageCount).toBe(0);
    expect(ileRollup!.unknownRoleUsageCount).toBe(12);
    expect(ileRollup!.totalObservedContractUsage).toBe(12);

    const ifaceRollup = ctx.interfaceRollupByCandidateId.get('iface-empty');
    expect(ifaceRollup).toBeDefined();
    expect(ifaceRollup!.totalObservedCalls).toBe(0);
    expect(ifaceRollup!.observedEndpointCount).toBe(0);
    expect(ifaceRollup!.totalEndpointCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Spec 6 Group 5.3 — strategic gap-fill: mixed candidate types in one list.
  // -------------------------------------------------------------------------
  // The six tests above each focus on ONE rollup at a time. This test
  // exercises ALL FOUR rollups together in a single mixed-type candidate
  // list, codifying the guarantee that the four-pass aggregator's passes
  // do not interfere with each other (e.g. that bucketing endpoints by
  // controllerClassName once is correctly reused by the interface,
  // logical-data-entity, AND interface-logical-entity rollups in a single
  // walk over the candidates).
  it('produces correct rollups for all four candidate types in a single mixed list', () => {
    // Topology:
    //   interface OwnerController (className: 'OwnerController')
    //     ↳ endpoint GET /owners        (50 calls,  responseType: 'Owner')
    //     ↳ endpoint POST /owners       (10 calls,  requestBodyType: 'Owner')
    //     ↳ endpoint GET /owners/{id}/no-evidence (no matched evidence)
    //   interface_logical_entities (Owner ↔ OwnerController)
    //   logical_data_entities Owner    (className: 'Owner')
    const iface = makeCandidate('iface-mixed', 'interfaces', {
      className: 'OwnerController',
    });
    const ile = makeCandidate('ile-mixed', 'interface_logical_entities', {
      logicalEntityName: 'Owner',
      interfaceClassName: 'OwnerController',
    });
    const lde = makeCandidate('lde-mixed', 'logical_data_entities', {
      className: 'Owner',
    });
    const epRead = makeCandidate(
      'ep-read',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'GET',
        pathTemplate: '/owners',
        responseType: 'Owner',
      },
      {
        runtime: {
          matched: makeMatched({
            method: 'GET',
            codePathTemplate: '/owners',
            observedUsageCount: 50,
            status2xxCount: 50,
            status3xxCount: 0,
            status4xxCount: 0,
            status5xxCount: 0,
            firstSeen: '2026-05-01T00:00:00Z',
            lastSeen: '2026-05-09T00:00:00Z',
          }),
        },
      }
    );
    const epWrite = makeCandidate(
      'ep-write',
      'endpoints',
      {
        controllerClassName: 'OwnerController',
        httpMethod: 'POST',
        pathTemplate: '/owners',
        requestBodyType: 'Owner',
      },
      {
        runtime: {
          matched: makeMatched({
            method: 'POST',
            codePathTemplate: '/owners',
            observedUsageCount: 10,
            status2xxCount: 9,
            status3xxCount: 0,
            status4xxCount: 1,
            status5xxCount: 0,
          }),
        },
      }
    );
    const epBare = makeCandidate('ep-bare', 'endpoints', {
      controllerClassName: 'OwnerController',
      httpMethod: 'DELETE',
      pathTemplate: '/owners/{id}',
    });

    const ctx = buildRuntimeEvidenceContext([
      iface,
      ile,
      lde,
      epRead,
      epWrite,
      epBare,
    ]);

    // byCandidateId — only the two endpoints with runtime blocks.
    expect(ctx.byCandidateId.size).toBe(2);
    expect(ctx.byCandidateId.has('ep-read')).toBe(true);
    expect(ctx.byCandidateId.has('ep-write')).toBe(true);
    expect(ctx.byCandidateId.has('ep-bare')).toBe(false);

    // interfaceRollup — 60 total calls across 2 of 3 related endpoints.
    const ifaceRollup = ctx.interfaceRollupByCandidateId.get('iface-mixed');
    expect(ifaceRollup).toBeDefined();
    expect(ifaceRollup!.totalObservedCalls).toBe(60);
    expect(ifaceRollup!.observedEndpointCount).toBe(2);
    expect(ifaceRollup!.totalEndpointCount).toBe(3);
    expect(ifaceRollup!.topEndpoints).toHaveLength(1);
    expect(ifaceRollup!.topEndpoints[0]!.observedUsageCount).toBe(50);

    // logicalDataEntityRollup — read-like = 50 (GET), write-like = 10 (POST).
    const ldeRollup = ctx.logicalDataEntityRollupByCandidateId.get('lde-mixed');
    expect(ldeRollup).toBeDefined();
    expect(ldeRollup!.totalObservedCalls).toBe(60);
    expect(ldeRollup!.readLikeCount).toBe(50);
    expect(ldeRollup!.writeLikeCount).toBe(10);

    // interfaceLogicalEntityRollup — request body usage = 10 (POST/Owner),
    // response body usage = 50 (GET/Owner), unknown = 0.
    const ileRollup = ctx.interfaceLogicalEntityRollupByCandidateId.get('ile-mixed');
    expect(ileRollup).toBeDefined();
    expect(ileRollup!.supportingEndpointCount).toBe(2); // ep-bare has no matched evidence
    expect(ileRollup!.requestBodyUsageCount).toBe(10);
    expect(ileRollup!.responseBodyUsageCount).toBe(50);
    expect(ileRollup!.unknownRoleUsageCount).toBe(0);
    expect(ileRollup!.totalObservedContractUsage).toBe(60);
  });
});
