/**
 * Matcher tests for endpointRuntimeMatcher.
 *
 * Per Spec 5 Task 2.1, kept tight and focused on the critical
 * behaviours called out in the task brief:
 *   - Exact normalized-path match → matchConfidence 'high'
 *   - Equivalent-placeholder match → matchConfidence 'medium'
 *   - Cross-method matching REJECTED when code candidate's method known and differs;
 *     ALLOWED only when code candidate's method is unknown/missing
 *   - Ambiguous multi-candidate match (two non-deterministic best matches) → NOT attached
 *
 * Discovery Run Robustness Section 1 additions cover:
 *   - Tier-3 suffix match with per-run `maxLogPathPrefixSegments` (M).
 *   - Literal-first-segment guardrail (rejects `/{id}/foo` candidates).
 *   - M = 0 disables tier-3 entirely.
 *   - Per-candidate aggregate merge (multiple aggregates pointing at the
 *     same candidate fold into ONE merged `MatchedRuntimeEvidence`).
 *
 * Pure-module tests, no mocks.
 */

import { matchAggregatesToCandidates } from '../endpointRuntimeMatcher';
import { EndpointRuntimeAggregate } from '../httpRuntimeObservation';
import { DiscoveryCandidate } from '../../../types/candidate';

function aggregate(
  partial: Partial<EndpointRuntimeAggregate> & { method: string; normalizedPath: string },
): EndpointRuntimeAggregate {
  return {
    method: partial.method.toUpperCase(),
    normalizedPath: partial.normalizedPath,
    totalLogRequests: partial.totalLogRequests ?? 1,
    observedUsageCount: partial.observedUsageCount ?? 1,
    status2xxCount: partial.status2xxCount ?? 1,
    status3xxCount: partial.status3xxCount ?? 0,
    status4xxCount: partial.status4xxCount ?? 0,
    status5xxCount: partial.status5xxCount ?? 0,
    topStatusCodes: partial.topStatusCodes ?? [{ status: 200, count: 1 }],
    firstSeen: partial.firstSeen,
    lastSeen: partial.lastSeen,
    sourceLogFileCount: partial.sourceLogFileCount ?? 1,
    sourceLogFiles: partial.sourceLogFiles ?? ['access.log'],
    sampleLineRefs: partial.sampleLineRefs ?? [],
  };
}

function aggregatesMap(items: EndpointRuntimeAggregate[]): Map<string, EndpointRuntimeAggregate> {
  const m = new Map<string, EndpointRuntimeAggregate>();
  for (const a of items) {
    m.set(`${a.method} ${a.normalizedPath}`, a);
  }
  return m;
}

function endpointCandidate(
  id: string,
  method: string | undefined,
  pathTemplate: string,
): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'endpoints',
    name: `${method ?? '?'} ${pathTemplate}`,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: {
      method,
      pathTemplate,
    },
    synthesizedAt: '2026-05-10T00:00:00.000Z',
  };
}

describe('endpointRuntimeMatcher.matchAggregatesToCandidates', () => {
  it('exact normalized-path match → matchConfidence "high"', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/users/{id}' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-1', 'GET', '/users/{id}'),
    ];

    const { matched, noUsage, ambiguousObservations } = matchAggregatesToCandidates(
      aggregates,
      candidates,
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].candidateId).toBe('cand-1');
    expect(matched[0].matchConfidence).toBe('high');
    expect(matched[0].matchReason).toBe('exact_normalized_path');
    expect(matched[0].codePathTemplate).toBe('/users/{id}');
    expect(matched[0].normalizedLogPath).toBe('/users/{id}');
    expect(noUsage).toHaveLength(0);
    expect(ambiguousObservations).toHaveLength(0);
  });

  it('equivalent-placeholder match (different placeholder names) → matchConfidence "medium"', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/owners/{id}/pets/{id}' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-2', 'GET', '/owners/{ownerId}/pets/{petId}'),
    ];

    const { matched } = matchAggregatesToCandidates(aggregates, candidates);

    expect(matched).toHaveLength(1);
    expect(matched[0].candidateId).toBe('cand-2');
    expect(matched[0].matchConfidence).toBe('medium');
    expect(matched[0].matchReason).toBe('equivalent_placeholders');
    // codePathTemplate must preserve the candidate's original (named) template
    expect(matched[0].codePathTemplate).toBe('/owners/{ownerId}/pets/{petId}');
    expect(matched[0].normalizedLogPath).toBe('/owners/{id}/pets/{id}');
  });

  it('cross-method matching is REJECTED when code candidate method is known and differs, but ALLOWED when method is unknown/missing', () => {
    // POST observation; only GET candidate exists for the same path → should NOT match
    const aggregates = aggregatesMap([
      aggregate({ method: 'POST', normalizedPath: '/users/{id}' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-rejected', 'GET', '/users/{id}'),
    ];

    const { matched, noUsage } = matchAggregatesToCandidates(aggregates, candidates);
    expect(matched).toHaveLength(0);
    // The endpoint candidate had no traffic → must appear in noUsage
    expect(noUsage.map((n) => n.candidateId)).toContain('cand-rejected');

    // Now: candidate has unknown/missing method → cross-method match SHOULD be allowed
    const aggregates2 = aggregatesMap([
      aggregate({ method: 'POST', normalizedPath: '/items/{id}' }),
    ]);
    const candidates2: DiscoveryCandidate[] = [
      endpointCandidate('cand-allowed', undefined, '/items/{id}'),
    ];

    const result2 = matchAggregatesToCandidates(aggregates2, candidates2);
    expect(result2.matched).toHaveLength(1);
    expect(result2.matched[0].candidateId).toBe('cand-allowed');
    expect(result2.matched[0].method).toBe('POST');
    expect(result2.noUsage).toHaveLength(0);
  });

  it('ambiguous multi-candidate match (two non-deterministic best matches) → NOT attached to any candidate, recorded in ambiguousObservations', () => {
    // Two GET endpoint candidates with structurally identical placeholder paths
    // both match `/owners/{id}/pets/{id}`. Neither is more specific (same placeholder count,
    // same literal-segment count) → ambiguous.
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/owners/{id}/pets/{id}' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-A', 'GET', '/owners/{ownerId}/pets/{petId}'),
      endpointCandidate('cand-B', 'GET', '/owners/{ownerHash}/pets/{petHash}'),
    ];

    const { matched, ambiguousObservations, noUsage } = matchAggregatesToCandidates(
      aggregates,
      candidates,
    );

    // Neither candidate received the match
    expect(matched).toHaveLength(0);
    // Both candidates listed as no-usage (since neither got attached)
    const noUsageIds = noUsage.map((n) => n.candidateId).sort();
    expect(noUsageIds).toEqual(['cand-A', 'cand-B']);
    // The aggregate is recorded as ambiguous
    expect(ambiguousObservations).toHaveLength(1);
    expect(ambiguousObservations[0].normalizedPath).toBe('/owners/{id}/pets/{id}');
  });
});

// Discovery Run Robustness Section 1 — Tier-3 suffix matcher + per-candidate merge.
describe('endpointRuntimeMatcher.matchAggregatesToCandidates — Tier 3 suffix match', () => {
  it('M = 1 with one-segment-prefix log → matches with `low` confidence and `suffix_match` reason', () => {
    // `/ui/job/12345/succinct` normalizes (proxy-strip removed) to
    // `/ui/job/{id}/succinct` — one leading proxy segment vs the
    // candidate `/job/{id}/succinct` (3 segments).
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/ui/job/{id}/succinct' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-suffix-1', 'GET', '/job/{id}/succinct'),
    ];

    const { matched, noUsage, ambiguousObservations } = matchAggregatesToCandidates(
      aggregates,
      candidates,
      { maxLogPathPrefixSegments: 1 },
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].candidateId).toBe('cand-suffix-1');
    expect(matched[0].matchConfidence).toBe('low');
    expect(matched[0].matchReason).toBe('suffix_match');
    expect(matched[0].codePathTemplate).toBe('/job/{id}/succinct');
    expect(matched[0].normalizedLogPath).toBe('/ui/job/{id}/succinct');
    expect(noUsage).toHaveLength(0);
    expect(ambiguousObservations).toHaveLength(0);
  });

  it('M = 1 with two-segment-prefix log → does NOT match (over the cap)', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/api/proxy/job/{id}/succinct' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-suffix-cap', 'GET', '/job/{id}/succinct'),
    ];

    const { matched, noUsage } = matchAggregatesToCandidates(aggregates, candidates, {
      maxLogPathPrefixSegments: 1,
    });

    expect(matched).toHaveLength(0);
    expect(noUsage.map((n) => n.candidateId)).toContain('cand-suffix-cap');
  });

  it('M = 2 with two-segment-prefix log → matches', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/api/proxy/job/{id}/succinct' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-suffix-2', 'GET', '/job/{id}/succinct'),
    ];

    const { matched } = matchAggregatesToCandidates(aggregates, candidates, {
      maxLogPathPrefixSegments: 2,
    });

    expect(matched).toHaveLength(1);
    expect(matched[0].candidateId).toBe('cand-suffix-2');
    expect(matched[0].matchConfidence).toBe('low');
    expect(matched[0].matchReason).toBe('suffix_match');
  });

  it('M = 0 → no tier-3 matches produced regardless of input', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/ui/job/{id}/succinct' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-m0', 'GET', '/job/{id}/succinct'),
    ];

    const { matched, noUsage } = matchAggregatesToCandidates(aggregates, candidates, {
      maxLogPathPrefixSegments: 0,
    });

    expect(matched).toHaveLength(0);
    expect(noUsage.map((n) => n.candidateId)).toContain('cand-m0');
  });

  it('candidate template `GET /{id}/foo` REJECTED by literal-first-segment guardrail regardless of M', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/ui/{id}/foo' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-bad-first', 'GET', '/{id}/foo'),
    ];

    const { matched, noUsage } = matchAggregatesToCandidates(aggregates, candidates, {
      maxLogPathPrefixSegments: 3,
    });

    expect(matched).toHaveLength(0);
    expect(noUsage.map((n) => n.candidateId)).toContain('cand-bad-first');
  });

  it('two aggregates pointing at the same candidate (tier-1 exact + tier-3 suffix) → ONE merged MatchedRuntimeEvidence with summed counts, unioned window, higher-confidence wins', () => {
    const aggregates = aggregatesMap([
      // Tier-1 exact-match contributor (matches the candidate directly)
      aggregate({
        method: 'GET',
        normalizedPath: '/job/{id}/succinct',
        totalLogRequests: 5,
        observedUsageCount: 4,
        status2xxCount: 4,
        status3xxCount: 0,
        status4xxCount: 1,
        status5xxCount: 0,
        topStatusCodes: [
          { status: 200, count: 4 },
          { status: 404, count: 1 },
        ],
        firstSeen: '2026-05-10T01:00:00.000Z',
        lastSeen: '2026-05-10T02:00:00.000Z',
        sourceLogFileCount: 1,
      }),
      // Tier-3 suffix-match contributor (same candidate via proxy prefix)
      aggregate({
        method: 'GET',
        normalizedPath: '/ui/job/{id}/succinct',
        totalLogRequests: 3,
        observedUsageCount: 3,
        status2xxCount: 3,
        status3xxCount: 0,
        status4xxCount: 0,
        status5xxCount: 0,
        topStatusCodes: [{ status: 200, count: 3 }],
        firstSeen: '2026-05-10T00:30:00.000Z',
        lastSeen: '2026-05-10T03:00:00.000Z',
        sourceLogFileCount: 1,
      }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      endpointCandidate('cand-merge', 'GET', '/job/{id}/succinct'),
    ];

    const { matched, noUsage } = matchAggregatesToCandidates(aggregates, candidates, {
      maxLogPathPrefixSegments: 1,
    });

    expect(matched).toHaveLength(1);
    const m = matched[0];

    expect(m.candidateId).toBe('cand-merge');

    // Summed counts
    expect(m.totalLogRequests).toBe(8);
    expect(m.observedUsageCount).toBe(7);
    expect(m.status2xxCount).toBe(7);
    expect(m.status3xxCount).toBe(0);
    expect(m.status4xxCount).toBe(1);
    expect(m.status5xxCount).toBe(0);
    expect(m.sourceLogFileCount).toBe(2);

    // Unioned time window
    expect(m.firstSeen).toBe('2026-05-10T00:30:00.000Z');
    expect(m.lastSeen).toBe('2026-05-10T03:00:00.000Z');

    // Re-aggregated topStatusCodes (sum per status, sort desc)
    expect(m.topStatusCodes).toEqual([
      { status: 200, count: 7 },
      { status: 404, count: 1 },
    ]);

    // Higher-confidence (tier-1 exact) contributor wins for
    // matchConfidence / matchReason / normalizedLogPath / codePathTemplate.
    expect(m.matchConfidence).toBe('high');
    expect(m.matchReason).toBe('exact_normalized_path');
    expect(m.normalizedLogPath).toBe('/job/{id}/succinct');
    expect(m.codePathTemplate).toBe('/job/{id}/succinct');

    expect(noUsage).toHaveLength(0);
  });

  it('normalizePath("/ui/job/123/succinct") post-removal returns "/ui/job/{id}/succinct" (no proxy strip)', () => {
    // The path normalizer no longer strips proxy prefixes — proof that the
    // env-var hotfix is fully removed. The leading `/ui` segment is now just
    // another literal segment that the suffix matcher tolerates at match time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { normalizePath } = require('../endpointPathNormalizer');
    expect(normalizePath('/ui/job/123/succinct')).toBe('/ui/job/{id}/succinct');
  });
});

describe('canonical merged-candidate field names (2026-08-01)', () => {
  function mergedShapeCandidate(
    id: string,
    verb: string,
    pathOrAddress: string,
  ): DiscoveryCandidate {
    return {
      id,
      runId: 'run-1',
      candidateType: 'endpoints',
      name: `${verb} ${pathOrAddress}`,
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      // The post-merge / save-back shape: NO method/pathTemplate keys —
      // the verb lives under `operation_verb`, the path under
      // `path_or_address`. Before the reader fallbacks, every such
      // candidate was dropped (matchedEndpoints: 0).
      data: {
        operation_verb: verb,
        path_or_address: pathOrAddress,
      },
      synthesizedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  it('binds a merged-shape candidate (operation_verb + path_or_address) to its log aggregate', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'POST', normalizedPath: '/views/lookup' }),
    ]);
    const candidates: DiscoveryCandidate[] = [
      mergedShapeCandidate('cand-merged', 'post', '/views/lookup'),
    ];

    const { matched, noUsage } = matchAggregatesToCandidates(aggregates, candidates);

    expect(matched).toHaveLength(1);
    expect(matched[0].candidateId).toBe('cand-merged');
    expect(matched[0].method).toBe('POST'); // operation_verb read + uppercased
    expect(matched[0].codePathTemplate).toBe('/views/lookup');
    expect(noUsage).toHaveLength(0);
  });

  it('original keys keep precedence over the canonical fallbacks', () => {
    const aggregates = aggregatesMap([
      aggregate({ method: 'GET', normalizedPath: '/orders' }),
    ]);
    const candidate: DiscoveryCandidate = {
      ...mergedShapeCandidate('cand-both', 'delete', '/ignored'),
      data: {
        method: 'get',
        pathTemplate: '/orders',
        operation_verb: 'delete',
        path_or_address: '/ignored',
      },
    };

    const { matched } = matchAggregatesToCandidates(aggregates, [candidate]);

    expect(matched).toHaveLength(1);
    expect(matched[0].method).toBe('GET');
    expect(matched[0].codePathTemplate).toBe('/orders');
  });
});
