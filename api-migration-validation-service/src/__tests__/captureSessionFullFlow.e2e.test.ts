/**
 * Full-flow end-to-end test for the API Behaviour capture pipeline.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- Task Group 3.
 *
 * Proves the closed loop from "session configured + secrets staged + inventory
 * present" through `orchestrateCaptureSession` to a saved baseline. Stack:
 *
 *   - Real local Express stub bound to `127.0.0.1:0` standing in for the
 *     target API under test (GET / POST / 500 / socket-close paths).
 *   - Real `createSessionHttpExecutor` against the stub (we do NOT spy this
 *     out -- the executor's redaction-on-the-wire is part of what we're
 *     covering).
 *   - Faked `gatewayClient.callLlmToolLoop` returning a scripted assistant
 *     message queue (no real LLM).
 *   - Faked `archModelClient` at the boundary with in-memory Maps for
 *     captures, scenarios, diagnostics, sessions, baselines, baseline-items.
 *
 * Coverage (five `it`s):
 *   1. Attempt-number sequence within a scenario is 1, 2, 3 AND resets to 1
 *      at the scenario boundary (proves the runManager counter is the source
 *      of truth and `beginScenario` resets it correctly through the real
 *      orchestrator).
 *   2. A 500 response from the stub persists a capture row with
 *      `response_status = 500` and populated redacted response slots.
 *   3. A path that closes the socket mid-response persists a capture row
 *      with `response_status = null`, populated `error_type` + `error_message`.
 *   4. Accepting one capture and "saving" a baseline via the AMS client
 *      surface returns a `BaselineDto` whose item count matches the accepted
 *      captures and whose snapshot includes the redacted request method /
 *      path / response status / response body from the accepted capture.
 *   5. Mutating-confirmation flow: with `mutatingCallsConfirmed = false`,
 *      `POST /widgets` is blocked (no capture row); with
 *      `mutatingCallsConfirmed = true`, the same call SUCCEEDS and persists
 *      a capture row.
 *
 * Sits alongside the existing `captureSessionOrchestrator.e2e.test.ts` which
 * covers the orchestrator lifecycle (secrets purge, runManager teardown,
 * session PATCH on terminal). This file's focus is the four gaps closed by
 * the 2026-05-16 fixes spec.
 */

import express, { Request, Response } from 'express';
import type { AddressInfo } from 'net';
import http from 'http';
import { orchestrateCaptureSession } from '../services/captureSessionOrchestrator';
import {
  toCaptureSession,
  type CaptureSessionDto,
  type OperationDto,
  type CaptureDto,
  type ScenarioDto,
  type DiagnosticDto,
  type BaselineDto,
  type BaselineItemDto,
  type CreateCaptureRequest,
  type CreateScenarioRequest,
  type CreateDiagnosticRequest,
  type CreateBaselineRequest,
  type CreateBaselineItemRequest,
  type PatchCaptureSessionRequest,
} from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

// ---------------------------------------------------------------------------
// Constants -- per-test ids are derived from these so multiple tests can run
// concurrently in a single Jest worker without collision.
// ---------------------------------------------------------------------------

const PROJECT_ID = '00000000-0000-0000-0000-0000000fff01';
const ARCH_ID = '00000000-0000-0000-0000-0000000fff02';

// ---------------------------------------------------------------------------
// Express stub server bound to 127.0.0.1:0 (ephemeral port). One instance is
// reused across all tests; each `it` resets the per-endpoint behaviour
// toggles via the `stubControls` handle returned from `startStubServer`.
// ---------------------------------------------------------------------------

interface StubControls {
  /** Reset all path counters / behaviour toggles between tests. */
  reset(): void;
  /** Number of times the configurable 500 path has been hit. */
  five00Hits(): number;
}

interface StubServerHandle {
  baseUrl: string;
  server: http.Server;
  controls: StubControls;
}

async function startStubServer(): Promise<StubServerHandle> {
  let five00Calls = 0;

  const app = express();
  app.use(express.json());

  // Happy-path GET -- returns a canned JSON body.
  app.get('/widgets/:id', (req: Request, res: Response) => {
    res.status(200).json({ id: req.params.id, name: 'widget-' + req.params.id });
  });

  // Mutating POST -- requires session.mutating_calls_confirmed=true to reach
  // this endpoint (the tool gate fires before any HTTP call leaves the
  // service). Returns 201 with an echo body.
  app.post('/widgets', (req: Request, res: Response) => {
    res.status(201).json({ id: 99, ...(req.body ?? {}) });
  });

  // Always-500 path -- exercises the non-2xx capture row path.
  app.get('/always-500', (_req: Request, res: Response) => {
    five00Calls += 1;
    res.status(500).json({ error: 'simulated_server_error' });
  });

  // Socket-close path -- closes the underlying connection without sending a
  // response. Forces the http executor's axios layer to throw with NO
  // `.response` field, which is the transport-failure code path under test.
  app.get('/drop-socket', (_req: Request, res: Response) => {
    res.socket?.destroy();
  });

  return await new Promise<StubServerHandle>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr || typeof addr === 'string') {
        reject(new Error('stub server: failed to bind ephemeral port'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        server,
        controls: {
          reset: () => {
            five00Calls = 0;
          },
          five00Hits: () => five00Calls,
        },
      });
    });
    server.on('error', reject);
  });
}

async function stopStubServer(handle: StubServerHandle): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    handle.server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

function buildSessionDto(opts: {
  sessionId: string;
  apiBaseUrl: string;
  mutatingConfirmed: boolean;
}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: opts.sessionId,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'e2e-fullflow-session',
    status: 'running',
    env_name: 'non-prod',
    api_base_url: opts.apiBaseUrl,
    auth_type: 'none',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: opts.mutatingConfirmed,
    started_at: now,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
}

function buildOperationRow(opts: {
  rowId: string;
  sessionId: string;
  operationId: string;
  method: string;
  path: string;
  included: boolean;
  safeToExecute: boolean;
}): OperationDto {
  const now = new Date().toISOString();
  return {
    id: opts.rowId,
    session_id: opts.sessionId,
    operation_id: opts.operationId,
    method: opts.method,
    path: opts.path,
    summary: null,
    description: null,
    included: opts.included,
    safe_to_execute: opts.safeToExecute,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: { operationId: opts.operationId },
    created_at: now,
    updated_at: now,
  };
}

function buildInventory(operations: ReadonlyArray<{ operationId: string; method: string; path: string }>): ParsedOasInventory {
  return {
    title: 'e2e fixture',
    version: '1.0.0',
    operations: operations.map((op) => ({
      operationId: op.operationId,
      method: op.method.toLowerCase() as never,
      path: op.path,
      summary: null,
      description: null,
      requestSchema: null,
      responseSchema: null,
      oasOperation: { operationId: op.operationId } as never,
    })),
  };
}

// ---------------------------------------------------------------------------
// In-memory AMS fake. Mirrors only the methods this spec exercises -- the
// orchestrator (Group 5 spec) uses `createScenario`, `createDiagnostic`,
// `createCapture`, `patchCaptureSession`. This test additionally uses
// `createBaseline` + `createBaselineItem` directly to simulate the save flow
// (in production this is invoked from the frontend against AMS, not from
// this service).
// ---------------------------------------------------------------------------

interface FakeAms {
  captures: Map<string, CaptureDto>;
  scenarios: Map<string, ScenarioDto>;
  diagnostics: DiagnosticDto[];
  sessionPatches: Array<{ projectId: string; sessionId: string; body: PatchCaptureSessionRequest }>;
  baselines: Map<string, BaselineDto>;
  baselineItems: BaselineItemDto[];
  client: {
    createScenario: jest.Mock;
    createCapture: jest.Mock;
    createDiagnostic: jest.Mock;
    patchCaptureSession: jest.Mock;
    createBaseline: jest.Mock;
    createBaselineItem: jest.Mock;
    /** Test-only helper to simulate an operator accepting a capture. */
    markCaptureAccepted: (captureId: string, notes?: string | null) => CaptureDto;
  };
}

function buildFakeAms(sessionDto: CaptureSessionDto): FakeAms {
  const captures = new Map<string, CaptureDto>();
  const scenarios = new Map<string, ScenarioDto>();
  const diagnostics: DiagnosticDto[] = [];
  const sessionPatches: Array<{ projectId: string; sessionId: string; body: PatchCaptureSessionRequest }> = [];
  const baselines = new Map<string, BaselineDto>();
  const baselineItems: BaselineItemDto[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const createScenario = jest.fn(async (projectId: string, body: CreateScenarioRequest): Promise<ScenarioDto> => {
    void projectId;
    const id = nextId('scenario');
    const row: ScenarioDto = {
      id,
      session_id: body.session_id,
      operation_id: body.operation_id,
      scenario_name: body.scenario_name ?? null,
      scenario_type: body.scenario_type ?? null,
      status: body.status ?? 'draft',
      generation_source: body.generation_source ?? null,
      request_method: null,
      request_path: null,
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    scenarios.set(id, row);
    return row;
  });

  const createCapture = jest.fn(async (projectId: string, body: CreateCaptureRequest): Promise<CaptureDto> => {
    void projectId;
    const id = nextId('capture');
    const row: CaptureDto = {
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
    };
    captures.set(id, row);
    return row;
  });

  const createDiagnostic = jest.fn(async (projectId: string, body: CreateDiagnosticRequest): Promise<DiagnosticDto> => {
    void projectId;
    const id = nextId('diag');
    const row: DiagnosticDto = {
      id,
      session_id: body.session_id,
      operation_id: body.operation_id ?? null,
      scenario_id: body.scenario_id ?? null,
      diagnostic_type: body.diagnostic_type,
      message: body.message,
      detail_json: body.detail_json ?? null,
      created_at: new Date().toISOString(),
    };
    diagnostics.push(row);
    return row;
  });

  const patchCaptureSession = jest.fn(async (projectId: string, sessionId: string, body: PatchCaptureSessionRequest): Promise<CaptureSessionDto> => {
    sessionPatches.push({ projectId, sessionId, body });
    return { ...sessionDto, ...body, id: sessionId, project_id: projectId };
  });

  const createBaseline = jest.fn(async (projectId: string, body: CreateBaselineRequest): Promise<BaselineDto> => {
    const id = nextId('baseline');
    const row: BaselineDto = {
      id,
      project_id: projectId,
      architecture_id: body.architecture_id,
      session_id: body.session_id,
      name: body.name ?? null,
      status: body.status ?? 'draft',
      accepted_capture_count: body.accepted_capture_count ?? null,
      operation_count: body.operation_count ?? null,
      notes: body.notes ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    baselines.set(id, row);
    return row;
  });

  const createBaselineItem = jest.fn(async (projectId: string, body: CreateBaselineItemRequest): Promise<BaselineItemDto> => {
    void projectId;
    const id = nextId('baseline-item');
    const row: BaselineItemDto = {
      id,
      baseline_id: body.baseline_id,
      capture_id: body.capture_id,
      operation_id: body.operation_id,
      scenario_id: body.scenario_id,
      method: body.method ?? null,
      path: body.path ?? null,
      scenario_name: body.scenario_name ?? null,
      request_json: body.request_json ?? null,
      response_status: body.response_status ?? null,
      response_json: body.response_json ?? null,
      business_notes: body.business_notes ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    baselineItems.push(row);
    return row;
  });

  const markCaptureAccepted = (captureId: string, notes: string | null = null): CaptureDto => {
    const existing = captures.get(captureId);
    if (!existing) throw new Error(`fake-ams: capture not found: ${captureId}`);
    const updated: CaptureDto = {
      ...existing,
      accepted: true,
      accepted_at: new Date().toISOString(),
      reviewer_notes: notes,
    };
    captures.set(captureId, updated);
    return updated;
  };

  return {
    captures,
    scenarios,
    diagnostics,
    sessionPatches,
    baselines,
    baselineItems,
    client: {
      createScenario,
      createCapture,
      createDiagnostic,
      patchCaptureSession,
      createBaseline,
      createBaselineItem,
      markCaptureAccepted,
    },
  };
}

// ---------------------------------------------------------------------------
// Scripted LLM gateway -- queue of assistant messages popped one per
// `callLlmToolLoop` invocation. Each scenario runs through the queue until
// the terminal `record_capture_note` tool call exits the scenario loop.
// ---------------------------------------------------------------------------

function buildScriptedGateway(messages: AssistantMessage[]): {
  callLlmToolLoop: jest.Mock;
} {
  const queue = [...messages];
  return {
    callLlmToolLoop: jest.fn(async () => {
      const next = queue.shift();
      if (!next) {
        throw new Error('scripted-gateway: assistant-message queue exhausted (test did not script enough rounds)');
      }
      return { message: next };
    }),
  };
}

/** Convenience: build a single assistant message with one tool call. */
function asstToolCall(callId: string, name: string, args: Record<string, unknown>): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

/** Convenience: build the terminal record_capture_note assistant message. */
function asstTerminal(callId: string, message = 'captured'): AssistantMessage {
  return asstToolCall(callId, 'record_capture_note', { message });
}

// ---------------------------------------------------------------------------
// Shared stub server lifecycle.
// ---------------------------------------------------------------------------

let stub: StubServerHandle;

beforeAll(async () => {
  stub = await startStubServer();
});

afterAll(async () => {
  await stopStubServer(stub);
});

beforeEach(() => {
  stub.controls.reset();
  secretsStore.clearAll();
  // Defensive: clear any orphaned runManager entries from earlier tests.
  for (const liveId of runManager.listLive()) {
    runManager.end(liveId);
  }
});

afterEach(() => {
  secretsStore.clearAll();
  for (const liveId of runManager.listLive()) {
    runManager.end(liveId);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('captureSessionFullFlow e2e', () => {
  it('attempt_number sequence is 1, 2, 3 within a scenario AND resets to 1 at scenario boundaries', async () => {
    const SESSION_ID = '00000000-0000-0000-0000-0000000fff10';
    const sessionDto = buildSessionDto({
      sessionId: SESSION_ID,
      apiBaseUrl: stub.baseUrl,
      mutatingConfirmed: false,
    });
    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });

    // Two GET operations, both included + safe_to_execute. The orchestrator
    // creates one scenario per included op, so two scenarios in total. The
    // first scenario fires three execute_http_request calls (attempts 1, 2,
    // 3); the second fires one (attempt 1) and proves the counter resets.
    const ops: OperationDto[] = [
      buildOperationRow({
        rowId: 'op-row-A',
        sessionId: SESSION_ID,
        operationId: 'getWidgetA',
        method: 'GET',
        path: '/widgets/A',
        included: true,
        safeToExecute: true,
      }),
      buildOperationRow({
        rowId: 'op-row-B',
        sessionId: SESSION_ID,
        operationId: 'getWidgetB',
        method: 'GET',
        path: '/widgets/B',
        included: true,
        safeToExecute: true,
      }),
    ];
    const inventory = buildInventory([
      { operationId: 'getWidgetA', method: 'GET', path: '/widgets/A' },
      { operationId: 'getWidgetB', method: 'GET', path: '/widgets/B' },
    ]);

    // Scripted LLM: scenario 1 -> 3 GETs + terminal; scenario 2 -> 1 GET + terminal.
    const ams = buildFakeAms(sessionDto);
    const gateway = buildScriptedGateway([
      // ---- Scenario 1 (getWidgetA): rounds 1..4
      asstToolCall('tc-A1', 'execute_http_request', { operationId: 'getWidgetA', method: 'get', path: '/widgets/A' }),
      asstToolCall('tc-A2', 'execute_http_request', { operationId: 'getWidgetA', method: 'get', path: '/widgets/A' }),
      asstToolCall('tc-A3', 'execute_http_request', { operationId: 'getWidgetA', method: 'get', path: '/widgets/A' }),
      asstTerminal('tc-A-end', 'scenario A done'),
      // ---- Scenario 2 (getWidgetB): rounds 1..2
      asstToolCall('tc-B1', 'execute_http_request', { operationId: 'getWidgetB', method: 'get', path: '/widgets/B' }),
      asstTerminal('tc-B-end', 'scenario B done'),
    ]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(sessionDto), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: ops,
    });

    expect(outcome.finalStatus).toBe('completed');
    expect(outcome.scenariosAttempted).toBe(2);
    expect(outcome.scenariosCompleted).toBe(2);

    const captureRows = Array.from(ams.captures.values());
    // Three captures on scenario A (rowId op-row-A), one on scenario B.
    const capturesA = captureRows.filter((c) => c.operation_id === 'op-row-A');
    const capturesB = captureRows.filter((c) => c.operation_id === 'op-row-B');
    expect(capturesA).toHaveLength(3);
    expect(capturesB).toHaveLength(1);
    // The order in which captures land is the order createCapture was called.
    const attemptsA = capturesA.map((c) => c.attempt_number);
    expect(attemptsA).toEqual([1, 2, 3]);
    expect(capturesB[0].attempt_number).toBe(1);
  });

  it('a 500 response from the stub persists a capture row with response_status=500 and populated redacted response slots', async () => {
    const SESSION_ID = '00000000-0000-0000-0000-0000000fff11';
    const sessionDto = buildSessionDto({
      sessionId: SESSION_ID,
      apiBaseUrl: stub.baseUrl,
      mutatingConfirmed: false,
    });
    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });

    const op = buildOperationRow({
      rowId: 'op-row-500',
      sessionId: SESSION_ID,
      operationId: 'getAlways500',
      method: 'GET',
      path: '/always-500',
      included: true,
      safeToExecute: true,
    });
    const inventory = buildInventory([
      { operationId: 'getAlways500', method: 'GET', path: '/always-500' },
    ]);

    const ams = buildFakeAms(sessionDto);
    const gateway = buildScriptedGateway([
      asstToolCall('tc-1', 'execute_http_request', { operationId: 'getAlways500', method: 'get', path: '/always-500' }),
      asstTerminal('tc-end', '500 captured'),
    ]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(sessionDto), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: [op],
    });

    expect(outcome.finalStatus).toBe('completed');
    expect(ams.captures.size).toBe(1);
    const [capture] = Array.from(ams.captures.values());
    expect(capture.response_status).toBe(500);
    expect(capture.response_body_json).toEqual({ error: 'simulated_server_error' });
    // Headers slot must be populated (non-null) so the review UI can show
    // what came back -- this is the gap the spec calls out for non-2xx.
    expect(capture.response_headers_redacted_json).not.toBeNull();
    expect(capture.error_type).toBeNull();
    expect(capture.error_message).toBeNull();
    expect(stub.controls.five00Hits()).toBe(1);
  });

  it('a path that closes the socket persists a capture row with response_status=null and populated error_type + error_message', async () => {
    const SESSION_ID = '00000000-0000-0000-0000-0000000fff12';
    const sessionDto = buildSessionDto({
      sessionId: SESSION_ID,
      apiBaseUrl: stub.baseUrl,
      mutatingConfirmed: false,
    });
    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });

    const op = buildOperationRow({
      rowId: 'op-row-drop',
      sessionId: SESSION_ID,
      operationId: 'getDropSocket',
      method: 'GET',
      path: '/drop-socket',
      included: true,
      safeToExecute: true,
    });
    const inventory = buildInventory([
      { operationId: 'getDropSocket', method: 'GET', path: '/drop-socket' },
    ]);

    const ams = buildFakeAms(sessionDto);
    const gateway = buildScriptedGateway([
      asstToolCall('tc-1', 'execute_http_request', { operationId: 'getDropSocket', method: 'get', path: '/drop-socket' }),
      asstTerminal('tc-end', 'transport failure captured'),
    ]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(sessionDto), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: [op],
    });

    expect(outcome.finalStatus).toBe('completed');
    expect(ams.captures.size).toBe(1);
    const [capture] = Array.from(ams.captures.values());
    expect(capture.response_status).toBeNull();
    expect(capture.response_headers_redacted_json).toBeNull();
    expect(capture.response_body_json).toBeNull();
    expect(typeof capture.error_type).toBe('string');
    expect(capture.error_type!.length).toBeGreaterThan(0);
    expect(typeof capture.error_message).toBe('string');
    expect(capture.error_message!.length).toBeGreaterThan(0);
  });

  it('accepting one capture and saving a baseline round-trips with item count + snapshot matching the accepted capture', async () => {
    const SESSION_ID = '00000000-0000-0000-0000-0000000fff13';
    const sessionDto = buildSessionDto({
      sessionId: SESSION_ID,
      apiBaseUrl: stub.baseUrl,
      mutatingConfirmed: false,
    });
    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });

    // Two operations -> two captures. Only one is accepted -> baseline has
    // one item.
    const ops: OperationDto[] = [
      buildOperationRow({
        rowId: 'op-row-keep',
        sessionId: SESSION_ID,
        operationId: 'getWidgetKeep',
        method: 'GET',
        path: '/widgets/keep',
        included: true,
        safeToExecute: true,
      }),
      buildOperationRow({
        rowId: 'op-row-drop',
        sessionId: SESSION_ID,
        operationId: 'getWidgetDrop',
        method: 'GET',
        path: '/widgets/drop',
        included: true,
        safeToExecute: true,
      }),
    ];
    const inventory = buildInventory([
      { operationId: 'getWidgetKeep', method: 'GET', path: '/widgets/keep' },
      { operationId: 'getWidgetDrop', method: 'GET', path: '/widgets/drop' },
    ]);

    const ams = buildFakeAms(sessionDto);
    const gateway = buildScriptedGateway([
      // Scenario 1: getWidgetKeep
      asstToolCall('tc-K1', 'execute_http_request', { operationId: 'getWidgetKeep', method: 'get', path: '/widgets/keep' }),
      asstTerminal('tc-K-end', 'keep'),
      // Scenario 2: getWidgetDrop
      asstToolCall('tc-D1', 'execute_http_request', { operationId: 'getWidgetDrop', method: 'get', path: '/widgets/drop' }),
      asstTerminal('tc-D-end', 'drop'),
    ]);

    const outcome = await orchestrateCaptureSession(toCaptureSession(sessionDto), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: inventory,
      persistedOperations: ops,
    });

    expect(outcome.finalStatus).toBe('completed');
    expect(ams.captures.size).toBe(2);

    // Pick the capture for the kept op -> mark accepted via the fake's
    // helper (simulates an operator clicking accept in the review UI which
    // in production patches the AMS capture row).
    const captureToKeep = Array.from(ams.captures.values()).find((c) => c.operation_id === 'op-row-keep');
    expect(captureToKeep).toBeDefined();
    ams.client.markCaptureAccepted(captureToKeep!.id, 'looks good');

    const accepted = Array.from(ams.captures.values()).filter((c) => c.accepted === true);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].id).toBe(captureToKeep!.id);

    // Now drive the "save as baseline" surface -- in production this is
    // invoked from the frontend; we exercise the same AMS client method
    // pair here to prove the snapshot contract.
    const baseline = await ams.client.createBaseline(PROJECT_ID, {
      project_id: PROJECT_ID,
      architecture_id: ARCH_ID,
      session_id: SESSION_ID,
      name: 'e2e-baseline-1',
      status: 'draft',
      accepted_capture_count: accepted.length,
      operation_count: 1,
      notes: null,
    });
    expect(baseline.id).toMatch(/^baseline-/);

    const item = await ams.client.createBaselineItem(PROJECT_ID, {
      baseline_id: baseline.id,
      capture_id: accepted[0].id,
      operation_id: accepted[0].operation_id,
      scenario_id: accepted[0].scenario_id,
      method: accepted[0].request_method,
      path: accepted[0].request_path,
      scenario_name: 'happy_path',
      request_json: {
        query: accepted[0].request_query_json,
        headers: accepted[0].request_headers_redacted_json,
        body: accepted[0].request_body_json,
      },
      response_status: accepted[0].response_status,
      response_json: {
        headers: accepted[0].response_headers_redacted_json,
        body: accepted[0].response_body_json,
      },
      business_notes: null,
    });

    // ---- Assertions on the baseline + baseline-item round-trip ----
    expect(ams.baselines.size).toBe(1);
    expect(ams.baselineItems).toHaveLength(1);
    expect(item.baseline_id).toBe(baseline.id);
    expect(item.capture_id).toBe(accepted[0].id);
    // Snapshot persistence contract: the request method, path, response
    // status, and response body from the accepted capture are mirrored
    // verbatim onto the baseline-item.
    expect(item.method).toBe('GET');
    expect(item.path).toBe('/widgets/keep');
    expect(item.response_status).toBe(200);
    expect((item.response_json as { body: unknown }).body).toEqual({
      id: 'keep',
      name: 'widget-keep',
    });
  });

  it('mutating-confirmation flow: POST /widgets is blocked when mutatingCallsConfirmed=false, succeeds when mutatingCallsConfirmed=true', async () => {
    // ---- Run 1: mutatingCallsConfirmed = false -> tool throws, no capture row.
    const SESSION_ID_BLOCKED = '00000000-0000-0000-0000-0000000fff14';
    const sessionDtoBlocked = buildSessionDto({
      sessionId: SESSION_ID_BLOCKED,
      apiBaseUrl: stub.baseUrl,
      mutatingConfirmed: false,
    });
    secretsStore.set({ sessionId: SESSION_ID_BLOCKED, api: { type: 'none' }, loadedAt: Date.now() });

    const opPost = buildOperationRow({
      rowId: 'op-row-post',
      sessionId: SESSION_ID_BLOCKED,
      operationId: 'createWidget',
      method: 'POST',
      path: '/widgets',
      included: true,
      // Mutating verb under default policy: safe_to_execute is FALSE; only
      // the session-level confirmation can unlock it.
      safeToExecute: false,
    });
    const inventory = buildInventory([
      { operationId: 'createWidget', method: 'POST', path: '/widgets' },
    ]);

    const amsBlocked = buildFakeAms(sessionDtoBlocked);
    const gatewayBlocked = buildScriptedGateway([
      // The tool will throw operation_not_executable; the loop runner feeds
      // the error back as a tool result. The LLM stub then terminates the
      // scenario via record_capture_note.
      asstToolCall('tc-1', 'execute_http_request', { operationId: 'createWidget', method: 'post', path: '/widgets', body: { name: 'blocked' } }),
      asstTerminal('tc-end', 'blocked attempt recorded'),
    ]);

    const blockedOutcome = await orchestrateCaptureSession(toCaptureSession(sessionDtoBlocked), {
      archModelClient: amsBlocked.client as never,
      gatewayClient: gatewayBlocked as never,
      oasInventory: inventory,
      persistedOperations: [opPost],
    });
    expect(blockedOutcome.finalStatus).toBe('completed');
    // Gate fired BEFORE the HTTP call left the service, so no capture row
    // was written. (Failed-gate attempts DO consume a runManager attempt
    // slot, but the capture is only persisted after a real request is
    // dispatched -- this matches the unit-level coverage in
    // executeHttpRequestRewrite.test.ts.)
    expect(amsBlocked.captures.size).toBe(0);

    // ---- Run 2: mutatingCallsConfirmed = true -> the SAME tool call succeeds.
    const SESSION_ID_OK = '00000000-0000-0000-0000-0000000fff15';
    const sessionDtoOk = buildSessionDto({
      sessionId: SESSION_ID_OK,
      apiBaseUrl: stub.baseUrl,
      mutatingConfirmed: true,
    });
    secretsStore.set({ sessionId: SESSION_ID_OK, api: { type: 'none' }, loadedAt: Date.now() });

    const opPostOk = buildOperationRow({
      rowId: 'op-row-post-ok',
      sessionId: SESSION_ID_OK,
      operationId: 'createWidget',
      method: 'POST',
      path: '/widgets',
      included: true,
      // Still safe_to_execute=false -- the OR gate is what unblocks this.
      safeToExecute: false,
    });

    const amsOk = buildFakeAms(sessionDtoOk);
    const gatewayOk = buildScriptedGateway([
      asstToolCall('tc-1', 'execute_http_request', { operationId: 'createWidget', method: 'post', path: '/widgets', body: { name: 'allowed' } }),
      asstTerminal('tc-end', 'allowed attempt captured'),
    ]);

    const okOutcome = await orchestrateCaptureSession(toCaptureSession(sessionDtoOk), {
      archModelClient: amsOk.client as never,
      gatewayClient: gatewayOk as never,
      oasInventory: inventory,
      persistedOperations: [opPostOk],
    });
    expect(okOutcome.finalStatus).toBe('completed');
    expect(amsOk.captures.size).toBe(1);
    const [capture] = Array.from(amsOk.captures.values());
    expect(capture.response_status).toBe(201);
    expect(capture.request_method).toBe('POST');
    expect(capture.request_path).toBe('/widgets');
    expect(capture.request_body_json).toEqual({ name: 'allowed' });
    expect(capture.attempt_number).toBe(1);
  });
});
