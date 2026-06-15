/**
 * Model-Seeded Capture Inventory -- end-to-end action lifecycle through the
 * REAL routes AND the REAL archModelClient (axios mocked at the HTTP
 * boundary with a stateful in-memory AMS stub).
 *
 * Spec: 2026-06-11 Model-Seeded Capture Inventory -- Task Group 5
 * (test review & gap analysis). The Task-Group-2 suite injects a mocked
 * archModelClient, so the client's URL construction and snake_case body
 * mapping were only covered indirectly; these tests run the default client
 * end to end.
 *
 * Test inventory (3 strategic tests):
 *   1. Configure-to-start lifecycle: reconcile shows 2 unaccounted ->
 *      include one + exclude one with reason -> re-reconcile shows BOTH
 *      accounted (the excluded-with-reason row still accounts) -> /start
 *      passes the gate and proceeds (202, orchestrator spawned, no override
 *      patch).
 *   2. Staleness (D8) + override: a clean configure-time reconcile, then a
 *      model endpoint is committed AFTER configure -> /start's re-run
 *      reconciliation catches the drift and blocks 409
 *      INVENTORY_UNACCOUNTED_ENDPOINTS -> re-submit with
 *      `coverageOverrideJustification` persists the override trio and
 *      starts.
 *   3. Legacy back-compat: a session with NO persisted scope and all new
 *      columns null whose operation rows already cover the architecture
 *      starts unimpeded -- the gate resolves null scope as
 *      whole-architecture AMS-side and never blocks or patches an override.
 *
 * IMPORTANT: the stub's endpoint<->operation matching below is TEST FIXTURE
 * code standing in for the AMS Java calculator (REST `<METHOD> <path>` only)
 * so the stub can answer the second reconcile statefully. It is NOT a
 * product-code reimplementation of the reconciliation key -- the single
 * source of truth remains `InventoryReconciliationCalculator` in AMS.
 */

// ---------------------------------------------------------------------------
// Axios mock -- MUST precede any import that pulls in archModelClient.
// ---------------------------------------------------------------------------

const httpGet = jest.fn();
const httpPost = jest.fn();
const httpPatch = jest.fn();

jest.mock('axios', () => {
  const interceptors = {
    response: { use: jest.fn() },
    request: { use: jest.fn() },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        get: (...args: unknown[]) => httpGet(...args),
        post: (...args: unknown[]) => httpPost(...args),
        put: jest.fn(),
        patch: (...args: unknown[]) => httpPatch(...args),
        delete: jest.fn(),
        interceptors,
      })),
      isAxiosError: jest.fn(() => false),
    },
    isAxiosError: jest.fn(() => false),
  };
});

import express from 'express';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { oasInventoryStore } from '../services/oasInventoryStore';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000e2';
const ARCH_ID = '00000000-0000-0000-0000-0000000000e3';
const SESSION_ID = '00000000-0000-0000-0000-0000000000e4';

// ---------------------------------------------------------------------------
// Stateful in-memory AMS stub behind the axios mock
// ---------------------------------------------------------------------------

interface StubEndpoint {
  id: string;
  interface_id: string;
  name: string;
  operation_verb: string;
  path_or_address: string;
  description?: string | null;
}

interface StubOperation {
  id: string;
  session_id: string;
  operation_id: string;
  method: string;
  path: string;
  included: boolean | null;
  exclusion_reason: string | null;
  [k: string]: unknown;
}

interface StubState {
  session: Record<string, unknown>;
  interfaces: Array<Record<string, unknown>>;
  endpoints: StubEndpoint[];
  operations: StubOperation[];
  sessionPatches: Array<Record<string, unknown>>;
  reconcileBodies: Array<Record<string, unknown>>;
}

let state: StubState;

function buildState(overrides: {
  session?: Partial<Record<string, unknown>>;
  endpoints?: StubEndpoint[];
  operations?: StubOperation[];
} = {}): StubState {
  const now = new Date().toISOString();
  return {
    session: {
      id: SESSION_ID,
      project_id: PROJECT_ID,
      architecture_id: ARCH_ID,
      name: 'e2e-session',
      status: 'configured',
      env_name: 'non-prod',
      api_base_url: 'https://api.example.test',
      auth_type: 'bearer',
      mutating_calls_confirmed: true,
      scope_interface_ids_json: null,
      coverage_override_justification: null,
      coverage_override_unaccounted_count: null,
      coverage_override_at: null,
      created_at: now,
      updated_at: now,
      ...(overrides.session ?? {}),
    },
    interfaces: [{ id: 'iface-1', name: 'order-api', architecture_id: ARCH_ID }],
    endpoints: overrides.endpoints ?? [],
    operations: overrides.operations ?? [],
    sessionPatches: [],
    reconcileBodies: [],
  };
}

/**
 * TEST-FIXTURE matching only (REST `<METHOD> <path>`): lets the stub answer
 * the SECOND reconcile from the rows the route just created. The real key
 * lives ONLY in the AMS Java calculator.
 */
function stubReconcile(body: Record<string, unknown>): Record<string, unknown> {
  state.reconcileBodies.push(body);
  const requestScope = Array.isArray(body.scope_interface_ids)
    ? (body.scope_interface_ids as string[])
    : null;
  const sessionScope = Array.isArray(state.session.scope_interface_ids_json)
    ? (state.session.scope_interface_ids_json as string[])
    : null;
  const scope = requestScope ?? sessionScope; // null => whole architecture
  if (body.persist_scope === true && requestScope) {
    state.session.scope_interface_ids_json = [...requestScope];
  }

  const opKeys = new Set(
    state.operations.map((o) => `${o.method.trim().toUpperCase()} ${o.path.trim()}`),
  );
  const unaccounted: Array<Record<string, unknown>> = [];
  const excludedByScope: Array<Record<string, unknown>> = [];
  let inScopeTotal = 0;
  let inScopeAccounted = 0;
  let archAccounted = 0;
  for (const ep of state.endpoints) {
    const key = `${ep.operation_verb.trim().toUpperCase()} ${ep.path_or_address.trim()}`;
    const accounted = opKeys.has(key);
    if (accounted) archAccounted += 1;
    const inScope = scope === null || scope.includes(ep.interface_id);
    if (inScope) {
      inScopeTotal += 1;
      if (accounted) {
        inScopeAccounted += 1;
      } else {
        unaccounted.push({
          endpoint_id: ep.id,
          interface_id: ep.interface_id,
          key,
          name: ep.name,
          method: ep.operation_verb,
          path: ep.path_or_address,
          protocol: 'REST',
          soap_action: null,
          request_root_element: null,
        });
      }
    } else {
      excludedByScope.push({
        endpoint_id: ep.id,
        interface_id: ep.interface_id,
        key,
        name: ep.name,
      });
    }
  }
  return {
    in_scope_unaccounted_endpoints: unaccounted,
    operations_without_model_endpoint: [],
    excluded_by_scope_endpoints: excludedByScope,
    in_scope_coverage_pct: inScopeTotal === 0 ? 100 : (inScopeAccounted * 100) / inScopeTotal,
    in_scope_accounted_count: inScopeAccounted,
    in_scope_total_count: inScopeTotal,
    architecture_coverage_pct:
      state.endpoints.length === 0 ? 100 : (archAccounted * 100) / state.endpoints.length,
    architecture_accounted_count: archAccounted,
    architecture_total_count: state.endpoints.length,
  };
}

function installAmsStub() {
  const SESSION_URL = `/api/projects/${PROJECT_ID}/api-behaviour/capture-sessions/${SESSION_ID}`;
  const MODEL_URL = `/api/model/projects/${PROJECT_ID}/architectures/${ARCH_ID}`;
  const OPERATIONS_URL = `/api/projects/${PROJECT_ID}/api-behaviour/operations`;

  httpGet.mockImplementation(async (url: string) => {
    if (url === SESSION_URL) return { data: { ...state.session } };
    if (url === MODEL_URL) {
      return {
        data: {
          metaModel: {
            entities: { interfaces: state.interfaces, endpoints: state.endpoints },
          },
        },
      };
    }
    if (url.startsWith(`${OPERATIONS_URL}?sessionId=`)) {
      return { data: state.operations.map((o) => ({ ...o })) };
    }
    throw new Error(`AMS stub: unexpected GET ${url}`);
  });

  httpPost.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === `${SESSION_URL}/inventory-reconciliation`) {
      return { data: stubReconcile(body) };
    }
    if (url === OPERATIONS_URL) {
      const row: StubOperation = {
        id: `op-row-${state.operations.length + 1}`,
        session_id: String(body.session_id),
        operation_id: String(body.operation_id),
        method: String(body.method),
        path: String(body.path),
        included: (body.included as boolean | null) ?? null,
        exclusion_reason: (body.exclusion_reason as string | null) ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.operations.push(row);
      return { data: { ...row } };
    }
    throw new Error(`AMS stub: unexpected POST ${url}`);
  });

  httpPatch.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === SESSION_URL) {
      state.sessionPatches.push({ ...body });
      state.session = { ...state.session, ...body };
      return { data: { ...state.session } };
    }
    throw new Error(`AMS stub: unexpected PATCH ${url}`);
  });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const spawnOrchestrator = jest.fn(async () => undefined);

function buildApp() {
  const app = express();
  app.use(express.json());
  // Default deps EXCEPT the orchestrator spawn (we must never run a real
  // capture loop in a unit test) -- the AMS path runs the real client.
  app.use(buildCaptureSessionActionsRouter({ spawnOrchestrator: spawnOrchestrator as never }));
  return app;
}

function stageStartPrerequisites() {
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: 'e2e', version: '1' });
}

beforeEach(() => {
  httpGet.mockReset();
  httpPost.mockReset();
  httpPatch.mockReset();
  spawnOrchestrator.mockClear();
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
});

// ---------------------------------------------------------------------------
// Test 1: configure-to-start lifecycle (include + exclude both account)
// ---------------------------------------------------------------------------
test('lifecycle: reconcile shows unaccounted -> include one + exclude one -> re-reconcile fully accounted -> /start passes the gate', async () => {
  state = buildState({
    endpoints: [
      {
        id: 'ep-1',
        interface_id: 'iface-1',
        name: 'getOrder',
        operation_verb: 'GET',
        path_or_address: '/orders/{id}',
      },
      {
        id: 'ep-2',
        interface_id: 'iface-1',
        name: 'legacyPing',
        operation_verb: 'POST',
        path_or_address: '/legacy/ping',
      },
    ],
  });
  installAmsStub();
  const app = buildApp();

  // 1. Configure-time reconcile: both committed endpoints unaccounted; the
  //    selected scope is persisted onto the session row.
  const first = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/reconcile-inventory?projectId=${PROJECT_ID}`)
    .send({ scopeInterfaceIds: ['iface-1'], persistScope: true, refreshFindings: true });
  expect(first.status).toBe(200);
  expect(first.body.in_scope_unaccounted_endpoints).toHaveLength(2);
  expect(first.body.in_scope_coverage_pct).toBe(0);
  expect(state.session.scope_interface_ids_json).toEqual(['iface-1']);
  expect(state.reconcileBodies[0]).toEqual({
    scope_interface_ids: ['iface-1'],
    persist_scope: true,
    refresh_findings: true,
  });

  // 2. Account both: one INCLUDE, one EXCLUDE-with-reason (bulk, one call).
  const account = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/account-endpoints?projectId=${PROJECT_ID}`)
    .send({
      items: [
        { endpoint_id: 'ep-1', action: 'include' },
        { endpoint_id: 'ep-2', action: 'exclude', reason: 'deprecated endpoint' },
      ],
    });
  expect(account.status).toBe(200);
  expect(account.body.operations).toHaveLength(2);
  expect(state.operations).toHaveLength(2);
  expect(state.operations[0]).toMatchObject({
    operation_id: 'getOrder',
    method: 'GET',
    path: '/orders/{id}',
    included: true,
    exclusion_reason: null,
  });
  expect(state.operations[1]).toMatchObject({
    operation_id: 'legacyPing',
    included: false,
    exclusion_reason: 'deprecated endpoint',
  });

  // 3. Re-reconcile: BOTH endpoints accounted -- the excluded-with-reason
  //    row counts exactly like the included one (persistence IS the record).
  const second = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/reconcile-inventory?projectId=${PROJECT_ID}`)
    .send({});
  expect(second.status).toBe(200);
  expect(second.body.in_scope_unaccounted_endpoints).toHaveLength(0);
  expect(second.body.in_scope_accounted_count).toBe(2);
  expect(second.body.in_scope_coverage_pct).toBe(100);

  // 4. /start passes the gate: 202, orchestrator spawned, NO override patch.
  stageStartPrerequisites();
  const start = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ includeDiscoveryContext: false });
  expect(start.status).toBe(202);
  expect(spawnOrchestrator).toHaveBeenCalledTimes(1);
  // The Start-time gate re-ran reconciliation with refresh_findings: true,
  // letting the session row's persisted scope resolve AMS-side.
  expect(state.reconcileBodies[state.reconcileBodies.length - 1]).toEqual({
    scope_interface_ids: null,
    persist_scope: false,
    refresh_findings: true,
  });
  // Only the running flip was patched -- never an override trio.
  const overridePatches = state.sessionPatches.filter(
    (p) => 'coverage_override_justification' in p,
  );
  expect(overridePatches).toHaveLength(0);
  expect(state.session.status).toBe('running');
});

// ---------------------------------------------------------------------------
// Test 2: staleness (D8) -- model drift after configure blocks at /start;
// justified override persists the trio and proceeds.
// ---------------------------------------------------------------------------
test('staleness: an endpoint committed AFTER a clean configure-time pass blocks /start with 409, then a justified override persists the trio and starts', async () => {
  state = buildState({
    endpoints: [
      {
        id: 'ep-1',
        interface_id: 'iface-1',
        name: 'getOrder',
        operation_verb: 'GET',
        path_or_address: '/orders/{id}',
      },
    ],
    operations: [
      {
        id: 'op-existing',
        session_id: SESSION_ID,
        operation_id: 'getOrder',
        method: 'GET',
        path: '/orders/{id}',
        included: true,
        exclusion_reason: null,
      },
    ],
  });
  installAmsStub();
  const app = buildApp();

  // Configure-time reconcile is CLEAN.
  const configure = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/reconcile-inventory?projectId=${PROJECT_ID}`)
    .send({ scopeInterfaceIds: ['iface-1'], persistScope: true });
  expect(configure.status).toBe(200);
  expect(configure.body.in_scope_unaccounted_endpoints).toHaveLength(0);

  // Model drift: discovery commits a NEW endpoint between configure and Start.
  state.endpoints.push({
    id: 'ep-new',
    interface_id: 'iface-1',
    name: 'cancelOrder',
    operation_verb: 'DELETE',
    path_or_address: '/orders/{id}',
  });

  // /start RE-RUNS reconciliation and catches the drift -- hard block.
  stageStartPrerequisites();
  const blocked = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ includeDiscoveryContext: false });
  expect(blocked.status).toBe(409);
  expect(blocked.body.error.code).toBe('INVENTORY_UNACCOUNTED_ENDPOINTS');
  expect(blocked.body.error.unaccountedCount).toBe(1);
  expect(blocked.body.error.unaccounted[0]).toMatchObject({
    endpoint_id: 'ep-new',
    key: 'DELETE /orders/{id}',
  });
  expect(spawnOrchestrator).not.toHaveBeenCalled();

  // Justified override: trio persisted BEFORE the running flip, then 202.
  const overridden = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({
      includeDiscoveryContext: false,
      coverageOverrideJustification: 'New endpoint lands in the next capture session',
    });
  expect(overridden.status).toBe(202);
  expect(spawnOrchestrator).toHaveBeenCalledTimes(1);
  const overridePatch = state.sessionPatches.find(
    (p) => 'coverage_override_justification' in p,
  );
  expect(overridePatch).toMatchObject({
    coverage_override_justification: 'New endpoint lands in the next capture session',
    coverage_override_unaccounted_count: 1,
  });
  expect(typeof overridePatch!.coverage_override_at).toBe('string');
  expect(state.session.status).toBe('running');
});

// ---------------------------------------------------------------------------
// Test 3: legacy back-compat -- no persisted scope, all new columns null,
// fully covered architecture: /start proceeds with no gate friction.
// ---------------------------------------------------------------------------
test('back-compat: a session with null scope and all new fields null whose rows cover the whole architecture starts unimpeded (null scope = whole architecture)', async () => {
  state = buildState({
    endpoints: [
      {
        id: 'ep-1',
        interface_id: 'iface-1',
        name: 'getOrder',
        operation_verb: 'GET',
        path_or_address: '/orders/{id}',
      },
    ],
    operations: [
      {
        id: 'op-legacy',
        session_id: SESSION_ID,
        operation_id: 'getOrder',
        method: 'GET',
        path: '/orders/{id}',
        included: true,
        exclusion_reason: null,
      },
    ],
  });
  installAmsStub();
  const app = buildApp();

  // Straight to /start -- this session pre-dates the reconciliation flow
  // (no reconcile-inventory call ever ran, no scope persisted).
  stageStartPrerequisites();
  const start = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ includeDiscoveryContext: false });

  expect(start.status).toBe(202);
  expect(spawnOrchestrator).toHaveBeenCalledTimes(1);
  // The gate still RAN (fails closed by design, never silently skipped) and
  // resolved null scope as whole-architecture.
  expect(state.reconcileBodies).toHaveLength(1);
  expect(state.reconcileBodies[0]).toEqual({
    scope_interface_ids: null,
    persist_scope: false,
    refresh_findings: true,
  });
  // No override patch, no scope write -- legacy row shape untouched beyond
  // the normal running flip.
  expect(state.session.scope_interface_ids_json).toBeNull();
  expect(state.session.coverage_override_justification).toBeNull();
  expect(state.session.status).toBe('running');
});
