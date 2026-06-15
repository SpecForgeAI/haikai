/**
 * Model-Seeded Capture Inventory -- validation-service actions + /start gate.
 *
 * Spec: 2026-06-11 Model-Seeded Capture Inventory -- Task Group 2
 * sub-task 2.1.
 *
 * Test inventory (8 tests, focused on the spec-required behaviours):
 *   1. POST /reconcile-inventory loads the session, calls the new
 *      `archModelClient.reconcileCaptureSessionInventory` method with the
 *      mapped snake_case AMS request, and returns the AMS payload VERBATIM.
 *   2. POST /account-endpoints INCLUDE (REST) auto-creates a schema-less
 *      operation row from the endpoint metadata (operation_id from the
 *      endpoint name, validated verb, path_or_address, included=true,
 *      safe_to_execute=null, null schemas,
 *      x-amvs-source: 'model-endpoint-reconciliation') AND appends the
 *      included row to the session's cached oasInventoryStore inventory.
 *   3. POST /account-endpoints INCLUDE (SOAP) maps the SOAP variant:
 *      default `post` verb, operation_id from soap_action, the
 *      `x-amvs-soap` block, the `x-amvs-soap-root` schema placeholders,
 *      and the namespace badge in the description.
 *   4. POST /account-endpoints EXCLUDE persists the identity row with
 *      included=false + exclusion_reason; a missing reason is a 400 with
 *      no operation row written.
 *   5. POST /start blocks with 409 INVENTORY_UNACCOUNTED_ENDPOINTS when
 *      in-scope unaccounted endpoints remain and no override is supplied --
 *      embedded list capped at 50 entries plus the total count; the
 *      orchestrator is NOT spawned and no patch goes out.
 *   6. POST /start with `coverageOverrideJustification` PATCHes the
 *      coverage-override trio onto the session row, then proceeds to start.
 *   7. The /start gate FAILS CLOSED: an AMS reconciliation error -> 502
 *      INVENTORY_RECONCILIATION_UNAVAILABLE, never a silent skip.
 *   8. parse-oas (interface-selected branch) persists the request's
 *      `interfaceIds` to the session's `scope_interface_ids_json` via a
 *      session PATCH.
 *
 * The AMS client is mocked throughout; NO reconciliation key or comparison
 * logic exists (or is asserted) in TypeScript -- the gate and the action only
 * consume the AMS payload.
 */

import express from 'express';
import path from 'path';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type {
  CaptureSessionDto,
  InterfaceDto,
  InventoryReconciliationResponse,
  InventoryUnaccountedEndpointRef,
  OperationDto,
} from '../services/archModelClient';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_OAS_PATH = path.resolve(__dirname, 'fixtures', 'sample-oas.json');

const PROJECT_ID = '00000000-0000-0000-0000-0000000000a7';
const ARCH_ID = '00000000-0000-0000-0000-0000000000b7';
const SESSION_ID = '00000000-0000-0000-0000-0000000000c7';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'inventory-test-session',
    status: 'configured',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildReconciliation(
  overrides: Partial<InventoryReconciliationResponse> = {},
): InventoryReconciliationResponse {
  return {
    in_scope_unaccounted_endpoints: [],
    operations_without_model_endpoint: [],
    excluded_by_scope_endpoints: [],
    in_scope_coverage_pct: 100,
    in_scope_accounted_count: 0,
    in_scope_total_count: 0,
    architecture_coverage_pct: 100,
    architecture_accounted_count: 0,
    architecture_total_count: 0,
    ...overrides,
  };
}

function buildUnaccountedRef(i: number): InventoryUnaccountedEndpointRef {
  return {
    endpoint_id: `ep-${i}`,
    interface_id: 'iface-1',
    key: `GET /things/${i}`,
    name: `getThing${i}`,
    method: 'GET',
    path: `/things/${i}`,
    protocol: 'REST',
    soap_action: null,
    request_root_element: null,
  };
}

function buildArchModelClientMock(opts: {
  session?: CaptureSessionDto;
  interfaces?: InterfaceDto[];
  endpoints?: Array<Record<string, unknown>>;
  reconciliation?: InventoryReconciliationResponse;
  reconciliationError?: Error;
} = {}) {
  const session = opts.session ?? buildSession();
  const operationsCreated: Array<{ projectId: string; body: any }> = [];
  const sessionPatches: Array<{ projectId: string; sessionId: string; body: any }> = [];
  const reconcileCalls: Array<{ projectId: string; sessionId: string; body: any }> = [];

  const mock = {
    getCaptureSession: jest.fn(async () => session),
    listInterfacesForArchitecture: jest.fn(async () => opts.interfaces ?? []),
    listEndpointsForInterface: jest.fn(async () => []),
    listEndpointsForArchitecture: jest.fn(async () => opts.endpoints ?? []),
    listOperationsBySession: jest.fn(async () => []),
    reconcileCaptureSessionInventory: jest.fn(
      async (projectId: string, sessionId: string, body: any) => {
        reconcileCalls.push({ projectId, sessionId, body });
        if (opts.reconciliationError) throw opts.reconciliationError;
        return opts.reconciliation ?? buildReconciliation();
      },
    ),
    createOperation: jest.fn(async (projectId: string, body: any) => {
      operationsCreated.push({ projectId, body });
      return {
        id: `op-row-${operationsCreated.length}`,
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
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ projectId, sessionId, body });
      return { ...session, ...body, id: sessionId, project_id: projectId } as CaptureSessionDto;
    }),
    getMigrationDiscoveryContext: jest.fn(async () => ({
      highPriorityFindings: [],
      evidenceHighlights: [],
      contextWarnings: [],
    })),
    createCaptureSession: jest.fn(),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    createBaseline: jest.fn(),
    createBaselineItem: jest.fn(),
  };
  return { mock, operationsCreated, sessionPatches, reconcileCalls };
}

function buildApp(deps: Parameters<typeof buildCaptureSessionActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter(deps));
  return app;
}

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Test 1: reconcile-inventory -- session load + AMS call + VERBATIM payload.
// ---------------------------------------------------------------------------
test('reconcile-inventory loads the session, calls AMS with the mapped snake_case request, and returns the payload verbatim', async () => {
  const payload = buildReconciliation({
    in_scope_unaccounted_endpoints: [buildUnaccountedRef(1)],
    in_scope_coverage_pct: 50,
    in_scope_accounted_count: 1,
    in_scope_total_count: 2,
    architecture_coverage_pct: 25,
    architecture_accounted_count: 1,
    architecture_total_count: 4,
  });
  const { mock, reconcileCalls } = buildArchModelClientMock({ reconciliation: payload });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/reconcile-inventory?projectId=${PROJECT_ID}`)
    .send({ scopeInterfaceIds: ['iface-1'], persistScope: true, refreshFindings: true });

  expect(res.status).toBe(200);
  // VERBATIM passthrough -- the wire contract is defined once, in AMS.
  expect(res.body).toEqual(payload);

  expect(mock.getCaptureSession).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID);
  expect(reconcileCalls).toHaveLength(1);
  expect(reconcileCalls[0].projectId).toBe(PROJECT_ID);
  expect(reconcileCalls[0].sessionId).toBe(SESSION_ID);
  expect(reconcileCalls[0].body).toEqual({
    scope_interface_ids: ['iface-1'],
    persist_scope: true,
    refresh_findings: true,
  });
});

// ---------------------------------------------------------------------------
// Test 2: account-endpoints INCLUDE (REST) -- schema-less row + inventory append.
// ---------------------------------------------------------------------------
test('account-endpoints include auto-creates a schema-less REST operation row and appends it to the cached inventory', async () => {
  const restEndpoint = {
    id: 'ep-rest-1',
    name: 'getOrder',
    interface_id: 'iface-rest',
    operation_verb: 'GET',
    path_or_address: '/orders/{id}',
    description: 'Fetch a single order',
  };
  const { mock, operationsCreated } = buildArchModelClientMock({
    interfaces: [{ id: 'iface-rest', name: 'order-api', architecture_id: ARCH_ID }],
    endpoints: [restEndpoint],
  });

  // Pre-stage a cached inventory (as parse-oas would have left it).
  oasInventoryStore.set(SESSION_ID, {
    operations: [
      {
        operationId: 'existingOp',
        method: 'get',
        path: '/existing',
        summary: null,
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { responses: {} } as any,
      },
    ],
    title: 'pre-existing',
    version: '1',
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/account-endpoints?projectId=${PROJECT_ID}`)
    .send({ items: [{ endpoint_id: 'ep-rest-1', action: 'include' }] });

  expect(res.status).toBe(200);
  expect(res.body.sessionId).toBe(SESSION_ID);
  // The action responds with the created rows -- no separate list call needed.
  expect(res.body.operations).toHaveLength(1);
  expect(res.body.operations[0].id).toBe('op-row-1');

  expect(operationsCreated).toHaveLength(1);
  const { body } = operationsCreated[0];
  expect(body.session_id).toBe(SESSION_ID);
  expect(body.operation_id).toBe('getOrder'); // endpoint name fallback (no soap_action)
  expect(body.method).toBe('GET'); // validated operation_verb, upper-cased on the wire
  expect(body.path).toBe('/orders/{id}'); // path_or_address
  expect(body.included).toBe(true);
  expect(body.safe_to_execute).toBeNull();
  expect(body.exclusion_reason).toBeNull();
  // Schema-less: REST rows keep null schemas.
  expect(body.request_schema_json).toBeNull();
  expect(body.response_schema_json).toBeNull();
  expect((body.oas_operation_json as Record<string, unknown>)['x-amvs-source']).toBe(
    'model-endpoint-reconciliation',
  );

  // Included row appended to the cached inventory for /start's orchestrator.
  const cached = oasInventoryStore.get(SESSION_ID)!;
  expect(cached.operations).toHaveLength(2);
  expect(cached.operations[1].operationId).toBe('getOrder');
});

// ---------------------------------------------------------------------------
// Test 3: account-endpoints INCLUDE (SOAP) -- soap_action id, default post,
// x-amvs-soap block, x-amvs-soap-root placeholders, namespace badge.
// ---------------------------------------------------------------------------
test('account-endpoints include maps a SOAP endpoint with the x-amvs-soap block and schema placeholders', async () => {
  const soapEndpoint = {
    id: 'ep-soap-1',
    name: 'GetAccount',
    interface_id: 'iface-soap',
    operation_verb: 'SOAP', // not a valid HTTP verb -> defaults to post
    path_or_address: '/services/AccountService',
    description: null,
    protocol_metadata_json: {
      soap_action: 'urn:GetAccount',
      request_root_element: 'GetAccountRequest',
      response_root_element: 'GetAccountResponse',
      request_namespace: 'urn:example:account',
    },
  };
  const soapInterface = {
    id: 'iface-soap',
    name: 'account-soap',
    architecture_id: ARCH_ID,
    interface_type: 'SOAP_API',
  } as unknown as InterfaceDto;
  const { mock, operationsCreated } = buildArchModelClientMock({
    interfaces: [soapInterface],
    endpoints: [soapEndpoint],
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/account-endpoints?projectId=${PROJECT_ID}`)
    .send({ items: [{ endpoint_id: 'ep-soap-1', action: 'include' }] });

  expect(res.status).toBe(200);
  expect(operationsCreated).toHaveLength(1);
  const { body } = operationsCreated[0];
  expect(body.operation_id).toBe('urn:GetAccount'); // soap_action wins the fallback chain
  expect(body.method).toBe('POST'); // SOAP defaults to post
  expect(body.path).toBe('/services/AccountService');
  expect(body.included).toBe(true);
  expect(body.safe_to_execute).toBeNull();
  // Namespace badge in the description (no entity description present).
  expect(body.description).toBe('XML namespace: urn:example:account');
  // SOAP root-element placeholder schemas.
  expect(body.request_schema_json).toEqual({
    type: 'object',
    'x-amvs-soap-root': 'GetAccountRequest',
  });
  expect(body.response_schema_json).toEqual({
    type: 'object',
    'x-amvs-soap-root': 'GetAccountResponse',
  });
  const oasOp = body.oas_operation_json as Record<string, unknown>;
  expect(oasOp['x-amvs-source']).toBe('model-endpoint-reconciliation');
  expect(oasOp['x-amvs-soap']).toEqual({
    soap_action: 'urn:GetAccount',
    request_root_element: 'GetAccountRequest',
    response_root_element: 'GetAccountResponse',
    request_namespace: 'urn:example:account',
  });
});

// ---------------------------------------------------------------------------
// Test 4: account-endpoints EXCLUDE -- included=false + exclusion_reason;
// missing reason -> 400 and nothing written.
// ---------------------------------------------------------------------------
test('account-endpoints exclude persists included=false + exclusion_reason and rejects a missing reason with 400', async () => {
  const restEndpoint = {
    id: 'ep-rest-2',
    name: 'legacyPing',
    interface_id: 'iface-rest',
    operation_verb: 'GET',
    path_or_address: '/legacy/ping',
    description: null,
  };
  const { mock, operationsCreated } = buildArchModelClientMock({
    interfaces: [{ id: 'iface-rest', name: 'order-api', architecture_id: ARCH_ID }],
    endpoints: [restEndpoint],
  });

  const app = buildApp({ archModelClient: mock as any });

  // EXCLUDE with a reason -> identity-mapped accounting row.
  const ok = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/account-endpoints?projectId=${PROJECT_ID}`)
    .send({
      items: [{ endpoint_id: 'ep-rest-2', action: 'exclude', reason: 'deprecated endpoint' }],
    });
  expect(ok.status).toBe(200);
  expect(operationsCreated).toHaveLength(1);
  expect(operationsCreated[0].body.included).toBe(false);
  expect(operationsCreated[0].body.exclusion_reason).toBe('deprecated endpoint');
  expect(operationsCreated[0].body.operation_id).toBe('legacyPing');
  // Excluded rows are accounting-only: they never enter the cached inventory.
  expect(oasInventoryStore.has(SESSION_ID)).toBe(false);

  // EXCLUDE without a reason -> 400, no further row written.
  const bad = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/account-endpoints?projectId=${PROJECT_ID}`)
    .send({ items: [{ endpoint_id: 'ep-rest-2', action: 'exclude', reason: '  ' }] });
  expect(bad.status).toBe(400);
  expect(bad.body.error.message).toContain('requires a non-empty reason');
  expect(operationsCreated).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Test 5: /start hard block -- 409 INVENTORY_UNACCOUNTED_ENDPOINTS with the
// embedded list capped at 50 entries plus the total count.
// ---------------------------------------------------------------------------
test('start blocks with 409 INVENTORY_UNACCOUNTED_ENDPOINTS (list capped at 50 + total) and does not spawn', async () => {
  const unaccounted = Array.from({ length: 60 }, (_, i) => buildUnaccountedRef(i));
  const { mock, sessionPatches } = buildArchModelClientMock({
    reconciliation: buildReconciliation({ in_scope_unaccounted_endpoints: unaccounted }),
  });
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: 'fake', version: '1' });

  const spawn = jest.fn();
  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ includeDiscoveryContext: false });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('INVENTORY_UNACCOUNTED_ENDPOINTS');
  expect(res.body.error.unaccountedCount).toBe(60);
  expect(res.body.error.unaccountedTotalCount).toBe(60);
  // Embedded list capped at 50; entries carry the full endpoint refs.
  expect(res.body.error.unaccounted).toHaveLength(50);
  expect(res.body.error.unaccounted[0]).toEqual(buildUnaccountedRef(0));
  // Blocked means BLOCKED: no spawn, no session patch (not even `running`).
  expect(spawn).not.toHaveBeenCalled();
  expect(sessionPatches).toHaveLength(0);
  // The gate re-ran reconciliation with refresh_findings: true (D8).
  expect(mock.reconcileCaptureSessionInventory).toHaveBeenCalledWith(
    PROJECT_ID,
    SESSION_ID,
    { scope_interface_ids: null, persist_scope: false, refresh_findings: true },
  );
});

// ---------------------------------------------------------------------------
// Test 6: /start justified override -- persists the trio, then proceeds.
// ---------------------------------------------------------------------------
test('start with coverageOverrideJustification persists the override trio then proceeds to start', async () => {
  const unaccounted = [buildUnaccountedRef(1), buildUnaccountedRef(2)];
  const { mock, sessionPatches } = buildArchModelClientMock({
    reconciliation: buildReconciliation({ in_scope_unaccounted_endpoints: unaccounted }),
  });
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: 'fake', version: '1' });

  const spawn = jest.fn(async () => undefined);
  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({
      includeDiscoveryContext: false,
      coverageOverrideJustification: 'Known legacy endpoints; capture in a follow-up session',
    });

  expect(res.status).toBe(202);
  expect(spawn).toHaveBeenCalledTimes(1);

  // First PATCH: the override trio (persisted BEFORE the running flip).
  expect(sessionPatches.length).toBeGreaterThanOrEqual(2);
  const overridePatch = sessionPatches[0];
  expect(overridePatch.body.coverage_override_justification).toBe(
    'Known legacy endpoints; capture in a follow-up session',
  );
  expect(overridePatch.body.coverage_override_unaccounted_count).toBe(2);
  expect(typeof overridePatch.body.coverage_override_at).toBe('string');
  expect(overridePatch.body.coverage_override_at.length).toBeGreaterThan(0);
  // Then the normal running flip.
  expect(sessionPatches[1].body.status).toBe('running');
});

// ---------------------------------------------------------------------------
// Test 7: the gate fails CLOSED on an AMS reconciliation error.
// ---------------------------------------------------------------------------
test('start fails closed with 502 when the AMS reconciliation call errors', async () => {
  const { mock, sessionPatches } = buildArchModelClientMock({
    reconciliationError: new Error('AMS unreachable: connect ECONNREFUSED'),
  });
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: 'fake', version: '1' });

  const spawn = jest.fn();
  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ includeDiscoveryContext: false });

  expect(res.status).toBe(502);
  expect(res.body.error.code).toBe('INVENTORY_RECONCILIATION_UNAVAILABLE');
  expect(res.body.error.message).toContain('fails closed');
  expect(res.body.error.message).toContain('AMS unreachable');
  // Fail-closed means NOTHING proceeded: no spawn, no patch.
  expect(spawn).not.toHaveBeenCalled();
  expect(sessionPatches).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 8: parse-oas interface-selected branch persists the scope.
// ---------------------------------------------------------------------------
test('parse-oas interface-selected branch persists interfaceIds to scope_interface_ids_json via session PATCH', async () => {
  const interfaceRow: InterfaceDto = {
    id: 'iface-1',
    name: 'pet-api',
    spec_link: FIXTURE_OAS_PATH,
    architecture_id: ARCH_ID,
  };
  const session = buildSession({ status: 'draft' });
  const { mock, sessionPatches } = buildArchModelClientMock({
    session,
    interfaces: [interfaceRow],
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-1'] });

  expect(res.status).toBe(200);
  // The interface scope landed on the session row so Start-time
  // reconciliation knows the coverage contract.
  const scopePatch = sessionPatches.find(
    (p) => 'scope_interface_ids_json' in p.body,
  );
  expect(scopePatch).toBeDefined();
  expect(scopePatch!.sessionId).toBe(SESSION_ID);
  expect(scopePatch!.body.scope_interface_ids_json).toEqual(['iface-1']);
});
