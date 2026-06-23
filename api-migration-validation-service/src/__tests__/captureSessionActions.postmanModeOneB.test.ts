/**
 * Mode 1(b) end-to-end forwarding test
 * (Spec 2026-06-23 Import a Postman Collection into Capture -- Task Group 9.3,
 * gap (i): "Mode 1(b) end-to-end -- import -> capture -> delta top-up").
 *
 * GAP filled: the existing add-operation/start test (captureSessionActions.
 * addOperation.test.ts) only asserts the Mode 1(c) `postmanOnly` flag is
 * forwarded into the orchestrator deps. NOTHING asserted that the Mode 1(b)
 * `postmanCapturedByOp` per-operation captured map (the deterministic "given"
 * the wizard builds from its pre-/start manual-capture sends) is forwarded into
 * the orchestrator deps by `/start`, nor that a Mode 1(b) start (postmanOnly
 * absent, captured map present) runs the LLM loop (postmanOnly stays false).
 *
 * This is the seam where R6 connects to R4b end-to-end: the camelCase
 * `postmanCapturedByOp` /start body field -> the orchestrator deps -> the
 * two-stage delta. The delta INTERNALS are unit-tested in postmanDelta.test.ts
 * and the loop seam in captureSessionOrchestrator.postmanDelta.test.ts; THIS
 * test pins only the /start -> deps forwarding the wizard depends on.
 *
 * Mirrors the add-operation test harness: archModelClient mocked via the router
 * dep seam, spawnOrchestrator stubbed so the spawned deps can be inspected.
 */

import express from 'express';
import request from 'supertest';

import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { oasInventoryStore } from '../services/oasInventoryStore';
import { runManager } from '../services/runManager';
import type {
  CaptureSessionDto,
  OperationDto,
  InventoryReconciliationResponse,
} from '../services/archModelClient';
import type { SecretsBundle } from '../types/secrets';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'postman-delta-start',
    status: 'configured',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildOperation(overrides: Partial<OperationDto> = {}): OperationDto {
  const now = new Date().toISOString();
  return {
    id: 'op-row-1',
    session_id: SESSION_ID,
    operation_id: 'getPetById',
    method: 'GET',
    path: '/pets/{id}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildReconciliation(): InventoryReconciliationResponse {
  return {
    in_scope_committed_count: 0,
    accounted_count: 0,
    in_scope_unaccounted_endpoints: [],
    operations_without_model_endpoint: [],
  } as unknown as InventoryReconciliationResponse;
}

function buildArchMock(session: CaptureSessionDto, ops: OperationDto[]) {
  const patches: Array<{ projectId: string; sessionId: string; body: any }> = [];
  return {
    getCaptureSession: jest.fn(async () => session),
    listOperationsBySession: jest.fn(async () => ops),
    reconcileCaptureSessionInventory: jest.fn(async () => buildReconciliation()),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      patches.push({ projectId, sessionId, body });
      return { ...session, ...body, id: sessionId, project_id: projectId } as CaptureSessionDto;
    }),
    getMigrationDiscoveryContext: jest.fn(async () => ({
      highPriorityFindings: [],
      evidenceHighlights: [],
      contextWarnings: [],
    })),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    __patches: patches,
  };
}

function buildApp(deps: Parameters<typeof buildCaptureSessionActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter(deps));
  return app;
}

function seedSecret(): void {
  const bundle: SecretsBundle = {
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'live-token' },
    loadedAt: Date.now(),
  };
  secretsStore.set(bundle);
}

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

test('Mode 1(b) /start forwards postmanCapturedByOp into the orchestrator deps and keeps postmanOnly=false (LLM delta still runs)', async () => {
  seedSecret();
  const op = buildOperation();
  oasInventoryStore.set(SESSION_ID, {
    operations: [
      {
        operationId: 'getPetById',
        method: 'get',
        path: '/pets/{id}',
        summary: null,
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { operationId: 'getPetById' } as never,
      },
    ],
    title: null,
    version: null,
  });
  const session = buildSession();
  const mock = buildArchMock(session, [op]);
  const spawn = jest.fn(async () => ({}));
  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });

  // The per-op captured map the wizard builds from its pre-/start
  // manual-capture sends: a 200 happy path + a 404, keyed by operation_id.
  const postmanCapturedByOp = {
    getPetById: [
      { method: 'GET', path: '/pets/42', expectedStatus: 'success' },
      { method: 'GET', path: '/pets/none', expectedStatus: 'not_found' },
    ],
  };

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ postmanCapturedByOp });

  expect(res.status).toBe(202);
  expect(spawn).toHaveBeenCalledTimes(1);
  const deps = (spawn.mock.calls[0] as any[])[1] as any;
  // The captured map is forwarded VERBATIM into the orchestrator deps so the
  // two-stage delta can subtract it per operation (R6).
  expect(deps.postmanCapturedByOp).toEqual(postmanCapturedByOp);
  // Mode 1(b) is NOT postman-only: the LLM top-up loop still runs.
  expect(deps.postmanOnly).toBe(false);
});

test('an ordinary /start (no Postman) leaves postmanCapturedByOp undefined (today behaviour unchanged)', async () => {
  seedSecret();
  const op = buildOperation();
  oasInventoryStore.set(SESSION_ID, {
    operations: [
      {
        operationId: 'getPetById',
        method: 'get',
        path: '/pets/{id}',
        summary: null,
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { operationId: 'getPetById' } as never,
      },
    ],
    title: null,
    version: null,
  });
  const session = buildSession();
  const mock = buildArchMock(session, [op]);
  const spawn = jest.fn(async () => ({}));
  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(202);
  const deps = (spawn.mock.calls[0] as any[])[1] as any;
  expect(deps.postmanCapturedByOp).toBeUndefined();
  expect(deps.postmanOnly).toBe(false);
});
