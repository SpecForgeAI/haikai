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
  applyDimensionClosuresToSummary,
  applyAuthCoverageToSummary,
  removeEndpointFromSummary,
  excludeDimensionFromSummary,
  isHappyStatus,
  selectDimensionClosingCapture,
  type ClosureFirer,
  type ClosureRepairer,
  type ClosureDimensionRepairer,
  type ClosureDbSampler,
} from '../services/captureClosureDriver';
import { collectFailedDimensions } from '../services/captureCoverageGate';
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

function dim(
  name: string,
  expected: CoverageDimensionResult['expected_status'],
  achieved: boolean,
  reportedOnly = false,
): CoverageDimensionResult {
  return {
    name,
    type: name.replace(/ .*/, ''),
    expected_status: expected,
    dimension_kind: 'error_status',
    reported_only: reportedOnly,
    achieved,
    canonical_capture_id: achieved ? 'existing' : null,
    reason: achieved ? null : 'no matching behaviour observed',
    observation: null,
  };
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

describe('excludeDimensionFromSummary (dimension-level Not Possible)', () => {
  function epWithDims(operation_id: string, dims: CoverageDimensionResult[]): EndpointCoverageResult {
    return {
      operation_id,
      method: 'POST',
      path: '/a',
      score: dims.filter((d) => d.achieved).length / dims.length,
      dimensions: dims,
    };
  }

  it('marks the named failed dimension reported_only, keeps the endpoint, and audits it', () => {
    const s = summaryOf([
      epWithDims('op1', [happy(true), dim('not_found', 'not_found', false)]),
    ]);
    const out = excludeDimensionFromSummary(
      s,
      'op1',
      'not_found',
      'error path not reproducible on current-state',
      '2026-08-02T00:00:00Z',
    );
    // Endpoint stays; the happy path is untouched.
    expect(out.per_endpoint.map((e) => e.operation_id)).toEqual(['op1']);
    const target = out.per_endpoint[0].dimensions.find((d) => d.name === 'not_found')!;
    expect(target.reported_only).toBe(true); // leaves the failed/retry set
    expect(out.per_endpoint[0].dimensions.find((d) => d.name === 'happy_path')!.achieved).toBe(true);
    const excluded = (out as unknown as {
      closure_excluded: Array<{ operation_id: string; scenario_name: string; reason: string }>;
    }).closure_excluded;
    expect(excluded[0]).toMatchObject({ operation_id: 'op1', scenario_name: 'not_found' });
  });

  it('is a no-op for an unknown endpoint or dimension', () => {
    const s = summaryOf([epWithDims('op1', [happy(true), dim('not_found', 'not_found', false)])]);
    expect(excludeDimensionFromSummary(s, 'nope', 'not_found', 'x', 't')).toBe(s);
    expect(excludeDimensionFromSummary(s, 'op1', 'no_such_dim', 'x', 't')).toBe(s);
  });
});

describe('selectDimensionClosingCapture', () => {
  it('closes on the LAST capture matching the intended class only — never the wrong class', () => {
    const caps = [
      { captureId: 'c1', status: 200, body: { id: 1 } },
      { captureId: 'c2', status: 404, body: { error: 'no such order' } },
      { captureId: 'c3', status: 200, body: { id: 2 } },
    ];
    expect(selectDimensionClosingCapture(caps, 'not_found')!.captureId).toBe('c2');
    expect(selectDimensionClosingCapture(caps, 'success')!.captureId).toBe('c3');
    // No auth-class behaviour observed → null (a stray 2xx must NOT close it).
    expect(selectDimensionClosingCapture(caps, 'auth')).toBeNull();
  });

  it('a 200 with an EMPTY body IS the not_found behaviour (semantics-aware, not raw status)', () => {
    const caps = [{ captureId: 'c1', status: 200, body: null }];
    expect(selectDimensionClosingCapture(caps, 'not_found')!.captureId).toBe('c1');
    expect(selectDimensionClosingCapture(caps, 'success')).toBeNull();
  });
});

describe('applyDimensionClosuresToSummary', () => {
  it('flips only the named dimension, recomputes the endpoint score, ignores unknown names', () => {
    const s = summaryOf([
      {
        operation_id: 'op1',
        method: 'GET',
        path: '/a',
        score: 1 / 3,
        dimensions: [happy(true), dim('not_found probe', 'not_found', false), dim('client_error probe', 'client_error', false)],
      },
    ]);
    const out = applyDimensionClosuresToSummary(s, [
      { operation_id: 'op1', name: 'not_found probe', capture_id: 'cap-nf' },
      { operation_id: 'op1', name: 'no-such-dimension', capture_id: 'cap-x' },
      { operation_id: 'ghost', name: 'not_found probe', capture_id: 'cap-y' },
    ]);
    const dims = out.per_endpoint[0].dimensions;
    expect(dims.find((d) => d.name === 'not_found probe')!.achieved).toBe(true);
    expect(dims.find((d) => d.name === 'not_found probe')!.canonical_capture_id).toBe('cap-nf');
    expect(dims.find((d) => d.name === 'client_error probe')!.achieved).toBe(false);
    expect(out.per_endpoint[0].score).toBeCloseTo(2 / 3);
    expect(out.dimensions_total).toBe(s.dimensions_total);
  });

  it('returns the input unchanged for an empty closure list', () => {
    const s = summaryOf([ep('op1', 'GET', '/a', true)]);
    expect(applyDimensionClosuresToSummary(s, [])).toBe(s);
  });
});

describe('applyAuthCoverageToSummary', () => {
  it('replaces the auth dimension and recomputes achieved/overall; totals unchanged', () => {
    // 1 endpoint dim achieved + auth NOT achieved -> 1 of 2.
    const s = summaryOf([ep('op1', 'GET', '/a', true)], false);
    expect(s.dimensions_achieved).toBe(1);
    const out = applyAuthCoverageToSummary(s, {
      achieved: true,
      representative_operation_id: 'op1',
      probes: [
        { name: 'no_token', expected: '401', achieved: true, observed_status: 401, reason: null },
        { name: 'bad_token', expected: '401/403', achieved: true, observed_status: 403, reason: null },
      ],
    });
    expect(out.auth_coverage.achieved).toBe(true);
    expect(out.dimensions_total).toBe(s.dimensions_total);
    expect(out.dimensions_achieved).toBe(2);
    expect(out.overall_score).toBe(1);
  });
});

describe('aggregate drift self-heal (2026-09-02)', () => {
  // The field bug: every patcher recomputed the NUMERATOR fresh from
  // per_endpoint while only carrying the DENOMINATOR forward incrementally,
  // so across many closure/retry passes the stored total drifted low and the
  // headline read past 100% ("415 of 412"). All three patchers now recount
  // BOTH sides from per_endpoint, healing already-persisted drift on the
  // next patch.
  function drifted(): CoverageSummary {
    const s = summaryOf([
      {
        operation_id: 'op1',
        method: 'GET',
        path: '/a',
        score: 0.5,
        dimensions: [happy(true), dim('not_found probe', 'not_found', false)],
      },
      ep('op2', 'GET', '/b', true),
    ]);
    // Simulate persisted drift: the stored denominator lost two dimensions.
    const staleTotal = s.dimensions_total - 2;
    return { ...s, dimensions_total: staleTotal, overall_score: s.dimensions_achieved / staleTotal };
  }

  it('applyClosureToSummary recounts the denominator from per_endpoint (heals stored drift)', () => {
    const out = applyClosureToSummary(drifted(), new Map([['op1', 'cap-heal']]));
    expect(out.dimensions_total).toBe(4); // 3 endpoint dims + 1 auth — not the drifted 2
    expect(out.overall_score).toBeLessThanOrEqual(1);
  });

  it('the dimensional and auth siblings recount too — total and achieved stay in lockstep', () => {
    const viaDim = applyDimensionClosuresToSummary(drifted(), [
      { operation_id: 'op1', name: 'not_found probe', capture_id: 'cap-nf' },
    ]);
    expect(viaDim.dimensions_total).toBe(4);
    expect(viaDim.overall_score).toBeLessThanOrEqual(1);
    const viaAuth = applyAuthCoverageToSummary(drifted(), {
      achieved: true,
      representative_operation_id: null,
      probes: [],
    });
    expect(viaAuth.dimensions_total).toBe(4);
    expect(viaAuth.overall_score).toBeLessThanOrEqual(1);
  });

  it('NEVER exceeds 100% after repeated closures, even starting from a drifted summary', () => {
    let s = drifted();
    for (let i = 0; i < 5; i++) {
      s = applyClosureToSummary(s, new Map([['op1', `cap-${i}`]]));
      s = applyDimensionClosuresToSummary(s, [
        { operation_id: 'op1', name: 'not_found probe', capture_id: `cap-nf-${i}` },
      ]);
      s = applyAuthCoverageToSummary(s, {
        achieved: true,
        representative_operation_id: null,
        probes: [],
      });
      expect(s.overall_score).toBeLessThanOrEqual(1);
      expect(s.dimensions_total).toBe(4);
      expect(s.dimensions_achieved).toBeLessThanOrEqual(s.dimensions_total);
    }
    expect(s.dimensions_achieved).toBe(4);
    expect(s.overall_score).toBe(1);
  });

  it('excluded dimensions stay OUT of both counts (mirrors assembleCoverageSummary)', () => {
    const withExcluded = summaryOf([
      {
        operation_id: 'op1',
        method: 'GET',
        path: '/a',
        score: 1,
        dimensions: [happy(true), { ...dim('manual rec', 'not_found', false), excluded: true }],
      },
    ]);
    const out = applyAuthCoverageToSummary(withExcluded, {
      achieved: true,
      representative_operation_id: null,
      probes: [],
    });
    expect(out.dimensions_total).toBe(2); // the achieved happy + auth; the excluded dim leaves BOTH sides
    expect(out.dimensions_achieved).toBe(2);
    expect(out.overall_score).toBe(1);
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

  it('dimensional pass (2026-07-25): failed non-happy dimensions repair per expected_status and flip in the summary; the gate stays happy-only', async () => {
    // Endpoint op1: happy achieved, not_found dimension FAILED.
    const withDims: EndpointCoverageResult = {
      operation_id: 'op1',
      method: 'GET',
      path: '/orders/{id}',
      score: 0.5,
      dimensions: [happy(true), dim('not_found probe', 'not_found', false)],
    };
    const s = summaryOf([withDims]);
    const failed = collectFailedDimensions(s);
    expect(failed).toEqual([
      expect.objectContaining({ operation_id: 'op1', name: 'not_found probe', expected_status: 'not_found' }),
    ]);

    const seen: { name: string; directive: string }[] = [];
    const dimensionRepairer: ClosureDimensionRepairer = {
      repairDimension: async (d, directive) => {
        seen.push({ name: d.name, directive });
        return { closed: true, captureId: 'cap-dim' };
      },
    };
    const res = await runClosureOrchestration(
      {
        summary: s,
        tablesByOperationId: new Map(),
        configByOperationId: new Map(),
        diagnosisByOperationId: new Map(),
        failedDimensions: failed,
      },
      { fireCandidate: async () => ({ status: 404, captureId: null }) },
      noopRepairer,
      noopSampler,
      dimensionRepairer,
    );
    expect(res.dimensional.attempted).toBe(1);
    expect(res.dimensional.closed).toEqual([
      { operation_id: 'op1', name: 'not_found probe', capture_id: 'cap-dim' },
    ]);
    // Directive names the dimension and its intended behaviour class.
    expect(seen[0].directive).toMatch(/not_found probe/);
    expect(seen[0].directive).toMatch(/"not_found" behaviour class/);
    // Summary flipped the NAMED dimension; totals unchanged, achieved +1.
    const patched = res.updatedSummary.per_endpoint[0];
    expect(patched.dimensions.find((d) => d.name === 'not_found probe')!.achieved).toBe(true);
    expect(res.updatedSummary.dimensions_total).toBe(s.dimensions_total);
    expect(res.updatedSummary.dimensions_achieved).toBe(s.dimensions_achieved + 1);
    expect(res.gate.complete).toBe(true); // happy was already achieved
  });

  it('dimensional pass is skipped when no failedDimensions are supplied (result reports 0)', async () => {
    const s = summaryOf([ep('op2', 'GET', '/b', true)]);
    const res = await runClosureOrchestration(
      {
        summary: s,
        tablesByOperationId: new Map(),
        configByOperationId: new Map(),
        diagnosisByOperationId: new Map(),
      },
      { fireCandidate: async () => ({ status: 404, captureId: null }) },
      noopRepairer,
      noopSampler,
    );
    expect(res.dimensional).toEqual({ attempted: 0, closed: [] });
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

// --------------------------------------------------------------------------
// 2026-08-08 seed fix: Pass B's directive carries what Pass A already holds —
// the endpoint's mined table values and its fired-without-success candidates.
// --------------------------------------------------------------------------

describe('runClosureOrchestration -- Pass B seeded from Pass A', () => {
  it('threads mined DB values and failed Pass A candidates into the repair directive', async () => {
    const s = summaryOf([ep('op1', 'GET', '/orders/{orderId}', false)]);
    // Every Pass A candidate fails → op1 survives to Pass B.
    const firer: ClosureFirer = { fireCandidate: async () => ({ status: 404, captureId: null }) };
    const sampler: ClosureDbSampler = {
      sampleIds: async () => new Map([['dbo.orders', ['12345', '67890']]]),
    };
    const seen: string[] = [];
    const repairer: ClosureRepairer = {
      repair: async (_d, directive) => {
        seen.push(directive);
        return { closed: false, captureId: null };
      },
    };
    await runClosureOrchestration(
      {
        summary: s,
        tablesByOperationId: new Map([['op1', ['dbo.orders']]]),
        configByOperationId: new Map(),
        diagnosisByOperationId: new Map(),
      },
      firer,
      repairer,
      sampler,
    );
    expect(seen).toHaveLength(1);
    // Mined values ride into the directive…
    expect(seen[0]).toContain('mined from source table dbo.orders: 12345, 67890');
    // …and the candidates Pass A fired without success are listed as do-not-repeat.
    expect(seen[0]).toContain('do NOT repeat these');
    expect(seen[0]).toContain('/orders/12345 -> 404');
    // The budget semantics line is present for the LLM.
    expect(seen[0]).toContain('Research is FREE');
  });
});
