/**
 * Happy-path coverage gate (CC1, Spec 2026-07-20 Coverage Closure).
 *
 * Pins the gate contract: complete IFF every included endpoint captured its
 * happy-path baseline; excluded endpoints (absent from per_endpoint) are OUT of
 * the denominator; a null / empty summary is never "complete".
 */
import { computeHappyPathGate } from '../services/captureCoverageGate';
import type {
  CoverageSummary,
  EndpointCoverageResult,
  CoverageDimensionResult,
} from '../services/captureSessionOrchestrator';

function happyDim(achieved: boolean, reason: string | null = null): CoverageDimensionResult {
  return {
    name: 'happy_path',
    type: 'happy_path',
    expected_status: 'success',
    dimension_kind: 'happy',
    reported_only: false,
    achieved,
    canonical_capture_id: achieved ? 'cap-1' : null,
    reason: achieved ? null : reason,
    observation: null,
  };
}

function negDim(achieved: boolean): CoverageDimensionResult {
  return {
    name: 'not_found',
    type: 'not_found',
    expected_status: 'not_found',
    dimension_kind: 'error_status',
    reported_only: false,
    achieved,
    canonical_capture_id: achieved ? 'cap-2' : null,
    reason: achieved ? null : 'no not_found capture',
    observation: null,
  };
}

function ep(
  operation_id: string,
  method: string,
  path: string,
  dimensions: CoverageDimensionResult[],
): EndpointCoverageResult {
  const achieved = dimensions.filter((d) => d.achieved).length;
  return {
    operation_id,
    method,
    path,
    score: dimensions.length ? achieved / dimensions.length : 0,
    dimensions,
  };
}

function summaryOf(per_endpoint: EndpointCoverageResult[]): CoverageSummary {
  return {
    overall_score: 0,
    dimensions_total: 0,
    dimensions_achieved: 0,
    per_endpoint,
    auth_coverage: { achieved: false, representative_operation_id: null, probes: [] },
    observations: [],
  };
}

describe('computeHappyPathGate', () => {
  it('null / unrecorded summary -> not complete, nothing unresolved', () => {
    for (const raw of [null, undefined, {} as unknown as CoverageSummary]) {
      const gate = computeHappyPathGate(raw as CoverageSummary | null);
      expect(gate.complete).toBe(false);
      expect(gate.included_total).toBe(0);
      expect(gate.happy_achieved).toBe(0);
      expect(gate.unresolved).toEqual([]);
    }
  });

  it('every included endpoint has happy-path -> complete (negatives missing is irrelevant)', () => {
    const gate = computeHappyPathGate(
      summaryOf([
        ep('op1', 'GET', '/orders', [happyDim(true), negDim(false)]),
        ep('op2', 'GET', '/orders/{id}', [happyDim(true)]),
      ]),
    );
    expect(gate.complete).toBe(true);
    expect(gate.included_total).toBe(2);
    expect(gate.happy_achieved).toBe(2);
    expect(gate.unresolved).toEqual([]);
  });

  it('an included endpoint missing happy-path -> not complete, listed unresolved with its reason', () => {
    const gate = computeHappyPathGate(
      summaryOf([
        ep('op1', 'GET', '/orders', [happyDim(true)]),
        ep('op2', 'GET', '/orders/{id}', [happyDim(false, 'id 999 not found')]),
      ]),
    );
    expect(gate.complete).toBe(false);
    expect(gate.included_total).toBe(2);
    expect(gate.happy_achieved).toBe(1);
    expect(gate.unresolved).toEqual([
      { operation_id: 'op2', method: 'GET', path: '/orders/{id}', reason: 'id 999 not found' },
    ]);
  });

  it('endpoint with NO happy dimension at all -> unresolved with a default reason', () => {
    const gate = computeHappyPathGate(summaryOf([ep('op3', 'POST', '/x', [negDim(true)])]));
    expect(gate.complete).toBe(false);
    expect(gate.unresolved[0].operation_id).toBe('op3');
    expect(gate.unresolved[0].reason).toMatch(/happy-path baseline not captured/);
  });

  it('zero included endpoints -> not complete (nothing to stand behind)', () => {
    const gate = computeHappyPathGate(summaryOf([]));
    expect(gate.complete).toBe(false);
    expect(gate.included_total).toBe(0);
  });
});
