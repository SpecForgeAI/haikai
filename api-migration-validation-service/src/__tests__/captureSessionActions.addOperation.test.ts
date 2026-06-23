/**
 * add-operation action + Postman-only /start tests
 * (Spec 2026-06-23 Import a Postman Collection into Capture, Task Group 6 --
 * R2 / R4c / R7 / R8).
 *
 * The add-operation action appends ONE endpoint to a session as an
 * `included=true` operation row BEFORE any `manual-capture` send, so an imported
 * Postman item that maps to an endpoint NOT already in the session satisfies the
 * `manual-capture` route's OPERATION_NOT_FOUND / OPERATION_NOT_INCLUDED guards.
 * It reuses `synthesiseOperationFromEndpoint` + the `account-endpoints`
 * `createOperation` snake_case shape and appends to `oasInventoryStore` so
 * `/start` sees the new row without a re-parse.
 *
 * These tests mock `archModelClient` via the router dep seam (no real AMS) and
 * cover the critical behaviours from task 6.1.
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
  InterfaceDto,
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
    name: 'add-operation',
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
    id: 'op-row-existing',
    session_id: SESSION_ID,
    operation_id: 'getWidget',
    method: 'GET',
    path: '/widgets/{id}',
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

function buildReconciliation(
  overrides: Partial<InventoryReconciliationResponse> = {},
): InventoryReconciliationResponse {
  return {
    in_scope_committed_count: 0,
    accounted_count: 0,
    in_scope_unaccounted_endpoints: [],
    operations_without_model_endpoint: [],
    ...(overrides as Record<string, unknown>),
  } as unknown as InventoryReconciliationResponse;
}

function buildArchMock(opts: {
  session?: CaptureSessionDto;
  existingOps?: OperationDto[];
  endpoints?: Array<Record<string, unknown>>;
  interfaces?: InterfaceDto[];
  reconciliation?: InventoryReconciliationResponse;
} = {}) {
  const session = opts.session ?? buildSession();
  const created: Array<{ projectId: string; body: any }> = [];
  const patches: Array<{ projectId: string; sessionId: string; body: any }> = [];
  const mock = {
    getCaptureSession: jest.fn(async () => session),
    listOperationsBySession: jest.fn(async () => opts.existingOps ?? []),
    listEndpointsForArchitecture: jest.fn(async () => opts.endpoints ?? []),
    listInterfacesForArchitecture: jest.fn(async () => opts.interfaces ?? []),
    listEndpointsForInterface: jest.fn(async () => []),
    createOperation: jest.fn(async (projectId: string, body: any) => {
      created.push({ projectId, body });
      return {
        id: `op-row-${created.length}`,
        session_id: body.session_id,
        operation_id: body.operation_id,
        method: body.method,
        path: body.path,
        summary: body.summary ?? null,
        description: body.description ?? null,
        included: body.included ?? null,
        safe_to_execute: body.safe_to_execute ?? null,
        request_schema_json: body.request_schema_json ?? null,
        response_schema_json: body.response_schema_json ?? null,
        oas_operation_json: body.oas_operation_json ?? null,
        exclusion_reason: body.exclusion_reason ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as OperationDto;
    }),
    reconcileCaptureSessionInventory: jest.fn(
      async () => opts.reconciliation ?? buildReconciliation(),
    ),
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
  };
  return { mock, created, patches };
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

test('add-operation (no endpointId) creates an included=true row + appends to oasInventoryStore', async () => {
  const { mock, created } = buildArchMock({ existingOps: [] });
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/add-operation?projectId=${PROJECT_ID}`)
    .send({ method: 'post', path: '/orders', summary: 'Create order' });

  expect(res.status).toBe(201);
  expect(res.body.created).toBe(true);
  expect(res.body.operation.included).toBe(true);

  // createOperation called once with the snake_case shape; included=true; method
  // upper-cased; safe_to_execute null (user reviews it).
  expect(mock.createOperation).toHaveBeenCalledTimes(1);
  const body = created[0].body;
  expect(body).toMatchObject({
    session_id: SESSION_ID,
    method: 'POST',
    path: '/orders',
    included: true,
    safe_to_execute: null,
  });
  expect(body.operation_id).toBe('POST_/orders');

  // Inventory append: /start sees the new row WITHOUT a re-parse.
  const cached = oasInventoryStore.get(SESSION_ID);
  expect(cached).toBeDefined();
  expect(cached!.operations).toHaveLength(1);
  expect(cached!.operations[0]).toMatchObject({ method: 'post', path: '/orders' });
});

test('add-operation (with endpointId) reuses synthesiseOperationFromEndpoint over the committed endpoint', async () => {
  const endpoint = {
    id: 'ep-7',
    interface_id: 'iface-1',
    name: 'createOrder',
    operation_verb: 'POST',
    path_or_address: '/orders',
    description: 'Create an order',
  };
  const { mock, created } = buildArchMock({
    existingOps: [],
    endpoints: [endpoint],
    interfaces: [{ id: 'iface-1', name: 'Orders', interface_type: 'REST_API' } as any],
  });
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/add-operation?projectId=${PROJECT_ID}`)
    .send({ endpointId: 'ep-7', method: 'POST', path: '/orders' });

  expect(res.status).toBe(201);
  expect(mock.listEndpointsForArchitecture).toHaveBeenCalledTimes(1);
  const body = created[0].body;
  // Synthesised from the endpoint row: name -> operation_id/summary, included=true.
  expect(body.included).toBe(true);
  expect(body.method).toBe('POST');
  expect(body.path).toBe('/orders');
  expect(body.operation_id).toBe('createOrder');
});

test('add-operation is idempotent: an existing row (by method+path) returns created:false, no duplicate', async () => {
  const existing = buildOperation({ method: 'GET', path: '/widgets/42', operation_id: 'getWidget42' });
  const { mock } = buildArchMock({ existingOps: [existing] });
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/add-operation?projectId=${PROJECT_ID}`)
    .send({ method: 'GET', path: '/widgets/42' });

  expect(res.status).toBe(200);
  expect(res.body.created).toBe(false);
  expect(res.body.operation.id).toBe('op-row-existing');
  expect(mock.createOperation).not.toHaveBeenCalled();
});

test('add-operation validates required method + path', async () => {
  const { mock } = buildArchMock();
  const app = buildApp({ archModelClient: mock as any });

  const noMethod = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/add-operation?projectId=${PROJECT_ID}`)
    .send({ path: '/orders' });
  expect(noMethod.status).toBe(400);
  expect(noMethod.body.error.message).toMatch(/method/i);

  const noPath = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/add-operation?projectId=${PROJECT_ID}`)
    .send({ method: 'POST' });
  expect(noPath.status).toBe(400);
  expect(noPath.body.error.message).toMatch(/path/i);

  expect(mock.createOperation).not.toHaveBeenCalled();
});

test('Postman-only /start carries coverageOverrideJustification so the coverage gate does not fail closed, spawns orchestrator with postmanOnly=true', async () => {
  seedSecret();
  oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });
  // One in-scope unaccounted endpoint -> the gate would block without the override.
  const reconciliation = buildReconciliation({
    in_scope_unaccounted_endpoints: [
      { endpoint_id: 'ep-1', interface_id: 'iface-1', key: 'POST /orders', name: 'createOrder', method: 'POST', path: '/orders' },
    ],
  } as any);
  const { mock, patches } = buildArchMock({ reconciliation });
  const spawn = jest.fn(async () => ({}));
  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ postmanOnly: true, coverageOverrideJustification: 'Postman-only run: coverage intentionally partial.' });

  expect(res.status).toBe(202);
  // Override trio persisted (gate did not fail closed).
  const overridePatch = patches.find((p) => p.body.coverage_override_justification);
  expect(overridePatch).toBeDefined();
  expect(overridePatch!.body.coverage_override_unaccounted_count).toBe(1);
  // Orchestrator spawned with postmanOnly=true so it skips planner + execute loop.
  expect(spawn).toHaveBeenCalledTimes(1);
  const deps = (spawn.mock.calls[0] as any[])[1] as any;
  expect(deps.postmanOnly).toBe(true);
});

test('Postman-only /start WITHOUT coverageOverrideJustification still fails closed (409)', async () => {
  seedSecret();
  oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });
  const reconciliation = buildReconciliation({
    in_scope_unaccounted_endpoints: [
      { endpoint_id: 'ep-1', interface_id: 'iface-1', key: 'POST /orders', name: 'createOrder', method: 'POST', path: '/orders' },
    ],
  } as any);
  const { mock } = buildArchMock({ reconciliation });
  const spawn = jest.fn(async () => ({}));
  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ postmanOnly: true });

  expect(res.status).toBe(409);
  expect(JSON.stringify(res.body)).toContain('INVENTORY_UNACCOUNTED_ENDPOINTS');
  expect(spawn).not.toHaveBeenCalled();
});
