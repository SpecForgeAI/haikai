/**
 * Oracle Coverage Scoring -- focused tests (Spec: 2026-06-17 Oracle Coverage
 * Scoring, Task Group 2 sub-task 2.1).
 *
 * Three categories, kept to the 2-8 highly-focused tests the spec asks for:
 *
 *   SCORER (no drift) -- the pure scorer reads the SAME `GeneratedScenario[]`
 *     that `defaultScenarioSet` emits: every generated dimension is scored, and
 *     a dimension cannot be scored that was not generated. achieved/missed is
 *     decided by `selectCanonicalCapture` (reused verbatim); each miss carries
 *     an honest reason.
 *
 *   AUTH-OVERRIDE (no leak / no regression) -- the executor's scoped
 *     `requestWithAuthOverride` swaps the session auth for ONE call and restores
 *     it immediately afterwards, so a no-auth / bad-token probe can never leak
 *     onto a subsequent normal capture; the normal `request` path is unchanged
 *     when no override is used.
 *
 *   PERSISTENCE (round-trip) -- the assembled summary rides the EXISTING
 *     completion PATCH through a mocked `archModelClient` in the agreed
 *     snake_case shape, including the single project-level auth dimension folded
 *     into the overall score.
 */

import axios from 'axios';
import {
  defaultScenarioSet,
  scoreEndpointCoverage,
  assembleCoverageSummary,
  selectAuthProbeEndpoint,
  orchestrateCaptureSession,
  type EndpointCoverageResult,
  type AuthCoverageResult,
} from '../services/captureSessionOrchestrator';
import { createSessionHttpExecutor } from '../services/httpExecutor';
import type { CaptureSessionDto, OperationDto } from '../services/archModelClient';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';
import {
  resolveConfig,
  USE_BUILT_IN_DEFAULTS,
  DEFAULT_NOT_FOUND_MARKERS,
  type ResponseSemanticsConfig,
} from '../services/responseSemantics';

// ---------------------------------------------------------------------------
// SCORER -- single-source rubric, no drift.
// ---------------------------------------------------------------------------

describe('scoreEndpointCoverage -- single-source rubric (no drift)', () => {
  // An enum + required-query op so defaultScenarioSet emits several dimensions.
  const op: OperationDto = {
    id: 'op-row-1',
    session_id: 's1',
    operation_id: 'listThings',
    method: 'GET',
    path: '/things/{id}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: {
      operationId: 'listThings',
      parameters: [
        { name: 'id', in: 'path', required: true },
        { name: 'status', in: 'query', required: true, schema: { enum: ['OPEN', 'CLOSED'] } },
        { name: 'kind', in: 'query', required: false },
      ],
    } as unknown,
    created_at: 'x',
    updated_at: 'x',
  };

  it('scores EXACTLY the generated dimensions -- every one, and none that was not generated', () => {
    const scenarios = defaultScenarioSet(op, undefined, op.oas_operation_json);
    // Empty outcomes -> nothing achieved, but the dimension SET must match the
    // rubric 1:1 (no extra, none missing).
    const result = scoreEndpointCoverage(op, scenarios, new Map());

    const generatedNames = scenarios.map((s) => s.name).sort();
    const scoredNames = result.dimensions.map((d) => d.name).sort();
    expect(scoredNames).toEqual(generatedNames);
    // The rubric here includes happy_path, not_found_id, two enum_status_* and
    // a bad_request_* -- proving the scorer covers all generated dimensions.
    expect(generatedNames).toContain('happy_path');
    expect(generatedNames).toContain('enum_status_OPEN');
    expect(generatedNames).toContain('enum_status_CLOSED');
  });

  it('achieved vs missed is decided by selectCanonicalCapture; every miss has an honest reason', () => {
    const scenarios = defaultScenarioSet(op, undefined, op.oas_operation_json);
    // happy_path: a 400 fumble then a corrected 200 -> achieved (canonical 200).
    // enum_status_CLOSED: only a 500 came back -> missed (no usable oracle).
    // enum_status_OPEN: a clean 200 -> achieved.
    // everything else: no captures -> missed.
    const outcomes = new Map<string, Array<{ captureId: string; status: number | null }>>([
      ['happy_path', [{ captureId: 'cap-h-400', status: 400 }, { captureId: 'cap-h-200', status: 200 }]],
      ['enum_status_OPEN', [{ captureId: 'cap-eo', status: 200 }]],
      ['enum_status_CLOSED', [{ captureId: 'cap-ec', status: 500 }]],
    ]);

    const result = scoreEndpointCoverage(op, scenarios, outcomes);
    const byName = new Map(result.dimensions.map((d) => [d.name, d]));

    // happy_path achieved with the LAST 2xx as canonical (matches selectCanonicalCapture).
    expect(byName.get('happy_path')!.achieved).toBe(true);
    expect(byName.get('happy_path')!.canonical_capture_id).toBe('cap-h-200');
    expect(byName.get('happy_path')!.reason).toBeNull();

    // enum OPEN achieved.
    expect(byName.get('enum_status_OPEN')!.achieved).toBe(true);

    // enum CLOSED missed -> honest 5xx reason, no canonical id.
    const closed = byName.get('enum_status_CLOSED')!;
    expect(closed.achieved).toBe(false);
    expect(closed.canonical_capture_id).toBeNull();
    expect(closed.reason).toMatch(/5xx|no response/);

    // A dimension with no captures missed -> honest "no capture was recorded".
    const notFound = byName.get('not_found_id')!;
    expect(notFound.achieved).toBe(false);
    expect(notFound.reason).toMatch(/no capture was recorded/);

    // score = achieved / total (display-only fraction).
    const achievedCount = result.dimensions.filter((d) => d.achieved).length;
    expect(result.score).toBeCloseTo(achievedCount / result.dimensions.length);
  });
});

describe('assembleCoverageSummary -- overall folds the auth dimension as +1', () => {
  it('overall = (endpoint achieved + auth achieved) / (endpoint total + 1)', () => {
    const perEndpoint: EndpointCoverageResult[] = [
      {
        operation_id: 'a',
        method: 'GET',
        path: '/a',
        score: 0.5,
        dimensions: [
          { name: 'happy_path', type: 'happy_path', expected_status: 'success', dimension_kind: 'happy', reported_only: false, achieved: true, canonical_capture_id: 'c1', reason: null, observation: null },
          { name: 'bad_request_x', type: 'bad_request', expected_status: 'client_error', dimension_kind: 'validation', reported_only: false, achieved: false, canonical_capture_id: null, reason: 'missed', observation: null },
        ],
      },
    ];
    const authAchieved: AuthCoverageResult = {
      achieved: true,
      representative_operation_id: 'a',
      probes: [
        { name: 'no_token', expected: '401', achieved: true, observed_status: 401, reason: null },
        { name: 'bad_token', expected: '401/403', achieved: true, observed_status: 403, reason: null },
      ],
    };
    const summary = assembleCoverageSummary(perEndpoint, authAchieved);
    // endpoint total 2, achieved 1; auth +1/+1 -> 2/3.
    expect(summary.dimensions_total).toBe(3);
    expect(summary.dimensions_achieved).toBe(2);
    expect(summary.overall_score).toBeCloseTo(2 / 3);

    // A missed auth dimension still counts in the denominator (+1), not numerator.
    const authMissed: AuthCoverageResult = { ...authAchieved, achieved: false };
    const summary2 = assembleCoverageSummary(perEndpoint, authMissed);
    expect(summary2.dimensions_total).toBe(3);
    expect(summary2.dimensions_achieved).toBe(1);
    expect(summary2.overall_score).toBeCloseTo(1 / 3);
  });
});

// ---------------------------------------------------------------------------
// SEMANTICS-AWARE coverage (Spec 2026-06-23) -- behaviour-observed scoring, the
// auth bucket, the 5xx crash-vs-validation split, and the non-scoring
// observations channel.
// ---------------------------------------------------------------------------

describe('scoreEndpointCoverage -- semantics-aware (Spec 2026-06-23)', () => {
  const opx = { operation_id: 'sx', method: 'GET', path: '/things/{id}' };
  type Outcomes = Map<string, Array<{ captureId: string; status: number | null; body?: unknown }>>;

  it('a not_found scenario answered with a 200 + NO_DATA_FOUND body is ACHIEVED (behaviour observed), not a miss', () => {
    const outcomes: Outcomes = new Map([
      ['not_found_id', [{ captureId: 'c200', status: 200, body: { responseCode: 'NO_DATA_FOUND' } }]],
    ]);
    const result = scoreEndpointCoverage(
      opx,
      [{ name: 'not_found_id', type: 'not_found', expectedStatus: 'not_found' }],
      outcomes,
    );
    const d = result.dimensions[0];
    expect(d.achieved).toBe(true); // the headline data-loss fix
    expect(d.canonical_capture_id).toBe('c200'); // the real response is KEPT
    expect(d.observation).toMatch(/missing resource/i); // surfaced as a deviation, not a miss
    expect(d.reason).toBeNull();
  });

  it('an auth scenario answered with a 200 is ACHIEVED and flagged "no auth enforced"', () => {
    const outcomes: Outcomes = new Map([
      ['auth_missing_token', [{ captureId: 'ca', status: 200, body: { ok: true } }]],
    ]);
    const result = scoreEndpointCoverage(
      opx,
      [{ name: 'auth_missing_token', type: 'auth_error', expectedStatus: 'auth' }],
      outcomes,
    );
    const d = result.dimensions[0];
    expect(d.achieved).toBe(true);
    expect(d.observation).toMatch(/no auth enforced/i);
  });

  it('a 500 validation-reject is KEPT (achieved); an unrecognized 500 crash is a MISS (crash is the safe default)', () => {
    const outcomes: Outcomes = new Map([
      ['bad_request_validation', [{ captureId: 'cv', status: 500, body: { message: 'validation failed: bad date' } }]],
      ['bad_request_crash', [{ captureId: 'cc', status: 500, body: { trace: 'NullPointerException at ...' } }]],
    ]);
    const result = scoreEndpointCoverage(
      opx,
      [
        { name: 'bad_request_validation', type: 'validation_error', expectedStatus: 'client_error' },
        { name: 'bad_request_crash', type: 'validation_error', expectedStatus: 'client_error' },
      ],
      outcomes,
    );
    const byName = new Map(result.dimensions.map((d) => [d.name, d]));
    expect(byName.get('bad_request_validation')!.achieved).toBe(true);
    expect(byName.get('bad_request_validation')!.canonical_capture_id).toBe('cv');
    const crash = byName.get('bad_request_crash')!;
    expect(crash.achieved).toBe(false);
    expect(crash.observation).toMatch(/crash/i);
  });

  it('observations aggregate into the summary WITHOUT affecting the score', () => {
    const ep = scoreEndpointCoverage(
      opx,
      [{ name: 'not_found_id', type: 'not_found', expectedStatus: 'not_found' }],
      new Map([
        ['not_found_id', [{ captureId: 'c200', status: 200, body: { responseCode: 'NO_DATA_FOUND' } }]],
      ]) as Outcomes,
    );
    const authMissed: AuthCoverageResult = { achieved: false, representative_operation_id: null, probes: [] };
    const summary = assembleCoverageSummary([ep], authMissed);
    // The deviation is surfaced as a non-scoring observation...
    expect(summary.observations.some((o) => /missing resource/i.test(o))).toBe(true);
    // ...and the endpoint dimension still counts as achieved (behaviour observed),
    // so the score reflects achieved/total only -- (1 endpoint achieved + auth missed)/(1+1).
    expect(summary.dimensions_achieved).toBe(1);
    expect(summary.overall_score).toBeCloseTo(1 / 2);
  });
});

describe('selectAuthProbeEndpoint -- representative selection', () => {
  it('skips templated paths and picks the first concrete candidate; null when none qualify', () => {
    expect(
      selectAuthProbeEndpoint([
        { operationId: 'byId', method: 'GET', path: '/things/{id}' },
        { operationId: 'list', method: 'GET', path: '/things' },
      ])?.operationId,
    ).toBe('list');
    expect(selectAuthProbeEndpoint([{ operationId: 'byId', method: 'GET', path: '/things/{id}' }])).toBeNull();
    expect(selectAuthProbeEndpoint([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AUTH-OVERRIDE -- scoped, no leak, normal path unchanged.
// ---------------------------------------------------------------------------

describe('SessionHttpExecutor.requestWithAuthOverride -- scoped, no leak', () => {
  /**
   * Capture the outgoing Authorization header by injecting a per-request axios
   * adapter (the real executor + real request interceptor run, so the auth
   * injection + scoping is exercised end-to-end). Returns the recorded headers
   * in call order.
   */
  function recordingAdapter(seen: Array<string | undefined>) {
    return (config: import('axios').InternalAxiosRequestConfig) => {
      const auth = (config.headers?.get?.('Authorization') ?? config.headers?.Authorization) as
        | string
        | undefined;
      seen.push(auth);
      return Promise.resolve({
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    };
  }

  it('a scoped override sends with the override auth, then restores session auth for the NEXT normal call', async () => {
    const seen: Array<string | undefined> = [];
    const exec = createSessionHttpExecutor({
      auth: { type: 'bearer', bearerToken: 'valid-session-token' },
      timeoutMs: 5_000,
    });

    // 1) override to NO auth -> Authorization absent on this single call.
    await exec.requestWithAuthOverride(
      { method: 'GET', url: '/probe', adapter: recordingAdapter(seen) as never },
      { type: 'none' },
    );
    // 2) a subsequent NORMAL call -> session bearer restored (override did NOT leak).
    await exec.request({ method: 'GET', url: '/normal', adapter: recordingAdapter(seen) as never });
    // 3) override to a BAD token -> only this call carries the garbage token.
    await exec.requestWithAuthOverride(
      { method: 'GET', url: '/probe2', adapter: recordingAdapter(seen) as never },
      { type: 'bearer', bearerToken: 'garbage' },
    );
    // 4) another normal call -> still the session bearer.
    await exec.request({ method: 'GET', url: '/normal2', adapter: recordingAdapter(seen) as never });

    expect(seen[0]).toBeUndefined(); // no-auth override
    expect(seen[1]).toBe('Bearer valid-session-token'); // restored
    expect(seen[2]).toBe('Bearer garbage'); // bad-token override
    expect(seen[3]).toBe('Bearer valid-session-token'); // restored again
    exec.dispose();
  });

  it('restores session auth even when the overridden call throws (no leak on error)', async () => {
    const seen: Array<string | undefined> = [];
    const exec = createSessionHttpExecutor({
      auth: { type: 'bearer', bearerToken: 'valid-session-token' },
      timeoutMs: 5_000,
    });
    const throwingAdapter = () => Promise.reject(new Error('boom'));

    await expect(
      exec.requestWithAuthOverride(
        { method: 'GET', url: '/probe', adapter: throwingAdapter as never },
        { type: 'none' },
      ),
    ).rejects.toThrow(/boom/);

    // The next normal call still carries the session bearer -- the override was
    // restored in the `finally` despite the throw.
    await exec.request({ method: 'GET', url: '/normal', adapter: recordingAdapter(seen) as never });
    expect(seen[0]).toBe('Bearer valid-session-token');
    exec.dispose();
  });
});

// ---------------------------------------------------------------------------
// PERSISTENCE -- summary round-trips through the completion PATCH (mocked AMS).
// ---------------------------------------------------------------------------

const PROJECT_ID = '00000000-0000-0000-0000-0000000000e1';
const ARCH_ID = '00000000-0000-0000-0000-0000000000e2';
const SESSION_ID = '00000000-0000-0000-0000-0000000000e3';

function buildSessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'coverage-session',
    status: 'running',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
}

function buildOperationRow(overrides: Partial<OperationDto> = {}): OperationDto {
  const now = new Date().toISOString();
  return {
    id: 'op-row-1',
    session_id: SESSION_ID,
    operation_id: 'getThings',
    method: 'GET',
    path: '/things',
    summary: 'List things',
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: { operationId: 'getThings' } as unknown,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildInventory(): ParsedOasInventory {
  return {
    title: 'coverage fixture',
    version: '1.0.0',
    operations: [
      {
        operationId: 'getThings',
        method: 'get',
        path: '/things',
        summary: 'List things',
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { operationId: 'getThings' } as never,
      },
    ],
  };
}

interface MockAms {
  sessionPatches: Array<{ body: any }>;
  client: {
    createScenario: jest.Mock;
    createCapture: jest.Mock;
    createDiagnostic: jest.Mock;
    patchCapture: jest.Mock;
    patchCaptureSession: jest.Mock;
  };
}

function buildMockAms(): MockAms {
  const sessionPatches: MockAms['sessionPatches'] = [];
  let captureN = 0;
  const sessionDto = buildSessionDto();
  const client = {
    createScenario: jest.fn(async (_p: string, body: any) => ({ id: 'scenario-1', ...body })),
    createCapture: jest.fn(async () => ({ id: `capture-${(captureN += 1)}` })),
    createDiagnostic: jest.fn(async () => ({ id: 'diag-1' })),
    patchCapture: jest.fn(async (_p: string, captureId: string, body: any) => ({ id: captureId, ...body })),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ body });
      return { ...sessionDto, ...body, id: sessionId, project_id: projectId };
    }),
  };
  return { sessionPatches, client };
}

function buildGateway(messages: AssistantMessage[]) {
  const queue = [...messages];
  return {
    callLlmToolLoop: jest.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('mock gateway: queue exhausted');
      return { message: next };
    }),
  };
}

function execMessage(callId: string): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: {
          name: 'execute_http_request',
          arguments: JSON.stringify({ operationId: 'getThings', method: 'get', path: '/things' }),
        },
      },
    ],
  };
}

function noteMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'tc-note', type: 'function', function: { name: 'record_capture_note', arguments: JSON.stringify({ message: 'done' }) } },
    ],
  };
}

/**
 * Stub `createSessionHttpExecutor` so the LLM `execute_http_request` call
 * returns a 200, AND the SESSION-level auth probes (which call
 * `requestWithAuthOverride` directly) return a 401 for no-token and 403 for
 * bad-token -- the expected rejections, so the auth dimension is achieved.
 */
function stubExecutorForCoverage() {
  const request = jest.fn(async () => ({ status: 200, headers: {}, data: { ok: true }, config: {}, statusText: 'OK' }));
  const requestWithAuthOverride = jest.fn(async (_config: any, override: any) => {
    const status = override.type === 'none' ? 401 : 403;
    return { status, headers: {}, data: { error: 'unauthorized' }, config: {}, statusText: 'AUTH' };
  });
  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({ request, requestWithAuthOverride, setAuth: jest.fn(), dispose: jest.fn() });
  return { request, requestWithAuthOverride };
}

beforeEach(() => {
  secretsStore.clearAll();
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'bearer', bearerToken: 'plaintext-token' }, loadedAt: Date.now() });
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

describe('orchestrator -- coverage summary persists on the completion PATCH (snake_case)', () => {
  it('assembles overall + per-endpoint + auth coverage and writes coverage_summary_json on the SAME PATCH as the tallies', async () => {
    const { requestWithAuthOverride } = stubExecutorForCoverage();
    const ams = buildMockAms();
    // happy_path: one 200 + terminal note (the only generated dimension for a
    // no-param op), so the endpoint achieves 1/1 and qualifies for auth probes.
    const gateway = buildGateway([execMessage('tc-1'), noteMessage()]);

    await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    // The auth probes ran ONCE (both no-token + bad-token) against the
    // representative endpoint via the scoped override seam.
    expect(requestWithAuthOverride).toHaveBeenCalledTimes(2);

    // Coverage rides the SAME completion PATCH as the scenario tallies.
    expect(ams.sessionPatches).toHaveLength(1);
    const body = ams.sessionPatches[0].body;
    expect(body.scenarios_attempted).toBe(1);
    expect(body.scenarios_completed).toBe(1);

    const summary = body.coverage_summary_json;
    expect(summary).toBeTruthy();
    // snake_case shape.
    expect(typeof summary.overall_score).toBe('number');
    expect(summary.dimensions_total).toBe(2); // 1 endpoint dimension + 1 auth dimension
    expect(summary.dimensions_achieved).toBe(2); // happy_path + auth both achieved
    expect(summary.overall_score).toBeCloseTo(1);

    expect(summary.per_endpoint).toHaveLength(1);
    const ep = summary.per_endpoint[0];
    expect(ep.operation_id).toBe('getThings');
    expect(ep.method).toBe('GET');
    expect(ep.path).toBe('/things');
    expect(ep.dimensions[0].name).toBe('happy_path');
    expect(ep.dimensions[0].achieved).toBe(true);
    expect(ep.dimensions[0].canonical_capture_id).toBeTruthy();

    // Single project-level auth dimension, achieved (both probes rejected).
    expect(summary.auth_coverage.achieved).toBe(true);
    expect(summary.auth_coverage.representative_operation_id).toBe('getThings');
    expect(summary.auth_coverage.probes).toHaveLength(2);
    expect(summary.auth_coverage.probes.map((p: any) => p.name).sort()).toEqual(['bad_token', 'no_token']);
    expect(summary.auth_coverage.probes.every((p: any) => p.achieved)).toBe(true);
  });

  it('records the auth dimension MISSED with an honest reason when no safe representative endpoint qualifies', async () => {
    const { requestWithAuthOverride } = stubExecutorForCoverage();
    const ams = buildMockAms();
    // A path-param op: defaultScenarioSet emits happy_path / not_found_id /
    // bad_request_id. Even if happy_path is achieved, the templated path means
    // it does NOT qualify as a safe auth-probe representative.
    const op = buildOperationRow({
      path: '/things/{id}',
      oas_operation_json: { operationId: 'getThings', parameters: [{ name: 'id', in: 'path', required: true }] } as unknown,
    });
    const inventory: ParsedOasInventory = {
      title: 'coverage fixture',
      version: '1.0.0',
      operations: [
        {
          operationId: 'getThings',
          method: 'get',
          path: '/things/{id}',
          summary: null,
          description: null,
          requestSchema: null,
          responseSchema: null,
          oasOperation: { operationId: 'getThings', parameters: [{ name: 'id', in: 'path', required: true }] } as never,
        },
      ],
    };
    // happy_path 200, not_found_id 404, bad_request_id 400 -> all three achieved.
    const request = jest.fn();
    const requestStub = require('../services/httpExecutor').createSessionHttpExecutor as jest.Mock;
    requestStub.mockReturnValue({
      request: jest.fn(async () => {
        // sequence by call order
        const seq = [200, 404, 400];
        const status = seq[request.mock.calls.length] ?? 200;
        request();
        return { status, headers: {}, data: { ok: status < 300 }, config: {}, statusText: 'X' };
      }),
      requestWithAuthOverride,
      setAuth: jest.fn(),
      dispose: jest.fn(),
    });
    const gateway = buildGateway([
      execMessage('h'), noteMessage(),
      execMessage('n'), noteMessage(),
      execMessage('b'), noteMessage(),
    ]);

    await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: [op],
    });

    // No safe representative endpoint -> NO override calls were fired.
    expect(requestWithAuthOverride).not.toHaveBeenCalled();
    const summary = ams.sessionPatches[0].body.coverage_summary_json;
    expect(summary.auth_coverage.achieved).toBe(false);
    expect(summary.auth_coverage.representative_operation_id).toBeNull();
    expect(summary.auth_coverage.probes.every((p: any) => /no safe representative endpoint/.test(p.reason))).toBe(true);
    // The missed auth dimension still contributes +1 to the denominator only.
    expect(summary.dimensions_total).toBe(summary.per_endpoint[0].dimensions.length + 1);
  });
});

// ---------------------------------------------------------------------------
// CONFIG PLUMBING (Spec: 2026-06-23 Semantics-aware coverage, Task Group 4) --
// the per-API response-semantics config persists on the session
// (`behaviour_semantics_config_json`, AMS changeset 196), is hydrated by
// `toCaptureSession` onto `session.behaviourSemanticsConfigJson`, and is
// threaded by the orchestrator into `classifyObservedBehaviour` (the scorer +
// selector). ABSENT config === built-in defaults (forward-only, no backfill).
// ---------------------------------------------------------------------------

describe('per-API semantics config -- persistence seam + orchestrator threading', () => {
  // A session DTO whose ONLY scenario capture will be a 500 with NO recognizable
  // validation body -- i.e. an unrecognized 5xx the classifier treats as a
  // crash (NOT a usable oracle) by default. Optionally carries the wire config
  // blob so we can prove the operator override reaches the classifier.
  function buildSessionDtoWithSemantics(
    cfg?: Record<string, unknown> | null,
  ): CaptureSessionDto {
    return { ...buildSessionDto(), behaviour_semantics_config_json: cfg ?? null };
  }

  // Stub `createSessionHttpExecutor` so the LLM `execute_http_request` call
  // returns a 500 carrying a stack-trace-shaped body with NO bad_request marker
  // (no "validation" / "invalid" / etc.). By default this is an unrecognized
  // crash; with `fiveXxIsBadInput` it becomes a deliberate client-error oracle.
  function stubExecutorReturning500Crash() {
    const request = jest.fn(async () => ({
      status: 500,
      headers: {},
      data: { trace: 'NullPointerException at com.legacy.Svc.handle(Svc.java:42)' },
      config: {},
      statusText: 'Internal Server Error',
    }));
    const requestWithAuthOverride = jest.fn(async () => ({
      status: 401,
      headers: {},
      data: { error: 'unauthorized' },
      config: {},
      statusText: 'AUTH',
    }));
    jest
      .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
      .mockReturnValue({ request, requestWithAuthOverride, setAuth: jest.fn(), dispose: jest.fn() });
    return { request };
  }

  it('(a) ABSENT config -> the orchestrator resolves built-in defaults: a normal run still scores happy_path achieved', async () => {
    // No `behaviour_semantics_config_json` on the session (the valid empty
    // state). A normal 200 happy_path scores exactly as before -- proving the
    // null/absent config does NOT break the existing default-vocabulary path.
    stubExecutorForCoverage();
    const ams = buildMockAms();
    const gateway = buildGateway([execMessage('tc-1'), noteMessage()]);

    const session = toCaptureSession(buildSessionDtoWithSemantics(null));
    expect(session.behaviourSemanticsConfigJson).toBeNull();

    await orchestrateCaptureSession(session, {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    const summary = ams.sessionPatches[0].body.coverage_summary_json;
    const happy = summary.per_endpoint[0].dimensions.find((d: any) => d.name === 'happy_path');
    expect(happy.achieved).toBe(true);
    expect(happy.canonical_capture_id).toBeTruthy();
  });

  it('(b) a PRESENT config { fiveXxIsBadInput: true } threads through: a 500-with-no-validation-body scores ACHIEVED instead of a crash MISS', async () => {
    // Same op + same 500-crash response in BOTH runs; only the per-API config
    // differs. This proves the config reaches `classifyObservedBehaviour` via
    // the orchestrator (session.behaviourSemanticsConfigJson -> semanticsConfig
    // -> scorer + selector).

    // --- Run 1: NO config -> the 500 is an unrecognized crash -> happy_path is
    //     a MISS (crash is the safe default), and the crash anomaly surfaces.
    stubExecutorReturning500Crash();
    const amsNoCfg = buildMockAms();
    await orchestrateCaptureSession(toCaptureSession(buildSessionDtoWithSemantics(null)), {
      archModelClient: amsNoCfg.client as never,
      gatewayClient: buildGateway([execMessage('c1'), noteMessage()]) as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });
    const sumNoCfg = amsNoCfg.sessionPatches[0].body.coverage_summary_json;
    const happyNoCfg = sumNoCfg.per_endpoint[0].dimensions.find((d: any) => d.name === 'happy_path');
    expect(happyNoCfg.achieved).toBe(false); // unrecognized 5xx = crash = NOT covered
    expect(happyNoCfg.observation).toMatch(/crash/i);

    jest.restoreAllMocks();
    if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'bearer', bearerToken: 'plaintext-token' }, loadedAt: Date.now() });

    // --- Run 2: config declares this API returns 5xx for bad input -> the SAME
    //     500 is now a deliberate client-error oracle -> happy_path ACHIEVED.
    stubExecutorReturning500Crash();
    const amsCfg = buildMockAms();
    const cfg: ResponseSemanticsConfig = { fiveXxIsBadInput: true };
    await orchestrateCaptureSession(
      toCaptureSession(buildSessionDtoWithSemantics(cfg as unknown as Record<string, unknown>)),
      {
        archModelClient: amsCfg.client as never,
        gatewayClient: buildGateway([execMessage('c2'), noteMessage()]) as never,
        oasInventory: buildInventory(),
        persistedOperations: [buildOperationRow()],
      },
    );
    const sumCfg = amsCfg.sessionPatches[0].body.coverage_summary_json;
    const happyCfg = sumCfg.per_endpoint[0].dimensions.find((d: any) => d.name === 'happy_path');
    expect(happyCfg.achieved).toBe(true); // config reached classifyObservedBehaviour
    expect(happyCfg.canonical_capture_id).toBeTruthy(); // the 500 response is KEPT
  });

  it('(c) the (use built-in defaults) sentinel round-trips as "explicitly default" -- same effective vocabulary as untouched', () => {
    // UNTOUCHED (absent) and EXPLICITLY-DEFAULT (sentinel) resolve to the SAME
    // effective built-in vocabulary; the sentinel is a deliberate, round-trippable
    // choice distinct from an untouched row -- but it never alters the markers.
    const untouched = resolveConfig(undefined);
    const explicitlyDefault = resolveConfig({
      notFoundMarkers: USE_BUILT_IN_DEFAULTS,
      badRequestMarkers: USE_BUILT_IN_DEFAULTS,
      statusBucketOverride: { 200: USE_BUILT_IN_DEFAULTS },
    });
    expect(explicitlyDefault.notFoundMarkers).toEqual([...DEFAULT_NOT_FOUND_MARKERS]);
    expect(explicitlyDefault.notFoundMarkers).toEqual(untouched.notFoundMarkers);
    expect(explicitlyDefault.badRequestMarkers).toEqual(untouched.badRequestMarkers);
    // A sentinel status entry resolves to "leave it to markers + status class" --
    // i.e. it is NOT added to the concrete override map.
    expect(explicitlyDefault.statusBucketOverride).toEqual({});
  });

  it('toCaptureSession hydrates behaviourSemanticsConfigJson from the snake_case wire field (null preserved)', () => {
    // Hydration round-trip: the snake_case wire blob lands on the camelCase
    // domain projection the orchestrator reads; absent === null (built-in
    // defaults), and a present config is carried verbatim.
    expect(toCaptureSession(buildSessionDtoWithSemantics(null)).behaviourSemanticsConfigJson).toBeNull();
    const hydrated = toCaptureSession(
      buildSessionDtoWithSemantics({ fiveXxIsBadInput: true, badRequestMarkers: { mode: 'extend', markers: ['boom'] } }),
    ).behaviourSemanticsConfigJson;
    expect(hydrated).toEqual({ fiveXxIsBadInput: true, badRequestMarkers: { mode: 'extend', markers: ['boom'] } });
  });
});

// Keep an explicit reference so the imported `axios` is treated as used by the
// adapter-typed helpers above (the adapter signature pulls the axios types in).
void axios;
