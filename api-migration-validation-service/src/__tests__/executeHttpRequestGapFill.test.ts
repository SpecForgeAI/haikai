/**
 * Gap-fill tests for the `execute_http_request` rewrite.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- Task Group 4 sub-task 4.3.
 *
 * Gaps identified after reviewing Groups 1-3:
 *
 *   1. The Group 2 "operation_not_executable" test asserts the gate THROWS
 *      and that no HTTP request / capture row results, but does NOT assert
 *      that the runManager attempt counter WAS still incremented (the
 *      spec D4 semantics: "increment at the TOP of the handler so even
 *      early-failed attempts consume budget"). Without this assertion, a
 *      regression that moves the increment AFTER the gates would pass all
 *      existing tests. -> Test A.
 *
 *   2. The Group 2 success test asserts `captureId` matches a `/^capture-/`
 *      regex; the Group 3 e2e tests assert capture rows land in the AMS
 *      fake. Neither pair asserts the `captureId` returned in the tool
 *      result is the SAME id keyed in the AMS fake -- i.e. the LLM
 *      round-trip correlation explicitly called out by the spec
 *      ("Return the persisted capture id back to the LLM ... so the
 *      LLM/loop can correlate"). -> Test B.
 *
 *   3. The defensive `missing_scenario_id` guard added in `execute_http_request.ts`
 *      (the FK requires a non-null scenario_id) has no test coverage in
 *      Groups 1-3 -- the orchestrator always sets `currentScenarioId`
 *      before invoking the tool in production, but the guard exists
 *      precisely for the test/regression path. -> Test C.
 *
 * Hard cap per Group 4: 3 new tests. This file is exactly that.
 */

import { AxiosResponse } from 'axios';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import {
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
} from '../services/tools';
import { runManager } from '../services/runManager';
import type { CaptureSession } from '../types/captureSession';
import type { CaptureDto, OperationDto } from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';

const SESSION_ID = 'session-gap-fill-1';
const PROJECT_ID = 'proj-gap-1';
const ARCH_ID = 'arch-gap-1';
const SCENARIO_ID = 'scenario-gap-1';

function buildSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'gap-fill-session',
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
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
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
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

interface MockArchClient extends ArchModelToolWriteSurface {
  createCapture: jest.Mock;
  createDiagnostic: jest.Mock;
  createScenario: jest.Mock;
  /** Test-only: in-memory store keyed by capture id so we can verify round-trip. */
  store: Map<string, CaptureDto>;
}

function buildMockArchClient(): MockArchClient {
  const store = new Map<string, CaptureDto>();
  let seq = 0;
  const createCapture = jest.fn(async (_projectId: string, body): Promise<CaptureDto> => {
    const id = `capture-${++seq}`;
    const row = {
      id,
      session_id: body.session_id,
      scenario_id: body.scenario_id,
      operation_id: body.operation_id,
      attempt_number: body.attempt_number ?? null,
      request_method: body.request_method ?? null,
      request_path: body.request_path ?? null,
      request_query_json: body.request_query_json ?? null,
      request_headers_redacted_json: body.request_headers_redacted_json ?? null,
      request_body_json: body.request_body_json ?? null,
      response_status: body.response_status ?? null,
      response_headers_redacted_json: body.response_headers_redacted_json ?? null,
      response_body_json: body.response_body_json ?? null,
      duration_ms: body.duration_ms ?? null,
      error_type: body.error_type ?? null,
      error_message: body.error_message ?? null,
      captured_at: body.captured_at ?? null,
      accepted: null,
      accepted_at: null,
      reviewer_notes: null,
    } as CaptureDto;
    store.set(id, row);
    return row;
  });
  return {
    createScenario: jest.fn(async () => ({ id: `scenario-${++seq}` })) as MockArchClient['createScenario'],
    createDiagnostic: jest.fn(async () => ({ id: `diag-${++seq}` })) as MockArchClient['createDiagnostic'],
    createCapture,
    store,
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

function buildContext(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  const arch = buildMockArchClient();
  const op = buildOperation();
  return {
    session: buildSession(),
    oasInventory: {
      title: 'Test',
      version: '1.0.0',
      operations: [],
    },
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
  runManager.start({
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
  });
}

afterEach(() => {
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Test A -- gate-rejected call STILL consumes a runManager attempt slot
// ---------------------------------------------------------------------------

describe('execute_http_request -- gate-rejected attempts consume budget (D4 semantics)', () => {
  it('increments scenarioHttpAttempts BEFORE the executability gate, so a rejected call still burns budget', async () => {
    startRun();
    expect(runManager.get(SESSION_ID)?.scenarioHttpAttempts).toBe(0);

    const op = buildOperation({
      operation_id: 'createThing',
      method: 'POST',
      path: '/things',
      included: true,
      safe_to_execute: false,
    });
    const ctx = buildContext({
      session: buildSession({ mutatingCallsConfirmed: false }),
      operationsByOasId: new Map([[op.operation_id, op]]),
      httpExecutor: buildHttpExecutor(jest.fn()),
    });

    await expect(
      executeHttpRequestTool.handler(
        { operationId: 'createThing', method: 'post', path: '/things' },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'ToolValidationError',
      reason: 'operation_not_executable',
    });

    // The gate threw, but the counter was incremented at the TOP of the
    // handler (D4) so the rejected call still consumed slot #1. A
    // regression that moves the increment AFTER the gates would leave the
    // counter at 0 here.
    expect(runManager.get(SESSION_ID)?.scenarioHttpAttempts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test B -- captureId in the tool result equals the id stored in AMS
// ---------------------------------------------------------------------------

describe('execute_http_request -- captureId round-trip correlation', () => {
  it('returns a captureId that matches the id of the row stored in the AMS fake', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      data: { ok: true },
    };
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(jest.fn(async () => response)),
    });
    const arch = ctx.archModelClient as MockArchClient;

    const result = await executeHttpRequestTool.handler(
      { operationId: 'getThings', method: 'get', path: '/things' },
      ctx,
    );

    const returnedId = (result as { captureId: string }).captureId;
    // The id returned to the LLM/loop is the same id keyed in AMS. This is
    // the round-trip correlation the spec calls out explicitly: "Return
    // the persisted capture id back to the LLM ... so the LLM/loop can
    // correlate."
    expect(arch.store.has(returnedId)).toBe(true);
    expect(arch.store.get(returnedId)?.session_id).toBe(SESSION_ID);
    expect(arch.store.get(returnedId)?.scenario_id).toBe(SCENARIO_ID);
    expect(arch.store.get(returnedId)?.attempt_number).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test C -- defensive missing_scenario_id guard
// ---------------------------------------------------------------------------

describe('execute_http_request -- defensive missing scenario id guard', () => {
  it('throws missing_scenario_id when ctx.currentScenarioId is null and does NOT persist a capture row', async () => {
    startRun();
    const response: AxiosResponse<unknown> = {
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as never,
      data: { ok: true },
    };
    const request = jest.fn(async () => response);
    const ctx = buildContext({
      httpExecutor: buildHttpExecutor(request),
      currentScenarioId: null,
    });
    const arch = ctx.archModelClient as MockArchClient;

    await expect(
      executeHttpRequestTool.handler(
        { operationId: 'getThings', method: 'get', path: '/things' },
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'ToolValidationError',
      reason: 'missing_scenario_id',
    });

    // The request DID happen (the guard is post-request to avoid duplicating
    // gate logic), but no capture row was persisted -- the FK requires a
    // non-null scenario_id, so the guard fires before createCapture.
    expect(request).toHaveBeenCalledTimes(1);
    expect(arch.createCapture).not.toHaveBeenCalled();
    expect(arch.store.size).toBe(0);
  });
});
