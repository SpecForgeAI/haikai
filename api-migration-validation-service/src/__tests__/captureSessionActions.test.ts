/**
 * Capture-session action endpoint tests.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 6
 * sub-task 6.1.
 *
 * Test inventory (5 tests, focused on the spec-required behaviours):
 *   1. POST /parse-oas happy path -- selected `Interface` rows resolve to
 *      filesystem paths, the OAS parser ingests them, and one
 *      `api_behaviour_operations` row is written per parsed operation via the
 *      mocked archModelClient.
 *   2. POST /test-api-connection -- in-memory secrets present + mocked HTTP
 *      probe returns 200 -> success response shape.
 *   3. POST /test-db-connection -- in-memory secrets present + mocked
 *      PostgresAdapter.testConnection() returns success -> success response.
 *   4. POST /start guard -- session status 'draft' (not 'configured') ->
 *      409 with currentStatus echoed back, orchestrator NOT spawned.
 *   5. POST /cancel -- patches status to 'cancelled', purges secrets bundle
 *      AND cached OAS inventory, signals abort to runManager.
 *
 * Skips exhaustive per-action coverage per spec sub-task 6.1.
 */

import express from 'express';
import path from 'path';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type { CaptureSessionDto, InterfaceDto, OperationDto } from '../services/archModelClient';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXTURE_OAS_PATH = path.resolve(__dirname, 'fixtures', 'sample-oas.json');

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'test-session',
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

function buildArchModelClientMock(opts: {
  session?: CaptureSessionDto;
  interfaces?: InterfaceDto[];
  operations?: OperationDto[];
  /**
   * Bug fix (2026-05-17) Phase A: per-interface endpoint candidate map.
   * The router calls `listEndpointsForInterface` for every interface that
   * was skipped on /parse-oas (no spec_link) so Step 4 can pre-populate
   * the operation grid with code-discovered endpoints.
   */
  endpointsByInterface?: Record<string, Array<Record<string, unknown>>>;
} = {}) {
  const session = opts.session ?? buildSession();
  const operationsCreated: Array<{ projectId: string; body: any }> = [];
  const sessionPatches: Array<{ projectId: string; sessionId: string; body: any }> = [];

  const mock = {
    getCaptureSession: jest.fn(async (projectId: string, sessionId: string) => {
      void projectId; void sessionId;
      return session;
    }),
    listInterfacesForArchitecture: jest.fn(async (projectId: string, archId: string) => {
      void projectId; void archId;
      return opts.interfaces ?? [];
    }),
    listEndpointsForInterface: jest.fn(
      async (projectId: string, archId: string, interfaceId: string) => {
        void projectId; void archId;
        return opts.endpointsByInterface?.[interfaceId] ?? [];
      },
    ),
    listEndpointsForArchitecture: jest.fn(async () => {
      const all: Array<Record<string, unknown>> = [];
      for (const eps of Object.values(opts.endpointsByInterface ?? {})) all.push(...eps);
      return all;
    }),
    // Model-Seeded Capture Inventory (2026-06-11): the /start coverage gate
    // now re-runs reconciliation against AMS before spawning. Default stub:
    // everything accounted (empty unaccounted list) so pre-existing /start
    // behaviours are unchanged by the gate.
    reconcileCaptureSessionInventory: jest.fn(async () => ({
      in_scope_unaccounted_endpoints: [],
      operations_without_model_endpoint: [],
      excluded_by_scope_endpoints: [],
      in_scope_coverage_pct: 100,
      in_scope_accounted_count: 0,
      in_scope_total_count: 0,
      architecture_coverage_pct: 100,
      architecture_accounted_count: 0,
      architecture_total_count: 0,
    })),
    listOperationsBySession: jest.fn(async (projectId: string, sessionId: string) => {
      void projectId; void sessionId;
      return opts.operations ?? [];
    }),
    createOperation: jest.fn(async (projectId: string, body: any) => {
      operationsCreated.push({ projectId, body });
      return {
        id: `op-${operationsCreated.length}`,
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as OperationDto;
    }),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ projectId, sessionId, body });
      return { ...session, ...body, id: sessionId, project_id: projectId } as CaptureSessionDto;
    }),
    // Unused methods on this surface -- shape-compatible no-ops for the deps
    // injection point. The router only calls the four above.
    createCaptureSession: jest.fn(),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    createBaseline: jest.fn(),
    createBaselineItem: jest.fn(),
  };
  return { mock, operationsCreated, sessionPatches };
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
  // runManager has no clearAll; remove any leftover live entry under SESSION_ID.
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Test 1: POST /parse-oas happy path -- one Interface row resolves to a
// filesystem OAS file, the parser produces an inventory, and one operation
// row is written per parsed operation. The fixture has 3 operations
// (GET /pets, POST /pets, GET /pets/{id} -- inspected below).
// ---------------------------------------------------------------------------
test('parse-oas writes one operation row per parsed OAS operation', async () => {
  const interfaceRow: InterfaceDto = {
    id: 'iface-1',
    name: 'pet-api',
    spec_link: FIXTURE_OAS_PATH,
    architecture_id: ARCH_ID,
  };
  const session = buildSession({ status: 'draft', mutating_calls_confirmed: true });
  const { mock, operationsCreated } = buildArchModelClientMock({
    session,
    interfaces: [interfaceRow],
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-1'] });

  expect(res.status).toBe(200);
  expect(res.body.sessionId).toBe(SESSION_ID);
  expect(res.body.operationCount).toBeGreaterThan(0);

  expect(mock.getCaptureSession).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID);
  expect(mock.listInterfacesForArchitecture).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID);
  expect(mock.createOperation).toHaveBeenCalledTimes(operationsCreated.length);

  // Every operation row carries the session id from the URL plus the parsed
  // OAS shape. With mutating_calls_confirmed=true, all rows land included.
  for (const { body } of operationsCreated) {
    expect(body.session_id).toBe(SESSION_ID);
    expect(typeof body.method).toBe('string');
    expect(typeof body.path).toBe('string');
    expect(typeof body.operation_id).toBe('string');
    expect(body.included).toBe(true);
  }

  // Inventory cached so /start can hand it to the orchestrator without a
  // second parse.
  expect(oasInventoryStore.has(SESSION_ID)).toBe(true);
  expect(oasInventoryStore.get(SESSION_ID)!.operations.length).toBe(operationsCreated.length);
});

// ---------------------------------------------------------------------------
// Test 2: POST /test-api-connection happy path. Mocked probe returns 200 ->
// success=true response. Verifies the endpoint sources base URL from the
// session DTO and pulls auth from the in-memory secrets bundle.
// ---------------------------------------------------------------------------
test('test-api-connection returns success when probe returns 2xx', async () => {
  const session = buildSession();
  const { mock } = buildArchModelClientMock({ session });

  // Stage in-memory secrets -- without these the route 409s.
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    loadedAt: Date.now(),
  });

  const probeArgs: Array<{ baseUrl: string; auth: any; defaultHeaders: any }> = [];
  const probe = jest.fn(async (args: any) => {
    probeArgs.push(args);
    return { status: 200, durationMs: 12 };
  });

  const app = buildApp({ archModelClient: mock as any, probeApiConnection: probe });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/test-api-connection?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    sessionId: SESSION_ID,
    success: true,
    status: 200,
    durationMs: 12,
  });
  expect(probe).toHaveBeenCalledTimes(1);
  expect(probeArgs[0].baseUrl).toBe(session.api_base_url);
  expect(probeArgs[0].auth.type).toBe('bearer');
  expect(probeArgs[0].auth.bearerToken).toBe('plaintext-token');
});

// ---------------------------------------------------------------------------
// Test 3: POST /test-db-connection happy path. Mocked PostgresAdapter's
// testConnection() resolves with { success: true, serverVersion: '...' };
// the route forwards that to the caller verbatim.
// ---------------------------------------------------------------------------
test('test-db-connection returns success when adapter.testConnection succeeds', async () => {
  const session = buildSession({
    db_config_redacted_json: {
      dbType: 'postgres',
      host: 'db.example.test',
      port: 5432,
      database: 'app',
      schema: 'public',
      username: 'reader',
    },
  });
  const { mock } = buildArchModelClientMock({ session });

  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'none' },
    db: { password: 'plaintext-pw' },
    loadedAt: Date.now(),
  });

  const disposeMock = jest.fn(async () => undefined);
  const fakeAdapter = {
    testConnection: jest.fn(async () => ({ success: true as const, serverVersion: 'PostgreSQL 16.0' })),
    listMetadata: jest.fn(),
    runReadonlySelect: jest.fn(),
    sampleValues: jest.fn(),
    dispose: disposeMock,
  };
  const factory: jest.Mock = jest.fn(() => fakeAdapter);

  const app = buildApp({ archModelClient: mock as any, createDbAdapter: factory as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/test-db-connection?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    sessionId: SESSION_ID,
    success: true,
    serverVersion: 'PostgreSQL 16.0',
  });
  // Adapter was built with the password from the in-memory bundle (not the
  // redacted json on the session).
  expect(factory).toHaveBeenCalledTimes(1);
  const firstCall = factory.mock.calls[0] as unknown as Array<{ password: string }>;
  expect(firstCall[0].password).toBe('plaintext-pw');
  expect(disposeMock).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Test 4: POST /start refuses to spawn the orchestrator when status is not
// 'configured'. Verifies the orchestrator was NOT spawned and the response
// echoes the offending status back to the caller.
// ---------------------------------------------------------------------------
test('start rejects with 409 when session status is not configured', async () => {
  const session = buildSession({ status: 'draft' });
  const { mock } = buildArchModelClientMock({ session });

  const spawn = jest.fn();

  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(409);
  expect(res.body.error.message).toContain("Status must be 'configured'");
  expect(res.body.error.currentStatus).toBe('draft');
  expect(spawn).not.toHaveBeenCalled();
  expect(mock.patchCaptureSession).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 5: POST /cancel patches status to 'cancelled' and clears the
// in-memory secrets bundle + cached OAS inventory + live runManager entry.
// ---------------------------------------------------------------------------
test('cancel sets status cancelled and purges secrets + inventory + runManager entry', async () => {
  const session = buildSession({ status: 'running' });
  const { mock, sessionPatches } = buildArchModelClientMock({ session });

  // Pre-stage everything cancel should clean up.
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: 'fake', version: '1' });
  runManager.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
  const liveState = runManager.get(SESSION_ID)!;
  expect(liveState.abortController.signal.aborted).toBe(false);

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/cancel?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('cancelled');

  // Status patch went out
  expect(sessionPatches).toHaveLength(1);
  expect(sessionPatches[0].body.status).toBe('cancelled');
  expect(sessionPatches[0].body.completed_at).toBeTruthy();

  // In-memory state cleared
  expect(secretsStore.has(SESSION_ID)).toBe(false);
  expect(oasInventoryStore.has(SESSION_ID)).toBe(false);
  // runManager.cancel() flips the abort signal but doesn't remove the entry
  // (the orchestrator itself does that on terminal). Verify abort fired.
  expect(liveState.abortController.signal.aborted).toBe(true);
});

// ---------------------------------------------------------------------------
// Bug fix (2026-05-17): parse-oas skip-on-missing-spec_link behaviour.
//
// Previously the route hard-failed with 400 the moment any selected
// interface lacked a spec_link, blocking SOAP / non-OAS interfaces. The
// new behaviour is "log + skip + continue" so the wizard can reach Step 4
// and the user defines those operations manually (or via Phase A
// pre-population from existing endpoint candidates).
// ---------------------------------------------------------------------------

test('parse-oas skips interfaces with no spec_link and reports them in the response', async () => {
  const withSpec: InterfaceDto = {
    id: 'iface-rest',
    name: 'rest-api',
    spec_link: FIXTURE_OAS_PATH,
    architecture_id: ARCH_ID,
  };
  const noSpec: InterfaceDto = {
    id: 'iface-soap',
    name: 'legacy-soap-api',
    spec_link: null,
    architecture_id: ARCH_ID,
  };
  const session = buildSession({ status: 'draft', mutating_calls_confirmed: true });
  const { mock, operationsCreated } = buildArchModelClientMock({
    session,
    interfaces: [withSpec, noSpec],
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-rest', 'iface-soap'] });

  // Pre-fix this returned 400. Post-fix it succeeds and reports the skip.
  expect(res.status).toBe(200);
  expect(res.body.skippedInterfaceCount).toBe(1);
  expect(res.body.skippedInterfaceIds).toEqual(['iface-soap']);

  // The REST interface's OAS still parses + persists; the SOAP one is
  // skipped and (in this test, with no endpoint candidates wired) adds
  // zero rows.
  expect(operationsCreated.length).toBeGreaterThan(0);
  for (const { body } of operationsCreated) {
    expect(body.session_id).toBe(SESSION_ID);
  }

  // The pre-population helper was still invoked (zero candidates -> no
  // synthesised rows). The mock's call log confirms the wiring.
  expect(mock.listEndpointsForInterface).toHaveBeenCalledWith(
    PROJECT_ID,
    ARCH_ID,
    'iface-soap',
  );
});

// ---------------------------------------------------------------------------
// Fix 5 Phase A: pre-populate Step 4 from existing endpoint candidates.
//
// When an interface is skipped (no spec_link) but the architecture model
// already carries `endpoints` entities for it (typically emitted by the
// code-discovery framework adapter), parse-oas synthesises
// ParsedOasOperation rows from those entities so they land in AMS as
// operation rows. The user reviews them on Step 4 alongside any OAS-derived
// ops.
// ---------------------------------------------------------------------------

test('parse-oas pre-populates skipped interfaces from existing endpoint entities', async () => {
  const noSpec: InterfaceDto = {
    id: 'iface-rest-no-spec',
    name: 'controller-derived-rest',
    spec_link: null,
    architecture_id: ARCH_ID,
  };
  const endpointEntities = [
    {
      id: 'ep-1',
      name: 'getOrder',
      interface_id: 'iface-rest-no-spec',
      operation_verb: 'GET',
      path_or_address: '/orders/{id}',
      description: 'Fetch a single order',
    },
    {
      id: 'ep-2',
      name: 'placeOrder',
      interface_id: 'iface-rest-no-spec',
      operation_verb: 'POST',
      path_or_address: '/orders',
      description: null,
    },
  ];
  const session = buildSession({ status: 'draft', mutating_calls_confirmed: true });
  const { mock, operationsCreated } = buildArchModelClientMock({
    session,
    interfaces: [noSpec],
    endpointsByInterface: { 'iface-rest-no-spec': endpointEntities },
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-rest-no-spec'] });

  expect(res.status).toBe(200);
  expect(res.body.skippedInterfaceCount).toBe(1);

  // Two endpoint entities -> two synthesised operation rows persisted.
  expect(operationsCreated).toHaveLength(2);
  const verbs = operationsCreated.map((c) => c.body.method);
  expect(verbs).toEqual(expect.arrayContaining(['GET', 'POST']));
  // Path / summary carry through from the entity fields.
  const paths = operationsCreated.map((c) => c.body.path);
  expect(paths).toEqual(expect.arrayContaining(['/orders/{id}', '/orders']));
  // Synthesised rows carry a minimal `oas_operation_json` with a source
  // marker so a future diagnostic can spot candidate-derived rows.
  for (const { body } of operationsCreated) {
    expect(body.oas_operation_json).toBeTruthy();
    expect((body.oas_operation_json as Record<string, unknown>)['x-amvs-source'])
      .toBe('discovery-endpoint-candidate');
  }
});

// ---------------------------------------------------------------------------
// Fix 3 (2026-06-05): no-zombie guarantee on /start.
//
// The orchestrator spawn is fire-and-forget. Errors that escape the
// orchestrator SETUP (before its internal try/catch) -- e.g. the
// `Unsupported dbType: undefined` throw from the field-name bug -- previously
// only hit a `console.error` in the `.catch`, so the session it had just
// patched to `running` was never moved to a terminal state and sat as a
// RUNNING zombie. The fix patches the session to `failed` in that `.catch`.
//
// This test injects a `spawnOrchestrator` that REJECTS and asserts the
// route's `.catch` flips the session to `failed` (status + error_message +
// completed_at). The patch runs as a microtask after the 202 response, so we
// poll the captured patch log until it appears.
// ---------------------------------------------------------------------------

/** Wait until `predicate()` is true, polling the microtask/timer queue. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('start flips the session to failed when the orchestrator spawn rejects (no RUNNING zombie)', async () => {
  const session = buildSession({ status: 'configured' });
  const { mock, sessionPatches } = buildArchModelClientMock({ session });

  // The route fetches migration discovery context (fail-soft) before spawning.
  // Provide a benign stub so that path does not generate a warning that could
  // mask the assertion target.
  (mock as unknown as Record<string, unknown>).getMigrationDiscoveryContext = jest.fn(
    async () => ({ highPriorityFindings: [], evidenceHighlights: [], contextWarnings: [] }),
  );

  // Pre-stage the two preconditions /start requires before it will spawn.
  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: 'fake', version: '1' });

  // The orchestrator throws on SETUP -> its returned promise REJECTS. This is
  // exactly the gap the in-loop self-patch never covers.
  const spawn = jest.fn(async () => {
    throw new Error('Unsupported dbType: undefined');
  });

  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ includeDiscoveryContext: false });

  // The route still returns 202 (running) -- the failure surfaces out-of-band.
  expect(res.status).toBe(202);
  expect(res.body.status).toBe('running');
  expect(spawn).toHaveBeenCalledTimes(1);

  // The crux of Fix 3: the fire-and-forget `.catch` patches the session to a
  // terminal `failed` state. Without the fix this patch never fires and the
  // session stays RUNNING forever.
  await waitFor(() => sessionPatches.some((p) => p.body.status === 'failed'));

  const failedPatch = sessionPatches.find((p) => p.body.status === 'failed');
  expect(failedPatch).toBeDefined();
  expect(failedPatch!.sessionId).toBe(SESSION_ID);
  expect(failedPatch!.body.error_message).toContain('Unsupported dbType: undefined');
  expect(failedPatch!.body.completed_at).toBeTruthy();

  // Exactly two patches went out: the initial `running`, then the terminal
  // `failed`. (Guards against a double-failed patch or a missing running one.)
  const statuses = sessionPatches.map((p) => p.body.status);
  expect(statuses).toEqual(['running', 'failed']);
});
