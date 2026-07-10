/**
 * Target capture-session action endpoint tests.
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3
 * sub-task 3.1.
 *
 * Test inventory (3 tests):
 *   1. POST /target-capture-sessions -- creates a session with
 *      `kind='target'` set server-side and `source_baseline_id` from the
 *      body persisted into the AMS payload.
 *   2. POST /target-capture-sessions/:id/start -- guards on the
 *      `kind='target'` discriminator (rejects a current-state session id
 *      with 400), then transitions to running and dispatches to
 *      `runTargetReplay` (NOT `orchestrateCaptureSession`).
 *   3. GET /target-capture-sessions/:id/status -- returns the session
 *      status with the live-runManager flag.
 */

import express from 'express';
import request from 'supertest';
import { buildTargetCaptureSessionActionsRouter } from '../routes/targetCaptureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { CaptureSessionDto } from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';

function buildSession(
  overrides: Partial<CaptureSessionDto> = {},
): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'target-1',
    status: 'draft',
    env_name: null,
    api_base_url: 'https://target.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: null,
    error_message: null,
    kind: 'target',
    source_baseline_id: SOURCE_BASELINE_ID,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildArchModelClientMock(overrides: {
  session?: CaptureSessionDto;
  createBaselineResult?: CaptureSessionDto;
} = {}) {
  const session = overrides.session ?? buildSession();
  const createdSessions: Array<{ projectId: string; body: Record<string, unknown> }> = [];
  const sessionPatches: Array<{
    projectId: string;
    sessionId: string;
    body: Record<string, unknown>;
  }> = [];

  const mock = {
    getCaptureSession: jest.fn(async () => session),
    createCaptureSession: jest.fn(
      async (projectId: string, body: Record<string, unknown>) => {
        createdSessions.push({ projectId, body });
        return {
          ...session,
          ...body,
          id: SESSION_ID,
          project_id: projectId,
        } as unknown as CaptureSessionDto;
      },
    ),
    patchCaptureSession: jest.fn(
      async (projectId: string, sessionId: string, body: Record<string, unknown>) => {
        sessionPatches.push({ projectId, sessionId, body });
        return {
          ...session,
          ...body,
          id: sessionId,
          project_id: projectId,
        } as unknown as CaptureSessionDto;
      },
    ),
    // Shape-compatible no-ops for parts of the deps surface we don't drive
    // in these tests.
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    getBaseline: jest.fn(),
    listBaselineItems: jest.fn(),
    createBaseline: jest.fn(),
    patchBaseline: jest.fn(),
    createCapture: jest.fn(),
    patchCapture: jest.fn(),
    createBaselineItem: jest.fn(),
    createDiagnostic: jest.fn(),
  };
  return { mock, createdSessions, sessionPatches };
}

function buildApp(deps: Parameters<typeof buildTargetCaptureSessionActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildTargetCaptureSessionActionsRouter(deps));
  return app;
}

beforeEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Test 1: create -- server sets kind='target', body's sourceBaselineId is
// forwarded into the AMS create payload as source_baseline_id.
// ---------------------------------------------------------------------------
test('POST /target-capture-sessions sets kind=target and persists sourceBaselineId', async () => {
  const { mock, createdSessions } = buildArchModelClientMock();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(`/api/target-capture-sessions?projectId=${PROJECT_ID}`)
    .send({
      architectureId: ARCH_ID,
      name: 'target-uat-replay',
      sourceBaselineId: SOURCE_BASELINE_ID,
      targetApiBaseUrl: 'https://target.example.test',
      authType: 'bearer',
      mutatingCallsConfirmed: true,
    });

  expect(res.status).toBe(201);
  expect(mock.createCaptureSession).toHaveBeenCalledTimes(1);
  expect(createdSessions).toHaveLength(1);
  expect(createdSessions[0].projectId).toBe(PROJECT_ID);
  expect(createdSessions[0].body.kind).toBe('target');
  expect(createdSessions[0].body.source_baseline_id).toBe(SOURCE_BASELINE_ID);
  expect(createdSessions[0].body.api_base_url).toBe(
    'https://target.example.test',
  );
  expect(createdSessions[0].body.mutating_calls_confirmed).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 1b: create rejects when required fields are missing.
// ---------------------------------------------------------------------------
test('POST /target-capture-sessions rejects missing required fields', async () => {
  const { mock } = buildArchModelClientMock();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = buildApp({ archModelClient: mock as any });

  // Missing architectureId
  let res = await request(app)
    .post(`/api/target-capture-sessions?projectId=${PROJECT_ID}`)
    .send({
      sourceBaselineId: SOURCE_BASELINE_ID,
      targetApiBaseUrl: 'https://x',
    });
  expect(res.status).toBe(400);
  expect(res.body.error.message).toContain('architectureId');

  // Missing sourceBaselineId
  res = await request(app)
    .post(`/api/target-capture-sessions?projectId=${PROJECT_ID}`)
    .send({
      architectureId: ARCH_ID,
      targetApiBaseUrl: 'https://x',
    });
  expect(res.status).toBe(400);
  expect(res.body.error.message).toContain('sourceBaselineId');

  // Missing projectId entirely
  res = await request(app)
    .post(`/api/target-capture-sessions`)
    .send({
      architectureId: ARCH_ID,
      sourceBaselineId: SOURCE_BASELINE_ID,
      targetApiBaseUrl: 'https://x',
    });
  expect(res.status).toBe(400);
  expect(res.body.error.message).toContain('projectId');
});

// ---------------------------------------------------------------------------
// Test 2: /start guards on kind, transitions to running, dispatches to
// runTargetReplay (NOT orchestrateCaptureSession). A current-state session
// is rejected with 400.
// ---------------------------------------------------------------------------
test('POST /target-capture-sessions/:id/start dispatches to runTargetReplay only for target sessions', async () => {
  // Stage 1: a current-state session is rejected.
  const currentSession = buildSession({ kind: 'current', source_baseline_id: null });
  const { mock: mockCurrent } = buildArchModelClientMock({ session: currentSession });
  const spawnRunner = jest.fn(async () => ({
    sessionId: SESSION_ID,
    targetBaselineId: 'tb-1',
    itemsTotal: 0,
    itemsReplayed: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    finalStatus: 'completed' as const,
    errorMessage: null,
    diagnostics: [],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app1 = buildApp({ archModelClient: mockCurrent as any, spawnRunner });
  let res = await request(app1)
    .post(`/api/target-capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});
  expect(res.status).toBe(400);
  expect(res.body.error.currentKind).toBe('current');
  expect(spawnRunner).not.toHaveBeenCalled();

  // Stage 2: a target session WITH loaded secrets transitions to running
  // and the runner is invoked.
  const targetSession = buildSession({ status: 'configured' });
  const { mock: mockTarget, sessionPatches } = buildArchModelClientMock({
    session: targetSession,
  });
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext' },
    loadedAt: Date.now(),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app2 = buildApp({ archModelClient: mockTarget as any, spawnRunner });
  res = await request(app2)
    .post(`/api/target-capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});
  expect(res.status).toBe(202);
  // Session was patched to running
  expect(sessionPatches.some((p) => p.body.status === 'running')).toBe(true);
  // runner was dispatched (fire-and-forget, awaited via the spawned promise)
  // -- give a tick for the .catch() chain to settle.
  await new Promise((r) => setTimeout(r, 5));
  expect(spawnRunner).toHaveBeenCalledTimes(1);
  // Spec 2026-07-06-i: an UNSCOPED start passes undefined runner deps —
  // the legacy full-replay contract, byte-identical to the pre-scope route.
  expect(spawnRunner).toHaveBeenCalledWith(SESSION_ID, undefined);
  // runManager has a live entry for the session
  expect(runManager.has(SESSION_ID)).toBe(true);

  // Stage 3: /start refuses to start without secrets loaded.
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  const { mock: mockTarget2 } = buildArchModelClientMock({
    session: buildSession({ status: 'configured' }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app3 = buildApp({ archModelClient: mockTarget2 as any, spawnRunner: jest.fn() });
  res = await request(app3)
    .post(`/api/target-capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('SECRETS_NOT_LOADED');
});

// ---------------------------------------------------------------------------
// Test 3: GET /status returns the session row + runManager liveness flag.
// ---------------------------------------------------------------------------
test('GET /target-capture-sessions/:id/status returns session status + liveness', async () => {
  const session = buildSession({ status: 'running' });
  const { mock } = buildArchModelClientMock({ session });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = buildApp({ archModelClient: mock as any });

  // No live run -- liveness=false
  let res = await request(app).get(
    `/api/target-capture-sessions/${SESSION_ID}/status?projectId=${PROJECT_ID}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.sessionId).toBe(SESSION_ID);
  expect(res.body.status).toBe('running');
  expect(res.body.isLiveInRunManager).toBe(false);

  // With a live runManager entry -- liveness=true
  runManager.start({
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
  });
  res = await request(app).get(
    `/api/target-capture-sessions/${SESSION_ID}/status?projectId=${PROJECT_ID}`,
  );
  expect(res.body.isLiveInRunManager).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 4 (bonus): startup-reconciliation parity assertion. The shipped
// `startupReconciliation.ts` is kind-agnostic; this test asserts that a
// kind='target' session in status='running' at boot time goes through the
// same `secrets_lost_during_run` patch path, with NO new code introduced.
// ---------------------------------------------------------------------------
jest.mock('../services/archModelClient', () => {
  return {
    archModelClient: {
      listAllCaptureSessionsByStatus: jest.fn(),
      patchCaptureSession: jest.fn(),
    },
  };
});

test('startup reconciliation marks kind=target running sessions failed with secrets_lost_during_run', async () => {
  // Note: This test must be in its own file to get the jest.mock isolation
  // correctly -- but we keep it here as a smoke / contract assertion: the
  // shipped reconciler scans by STATUS only and patches every running
  // session, whatever its kind. We import lazily so the mock above wires
  // up first.
  const { reconcileOrphanRunningSessions } = await import(
    '../services/startupReconciliation'
  );
  const { archModelClient } = await import('../services/archModelClient');
  const targetOrphan: CaptureSessionDto = buildSession({
    id: 'target-orphan',
    status: 'running',
    kind: 'target',
    source_baseline_id: SOURCE_BASELINE_ID,
  });
  const currentOrphan: CaptureSessionDto = buildSession({
    id: 'current-orphan',
    status: 'running',
    kind: 'current',
    source_baseline_id: null,
  });
  (archModelClient.listAllCaptureSessionsByStatus as jest.Mock).mockResolvedValue([
    targetOrphan,
    currentOrphan,
  ]);
  (archModelClient.patchCaptureSession as jest.Mock).mockImplementation(
    async (projectId: string, sessionId: string, body: unknown) => ({
      id: sessionId,
      project_id: projectId,
      ...(body as Record<string, unknown>),
    }),
  );

  const result = await reconcileOrphanRunningSessions();
  expect(result.scanned).toBe(2);
  expect(result.reconciled).toBe(2);

  const calls = (archModelClient.patchCaptureSession as jest.Mock).mock.calls;
  // BOTH orphans (target + current) received the same patch shape.
  for (const [, , body] of calls) {
    expect((body as Record<string, string>).status).toBe('failed');
    expect((body as Record<string, string>).error_message).toBe(
      'secrets_lost_during_run',
    );
  }
});

// ---------------------------------------------------------------------------
// Spec 2026-07-06-n (Tier-1 batch): target-DB creds → state-delta adapter.
//   - create persists the OPTIONAL dbConfigRedactedJson (config, NO password);
//   - /secrets accepts the OPTIONAL db password (in-memory only);
//   - /start builds the adapter (config + password) and passes it to the
//     runner deps; the route disposes it when the run settles;
//   - config-without-password (or vice versa) => NO adapter (fail-closed to
//     state_unverified, never a throw).
// ---------------------------------------------------------------------------

test('target-DB creds: config on create, password on secrets, adapter into the runner deps', async () => {
  const dbConfig = {
    dbType: 'postgres',
    host: 'pg.example.test',
    port: 5432,
    database: 'target_db',
    schema: null,
    username: 'replay',
  };
  const { mock, createdSessions } = buildArchModelClientMock({
    session: buildSession({ db_config_redacted_json: dbConfig }),
  });
  const disposed: string[] = [];
  const fakeAdapter = {
    testConnection: jest.fn(),
    listMetadata: jest.fn(),
    runReadonlySelect: jest.fn(),
    sampleValues: jest.fn(),
    dispose: jest.fn(async () => {
      disposed.push('yes');
    }),
  };
  const factoryCalls: Array<Record<string, unknown>> = [];
  const createDbAdapter = jest.fn((cfg: Record<string, unknown>) => {
    factoryCalls.push(cfg);
    return fakeAdapter;
  });
  const spawnRunner = jest.fn(
    async (_sessionId: string, _deps?: { dbAdapter?: unknown }) => ({}) as never,
  );
  const app = buildApp({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    spawnRunner,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createDbAdapter: createDbAdapter as any,
  });

  // Create: config rides the AMS payload (no password anywhere).
  const createRes = await request(app)
    .post(`/api/target-capture-sessions?projectId=${PROJECT_ID}`)
    .send({
      architectureId: ARCH_ID,
      sourceBaselineId: SOURCE_BASELINE_ID,
      targetApiBaseUrl: 'https://target.example.test',
      dbConfigRedactedJson: dbConfig,
    });
  expect(createRes.status).toBe(201);
  expect(createdSessions[0].body.db_config_redacted_json).toEqual(dbConfig);
  expect(JSON.stringify(createdSessions[0].body)).not.toContain('password');

  // Secrets: api + db password land in the in-memory bundle only.
  const secretsRes = await request(app)
    .post(`/api/target-capture-sessions/${SESSION_ID}/secrets`)
    .send({ api: { type: 'none' }, db: { password: 's3cret' } });
  expect(secretsRes.status).toBe(200);
  expect(secretsRes.body.dbLoaded).toBe(true);

  // Start: adapter built from config + password, passed to the runner deps.
  const startRes = await request(app)
    .post(`/api/target-capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});
  expect(startRes.status).toBe(202);
  await new Promise((r) => setTimeout(r, 5));
  expect(factoryCalls).toHaveLength(1);
  expect(factoryCalls[0]).toMatchObject({
    dbType: 'postgres',
    host: 'pg.example.test',
    port: 5432,
    database: 'target_db',
    username: 'replay',
    password: 's3cret',
  });
  const runnerDeps = spawnRunner.mock.calls[0][1] as { dbAdapter?: unknown } | undefined;
  expect(runnerDeps?.dbAdapter).toBe(fakeAdapter);
  // Route owns the lifecycle: disposed once the spawned run settled.
  await new Promise((r) => setTimeout(r, 5));
  expect(disposed).toEqual(['yes']);
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

test('target-DB creds: config without password (or neither) yields NO adapter', async () => {
  const dbConfig = {
    dbType: 'postgres',
    host: 'pg.example.test',
    port: 5432,
    database: 'target_db',
    username: 'replay',
  };
  const { mock } = buildArchModelClientMock({
    session: buildSession({ db_config_redacted_json: dbConfig }),
  });
  const createDbAdapter = jest.fn();
  const spawnRunner = jest.fn(
    async (_sessionId: string, _deps?: { dbAdapter?: unknown }) => ({}) as never,
  );
  const app = buildApp({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    spawnRunner,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createDbAdapter: createDbAdapter as any,
  });

  // Secrets WITHOUT a db password.
  await request(app)
    .post(`/api/target-capture-sessions/${SESSION_ID}/secrets`)
    .send({ api: { type: 'none' } });
  const startRes = await request(app)
    .post(`/api/target-capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});
  expect(startRes.status).toBe(202);
  await new Promise((r) => setTimeout(r, 5));
  expect(createDbAdapter).not.toHaveBeenCalled();
  // Legacy contract: no scope/purpose/adapter => undefined deps.
  expect(spawnRunner).toHaveBeenCalledWith(SESSION_ID, undefined);
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});
