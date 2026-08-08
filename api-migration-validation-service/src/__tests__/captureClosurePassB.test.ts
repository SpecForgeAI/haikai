/**
 * Coverage Closure Pass B — repair directive builder (CC3, Spec 2026-07-20).
 *
 * Pins: failure-mode classification; verb-capped/clamped attempt budgets
 * (default 15, mutating capped at 5); playbook + diagnosis + operator notes
 * composition.
 */
import {
  classifyFailureMode,
  buildRepairDirective,
  isMutatingVerb,
  DEFAULT_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS,
  MUTATING_ATTEMPTS_CAP,
  EndpointDiagnosis,
  deriveLoopBudget,
} from '../services/captureClosurePassB';

function diag(partial: Partial<EndpointDiagnosis>): EndpointDiagnosis {
  return {
    operation_id: partial.operation_id ?? 'op1',
    method: partial.method ?? 'GET',
    path: partial.path ?? '/orders/{id}',
    last_status: 'last_status' in partial ? (partial.last_status ?? null) : 404,
    last_error_summary: partial.last_error_summary ?? null,
    last_request_summary: partial.last_request_summary ?? null,
  };
}

describe('classifyFailureMode', () => {
  it('maps statuses to modes', () => {
    expect(classifyFailureMode(404, null)).toBe('missing_id');
    expect(classifyFailureMode(409, null)).toBe('sequencing');
    expect(classifyFailureMode(401, null)).toBe('auth');
    expect(classifyFailureMode(403, null)).toBe('auth');
    expect(classifyFailureMode(400, null)).toBe('bad_request');
    expect(classifyFailureMode(422, null)).toBe('bad_request');
    expect(classifyFailureMode(500, null)).toBe('server_error');
    expect(classifyFailureMode(null, null)).toBe('transport');
  });
  it('uses the error text to spot sequencing on an ambiguous status', () => {
    expect(classifyFailureMode(200, 'resource does not exist yet')).toBe('sequencing');
    expect(classifyFailureMode(200, 'something else')).toBe('unknown');
  });
});

describe('isMutatingVerb', () => {
  it('flags POST/PUT/DELETE/PATCH only', () => {
    expect(isMutatingVerb('GET')).toBe(false);
    expect(['POST', 'put', 'Delete', 'PATCH'].every(isMutatingVerb)).toBe(true);
  });
});

describe('buildRepairDirective', () => {
  it('reads get the default budget (15) when unspecified', () => {
    const d = buildRepairDirective(diag({ method: 'GET' }));
    expect(d.attempts).toBe(DEFAULT_REPAIR_ATTEMPTS);
    expect(d.is_mutating).toBe(false);
    expect(d.failure_mode).toBe('missing_id');
    expect(d.directive).toMatch(/Obtain a REAL id/);
  });

  it('reads honour a user attempts value, clamped to the ceiling', () => {
    expect(buildRepairDirective(diag({ method: 'GET' }), { attempts: 30 }).attempts).toBe(30);
    expect(buildRepairDirective(diag({ method: 'GET' }), { attempts: 999 }).attempts).toBe(
      MAX_REPAIR_ATTEMPTS,
    );
    expect(buildRepairDirective(diag({ method: 'GET' }), { attempts: 0 }).attempts).toBe(1);
  });

  it('mutating verbs are capped low and steered to create-then-act', () => {
    const d = buildRepairDirective(
      diag({ method: 'POST', path: '/orders', last_status: 422 }),
      { attempts: 15 },
    );
    expect(d.attempts).toBe(MUTATING_ATTEMPTS_CAP);
    expect(d.is_mutating).toBe(true);
    expect(d.directive).toMatch(/create-then-act/);
  });

  it('embeds the persisted diagnosis and the operator notes verbatim (notes last)', () => {
    const d = buildRepairDirective(
      diag({
        last_status: 404,
        last_error_summary: 'id 999 not found',
        last_request_summary: 'GET /orders/999',
      }),
      { notes: "try ID=3275 and use 'Core' for parameter 'type'" },
    );
    expect(d.directive).toMatch(/Last attempt: status 404/);
    expect(d.directive).toMatch(/Last error: id 999 not found/);
    expect(d.directive).toMatch(/Last request: GET \/orders\/999/);
    expect(d.directive.trim().endsWith("Operator hint (follow this): try ID=3275 and use 'Core' for parameter 'type'")).toBe(
      true,
    );
  });

  it('transport failure renders a no-response last attempt', () => {
    const d = buildRepairDirective(diag({ last_status: null }));
    expect(d.failure_mode).toBe('transport');
    expect(d.directive).toMatch(/status transport failure \(no response\)/);
  });
});

// --------------------------------------------------------------------------
// 2026-08-08 budget/seed fix: attempts = FIRED requests at the target; the
// loop limits derive from the budget; the directive carries the budget
// explanation, the deterministic seeds, and the known-failed candidates.
// --------------------------------------------------------------------------

describe('deriveLoopBudget', () => {
  it('scales rounds and wall clock from the fired-attempt budget', () => {
    expect(deriveLoopBudget(15)).toEqual({
      roundLimit: 15 * 4 + 8,
      wallClockMs: 15 * 60_000 + 240_000,
    });
    // Mutating cap of 5 fired attempts still buys a real loop.
    expect(deriveLoopBudget(5)).toEqual({ roundLimit: 28, wallClockMs: 540_000 });
  });

  it('floors at one attempt and ceilings the wall clock at 45 minutes', () => {
    expect(deriveLoopBudget(0).roundLimit).toBe(12);
    expect(deriveLoopBudget(50).wallClockMs).toBe(45 * 60_000);
  });
});

describe('buildRepairDirective -- budget explanation + deterministic seeds', () => {
  const diag: EndpointDiagnosis = {
    operation_id: 'getOrder',
    method: 'GET',
    path: '/orders/{orderId}',
    last_status: 404,
    last_error_summary: 'not found',
    last_request_summary: 'GET /orders/1',
  };

  it('states that research is free and only fired requests consume the budget', () => {
    const d = buildRepairDirective(diag, { attempts: 10 });
    expect(d.directive).toContain('Budget: 10 request(s) fired at this target operation');
    expect(d.directive).toContain('Research is FREE');
    expect(d.directive).toContain('search_source_files');
  });

  it('seeds mined table values, the session id pool, and the failed candidates (never repeated)', () => {
    const d = buildRepairDirective(diag, null, {
      minedIdsByTable: { orders: ['12345', '67890'] },
      sessionIdPool: ['abc-1'],
      triedAndFailed: [
        { path: '/orders/12345', status: 404 },
        { path: '/orders/67890', status: null },
      ],
    });
    expect(d.directive).toContain('mined from source table orders: 12345, 67890');
    expect(d.directive).toContain('Identifier values already seen in this session: abc-1');
    expect(d.directive).toContain('do NOT repeat these');
    expect(d.directive).toContain('/orders/12345 -> 404');
    expect(d.directive).toContain('/orders/67890 -> no response');
  });

  it('caps rendered seed values and omits empty seed sections', () => {
    const many = Array.from({ length: 40 }, (_v, i) => `id-${i}`);
    const capped = buildRepairDirective(diag, null, { minedIdsByTable: { orders: many } });
    expect(capped.directive).toContain('id-14');
    expect(capped.directive).not.toContain('id-15,');
    const bare = buildRepairDirective(diag, null, {});
    expect(bare.directive).not.toContain('mined from source table');
    expect(bare.directive).not.toContain('Already tried WITHOUT success');
  });

  it('keeps operator notes LAST (highest signal) even with seeds present', () => {
    const d = buildRepairDirective(
      diag,
      { notes: 'use type=Core' },
      { sessionIdPool: ['abc-1'] },
    );
    const notesIdx = d.directive.indexOf('Operator hint');
    const seedIdx = d.directive.indexOf('Identifier values already seen');
    expect(notesIdx).toBeGreaterThan(seedIdx);
  });
});
