/**
 * Spec 2026-07-06-k — coverage-floor evaluator (gateway side). Pins:
 *
 *   FLOOR PIN     — a missed floor-bearing dimension fails the operation and
 *                   is listed with its kind + reason; achieving it clears it
 *   REPORTED PIN  — missed reported-only dimensions (pagination/content_type
 *                   or reported_only flag) never block; they are enumerated
 *   WAIVER PIN    — a waived (operation, dimension) key passes WITH the
 *                   waiver enumerated (never silent)
 *   LEGACY PIN    — dimensions without a kind default from expected_status
 *   AGGREGATE PIN — interface-level aggregation groups failing operations
 *                   under their interface ids (Spec G capture stories)
 */

import {
  aggregateFloorByInterface,
  evaluateCoverageFloor,
  type CoverageSummaryJson,
} from '../services/apiBehaviourCoverageFloor';

function summary(): CoverageSummaryJson {
  return {
    per_endpoint: [
      {
        operation_id: 'op-1',
        method: 'GET',
        path: '/orders/{id}',
        dimensions: [
          { name: 'happy_path', dimension_kind: 'happy', reported_only: false, achieved: true },
          {
            name: 'not_found_id',
            dimension_kind: 'error_status',
            reported_only: false,
            achieved: false,
            reason: 'value not reachable',
          },
          {
            name: 'pagination_first_page',
            dimension_kind: 'pagination',
            reported_only: true,
            achieved: false,
          },
        ],
      },
      {
        operation_id: 'op-2',
        method: 'POST',
        path: '/orders',
        dimensions: [
          { name: 'happy_path', dimension_kind: 'happy', reported_only: false, achieved: true },
          { name: 'bad_request_body', dimension_kind: 'validation', reported_only: false, achieved: true },
        ],
      },
    ],
    auth_coverage: { achieved: true },
  };
}

describe('FLOOR + REPORTED pins', () => {
  it('fails on a missed floor-bearing dimension; reported-only misses never block', () => {
    const result = evaluateCoverageFloor(summary());
    expect(result.passed).toBe(false);
    const op1 = result.operations.find((o) => o.operationId === 'op-1')!;
    expect(op1.passed).toBe(false);
    expect(op1.missedDimensions).toEqual([
      { name: 'not_found_id', kind: 'error_status', reason: 'value not reachable' },
    ]);
    expect(op1.reportedMisses).toEqual(['pagination_first_page']);
    const op2 = result.operations.find((o) => o.operationId === 'op-2')!;
    expect(op2.passed).toBe(true);
  });

  it('passes once the floor-bearing dimension is achieved', () => {
    const s = summary();
    s.per_endpoint![0].dimensions[1].achieved = true;
    const result = evaluateCoverageFloor(s);
    expect(result.passed).toBe(true);
  });
});

describe('WAIVER + LEGACY pins', () => {
  it('a waived (operation, dimension) key passes with the waiver enumerated', () => {
    const result = evaluateCoverageFloor(
      summary(),
      new Set(['GET /orders/{id}::not_found_id']),
    );
    const op1 = result.operations.find((o) => o.operationId === 'op-1')!;
    expect(op1.passed).toBe(true);
    expect(op1.waivedDimensions).toEqual(['not_found_id']);
    expect(result.passed).toBe(true);
  });

  it('legacy dimensions default their kind from expected_status', () => {
    const legacy: CoverageSummaryJson = {
      per_endpoint: [
        {
          operation_id: 'op-9',
          method: 'GET',
          path: '/legacy',
          dimensions: [
            { name: 'happy_path', expected_status: 'success', achieved: false },
            { name: 'not_found_x', expected_status: 'not_found', achieved: false },
          ],
        },
      ],
    };
    const result = evaluateCoverageFloor(legacy);
    const op = result.operations[0];
    expect(op.missedDimensions.map((d) => d.kind).sort()).toEqual([
      'error_status',
      'happy',
    ]);
  });

  it('a failed session-level auth dimension fails the floor', () => {
    const s = summary();
    s.per_endpoint![0].dimensions[1].achieved = true;
    s.auth_coverage = { achieved: false };
    expect(evaluateCoverageFloor(s).passed).toBe(false);
  });
});

describe('AGGREGATE PIN', () => {
  it('groups failing operations under their interface ids', () => {
    const evaluation = evaluateCoverageFloor(summary());
    const byInterface = aggregateFloorByInterface(
      evaluation,
      new Map([
        ['iface-orders', new Set(['GET /orders/{id}', 'POST /orders'])],
        ['iface-other', new Set(['GET /other'])],
      ]),
    );
    expect(byInterface.get('iface-orders')!.passed).toBe(false);
    expect(byInterface.get('iface-orders')!.failingOperations[0].operationId).toBe('op-1');
    expect(byInterface.get('iface-other')!.passed).toBe(true); // no data = no fail
  });
});
