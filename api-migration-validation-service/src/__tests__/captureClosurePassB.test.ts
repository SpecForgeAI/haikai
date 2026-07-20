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
