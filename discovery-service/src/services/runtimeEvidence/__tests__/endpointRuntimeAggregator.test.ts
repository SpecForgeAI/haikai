/**
 * Aggregator tests for endpointRuntimeAggregator.
 *
 * Per Spec 5 Task 2.1, kept tight and focused on the critical
 * behaviours called out in the task brief:
 *   - Grouping by `method + normalizedPath` with status distribution
 *   - `observedUsageCount` = 2xx + 3xx only (4xx + 5xx excluded)
 *   - `firstSeen` / `lastSeen` timestamps captured across observations
 *   - Pure-404 routes excluded from aggregates AND unmatched hints
 *   - `RUNTIME_UNMATCHED_HINT_THRESHOLD` env var honoured (default 5)
 *
 * These tests are pure-module — no mocks, no I/O.
 */

import { HttpRuntimeObservation } from '../httpRuntimeObservation';

function obs(
  partial: Partial<HttpRuntimeObservation> & { method: string; status: number; rawPath: string },
): HttpRuntimeObservation {
  return {
    method: partial.method,
    rawPath: partial.rawPath,
    normalizedPath: partial.normalizedPath ?? partial.rawPath,
    status: partial.status,
    timestampIso: partial.timestampIso,
    sourceArtifactId: partial.sourceArtifactId ?? 'artifact-1',
    sourceFileName: partial.sourceFileName ?? 'access.log',
    lineNumber: partial.lineNumber ?? 1,
    snippet: partial.snippet,
  };
}

describe('endpointRuntimeAggregator.aggregateObservations', () => {
  it('aggregates by method + normalizedPath, captures status distribution and time window, and excludes 4xx/5xx from observedUsageCount', () => {
    // Use isolateModules so the env-default (5) is read at import time.
    const original = process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD;
    delete process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD;

    let aggregateObservations: typeof import('../endpointRuntimeAggregator').aggregateObservations;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      aggregateObservations = require('../endpointRuntimeAggregator').aggregateObservations;
    });

    const observations: HttpRuntimeObservation[] = [
      obs({ method: 'get', rawPath: '/users/{id}', status: 200, timestampIso: '2026-05-10T10:00:00.000Z', lineNumber: 1 }),
      obs({ method: 'GET', rawPath: '/users/{id}', status: 200, timestampIso: '2026-05-10T11:00:00.000Z', lineNumber: 2 }),
      obs({ method: 'GET', rawPath: '/users/{id}', status: 302, timestampIso: '2026-05-10T09:30:00.000Z', lineNumber: 3 }),
      obs({ method: 'GET', rawPath: '/users/{id}', status: 404, timestampIso: '2026-05-10T12:00:00.000Z', lineNumber: 4 }),
      obs({ method: 'GET', rawPath: '/users/{id}', status: 500, timestampIso: '2026-05-10T12:30:00.000Z', lineNumber: 5 }),
      // Different method on same path → different aggregate
      obs({ method: 'POST', rawPath: '/users/{id}', status: 200, timestampIso: '2026-05-10T10:15:00.000Z', lineNumber: 6 }),
    ];

    const { aggregates } = aggregateObservations!(observations);

    expect(aggregates.size).toBe(2);
    const getAggregate = aggregates.get('GET /users/{id}');
    expect(getAggregate).toBeDefined();
    expect(getAggregate!.totalLogRequests).toBe(5);
    expect(getAggregate!.observedUsageCount).toBe(3); // 2x 200 + 1x 302
    expect(getAggregate!.status2xxCount).toBe(2);
    expect(getAggregate!.status3xxCount).toBe(1);
    expect(getAggregate!.status4xxCount).toBe(1);
    expect(getAggregate!.status5xxCount).toBe(1);
    expect(getAggregate!.firstSeen).toBe('2026-05-10T09:30:00.000Z');
    expect(getAggregate!.lastSeen).toBe('2026-05-10T12:30:00.000Z');

    const postAggregate = aggregates.get('POST /users/{id}');
    expect(postAggregate).toBeDefined();
    expect(postAggregate!.totalLogRequests).toBe(1);
    expect(postAggregate!.observedUsageCount).toBe(1);

    if (original === undefined) {
      delete process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD;
    } else {
      process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD = original;
    }
  });

  it('excludes pure-404 routes (every observation 404, zero 2xx/3xx) from aggregates AND unmatched hints', () => {
    const original = process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD;
    process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD = '1';

    let aggregateObservations: typeof import('../endpointRuntimeAggregator').aggregateObservations;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      aggregateObservations = require('../endpointRuntimeAggregator').aggregateObservations;
    });

    const observations: HttpRuntimeObservation[] = [
      obs({ method: 'GET', rawPath: '/missing', status: 404, lineNumber: 1 }),
      obs({ method: 'GET', rawPath: '/missing', status: 404, lineNumber: 2 }),
      obs({ method: 'GET', rawPath: '/missing', status: 404, lineNumber: 3 }),
      // A real route that should still appear
      obs({ method: 'GET', rawPath: '/real', status: 200, lineNumber: 4 }),
    ];

    const { aggregates, unmatchedRouteHintCandidates } = aggregateObservations!(observations);

    expect(aggregates.has('GET /missing')).toBe(false);
    expect(aggregates.has('GET /real')).toBe(true);
    // Pure-404 must not appear as an unmatched hint candidate either
    const hintKeys = unmatchedRouteHintCandidates.map((h) => `${h.method} ${h.normalizedPath}`);
    expect(hintKeys).not.toContain('GET /missing');

    if (original === undefined) {
      delete process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD;
    } else {
      process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD = original;
    }
  });

  it('honours RUNTIME_UNMATCHED_HINT_THRESHOLD globally (below threshold → no hint emitted)', () => {
    const original = process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD;

    // Threshold = 5: 4 successful observations should NOT emit a hint
    process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD = '5';

    let aggregateObservations: typeof import('../endpointRuntimeAggregator').aggregateObservations;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      aggregateObservations = require('../endpointRuntimeAggregator').aggregateObservations;
    });

    const belowThreshold: HttpRuntimeObservation[] = [
      obs({ method: 'GET', rawPath: '/below', status: 200, lineNumber: 1 }),
      obs({ method: 'GET', rawPath: '/below', status: 200, lineNumber: 2 }),
      obs({ method: 'GET', rawPath: '/below', status: 200, lineNumber: 3 }),
      obs({ method: 'GET', rawPath: '/below', status: 200, lineNumber: 4 }),
    ];

    const belowResult = aggregateObservations!(belowThreshold);
    expect(belowResult.aggregates.has('GET /below')).toBe(true);
    expect(
      belowResult.unmatchedRouteHintCandidates.some((h) => h.normalizedPath === '/below'),
    ).toBe(false);

    // Now 5 hits → at threshold → should emit a hint candidate
    let aggregateObservations2: typeof import('../endpointRuntimeAggregator').aggregateObservations;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      aggregateObservations2 = require('../endpointRuntimeAggregator').aggregateObservations;
    });

    const atThreshold: HttpRuntimeObservation[] = [
      obs({ method: 'GET', rawPath: '/atthresh', status: 200, lineNumber: 1 }),
      obs({ method: 'GET', rawPath: '/atthresh', status: 200, lineNumber: 2 }),
      obs({ method: 'GET', rawPath: '/atthresh', status: 200, lineNumber: 3 }),
      obs({ method: 'GET', rawPath: '/atthresh', status: 200, lineNumber: 4 }),
      obs({ method: 'GET', rawPath: '/atthresh', status: 200, lineNumber: 5 }),
    ];

    const atResult = aggregateObservations2!(atThreshold);
    expect(
      atResult.unmatchedRouteHintCandidates.some((h) => h.normalizedPath === '/atthresh'),
    ).toBe(true);

    if (original === undefined) {
      delete process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD;
    } else {
      process.env.RUNTIME_UNMATCHED_HINT_THRESHOLD = original;
    }
  });
});
