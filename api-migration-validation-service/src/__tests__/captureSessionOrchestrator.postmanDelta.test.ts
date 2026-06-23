/**
 * Orchestrator per-op loop wiring for Mode 1(b)/(c)
 * (Spec 2026-06-23 Import a Postman Collection into Capture, Task Group 7 --
 * R6 / D3 / A5 + R4c).
 *
 * Asserts the loop SEAM, not the dedup internals (those are unit-tested in
 * postmanDelta.test.ts):
 *   - Mode 1(b): a per-operation Postman-covered set is subtracted BEFORE
 *     generating, so only the delta survivors are turned into scenario rows
 *     (fewer `createScenario` calls than the full candidate set).
 *   - Mode 1(c): `postmanOnly` skips the per-op loop entirely (no scenario rows,
 *     no LLM calls).
 *
 * Harness mirrors captureSessionOrchestrator.scenarioRequest.test.ts: mocked LLM
 * gateway, stubbed HTTP executor, captured AMS surface.
 */

import { orchestrateCaptureSession } from '../services/captureSessionOrchestrator';
import type { CaptureSessionDto, OperationDto } from '../services/archModelClient';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';
import type { PostmanCapturedRequest } from '../services/postmanDeltaStage1';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'postman-delta-session',
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
    id: 'op-row-1',
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
    title: 'fixture',
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
        oasOperation: {
          operationId: 'getPetById',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
        } as never,
      },
    ],
  };
}

function buildArchMock(sessionDto: CaptureSessionDto) {
  const scenariosCreated: Array<{ projectId: string; body: any }> = [];
  let scenarioSeq = 0;
  return {
    scenariosCreated,
    mock: {
      createScenario: jest.fn(async (projectId: string, body: any) => {
        scenariosCreated.push({ projectId, body });
        scenarioSeq += 1;
        return {
          id: `scenario-${scenarioSeq}`,
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
    },
  };
}

/** A gateway that records a capture-note (terminal) for every scenario. */
function buildGateway() {
  return {
    callLlmToolLoop: jest.fn(async () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc',
            type: 'function',
            function: { name: 'record_capture_note', arguments: JSON.stringify({ message: 'noted' }) },
          },
        ],
      };
      return { message: msg };
    }),
  };
}

beforeEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'token' },
    loadedAt: Date.now(),
  });
  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({
      request: jest.fn(async () => ({ status: 200, headers: {}, data: { ok: true }, config: {}, statusText: 'OK' })),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    });
});

afterEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  jest.restoreAllMocks();
});

test('Mode 1(b): per-op Postman-covered set is subtracted BEFORE generating (fewer scenario rows than the full set)', async () => {
  const sessionDto = buildSessionDto();
  const session = toCaptureSession(sessionDto);
  const { mock, scenariosCreated } = buildArchMock(sessionDto);
  const gateway = buildGateway();

  // First, a baseline run with NO Postman captures to learn the full candidate count.
  const baselineArch = buildArchMock(sessionDto);
  await orchestrateCaptureSession(session, {
    archModelClient: baselineArch.mock as never,
    gatewayClient: buildGateway() as never,
    oasInventory: buildInventory(),
    persistedOperations: [buildOperationRow()],
  });
  const fullCount = baselineArch.scenariosCreated.length;
  expect(fullCount).toBeGreaterThan(1);

  // Reset run state between the two runs.
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'bearer', bearerToken: 'token' }, loadedAt: Date.now() });

  // Now a delta run: capture the happy path + a 404. A Stage-2 judge that marks
  // the remaining bad_request scenarios redundant. Far fewer survivors.
  const captured: PostmanCapturedRequest[] = [
    { method: 'GET', path: '/pets/{id}', expectedStatus: 'success' },
    { method: 'GET', path: '/pets/{id}', expectedStatus: 'not_found', whichParam: 'id' },
  ];
  const judge = jest.fn(async () => ['bad_request_id', 'bad_request_id_type', 'edge_id', 'not_found_id']);

  await orchestrateCaptureSession(session, {
    archModelClient: mock as never,
    gatewayClient: gateway as never,
    oasInventory: buildInventory(),
    persistedOperations: [buildOperationRow()],
    postmanCapturedByOp: { getPetById: captured },
    judgeRedundantScenarios: judge as never,
  });

  // The delta produced STRICTLY fewer scenario rows than the full set, proving
  // the subtraction happened BEFORE generating.
  expect(scenariosCreated.length).toBeLessThan(fullCount);
  // The judge was consulted for this operation (Stage-2 ran on Stage-1 survivors).
  expect(judge).toHaveBeenCalledTimes(1);
});

test('Mode 1(c): postmanOnly skips the per-op loop entirely (no scenario rows, no LLM calls)', async () => {
  const sessionDto = buildSessionDto();
  const session = toCaptureSession(sessionDto);
  const { mock, scenariosCreated } = buildArchMock(sessionDto);
  const gateway = buildGateway();

  const outcome = await orchestrateCaptureSession(session, {
    archModelClient: mock as never,
    gatewayClient: gateway as never,
    oasInventory: buildInventory(),
    persistedOperations: [buildOperationRow()],
    postmanOnly: true,
  });

  expect(scenariosCreated).toHaveLength(0);
  expect(gateway.callLlmToolLoop).not.toHaveBeenCalled();
  expect(outcome.scenariosAttempted).toBe(0);
  expect(outcome.finalStatus).toBe('completed');
});
