/**
 * Orchestrator tally-truthfulness tests (misleading-COMPLETED fix).
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 *       misleading-COMPLETED follow-up.
 *
 * The bug: a scenario was credited to `scenarios_completed` purely on the
 * loop's exit `reason === 'completed'`. The loop returns `completed` when a
 * TERMINAL tool fires -- and the ONLY terminal tool is `record_capture_note`,
 * which writes a DIAGNOSTIC, not a capture. So every scenario could "complete"
 * with ZERO capture rows and the session was PATCHed `scenarios_completed=N`,
 * making the dashboard read "N of N captured" when nothing was captured.
 *
 * The fix: `scenarios_completed` now means "scenarios that persisted >=1
 * capture row" (tracked via `runManager.scenarioCapturesPersisted`, bumped by
 * `execute_http_request` only after a successful `createCapture`). A scenario
 * that exits `completed` with zero captures is counted as errored.
 *
 * These tests drive the FULL orchestrator (mocked LLM + mocked HTTP executor +
 * mocked AMS surface), matching `captureSessionOrchestrator.e2e.test.ts`, and
 * cover:
 *   1. a scenario that ends via `record_capture_note` with 0 captures
 *      -> counted as errored (0 completed / 1 attempted);
 *   2. a scenario with >=1 successful `execute_http_request`
 *      -> counted as captured (1 completed / 1 attempted);
 *   3. a whole session where every scenario produced 0 captures
 *      -> 0 completed / N attempted / N errored (NOT "N of N captured"),
 *      surfaced as a degraded run via the truthful patch tallies;
 *   4. a `createCapture` failure -> scenario errored + a `failed_request`
 *      diagnostic emitted.
 */

import { orchestrateCaptureSession } from '../services/captureSessionOrchestrator';
import type {
  CaptureSessionDto,
  OperationDto,
} from '../services/archModelClient';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000a1';
const ARCH_ID = '00000000-0000-0000-0000-0000000000b1';
const SESSION_ID = '00000000-0000-0000-0000-0000000000c1';

function buildSessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'tally-session',
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
    title: 'tally fixture',
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
  scenariosCreated: Array<{ projectId: string; body: any }>;
  capturesCreated: Array<{ projectId: string; body: any }>;
  diagnosticsCreated: Array<{ projectId: string; body: any }>;
  sessionPatches: Array<{ projectId: string; sessionId: string; body: any }>;
  client: {
    createScenario: jest.Mock;
    createCapture: jest.Mock;
    createDiagnostic: jest.Mock;
    patchCaptureSession: jest.Mock;
  };
}

function buildMockAms(opts: { captureSucceeds: boolean } = { captureSucceeds: true }): MockAms {
  const scenariosCreated: MockAms['scenariosCreated'] = [];
  const capturesCreated: MockAms['capturesCreated'] = [];
  const diagnosticsCreated: MockAms['diagnosticsCreated'] = [];
  const sessionPatches: MockAms['sessionPatches'] = [];
  const sessionDto = buildSessionDto();

  const client = {
    createScenario: jest.fn(async (projectId: string, body: any) => {
      scenariosCreated.push({ projectId, body });
      return {
        id: `scenario-${scenariosCreated.length}`,
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
    }),
    createCapture: jest.fn(async (projectId: string, body: any) => {
      if (!opts.captureSucceeds) {
        throw new Error('AMS createCapture failed');
      }
      capturesCreated.push({ projectId, body });
      return { id: `capture-${capturesCreated.length}` };
    }),
    createDiagnostic: jest.fn(async (projectId: string, body: any) => {
      diagnosticsCreated.push({ projectId, body });
      return { id: `diag-${diagnosticsCreated.length}` };
    }),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ projectId, sessionId, body });
      return { ...sessionDto, ...body, id: sessionId, project_id: projectId };
    }),
  };

  return { scenariosCreated, capturesCreated, diagnosticsCreated, sessionPatches, client };
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

function noteOnlyMessages(): AssistantMessage[] {
  // The LLM goes straight to the terminal note tool WITHOUT ever calling
  // execute_http_request -> zero capture rows, loop exits `completed`.
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-note',
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({
              message: 'could not capture; skipping',
              diagnosticType: 'endpoint_skipped',
            }),
          },
        },
      ],
    },
  ];
}

function captureThenNoteMessages(): AssistantMessage[] {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-exec',
          type: 'function',
          function: {
            name: 'execute_http_request',
            arguments: JSON.stringify({ operationId: 'getThings', method: 'get', path: '/things' }),
          },
        },
      ],
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-note',
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({ message: 'captured ok' }),
          },
        },
      ],
    },
  ];
}

function stubHttpExecutor(status = 200) {
  const request = jest.fn(async () => ({
    status,
    headers: {},
    data: { ok: true },
    config: {},
    statusText: 'OK',
  }));
  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({ request, setAuth: jest.fn(), dispose: jest.fn() });
  return request;
}

beforeEach(() => {
  secretsStore.clearAll();
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    loadedAt: Date.now(),
  });
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

describe('orchestrator -- captured-tally truthfulness (misleading-COMPLETED fix)', () => {
  it('a scenario that ends via record_capture_note with 0 captures is counted as errored (0 of 1 captured)', async () => {
    stubHttpExecutor();
    const ams = buildMockAms({ captureSucceeds: true });
    const gateway = buildGateway(noteOnlyMessages());

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    // The loop exited `completed` (terminal note tool), but NO capture row was
    // persisted, so the scenario is counted as errored, not captured.
    expect(ams.capturesCreated).toHaveLength(0);
    expect(outcome.finalStatus).toBe('completed'); // status state-machine unchanged
    expect(outcome.scenariosAttempted).toBe(1);
    expect(outcome.scenariosCompleted).toBe(0);
    expect(outcome.scenariosErrored).toBe(1);

    // The terminal patch carries the truthful tally (0 of 1 captured) so the
    // header cannot read "1 of 1 captured".
    expect(ams.sessionPatches).toHaveLength(1);
    expect(ams.sessionPatches[0].body.scenarios_attempted).toBe(1);
    expect(ams.sessionPatches[0].body.scenarios_completed).toBe(0);
    expect(ams.sessionPatches[0].body.scenarios_errored).toBe(1);
  });

  it('a scenario with >=1 successful execute_http_request is counted as captured (1 of 1 captured)', async () => {
    const request = stubHttpExecutor(200);
    const ams = buildMockAms({ captureSucceeds: true });
    const gateway = buildGateway(captureThenNoteMessages());

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    expect(request).toHaveBeenCalled();
    expect(ams.capturesCreated).toHaveLength(1);
    expect(outcome.finalStatus).toBe('completed');
    expect(outcome.scenariosAttempted).toBe(1);
    expect(outcome.scenariosCompleted).toBe(1);
    expect(outcome.scenariosErrored).toBe(0);
    expect(ams.sessionPatches[0].body.scenarios_completed).toBe(1);
    expect(ams.sessionPatches[0].body.scenarios_errored).toBe(0);
  });

  it('a session where every scenario produced 0 captures patches 0 completed / N attempted / N errored (NOT "N of N captured")', async () => {
    stubHttpExecutor();
    const ams = buildMockAms({ captureSucceeds: true });
    // Three included operations -> three scenarios, each going straight to the
    // terminal note tool with no execute_http_request. The gateway re-serves a
    // fresh note message per LLM round (one round per scenario here).
    const gateway = {
      callLlmToolLoop: jest.fn(async () => ({ message: noteOnlyMessages()[0] })),
    };
    const ops = [
      buildOperationRow({ id: 'op-1', operation_id: 'getThings', path: '/things' }),
      buildOperationRow({ id: 'op-2', operation_id: 'getWidgets', path: '/widgets' }),
      buildOperationRow({ id: 'op-3', operation_id: 'getGadgets', path: '/gadgets' }),
    ];

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: ops,
    });

    expect(ams.capturesCreated).toHaveLength(0);
    // `completed` only means "no infrastructure error"; the truthful tallies
    // make the all-failed run impossible to mistake for a success.
    expect(outcome.finalStatus).toBe('completed');
    expect(outcome.scenariosAttempted).toBe(3);
    expect(outcome.scenariosCompleted).toBe(0);
    expect(outcome.scenariosErrored).toBe(3);
    const patch = ams.sessionPatches[0].body;
    expect(patch.scenarios_attempted).toBe(3);
    expect(patch.scenarios_completed).toBe(0);
    expect(patch.scenarios_errored).toBe(3);
    // The header renders `scenarios_completed of scenarios_attempted captured`
    // => "0 of 3 captured", NOT "3 of 3 captured".
    expect(`${patch.scenarios_completed} of ${patch.scenarios_attempted}`).toBe('0 of 3');
  });

  it('a createCapture failure leaves the scenario errored AND emits a failed_request diagnostic', async () => {
    stubHttpExecutor(200);
    const ams = buildMockAms({ captureSucceeds: false });
    const gateway = buildGateway(captureThenNoteMessages());

    const outcome = await orchestrateCaptureSession(toCaptureSession(buildSessionDto()), {
      archModelClient: ams.client as never,
      gatewayClient: gateway as never,
      oasInventory: buildInventory(),
      persistedOperations: [buildOperationRow()],
    });

    // createCapture threw -> no durable capture row, scenario counted errored.
    expect(ams.capturesCreated).toHaveLength(0);
    expect(outcome.scenariosAttempted).toBe(1);
    expect(outcome.scenariosCompleted).toBe(0);
    expect(outcome.scenariosErrored).toBe(1);

    // A `failed_request` diagnostic was emitted for the failed persistence so
    // the no-capture scenario is auditable in the Diagnostics list.
    const failedReq = ams.diagnosticsCreated.filter(
      (d) => d.body.diagnostic_type === 'failed_request',
    );
    expect(failedReq.length).toBeGreaterThanOrEqual(1);
    expect(failedReq[0].body.session_id).toBe(SESSION_ID);
    expect((failedReq[0].body.detail_json as { phase: string }).phase).toBe(
      'create_capture_failed',
    );
  });
});
