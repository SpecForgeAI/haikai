/**
 * Focused tests for `execute_http_request` driving the per-scenario
 * persisted-capture counter and emitting `failed_request` diagnostics for
 * no-capture / failed-persistence attempts.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 *       misleading-COMPLETED follow-up.
 *
 * Scope:
 *   1. A successful `createCapture` bumps `runManager.scenarioCapturesPersisted`
 *      by exactly one (so the orchestrator can tell the scenario captured).
 *   2. A transport failure (axios throw with no response) STILL persists a
 *      capture row (existing behaviour) AND emits a `failed_request`
 *      diagnostic so the failure is auditable; the counter still bumps because
 *      a row WAS persisted.
 *   3. A `createCapture` failure does NOT bump the counter and emits a
 *      `failed_request` diagnostic (phase=create_capture_failed) before
 *      rethrowing.
 */

import { AxiosError, AxiosResponse } from 'axios';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import type {
  ArchModelToolWriteSurface,
  ToolExecutionContext,
} from '../services/tools';
import { runManager } from '../services/runManager';
import type { CaptureSession } from '../types/captureSession';
import type { CaptureDto, OperationDto } from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';

const SESSION_ID = 'session-exec-cap-1';
const PROJECT_ID = 'proj-exec-cap-1';
const ARCH_ID = 'arch-exec-cap-1';
const SCENARIO_ID = 'scenario-cap-1';

function buildSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'test-session',
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

function buildHttpExecutor(request: jest.Mock): SessionHttpExecutor & { request: jest.Mock } {
  return { request, setAuth: jest.fn(), dispose: jest.fn() } as unknown as SessionHttpExecutor & { request: jest.Mock };
}

function buildContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
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

describe('execute_http_request -- scenarioCapturesPersisted counter', () => {
  it('bumps runManager.scenarioCapturesPersisted by one after a successful createCapture (2xx)', async () => {
    startRun();
    expect(runManager.getScenarioCapturesPersisted(SESSION_ID)).toBe(0);
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
      data: { ok: true },
    };
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(jest.fn(async () => response)) });

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    expect((ctx.archModelClient as MockArchClient).createCapture).toHaveBeenCalledTimes(1);
    expect(runManager.getScenarioCapturesPersisted(SESSION_ID)).toBe(1);
  });

  it('a transport failure persists the row, bumps the counter, AND emits a failed_request diagnostic (http_no_response)', async () => {
    startRun();
    const transportErr = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      name: 'AxiosError',
      isAxiosError: true,
    }) as unknown as AxiosError;
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(jest.fn(async () => { throw transportErr; })),
    });
    const arch = ctx.archModelClient as MockArchClient;

    await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    // Row was persisted (existing behaviour) and counter bumped.
    expect(arch.createCapture).toHaveBeenCalledTimes(1);
    expect(runManager.getScenarioCapturesPersisted(SESSION_ID)).toBe(1);
    // A failed_request diagnostic was emitted for the no-response attempt.
    const failed = arch.createDiagnostic.mock.calls
      .map((c) => c[1])
      .filter((b) => b.diagnostic_type === 'failed_request');
    expect(failed).toHaveLength(1);
    expect(failed[0].detail_json.phase).toBe('http_no_response');
    expect(failed[0].detail_json.error_type).toBe('ECONNRESET');
  });

  it('a createCapture failure does NOT bump the counter and emits a failed_request diagnostic (create_capture_failed) before rethrow', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
      data: { ok: true },
    };
    const ctx = buildContext({ httpExecutor: buildHttpExecutor(jest.fn(async () => response)) });
    const arch = ctx.archModelClient as MockArchClient;
    arch.createCapture.mockRejectedValueOnce(new Error('AMS write failed'));

    await expect(
      executeHttpRequestTool.handler(
        { operationId: 'getThings', method: 'get', path: '/things' },
        ctx,
      ),
    ).rejects.toThrow(/AMS write failed/);

    // Nothing was persisted -> counter stays at 0.
    expect(runManager.getScenarioCapturesPersisted(SESSION_ID)).toBe(0);
    // A failed_request diagnostic was emitted before the rethrow.
    const failed = arch.createDiagnostic.mock.calls
      .map((c) => c[1])
      .filter((b) => b.diagnostic_type === 'failed_request');
    expect(failed).toHaveLength(1);
    expect(failed[0].detail_json.phase).toBe('create_capture_failed');
  });
});
