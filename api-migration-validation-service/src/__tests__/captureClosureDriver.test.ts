/**
 * Coverage Closure driver — orchestration + summary patch (live integration for
 * CC1-CC3, Spec 2026-07-20).
 *
 * Uses fake firer/repairer/sampler to pin the handoff logic: Pass A fires
 * candidates and stops an endpoint on its first 2xx; survivors go to Pass B;
 * the summary is patched so closed endpoints' happy dimensions read achieved and
 * the gate flips.
 */
import {
  runClosureOrchestration,
  applyClosureToSummary,
  removeEndpointFromSummary,
  isHappyStatus,
  type ClosureFirer,
  type ClosureRepairer,
  type ClosureDbSampler,
} from '../services/captureClosureDriver';
import type { CoverageSummary, EndpointCoverageResult, CoverageDimensionResult } from '../services/captureSessionOrchestrator';
import type { EndpointDiagnosis } from '../services/captureClosurePassB';

function happy(achieved: boolean): CoverageDimensionResult {
  return {
    name: 'happy_path',
    type: 'happy_path',
    expected_status: 'success',
    dimension_kind: 'happy',
    reported_only: false,
    achieved,
    canonical_capture_id: achieved ? 'existing' : null,
    reason: achieved ? null : 'missing',
    observation: null,
  };
}

function ep(operation_id: string, method: string, path: string, achieved: boolean): EndpointCoverageResult {
  return { operation_id, method, path, score: achieved ? 1 : 0, dimensions: [happy(achieved)] };
}

function summaryOf(per_endpoint: EndpointCoverageResult[], authAchieved = false): CoverageSummary {
  const endpointDims = per_endpoint.reduce((a, e) => a + e.dimensions.length, 0);
  const endpointAch = per_endpoint.reduce((a, e) => a + e.dimensions.filter((d) => d.achieved).length, 0);
  return {
    overall_score: (endpointAch + (authAchieved ? 1 : 0)) / (endpointDims + 1),
    dimensions_total: endpointDims + 1,
    dimensions_achieved: endpointAch + (authAchieved ? 1 : 0),
    per_endpoint,
    auth_coverage: { achieved: authAchieved, representative_operation_id: null, probes: [] },
    observations: [],
  };
}

const noopSampler: ClosureDbSampler = { sampleIds: async () => new Map() };
const noopRepairer: ClosureRepairer = { repair: async () => ({ closed: false, captureId: null }) };

describe('isHappyStatus', () => {
  it('is true only for 2xx', () => {
    expect(isHappyStatus(200)).toBe(true);
    expect(isHappyStatus(204)).toBe(true);
    expect([404, 500, null, 302].some(isHappyStatus)).toBe(false);
  });
});

describe('applyClosureToSummary', () => {
  it('flips a closed endpoint happy dimension to achieved + recomputes aggregates', () => {
    const s = summaryOf([ep('op1', 'GET', '/a/{id}', false), ep('op2', 'GET', '/b', true)]);
    const out = applyClosureToSummary(s, new Map([['op1', 'cap-new']]));
    const op1 = out.per_endpoint.find((e) => e.operation_id === 'op1')!;
    expect(op1.dimensions[0].achieved).toBe(true);
    expect(op1.dimensions[0].canonical_capture_id).toBe('cap-new');
    expect(out.dimensions_achieved).toBe(2); // both endpoints now achieved
    expect(out.overall_score).toBeCloseTo(2 / 3); // 2 endpoint dims + 1 auth
  });

  it('injects a happy dimension (and bumps the total) for an endpoint that had none', () => {
    const bare: EndpointCoverageResult = { operation_id: 'op3', method: 'GET', path: '/c/{id}', score: 0, dimensions: [] };
    const s = summaryOf([bare]);
    const out = applyClosureToSummary(s, new Map([['op3', 'cap-x']]));
    expect(out.per_endpoint[0].dimensions[0].achieved).toBe(true);
    expect(out.dimensions_total).toBe(s.dimensions_total + 1);
  });
});

describe('removeEndpointFromSummary (exclude-with-reason)', () => {
  it('drops the endpoint from the gate denominator and records the audit entry', () => {
    const s = summaryOf([ep('op1', 'GET', '/a/{id}', false), ep('op2', 'GET', '/b', true)]);
    const out = removeEndpointFromSummary(s, 'op1', 'endpoint 500s on all input', '2026-07-21T00:00:00Z');
    expect(out.per_endpoint.map((e) => e.operation_id)).toEqual(['op2']);
    // op1 is gone → the remaining endpoint is complete.
    const excluded = (out as unknown as { closure_excluded: Array<{ operation_id: string; reason: string }> }).closure_excluded;
    expect(excluded).toEqual([
      { operation_id: 'op1', method: 'GET', path: '/a/{id}', reason: 'endpoint 500s on all input', at: '2026-07-21T00:00:00Z' },
    ]);
    expect(out.dimensions_total).toBe(s.dimensions_total - 1);
  });

  it('is a no-op for an unknown endpoint', () => {
    const s = summaryOf([ep('op2', 'GET', '/b', true)]);
    expect(removeEndpointFromSummary(s, 'nope', 'x', 't')).toBe(s);
  });
});

describe('runClosureOrchestration', () => {
  it('Pass A closes a path-param endpoint on its first 2xx and stops firing it', async () => {
    const s = summaryOf([ep('op1', 'GET', '/orders/{id}', false)]);
    const fired: string[] = [];
    const firer: ClosureFirer = {
      fireCandidate: async (c) => {
        fired.push(c.path);
        return { status: c.path.endsWith('/7') ? 200 : 404, captureId: 'cap-' + c.path };
      },
    };
    const sampler: ClosureDbSampler = {
      sampleIds: async () => new Map([['dbo.orders', ['9', '7']]]),
    };
    const res = await runClosureOrchestration(
      {
        summary: s,
        tablesByOperationId: new Map([['op1', ['dbo.orders']]]),
        configByOperationId: new Map(),
        diagnosisByOperationId: new Map(),
      },
      firer,
      noopRepairer,
      sampler,
    );
    expect(res.passA.closed).toEqual(['op1']);
    expect(fired).toEqual(['/orders/9', '/orders/7']); // stopped after the 200
    expect(res.gate.complete).toBe(true);
  });

  it('survivors of Pass A go to Pass B; a Pass B close flips the gate', async () => {
    const s = summaryOf([ep('op2', 'POST', '/orders', false)]); // no path param → Pass A skips
    const firer: ClosureFirer = { fireCandidate: async () => ({ status: 404, captureId: null }) };
    const diag = new Map<string, EndpointDiagnosis>([
      ['op2', { operation_id: 'op2', method: 'POST', path: '/orders', last_status: 422, last_error_summary: 'bad body', last_request_summary: null }],
    ]);
    const seen: { directive: string; attempts: number }[] = [];
    const repairer: ClosureRepairer = {
      repair: async (_d, directive, attempts) => {
        seen.push({ directive, attempts });
        return { closed: true, captureId: 'cap-b' };
      },
    };
    const res = await runClosureOrchestration(
      {
        summary: s,
        tablesByOperationId: new Map(),
        configByOperationId: new Map([['op2', { operation_id: 'op2', attempts: 8, notes: 'use Core' }]]),
        diagnosisByOperationId: diag,
      },
      firer,
      repairer,
      noopSampler,
    );
    expect(res.passA.closed).toEqual([]);
    expect(res.passB.closed).toEqual(['op2']);
    // POST is mutating → attempts capped at 5 even though 8 was requested.
    expect(seen[0].attempts).toBe(5);
    expect(seen[0].directive).toMatch(/use Core/);
    expect(res.gate.complete).toBe(true);
  });

  it('fail-soft: a throwing firer leaves the endpoint unresolved, not the whole run', async () => {
    const s = summaryOf([ep('op1', 'GET', '/orders/{id}', false)]);
    const firer: ClosureFirer = {
      fireCandidate: async () => {
        throw new Error('transport boom');
      },
    };
    const res = await runClosureOrchestration(
      {
        summary: s,
        tablesByOperationId: new Map([['op1', ['dbo.orders']]]),
        sessionIdPool: ['1'],
        configByOperationId: new Map(),
        diagnosisByOperationId: new Map(),
      },
      firer,
      noopRepairer,
      noopSampler,
    );
    expect(res.gate.complete).toBe(false);
    expect(res.gate.unresolved.map((u) => u.operation_id)).toEqual(['op1']);
  });
});
