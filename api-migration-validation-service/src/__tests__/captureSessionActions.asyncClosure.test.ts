/**
 * Async coverage closure (2026-09-02).
 *
 * `retry-uncovered` used to run its multi-minute closure INSIDE the request
 * handler; the gateway's proxy fetch timed out at ~5 minutes and surfaced a
 * false `503 "service unavailable"` banner while the run completed fine in
 * the background. The route now answers 202 for a viable run and records
 * progress in `closureRunStore`; `GET /closure-status` is the poll surface.
 *
 * Pins:
 *   - configuration errors still fail INSTANTLY with their original statuses
 *     (409 SECRETS_NOT_LOADED here), with no run recorded;
 *   - an already-complete gate still answers the old synchronous 200 shape;
 *   - a viable run answers 202 {closureRunId} and the status transitions
 *     running -> completed carrying the exact synchronous-era result body,
 *     with the coverage patch persisted;
 *   - a second launch while one is running is refused (409
 *     CLOSURE_ALREADY_RUNNING);
 *   - a background failure lands as status 'failed' with the error;
 *   - closure-status with no record is 404 NO_CLOSURE_RUN (restart case —
 *     the durable outcome lives on the session row).
 */

import express from 'express';
import request from 'supertest';

import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { oasInventoryStore } from '../services/oasInventoryStore';
import { closureRunStore } from '../services/closureRunStore';
import { runManager } from '../services/runManager';
import type { CaptureSessionDto } from '../services/archModelClient';
import type { SecretsBundle } from '../types/secrets';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000dd';

/** The real CoverageSummary shape (mirrors captureClosureDriver.test.ts). */
function happyDim(achieved: boolean): Record<string, unknown> {
  return {
    name: 'happy_path',
    type: 'happy_path',
    expected_status: 'success',
    dimension_kind: 'happy',
    reported_only: false,
    achieved,
    canonical_capture_id: achieved ? 'existing' : null,
    reason: achieved ? null : 'missing',
    observation: null,
  };
}

function summaryOf(achieved: boolean): Record<string, unknown> {
  return {
    overall_score: achieved ? 1 : 0.5,
    dimensions_total: 2,
    dimensions_achieved: achieved ? 2 : 1,
    per_endpoint: [
      {
        operation_id: 'listWidgets',
        method: 'GET',
        // No path params, so Pass A has no id candidates and the run
        // completes fast under the mocked client.
        path: '/widgets',
        score: achieved ? 1 : 0,
        dimensions: [happyDim(achieved)],
      },
    ],
    auth_coverage: { achieved: true, representative_operation_id: null, probes: [] },
    observations: [],
  };
}

const summaryWithUnresolved = () => summaryOf(false);
const summaryComplete = () => summaryOf(true);

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'async-closure',
    status: 'completed',
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
    coverage_summary_json: summaryWithUnresolved(),
    ...overrides,
  } as CaptureSessionDto;
}

function buildArchMock(session: CaptureSessionDto) {
  return {
    getCaptureSession: jest.fn().mockResolvedValue(session),
    listOperationsBySession: jest.fn().mockResolvedValue([]),
    listDiscoveryRuns: jest.fn().mockResolvedValue([]),
    patchCaptureSession: jest.fn().mockResolvedValue(session),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
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

/** Poll the status route until terminal (bounded — the mocked run is fast). */
async function pollUntilTerminal(app: express.Express): Promise<request.Response> {
  for (let i = 0; i < 40; i++) {
    const res = await request(app).get(
      `/api/capture-sessions/${SESSION_ID}/closure-status?projectId=${PROJECT_ID}`,
    );
    if (res.status !== 200 || res.body.status !== 'running') return res;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('closure run never reached a terminal status');
}

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  closureRunStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

test('guard failures stay SYNCHRONOUS: no secrets -> 409, no run recorded', async () => {
  const app = buildApp({ archModelClient: buildArchMock(buildSession()) as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/retry-uncovered?projectId=${PROJECT_ID}`)
    .send({ config: [] });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('SECRETS_NOT_LOADED');
  expect(closureRunStore.get(SESSION_ID)).toBeUndefined();
});

test('an already-complete gate still answers the old synchronous 200 shape', async () => {
  seedSecret();
  const app = buildApp({
    archModelClient: buildArchMock(
      buildSession({ coverage_summary_json: summaryComplete() } as never),
    ) as any,
  });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/retry-uncovered?projectId=${PROJECT_ID}`)
    .send({ config: [] });

  expect(res.status).toBe(200);
  expect(res.body.gate.complete).toBe(true);
  expect(res.body.passA).toEqual({ fired: 0, closed: [] });
  expect(res.body.accepted).toBeUndefined();
  expect(closureRunStore.get(SESSION_ID)).toBeUndefined();
});

test('a viable run answers 202 and the status transitions to completed with the full result', async () => {
  seedSecret();
  const mock = buildArchMock(buildSession());
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/retry-uncovered?projectId=${PROJECT_ID}`)
    .send({ config: [{ operationId: 'listWidgets', attempts: 3, notes: '' }] });

  expect(res.status).toBe(202);
  expect(res.body.accepted).toBe(true);
  expect(typeof res.body.closureRunId).toBe('string');
  expect(res.body.sessionId).toBe(SESSION_ID);

  const terminal = await pollUntilTerminal(app);
  expect(terminal.status).toBe(200);
  expect(terminal.body.status).toBe('completed');
  expect(terminal.body.closureRunId).toBe(res.body.closureRunId);
  // The exact synchronous-era result body rides on the poll.
  expect(terminal.body.result.sessionId).toBe(SESSION_ID);
  expect(terminal.body.result.passA).toBeDefined();
  expect(terminal.body.result.passB.available).toBe(false); // no inventory, no op rows
  expect(terminal.body.result.gate).toBeDefined();
  expect(terminal.body.error).toBeNull();
  // The durable coverage patch persisted at end of run.
  expect(mock.patchCaptureSession).toHaveBeenCalledTimes(1);
});

test('a second launch while one is running is refused with 409 CLOSURE_ALREADY_RUNNING', async () => {
  seedSecret();
  const app = buildApp({ archModelClient: buildArchMock(buildSession()) as any });

  // Simulate an in-flight run (the store is the guard's source of truth).
  closureRunStore.begin(SESSION_ID, 'closure-inflight');

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/retry-uncovered?projectId=${PROJECT_ID}`)
    .send({ config: [] });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('CLOSURE_ALREADY_RUNNING');
  expect(res.body.error.closureRunId).toBe('closure-inflight');
});

test('a background failure lands as status=failed carrying the error', async () => {
  seedSecret();
  const mock = buildArchMock(buildSession());
  mock.listOperationsBySession.mockRejectedValue(new Error('AMS exploded'));
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/retry-uncovered?projectId=${PROJECT_ID}`)
    .send({ config: [] });
  expect(res.status).toBe(202);

  const terminal = await pollUntilTerminal(app);
  expect(terminal.body.status).toBe('failed');
  expect(terminal.body.error).toContain('AMS exploded');
  expect(terminal.body.result).toBeNull();
});

test('closure-status with NO record is 404 NO_CLOSURE_RUN (restart case)', async () => {
  const app = buildApp({ archModelClient: buildArchMock(buildSession()) as any });

  const res = await request(app).get(
    `/api/capture-sessions/${SESSION_ID}/closure-status?projectId=${PROJECT_ID}`,
  );

  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('NO_CLOSURE_RUN');
});
