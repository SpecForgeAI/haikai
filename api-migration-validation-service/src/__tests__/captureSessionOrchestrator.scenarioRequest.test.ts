/**
 * Regression test for the scenario-create payload (Fix 1).
 *
 * Bug: `orchestrateCaptureSession` called `archClient.createScenario` WITHOUT
 * `request_method` / `request_path`. AMS's `ApiBehaviourScenarioService.create`
 * throws `IllegalArgumentException("requestMethod is required")` /
 * `("requestPath is required")` -> HTTP 400 when either is blank, and the
 * underlying `api_behaviour_scenarios` columns are NOT NULL. The FIRST scenario
 * create 400'd and aborted the entire capture run in ~16ms, before any target
 * API call ("Failed to create scenario via AMS (HTTP 400)").
 *
 * This test pins the fix: every `createScenario` payload MUST carry a
 * non-empty `request_method` + `request_path` (sourced from the persisted
 * operation row), so a malformed scenario can never be sent to AMS again. It
 * also asserts the other AMS-required fields are present (`session_id`,
 * `operation_id`, `scenario_name`).
 *
 * The harness mirrors `captureSessionOrchestrator.e2e.test.ts`: mocked LLM
 * (one execute_http_request then a terminal record_capture_note), a stubbed
 * HTTP executor, and a captured AMS surface.
 */

import { orchestrateCaptureSession } from '../services/captureSessionOrchestrator';
import type { CaptureSessionDto, OperationDto } from '../services/archModelClient';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'scenario-request-fields-session',
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
    id: 'op-row-fix1',
    session_id: SESSION_ID,
    operation_id: 'getPetById',
    method: 'GET',
    path: '/pets/{id}',
    summary: 'Fetch one pet',
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: { operationId: 'getPetById' } as unknown,
    created_at: now,
    updated_at: now,
  };
}

function buildInventory(): ParsedOasInventory {
  return {
    title: 'fix1 fixture',
    version: '1.0.0',
    operations: [
      {
        operationId: 'getPetById',
        method: 'get',
        path: '/pets/{id}',
        summary: 'Fetch one pet',
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { operationId: 'getPetById' } as never,
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

test('createScenario payload carries non-empty request_method + request_path (AMS-required, sourced from the operation row)', async () => {
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    loadedAt: Date.now(),
  });

  const sessionDto = buildSessionDto();
  const session = toCaptureSession(sessionDto);
  const operationRow = buildOperationRow();
  const inventory = buildInventory();

  const scenariosCreated: Array<{ projectId: string; body: any }> = [];

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
        request_method: body.request_method ?? null,
        request_path: body.request_path ?? null,
        request_query_json: null,
        request_headers_redacted_json: null,
        request_body_json: null,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(async () => ({ id: 'diag-1' })),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => ({
      ...sessionDto,
      ...body,
      id: sessionId,
      project_id: projectId,
    })),
  };

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
            arguments: JSON.stringify({ operationId: 'getPetById', method: 'get', path: '/pets/{id}' }),
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
            arguments: JSON.stringify({ message: 'captured' }),
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

  expect(outcome.finalStatus).toBe('completed');

  // Exactly one scenario row created for the single included operation.
  expect(scenariosCreated).toHaveLength(1);
  const body = scenariosCreated[0].body;

  // The crux of Fix 1: request_method + request_path present and non-empty,
  // matching the persisted operation row (so AMS's NOT-NULL + non-blank
  // validation passes).
  expect(typeof body.request_method).toBe('string');
  expect(body.request_method.length).toBeGreaterThan(0);
  expect(body.request_method).toBe(operationRow.method);

  expect(typeof body.request_path).toBe('string');
  expect(body.request_path.length).toBeGreaterThan(0);
  expect(body.request_path).toBe(operationRow.path);

  // The other AMS-required fields stay present too (regression guard).
  expect(body.session_id).toBe(SESSION_ID);
  expect(body.operation_id).toBe(operationRow.id);
  expect(typeof body.scenario_name).toBe('string');
  expect(body.scenario_name.length).toBeGreaterThan(0);

  // And createScenario was actually invoked with a non-empty method/path
  // (belt-and-braces via the mock assertion API).
  expect(mockArchClient.createScenario).toHaveBeenCalledWith(
    PROJECT_ID,
    expect.objectContaining({
      request_method: 'GET',
      request_path: '/pets/{id}',
    }),
  );
});
