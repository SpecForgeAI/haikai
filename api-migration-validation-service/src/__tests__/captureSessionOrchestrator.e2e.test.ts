/**
 * End-to-end orchestrator integration test (Task Group 11.3 gap-fill #1).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 11.
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 *       misleading-COMPLETED follow-up: a scenario is only credited to
 *       `scenarios_completed` when it persisted >=1 capture row, so this
 *       test's `createCapture` mock now returns a real capture DTO (the old
 *       `jest.fn()` returning `undefined` would, under the fix, be treated as
 *       a no-capture / errored scenario -- which is the bug, not the success
 *       path this test asserts).
 *
 * Why: Groups 5/6/9 cover slices (the per-scenario loop in isolation, action
 * endpoints in isolation, save-as-baseline in isolation), but no existing
 * test wires a session from "configured + secrets staged + inventory cached"
 * through `orchestrateCaptureSession` to the terminal patch. This fills that
 * gap with mocked LLM + mocked HTTP executor + mocked AMS surface so the
 * full lifecycle is verified end-to-end:
 *
 *   1. Secrets bundle present (would otherwise short-circuit with the
 *      `secrets_lost_during_run` patch).
 *   2. For one persisted included operation, a draft scenario row is created
 *      and the per-scenario loop runs.
 *   3. The mocked LLM emits one `execute_http_request` tool call (so the
 *      stubbed HTTP executor is actually invoked and a capture row is
 *      persisted), followed by the terminal `record_capture_note` tool call
 *      which writes a diagnostic and exits the scenario.
 *   4. On the terminal-status transition the session is PATCHED with
 *      `status='completed'`, `completed_at` set, and the truthful per-run
 *      tallies (1 attempted / 1 completed / 0 errored -- the scenario DID
 *      persist a capture).
 *   5. The in-memory secrets bundle is purged.
 *   6. The runManager entry is removed.
 *
 * This is the only test in the suite that exercises the full orchestrator
 * path; the per-group tests use the loop runner directly with hand-built
 * contexts.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'e2e-session',
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

function buildOperationRow(): OperationDto {
  const now = new Date().toISOString();
  return {
    id: 'op-row-e2e',
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
  };
}

function buildInventory(): ParsedOasInventory {
  return {
    title: 'e2e fixture',
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

beforeEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

afterEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('orchestrator end-to-end: secrets staged + inventory present -> scenario captures + completes -> session patched completed (1 of 1 captured) + secrets purged + runManager cleared', async () => {
  // Stage in-memory secrets so the orchestrator doesn't short-circuit on the
  // secrets_lost guard.
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    loadedAt: Date.now(),
  });

  const sessionDto = buildSessionDto();
  const session = toCaptureSession(sessionDto);
  const operationRow = buildOperationRow();
  const inventory = buildInventory();

  // Mock AMS client: capture every call so we can assert lifecycle.
  const scenariosCreated: Array<{ projectId: string; body: any }> = [];
  const capturesCreated: Array<{ projectId: string; body: any }> = [];
  const diagnosticsCreated: Array<{ projectId: string; body: any }> = [];
  const sessionPatches: Array<{ projectId: string; sessionId: string; body: any }> = [];

  const mockArchClient = {
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
    // execute_http_request auto-persists a capture row; return a real id so
    // the handler bumps runManager.scenarioCapturesPersisted (the orchestrator
    // credits the scenario as captured only when that counter is > 0).
    createCapture: jest.fn(async (projectId: string, body: any) => {
      capturesCreated.push({ projectId, body });
      return { id: `capture-${capturesCreated.length}` };
    }),
    // record_capture_note (terminal) writes a diagnostic row -- assert this
    // landed so we know the scenario actually reached its terminal tool call.
    createDiagnostic: jest.fn(async (projectId: string, body: any) => {
      diagnosticsCreated.push({ projectId, body });
      return { id: `diag-${diagnosticsCreated.length}` };
    }),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ projectId, sessionId, body });
      return { ...sessionDto, ...body, id: sessionId, project_id: projectId };
    }),
  };

  // Mock gateway: emits a single execute_http_request call, then terminates
  // via record_capture_note.
  const gatewayMessages: AssistantMessage[] = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-1',
          type: 'function',
          function: {
            name: 'execute_http_request',
            arguments: JSON.stringify({
              operationId: 'getThings',
              method: 'get',
              path: '/things',
            }),
          },
        },
      ],
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-2',
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({ message: 'happy-path captured' }),
          },
        },
      ],
    },
  ];
  const queue = [...gatewayMessages];
  const mockGateway = {
    callLlmToolLoop: jest.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('mock gateway: queue exhausted');
      return { message: next };
    }),
  };

  // Inject a stub HTTP executor that always responds 200 so
  // execute_http_request resolves cleanly. The orchestrator builds its own
  // executor from `createSessionHttpExecutor`; spy on that factory.
  const httpRequestSpy = jest.fn(async () => ({
    status: 200,
    headers: {},
    data: { ok: true },
    config: {},
    statusText: 'OK',
  }));
  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({
      request: httpRequestSpy,
      setAuth: jest.fn(),
      dispose: jest.fn(),
    });

  const outcome = await orchestrateCaptureSession(session, {
    archModelClient: mockArchClient as never,
    gatewayClient: mockGateway as never,
    oasInventory: inventory,
    persistedOperations: [operationRow],
  });

  // --- Lifecycle assertions ------------------------------------------------
  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.errorMessage).toBeNull();
  expect(outcome.scenariosAttempted).toBe(1);
  // The scenario persisted a capture row AND exited `completed`, so it is
  // credited as captured (1 of 1), not errored.
  expect(outcome.scenariosCompleted).toBe(1);
  expect(outcome.scenariosErrored).toBe(0);

  // One draft scenario row created for the included operation.
  expect(scenariosCreated).toHaveLength(1);
  expect(scenariosCreated[0].body.operation_id).toBe('op-row-e2e');
  expect(scenariosCreated[0].body.status).toBe('draft');

  // The HTTP executor was actually called via the execute_http_request tool
  // (the captured call; a non-mutating GET also drives the volatility probe,
  // so the executor may be hit more than once -- assert at-least-once here).
  expect(httpRequestSpy).toHaveBeenCalled();

  // A capture row was persisted for the scenario.
  expect(capturesCreated).toHaveLength(1);
  expect(capturesCreated[0].body.session_id).toBe(SESSION_ID);

  // The terminal record_capture_note tool wrote exactly one diagnostic row;
  // because the capture persisted cleanly there is NO `failed_request`
  // diagnostic. CSD Spec 3 additionally writes a LOUD `compensation_inactive`
  // advisory here — this session confirms mutating calls but stages NO DB
  // credentials, which is exactly the posture the advisory exists to flag.
  const advisories = diagnosticsCreated.filter(
    (d) => d.body.diagnostic_type === 'compensation_inactive',
  );
  expect(advisories).toHaveLength(1);
  const nonAdvisory = diagnosticsCreated.filter(
    (d) => d.body.diagnostic_type !== 'compensation_inactive',
  );
  expect(nonAdvisory).toHaveLength(1);
  expect(nonAdvisory[0].body.session_id).toBe(SESSION_ID);
  expect(nonAdvisory[0].body.message).toBe('happy-path captured');

  // Terminal session patch with status='completed' and truthful tallies.
  expect(sessionPatches).toHaveLength(1);
  expect(sessionPatches[0].body.status).toBe('completed');
  expect(sessionPatches[0].body.completed_at).toBeTruthy();
  expect(sessionPatches[0].body.error_message).toBeNull();
  expect(sessionPatches[0].body.scenarios_attempted).toBe(1);
  expect(sessionPatches[0].body.scenarios_completed).toBe(1);
  expect(sessionPatches[0].body.scenarios_errored).toBe(0);

  // Secrets purged after terminal.
  expect(secretsStore.has(SESSION_ID)).toBe(false);

  // runManager entry cleared after terminal.
  expect(runManager.has(SESSION_ID)).toBe(false);

  // Gateway LLM was called twice (one round per assistant message).
  expect(mockGateway.callLlmToolLoop).toHaveBeenCalledTimes(2);
});
