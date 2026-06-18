/**
 * Oracle Coverage Scoring -- cross-layer gap-filling tests (Spec:
 * 2026-06-17 Oracle Coverage Scoring, Task Group 4 sub-task 4.3).
 *
 * Task Group 4 reviewed the tests written in TG1 (AMS round-trip), TG2 (pure
 * scorer / executor scoping / persistence) and TG3 (frontend surfacing). The
 * three feature invariants -- no-drift, auth-override no-leak/no-regression,
 * persistence round-trip -- are each already exercised at SOME layer:
 *
 *   - no-drift: the PURE scorer reading the SAME `GeneratedScenario[]` as
 *     `defaultScenarioSet` is proven in `oracleCoverageScoring.test.ts`
 *     ("scores EXACTLY the generated dimensions");
 *   - no-leak: `requestWithAuthOverride` swap/restore (incl. restore-on-throw)
 *     is proven directly against the real executor in the same TG2 suite;
 *   - persistence: the assembled summary riding the completion PATCH is proven
 *     against a mocked AMS (TG2), and the AMS round-trip + null-guard +
 *     snake_case wire is proven in the Java suite (TG1).
 *
 * What was NOT yet covered are the two integration SEAMS that connect those
 * unit-tested pieces end-to-end -- the gaps this file fills (5 strategic
 * tests, deliberately NOT padded to the 10-test ceiling):
 *
 *   1. NO-DRIFT, single-source auth shapes -- `resolveAuthOverride` /
 *      `coerceAuthMode` (`authOverride.ts`) are the ONE definition of the
 *      no-auth / bad-token shapes shared by BOTH the `execute_http_request`
 *      tool arg AND the orchestrator's session-level probes. Untested directly
 *      before now (gap).
 *
 *   2. AUTH-OVERRIDE no-regression at the TOOL seam -- `execute_http_request`
 *      must route through the executor's `request` (normal path, byte-for-byte
 *      unchanged) when `authMode` is absent, and through the SCOPED
 *      `requestWithAuthOverride` (exactly once, no volatility-probe replay)
 *      with the correct override secret when `authMode` is `none` / `bad_token`.
 *      Existing executor tests stub `requestWithAuthOverride` but never assert
 *      the tool's routing (gap).
 *
 *   3. NO-DRIFT end-to-end through the REAL orchestrator loop -- a
 *      MULTI-dimension operation's persisted `per_endpoint` dimensions must
 *      line up 1:1 with `defaultScenarioSet(op)` by name, with a MIX of
 *      achieved + honest-reason MISSED dimensions. The TG2 orchestrator test
 *      only drives a single `happy_path` dimension, so the achieved/missed mix
 *      through the live loop was not asserted (gap).
 */

import {
  AuthMode,
  BAD_TOKEN_VALUE,
  coerceAuthMode,
  resolveAuthOverride,
} from '../services/authOverride';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import {
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
} from '../services/tools';
import { runManager } from '../services/runManager';
import {
  defaultScenarioSet,
  orchestrateCaptureSession,
} from '../services/captureSessionOrchestrator';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import type { CaptureSession } from '../types/captureSession';
import type { CaptureDto, CaptureSessionDto, OperationDto } from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

// ===========================================================================
// 1. SINGLE-SOURCE auth-override shapes (no drift between tool + probe paths)
// ===========================================================================

describe('authOverride -- the ONE definition the tool arg and the probes share', () => {
  it('resolveAuthOverride yields exactly the shapes the orchestrator probes send (no drift), and session/absent is the untouched normal path', () => {
    // `none` -> the no-auth shape the no_token probe uses.
    expect(resolveAuthOverride('none')).toEqual({ type: 'none' });
    // `bad_token` -> the SAME garbage bearer the bad_token probe sends
    // (the orchestrator's runAuthNegativeProbes uses BAD_TOKEN_VALUE verbatim).
    expect(resolveAuthOverride('bad_token')).toEqual({
      type: 'bearer',
      bearerToken: BAD_TOKEN_VALUE,
    });
    // The bad token is a non-empty, obviously-invalid marker (never a secret).
    expect(BAD_TOKEN_VALUE.length).toBeGreaterThan(0);

    // `session` / undefined / null all mean "no override" -> null, i.e. the
    // executor's `currentAuth` is left untouched (the normal path is unchanged).
    expect(resolveAuthOverride('session')).toBeNull();
    expect(resolveAuthOverride(undefined)).toBeNull();
    expect(resolveAuthOverride(null)).toBeNull();
  });

  it('coerceAuthMode narrows arbitrary tool input to a valid mode, defaulting unknown/garbage to session', () => {
    const cases: Array<[unknown, AuthMode]> = [
      ['none', 'none'],
      ['bad_token', 'bad_token'],
      ['session', 'session'],
      [undefined, 'session'],
      [null, 'session'],
      ['garbage', 'session'],
      [42, 'session'],
      [{ type: 'none' }, 'session'],
    ];
    for (const [input, expected] of cases) {
      expect(coerceAuthMode(input)).toBe(expected);
    }
  });
});

// ===========================================================================
// 2. AUTH-OVERRIDE no-regression at the `execute_http_request` tool seam
// ===========================================================================

const TOOL_SESSION_ID = 'session-cov-tool-1';
const TOOL_PROJECT_ID = 'proj-cov-tool-1';
const TOOL_ARCH_ID = 'arch-cov-tool-1';
const TOOL_SCENARIO_ID = 'scenario-cov-tool-1';

function buildToolSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: TOOL_SESSION_ID,
    projectId: TOOL_PROJECT_ID,
    architectureId: TOOL_ARCH_ID,
    name: 'tool-session',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: 'https://api.example.test',
    authType: 'bearer',
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: false,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: '2026-06-17T00:00:00Z',
    updatedAt: '2026-06-17T00:00:00Z',
    ...overrides,
  };
}

function buildToolOperation(overrides: Partial<OperationDto> = {}): OperationDto {
  return {
    id: 'op-row-tool-1',
    session_id: TOOL_SESSION_ID,
    operation_id: 'getThings',
    method: 'GET',
    path: '/things',
    summary: 'List things',
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: {},
    created_at: '2026-06-17T00:00:00Z',
    updated_at: '2026-06-17T00:00:00Z',
    ...overrides,
  };
}

interface ToolMockArch extends ArchModelToolWriteSurface {
  createCapture: jest.Mock;
  createDiagnostic: jest.Mock;
  createScenario: jest.Mock;
}

function buildToolArch(): ToolMockArch {
  let nextId = 1;
  return {
    createScenario: jest.fn(async () => ({ id: `scenario-${nextId++}` })),
    createDiagnostic: jest.fn(async () => ({ id: `diag-${nextId++}` })),
    createCapture: jest.fn(async () => ({ id: `capture-${nextId++}` } as Partial<CaptureDto>)),
  } as unknown as ToolMockArch;
}

/** Both seams are jest.fn so the test can assert WHICH one the tool routed
 *  through, and with which auth override. A 401 status lands as a normal
 *  captured row (validateStatus: () => true semantics), so the override call
 *  still persists. */
function buildRoutingExecutor(): SessionHttpExecutor & {
  request: jest.Mock;
  requestWithAuthOverride: jest.Mock;
} {
  return {
    request: jest.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      data: { id: 1, name: 'thing' },
    })),
    requestWithAuthOverride: jest.fn(async () => ({
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {} as never,
      data: { error: 'unauthorized' },
    })),
    setAuth: jest.fn(),
    dispose: jest.fn(),
  } as unknown as SessionHttpExecutor & { request: jest.Mock; requestWithAuthOverride: jest.Mock };
}

function buildToolContext(
  executor: SessionHttpExecutor,
): ToolExecutionContext {
  const op = buildToolOperation();
  return {
    session: buildToolSession(),
    oasInventory: { title: 'Test', version: '1.0.0', operations: [] },
    operationsByOasId: new Map([[op.operation_id, op]]),
    secrets: { sessionId: TOOL_SESSION_ID, api: { type: 'bearer', bearerToken: 'valid' }, loadedAt: Date.now() },
    httpExecutor: executor,
    dbAdapter: null,
    archModelClient: buildToolArch(),
    currentScenarioId: TOOL_SCENARIO_ID,
  };
}

function startToolRun(): void {
  if (runManager.has(TOOL_SESSION_ID)) runManager.end(TOOL_SESSION_ID);
  runManager.start({
    sessionId: TOOL_SESSION_ID,
    projectId: TOOL_PROJECT_ID,
    architectureId: TOOL_ARCH_ID,
  });
}

afterEach(() => {
  if (runManager.has(TOOL_SESSION_ID)) runManager.end(TOOL_SESSION_ID);
});

describe('execute_http_request -- authMode routing (no leak, normal path unchanged)', () => {
  it('routes through the NORMAL `request` seam (never the override) when authMode is absent', async () => {
    startToolRun();
    const exec = buildRoutingExecutor();
    const ctx = buildToolContext(exec);

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    // The normal path is taken: at least the captured call (plus k volatility
    // probe replays for a safe 2xx GET) all go through `request`. The scoped
    // override seam is NEVER touched when authMode is absent -- byte-for-byte
    // the pre-spec behaviour.
    expect(exec.request).toHaveBeenCalled();
    expect(exec.requestWithAuthOverride).not.toHaveBeenCalled();
  });

  it('routes the SINGLE call through the SCOPED override seam with {type:"none"} for authMode "none" (and fires no volatility-probe replays)', async () => {
    startToolRun();
    const exec = buildRoutingExecutor();
    const ctx = buildToolContext(exec);

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things', authMode: 'none' },
      ctx,
    );

    // The override seam is used EXACTLY once -- a deliberate negative is never
    // replayed k more times by the volatility probe (the `!authOverride`
    // guard), so the scoped no-auth state cannot leak onto a probe replay.
    expect(exec.requestWithAuthOverride).toHaveBeenCalledTimes(1);
    expect(exec.request).not.toHaveBeenCalled();
    // The override secret is the shared no-auth shape (single source).
    const [, override] = exec.requestWithAuthOverride.mock.calls[0];
    expect(override).toEqual({ type: 'none' });
  });

  it('routes through the override seam with the shared BAD_TOKEN_VALUE for authMode "bad_token"', async () => {
    startToolRun();
    const exec = buildRoutingExecutor();
    const ctx = buildToolContext(exec);

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things', authMode: 'bad_token' },
      ctx,
    );

    expect(exec.requestWithAuthOverride).toHaveBeenCalledTimes(1);
    expect(exec.request).not.toHaveBeenCalled();
    const [, override] = exec.requestWithAuthOverride.mock.calls[0];
    expect(override).toEqual({ type: 'bearer', bearerToken: BAD_TOKEN_VALUE });
  });
});

// ===========================================================================
// 3. NO-DRIFT end-to-end through the REAL orchestrator loop (multi-dimension)
// ===========================================================================

const E2E_PROJECT_ID = '00000000-0000-0000-0000-0000000000f1';
const E2E_ARCH_ID = '00000000-0000-0000-0000-0000000000f2';
const E2E_SESSION_ID = '00000000-0000-0000-0000-0000000000f3';

function buildE2ESessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: E2E_SESSION_ID,
    project_id: E2E_PROJECT_ID,
    architecture_id: E2E_ARCH_ID,
    name: 'e2e-coverage-session',
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

/** A path-param + enum op so defaultScenarioSet emits MULTIPLE dimensions:
 *  happy_path, not_found_id, enum_status_OPEN, enum_status_CLOSED, and a
 *  bad_request for the required enum query param. */
function buildE2EOperation(): OperationDto {
  const now = new Date().toISOString();
  const oas = {
    operationId: 'getThing',
    parameters: [
      { name: 'id', in: 'path', required: true },
      { name: 'status', in: 'query', required: true, schema: { enum: ['OPEN', 'CLOSED'] } },
    ],
  };
  return {
    id: 'op-row-e2e-1',
    session_id: E2E_SESSION_ID,
    operation_id: 'getThing',
    method: 'GET',
    path: '/things/{id}',
    summary: 'Get a thing',
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: oas as unknown,
    created_at: now,
    updated_at: now,
  };
}

function buildE2EInventory(): ParsedOasInventory {
  return {
    title: 'e2e coverage fixture',
    version: '1.0.0',
    operations: [
      {
        operationId: 'getThing',
        method: 'get',
        path: '/things/{id}',
        summary: 'Get a thing',
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: {
          operationId: 'getThing',
          parameters: [
            { name: 'id', in: 'path', required: true },
            { name: 'status', in: 'query', required: true, schema: { enum: ['OPEN', 'CLOSED'] } },
          ],
        } as never,
      },
    ],
  };
}

function buildE2EAms(): {
  sessionPatches: Array<{ body: any }>;
  client: Record<string, jest.Mock>;
} {
  const sessionPatches: Array<{ body: any }> = [];
  let captureN = 0;
  const sessionDto = buildE2ESessionDto();
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

function execMsg(callId: string): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: {
          name: 'execute_http_request',
          arguments: JSON.stringify({ operationId: 'getThing', method: 'get', path: '/things/{id}' }),
        },
      },
    ],
  };
}

function noteMsg(id: string): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id, type: 'function', function: { name: 'record_capture_note', arguments: JSON.stringify({ message: 'done' }) } },
    ],
  };
}

function buildGatewayQueue(messages: AssistantMessage[]) {
  const queue = [...messages];
  return {
    callLlmToolLoop: jest.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('mock gateway: queue exhausted');
      return { message: next };
    }),
  };
}

describe('orchestrator -- end-to-end NO-DRIFT for a multi-dimension op', () => {
  beforeEach(() => {
    secretsStore.clearAll();
    secretsStore.set({ sessionId: E2E_SESSION_ID, api: { type: 'bearer', bearerToken: 'plaintext' }, loadedAt: Date.now() });
    if (runManager.has(E2E_SESSION_ID)) runManager.end(E2E_SESSION_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    secretsStore.clearAll();
    if (runManager.has(E2E_SESSION_ID)) runManager.end(E2E_SESSION_ID);
  });

  it('persists per_endpoint dimensions that match defaultScenarioSet 1:1 (no extra, none missing) with a real achieved+missed mix and honest miss reasons', async () => {
    const op = buildE2EOperation();
    // The rubric the orchestrator will ALSO use for generation: prove the
    // persisted dimension set is exactly this set, scored.
    const rubric = defaultScenarioSet(op, undefined, op.oas_operation_json);
    const rubricNames = rubric.map((s) => s.name).sort();
    // Sanity: this fixture really is multi-dimension (not a degenerate single
    // happy_path), so the 1:1 assertion below is meaningful.
    expect(rubric.length).toBeGreaterThan(2);

    // Drive a per-scenario status by scenario NAME so the achieved/missed mix
    // is deterministic regardless of generation order:
    //   happy_path        -> 200 (achieved, success)
    //   not_found_id      -> 404 (achieved, not_found)
    //   enum_status_OPEN  -> 200 (achieved, success)
    //   enum_status_CLOSED-> 500 (MISSED -> "5xx on all attempts" reason)
    //   bad_request_status-> (no capture) MISSED -> "no capture was recorded"
    const statusByScenario: Record<string, number | null> = {
      happy_path: 200,
      not_found_id: 404,
      enum_status_OPEN: 200,
      enum_status_CLOSED: 500,
    };
    // bad_request_* deliberately omitted -> its execute returns nothing usable.

    let currentScenario = '';
    const request = jest.fn(async () => {
      const status = statusByScenario[currentScenario];
      if (status == null) {
        // No usable response for this scenario -> capture is still persisted by
        // the tool, but with no matching canonical (a transport-style miss is
        // simulated by returning a 500 we don't map). Use 500 so selectCanonical
        // returns null for a client_error dimension too.
        return { status: 500, statusText: 'ERR', headers: {}, config: {} as never, data: { err: true } };
      }
      return { status, statusText: 'X', headers: {}, config: {} as never, data: { ok: status < 300 } };
    });

    // The gateway emits one execute + one note per scenario, and we set
    // `currentScenario` from the createScenario body so `request` knows which
    // status to return.
    const ams = buildE2EAms();
    ams.client.createScenario = jest.fn(async (_p: string, body: any) => {
      currentScenario = body.scenario_name;
      return { id: `scenario-${body.scenario_name}`, ...body };
    });

    const requestWithAuthOverride = jest.fn(async (_c: any, override: any) => ({
      status: override.type === 'none' ? 401 : 403,
      statusText: 'AUTH',
      headers: {},
      config: {} as never,
      data: { error: 'unauthorized' },
    }));
    jest
      .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
      .mockReturnValue({ request, requestWithAuthOverride, setAuth: jest.fn(), dispose: jest.fn() });

    // Two gateway turns (execute + note) per generated scenario.
    const turns: AssistantMessage[] = [];
    for (let i = 0; i < rubric.length; i += 1) {
      turns.push(execMsg(`exec-${i}`), noteMsg(`note-${i}`));
    }
    const gateway = buildGatewayQueue(turns);

    await orchestrateCaptureSession(toCaptureSession(buildE2ESessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildE2EInventory(),
      persistedOperations: [op],
    });

    expect(ams.sessionPatches).toHaveLength(1);
    const summary = ams.sessionPatches[0].body.coverage_summary_json;
    expect(summary).toBeTruthy();
    expect(summary.per_endpoint).toHaveLength(1);
    const ep = summary.per_endpoint[0];

    // NO-DRIFT: the persisted dimension NAMES equal defaultScenarioSet's output
    // exactly -- no dimension scored that was not generated, none missing.
    const scoredNames = ep.dimensions.map((d: any) => d.name).sort();
    expect(scoredNames).toEqual(rubricNames);

    const byName = new Map<string, any>(ep.dimensions.map((d: any) => [d.name, d]));

    // Achieved dimensions: happy_path, not_found_id, enum_status_OPEN.
    expect(byName.get('happy_path').achieved).toBe(true);
    expect(byName.get('happy_path').canonical_capture_id).toBeTruthy();
    expect(byName.get('happy_path').reason).toBeNull();
    expect(byName.get('not_found_id').achieved).toBe(true);
    expect(byName.get('enum_status_OPEN').achieved).toBe(true);

    // Missed enum (only a 500 came back) -> honest 5xx reason, no canonical id.
    const closed = byName.get('enum_status_CLOSED');
    expect(closed.achieved).toBe(false);
    expect(closed.canonical_capture_id).toBeNull();
    expect(typeof closed.reason).toBe('string');
    expect(closed.reason.length).toBeGreaterThan(0);

    // The endpoint score is the achieved/total fraction off the SAME dimensions.
    const achievedCount = ep.dimensions.filter((d: any) => d.achieved).length;
    expect(ep.score).toBeCloseTo(achievedCount / ep.dimensions.length);

    // The templated-path op cannot be an auth-probe representative, so the
    // single project-level auth dimension is MISSED with an honest reason and
    // contributes +1 to the denominator only (overall folds it in).
    expect(summary.auth_coverage.achieved).toBe(false);
    expect(summary.auth_coverage.representative_operation_id).toBeNull();
    expect(requestWithAuthOverride).not.toHaveBeenCalled();
    expect(summary.dimensions_total).toBe(ep.dimensions.length + 1);
    expect(summary.dimensions_achieved).toBe(achievedCount);
  });
});
