/**
 * Tests for runtimeEvidenceLlmContextBuilder.
 *
 * Per Spec 5 Task 3.1, kept tight and focused on the critical
 * behaviours called out in the task brief:
 *   - Output JSON matches the pinned `RuntimeEvidenceLlmContext` shape
 *     verbatim (no per-endpoint firstSeen/lastSeen, no source files,
 *     no sample line refs, no snippets, no IPs, no user agents).
 *   - Skipped run summaries collapse to a minimal "no runtime
 *     evidence" context the gap-fill stage can interpret.
 *   - Compactness: the serialized JSON for a representative fixture
 *     stays under an 8KB byte budget (proxy for the ≤500-token spec
 *     target — at ~4 chars/token, 500 tokens ≈ 2KB; the 8KB budget
 *     leaves generous headroom).
 *
 * Pure-module tests — no mocks, no I/O.
 */

import { buildRuntimeEvidenceLlmContext } from '../runtimeEvidenceLlmContextBuilder';
import {
  MatchedRuntimeEvidence,
  NoUsageRuntimeEvidence,
  RuntimeEvidenceRunSummary,
} from '../httpRuntimeObservation';

function buildMatched(overrides: Partial<MatchedRuntimeEvidence>): MatchedRuntimeEvidence {
  return {
    candidateId: overrides.candidateId ?? 'cand-1',
    candidateType: 'endpoints',
    method: overrides.method ?? 'GET',
    codePathTemplate: overrides.codePathTemplate ?? '/users/{id}',
    normalizedLogPath: overrides.normalizedLogPath ?? '/users/{id}',
    totalLogRequests: overrides.totalLogRequests ?? 100,
    observedUsageCount: overrides.observedUsageCount ?? 95,
    status2xxCount: overrides.status2xxCount ?? 90,
    status3xxCount: overrides.status3xxCount ?? 5,
    status4xxCount: overrides.status4xxCount ?? 4,
    status5xxCount: overrides.status5xxCount ?? 1,
    topStatusCodes: overrides.topStatusCodes ?? [
      { status: 200, count: 90 },
      { status: 304, count: 5 },
    ],
    firstSeen: overrides.firstSeen ?? '2026-05-01T00:00:00Z',
    lastSeen: overrides.lastSeen ?? '2026-05-02T00:00:00Z',
    sourceLogFileCount: overrides.sourceLogFileCount ?? 2,
    matchConfidence: overrides.matchConfidence ?? 'high',
    matchReason: overrides.matchReason ?? 'exact_normalized_path',
  };
}

function buildNoUsage(candidateId: string): NoUsageRuntimeEvidence {
  return {
    candidateId,
    candidateType: 'endpoints',
    observedUsageCount: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    totalLogRequests: 0,
    noUsageObserved: true,
    note: 'No matching log observations in processed log window',
  };
}

function happyRunSummary(): Extract<RuntimeEvidenceRunSummary, { logFilesProcessed: number }> {
  return {
    logFilesProcessed: 3,
    logWindow: { firstSeen: '2026-05-01T00:00:00Z', lastSeen: '2026-05-03T23:59:59Z' },
    totals: {
      observations: 12345,
      matchedEndpoints: 2,
      noUsageEndpoints: 1,
      unmatchedHints: 1,
    },
    warnings: [],
    unmatchedRouteHints: [
      { method: 'GET', pathTemplate: '/healthz', observedUsageCount: 50, status2xxCount: 50, status3xxCount: 0 },
    ],
  };
}

describe('buildRuntimeEvidenceLlmContext — pinned shape and field stripping', () => {
  it('produces the exact pinned shape and strips per-endpoint firstSeen/lastSeen, source files, sample line refs, and topStatusCodes', () => {
    const matched = [
      buildMatched({ candidateId: 'cand-A', codePathTemplate: '/users/{id}' }),
      buildMatched({ candidateId: 'cand-B', method: 'POST', codePathTemplate: '/orders' }),
    ];
    const noUsage = [buildNoUsage('cand-no-usage')];
    const runSummary = happyRunSummary();

    const ctx = buildRuntimeEvidenceLlmContext(matched, noUsage, runSummary, {
      get: (id) =>
        id === 'cand-no-usage'
          ? { method: 'DELETE', pathTemplate: '/admin/{id}' }
          : undefined,
    });

    // Top-level shape: ONLY `runtimeEvidenceSummary` allowed.
    expect(Object.keys(ctx)).toEqual(['runtimeEvidenceSummary']);

    const s = ctx.runtimeEvidenceSummary;
    expect(s.logFilesProcessed).toBe(3);
    expect(s.logWindow).toEqual({
      firstSeen: '2026-05-01T00:00:00Z',
      lastSeen: '2026-05-03T23:59:59Z',
    });

    // matchedEndpoints — pinned fields only.
    expect(s.matchedEndpoints).toHaveLength(2);
    for (const m of s.matchedEndpoints) {
      expect(Object.keys(m).sort()).toEqual(
        [
          'candidateId',
          'method',
          'pathTemplate',
          'observedUsageCount',
          'status2xxCount',
          'status3xxCount',
          'status4xxCount',
          'status5xxCount',
        ].sort(),
      );
    }
    expect(s.matchedEndpoints[0]).toMatchObject({
      candidateId: 'cand-A',
      method: 'GET',
      pathTemplate: '/users/{id}',
    });
    expect(s.matchedEndpoints[1]).toMatchObject({
      candidateId: 'cand-B',
      method: 'POST',
      pathTemplate: '/orders',
    });

    // codeEndpointsWithNoObservedUsage — identity-only fields.
    expect(s.codeEndpointsWithNoObservedUsage).toHaveLength(1);
    expect(Object.keys(s.codeEndpointsWithNoObservedUsage[0]).sort()).toEqual(
      ['candidateId', 'method', 'pathTemplate'].sort(),
    );
    expect(s.codeEndpointsWithNoObservedUsage[0]).toEqual({
      candidateId: 'cand-no-usage',
      method: 'DELETE',
      pathTemplate: '/admin/{id}',
    });

    // unmatchedRuntimeRouteHints — pinned fields only.
    expect(s.unmatchedRuntimeRouteHints).toHaveLength(1);
    expect(Object.keys(s.unmatchedRuntimeRouteHints[0]).sort()).toEqual(
      ['method', 'pathTemplate', 'observedUsageCount'].sort(),
    );
  });

  it('returns a minimal empty context when the run summary is the skipped-no-log-artifacts variant', () => {
    const ctx = buildRuntimeEvidenceLlmContext([], [], {
      skipped: true,
      reason: 'no_log_artifacts',
    });

    expect(ctx).toEqual({
      runtimeEvidenceSummary: {
        logFilesProcessed: 0,
        logWindow: {},
        matchedEndpoints: [],
        codeEndpointsWithNoObservedUsage: [],
        unmatchedRuntimeRouteHints: [],
      },
    });
  });

  it('returns a minimal empty context when the run summary is the skipped-log-processing-failed variant', () => {
    const ctx = buildRuntimeEvidenceLlmContext([], [], {
      skipped: true,
      reason: 'log_processing_failed',
      warnings: ['file foo.log unreadable'],
    });

    // Even with provided matched/noUsage the skipped variant collapses.
    expect(ctx.runtimeEvidenceSummary.matchedEndpoints).toEqual([]);
    expect(ctx.runtimeEvidenceSummary.codeEndpointsWithNoObservedUsage).toEqual([]);
    expect(ctx.runtimeEvidenceSummary.unmatchedRuntimeRouteHints).toEqual([]);
  });
});

describe('buildRuntimeEvidenceLlmContext — privacy and compactness', () => {
  it('contains no IPs, user agents, referrers, snippets, or sample line refs even on a representative fixture, and stays under an 8KB byte budget', () => {
    // A representative fixture: 15 matched endpoints, 15 no-usage candidates,
    // 5 unmatched hints — sized to stay under the spec's 500-token target
    // (~2KB) while still proving the compactness rule.
    const matched: MatchedRuntimeEvidence[] = [];
    for (let i = 0; i < 15; i++) {
      matched.push(buildMatched({
        candidateId: `cand-matched-${i}`,
        codePathTemplate: `/api/v1/resources/{id}/items/{itemId}/segment-${i}`,
        method: i % 2 === 0 ? 'GET' : 'POST',
      }));
    }
    const noUsage: NoUsageRuntimeEvidence[] = [];
    const identities = new Map<string, { method: string; pathTemplate: string }>();
    for (let i = 0; i < 15; i++) {
      const candidateId = `cand-no-usage-${i}`;
      noUsage.push(buildNoUsage(candidateId));
      identities.set(candidateId, {
        method: i % 2 === 0 ? 'PUT' : 'DELETE',
        pathTemplate: `/api/v1/cold/{id}/path-${i}`,
      });
    }
    const runSummary = happyRunSummary();
    runSummary.unmatchedRouteHints = [];
    for (let i = 0; i < 5; i++) {
      runSummary.unmatchedRouteHints.push({
        method: 'GET',
        pathTemplate: `/legacy/route-${i}/{id}`,
        observedUsageCount: 5 + i,
        status2xxCount: 5 + i,
        status3xxCount: 0,
      });
    }

    const ctx = buildRuntimeEvidenceLlmContext(matched, noUsage, runSummary, {
      get: (id) => identities.get(id),
    });

    const serialized = JSON.stringify(ctx);

    // Privacy assertions — none of these tokens should appear in the
    // serialized output.
    expect(serialized).not.toMatch(/\bsnippet\b/);
    expect(serialized).not.toMatch(/\bsourceLogFiles\b/);
    expect(serialized).not.toMatch(/\bsampleLineRefs\b/);
    expect(serialized).not.toMatch(/\bsourceArtifactId\b/);
    expect(serialized).not.toMatch(/\buserAgent\b/i);
    expect(serialized).not.toMatch(/\breferrer\b/i);
    expect(serialized).not.toMatch(/\bipAddress\b/i);
    // Per-endpoint timestamps should NOT appear inside the matched array
    // entries (only the run-level logWindow carries them).
    for (const m of ctx.runtimeEvidenceSummary.matchedEndpoints) {
      expect(Object.prototype.hasOwnProperty.call(m, 'firstSeen')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(m, 'lastSeen')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(m, 'topStatusCodes')).toBe(false);
    }

    // Compactness — under 8KB even with a 35-entry combined fixture.
    expect(serialized.length).toBeLessThan(8192);
  });
});
