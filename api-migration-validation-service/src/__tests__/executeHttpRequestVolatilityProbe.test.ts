/**
 * FU-2: capture-time volatility probe wired into `execute_http_request`.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * FU-2 (probe-at-capture wiring).
 *
 * These tests prove the END-TO-END capture-side seam: when a non-mutating
 * scenario is executed during capture, the probe replays the same request
 * through the SAME `ctx.httpExecutor` (the current-system executor), self-diffs
 * the responses, and the resulting envelope is written onto the capture row's
 * `volatile_paths_json` so it survives to the frontend-driven Save-as-baseline
 * promotion (where it lands on the source baseline item).
 *
 * Scope (focused):
 *   1. A non-mutating GET whose probe replays VARY on a leaf records that leaf
 *      in `volatile_paths_json.paths`, tagged `probed`, k = repeats, and the
 *      executor is hit once for the captured call plus k probe replays.
 *   2. A non-mutating GET that is deterministic across replays records an
 *      EMPTY `paths` (still `probed`) -- the invariant that no measured
 *      variance still yields a real, non-null envelope.
 *   3. The mutating guard: a POST with `mutatingCallsConfirmed = true` is
 *      tagged `not_probed` and makes NO probe replays (the executor is hit
 *      exactly once, for the captured call only).
 *
 * The executor mock returns VARYING bodies across calls (call 1 = the captured
 * call, calls 2..k+1 = the probe replays) so the self-diff has something to
 * measure. Probe spacing is disabled (spacingMs via env default is small; the
 * tests inject 0 indirectly by relying on the budget not being hit) -- the
 * tests run synchronously fast because the mock resolves immediately.
 */

import { AxiosResponse } from 'axios';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import {
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
} from '../services/tools';
import { runManager } from '../services/runManager';
import { VOLATILITY_PROBE_REPEATS } from '../config';
import type { CaptureSession } from '../types/captureSession';
import type { CaptureDto, OperationDto } from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';

const SESSION_ID = 'session-vol-probe-1';
const PROJECT_ID = 'proj-vol-1';
const ARCH_ID = 'arch-vol-1';
const SCENARIO_ID = 'scenario-vol-1';

function buildSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'vol-session',
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
    createdAt: '2026-06-16T00:00:00Z',
    updatedAt: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

function buildOperation(overrides: Partial<OperationDto> = {}): OperationDto {
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
    oas_operation_json: {},
    created_at: '2026-06-16T00:00:00Z',
    updated_at: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

interface MockArchClient extends ArchModelToolWriteSurface {
  createCapture: jest.Mock;
  createDiagnostic: jest.Mock;
  createScenario: jest.Mock;
}

function buildMockArchClient(): MockArchClient {
  let nextId = 1;
  return {
    createScenario: jest.fn(async () => ({ id: `scenario-${nextId++}` })) as MockArchClient['createScenario'],
    createDiagnostic: jest.fn(async () => ({ id: `diag-${nextId++}` })) as MockArchClient['createDiagnostic'],
    createCapture: jest.fn(async () => ({ id: `capture-${nextId++}` } as Partial<CaptureDto>)) as MockArchClient['createCapture'],
  } as MockArchClient;
}

function buildHttpExecutor(
  request: jest.Mock,
): SessionHttpExecutor & { request: jest.Mock } {
  return {
    request,
    setAuth: jest.fn(),
    dispose: jest.fn(),
  } as unknown as SessionHttpExecutor & { request: jest.Mock };
}

function jsonResponse(status: number, data: unknown): AxiosResponse<unknown> {
  return {
    status,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    config: {} as never,
    data,
  };
}

function buildContext(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  const arch = buildMockArchClient();
  const op = buildOperation();
  return {
    session: buildSession(),
    oasInventory: { title: 'Test', version: '1.0.0', operations: [] },
    operationsByOasId: new Map([[op.operation_id, op]]),
    secrets: { sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() },
    httpExecutor: buildHttpExecutor(jest.fn()),
    dbAdapter: null,
    archModelClient: arch,
    currentScenarioId: SCENARIO_ID,
    ...overrides,
  };
}

function startRun(): void {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  runManager.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
}

afterEach(() => {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

describe('execute_http_request -- capture-time volatility probe (FU-2)', () => {
  it('records a varying leaf path on the capture row, tagged probed, and replays through the SAME executor k more times', async () => {
    startRun();
    // Call 1 = the captured call; calls 2..(k+1) = the probe replays. Vary
    // `serverTime` across the probe replays so the self-diff measures it.
    let call = 0;
    const request = jest.fn(async () => {
      call += 1;
      // Deterministic id, but a serverTime that changes every replay.
      return jsonResponse(200, { id: 1, serverTime: `2026-06-16T00:00:0${call}Z` });
    });
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(request) });
    const arch = ctx.archModelClient as MockArchClient;

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    // The captured call plus k probe replays.
    expect(request).toHaveBeenCalledTimes(1 + VOLATILITY_PROBE_REPEATS);
    expect(arch.createCapture).toHaveBeenCalledTimes(1);

    const body = arch.createCapture.mock.calls[0][1] as {
      volatile_paths_json: Record<string, unknown> | null;
    };
    const env = body.volatile_paths_json as {
      paths: string[];
      volatility_source: string;
      k: number;
    } | null;
    expect(env).not.toBeNull();
    expect(env?.volatility_source).toBe('probed');
    expect(env?.k).toBe(VOLATILITY_PROBE_REPEATS);
    // The varying leaf is recorded as a normalised JSON-Pointer; the
    // deterministic `id` leaf is NOT.
    expect(env?.paths).toContain('/serverTime');
    expect(env?.paths).not.toContain('/id');
  });

  it('records an EMPTY paths list (still probed, non-null envelope) when the response is deterministic across replays', async () => {
    startRun();
    const request = jest.fn(async () => jsonResponse(200, { id: 1, name: 'thing' }));
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(request) });
    const arch = ctx.archModelClient as MockArchClient;

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    const body = arch.createCapture.mock.calls[0][1] as {
      volatile_paths_json: Record<string, unknown> | null;
    };
    const env = body.volatile_paths_json as {
      paths: string[];
      volatility_source: string;
      k: number;
    } | null;
    // No measured variance => empty paths but a REAL (non-null) probed
    // envelope -- distinct from the never-probed `null` strict default.
    expect(env).not.toBeNull();
    expect(env?.volatility_source).toBe('probed');
    expect(env?.paths).toEqual([]);
  });

  it('does NOT probe a mutating scenario: tags not_probed and makes NO probe replays', async () => {
    startRun();
    const request = jest.fn(async () => jsonResponse(201, { id: 42 }));
    const op = buildOperation({
      operation_id: 'createThing',
      method: 'POST',
      path: '/things',
      included: true,
      safe_to_execute: false,
    });
    const ctx = buildContext({
      session: buildSession({ mutatingCallsConfirmed: true }),
      operationsByOasId: new Map([[op.operation_id, op]]),
      httpExecutor: buildHttpExecutor(request),
    });
    const arch = ctx.archModelClient as MockArchClient;

    await executeHttpRequestTool.handler(
      { operationId: 'createThing', method: 'post', path: '/things', body: { name: 'x' } },
      ctx,
    );

    // A 201 is non-2xx... wait, 201 IS 2xx. The mutating guard must still stop
    // the probe BEFORE any replay -- the executor is hit exactly ONCE (the
    // captured call), never the k probe replays. (The probe's own
    // mutating-scenario guard returns `not_probed` without making any call.)
    expect(request).toHaveBeenCalledTimes(1);
    expect(arch.createCapture).toHaveBeenCalledTimes(1);

    const body = arch.createCapture.mock.calls[0][1] as {
      volatile_paths_json: Record<string, unknown> | null;
    };
    const env = body.volatile_paths_json as {
      paths: string[];
      volatility_source: string;
      k: number;
    } | null;
    expect(env).not.toBeNull();
    expect(env?.volatility_source).toBe('not_probed');
    expect(env?.paths).toEqual([]);
    expect(env?.k).toBe(0);
  });
});
