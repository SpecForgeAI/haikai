/**
 * Capture-session `/extract-endpoints` action endpoint tests.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * Task Group 6, sub-task 6.2 / 6.3.
 *
 * The route hosts the Workstream A explicit "Extract endpoints with LLM"
 * Step 4 button. This file pins the four wire-shape branches the frontend
 * relies on:
 *
 *   1. Happy path -- propose tool returns operations; the route forwards
 *      them verbatim under `status: 'ok'`.
 *   2. Malformed-twice -- propose tool returns `{ malformed: true, ... }`;
 *      the route responds with 200 + `status: 'malformed'` + empty
 *      `operations` so the frontend can show the "review manually" toast.
 *   3. Clone-evicted -- propose tool returns `{ cloneEvicted: true, ... }`
 *      (the discovery-service source endpoint emitted 410 Gone for the
 *      cached run); the route responds with 200 + `status: 'clone_evicted'`
 *      so the frontend can disable the trigger button.
 *   4. Server-side 60-second deadline -- the propose tool is artificially
 *      slow; the route responds with 202 + `status: 'still_working'` so the
 *      socket releases while the background tool keeps running.
 *
 * The route's tool dependency is injected so we never spin up a real LLM
 * round-trip; the timeout-path test uses a tiny `extractEndpointsTimeoutMs`
 * deps override so the suite doesn't hold open for a real 60s.
 */

import express from 'express';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import type {
  ProposeEndpointsArgs,
  ProposeEndpointsResult,
} from '../services/tools/propose_endpoints_from_code';
import type { CaptureSessionDto } from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';
const INTERFACE_ID = 'iface-soap-1';
const RUN_ID = 'run-xyz-1';

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

function buildArchModelClientMock() {
  return {
    getCaptureSession: jest.fn(async () => buildSession()),
    listInterfacesForArchitecture: jest.fn(async () => []),
    listEndpointsForInterface: jest.fn(async () => []),
    listOperationsBySession: jest.fn(async () => []),
    createOperation: jest.fn(),
    patchCaptureSession: jest.fn(),
    createCaptureSession: jest.fn(),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    createBaseline: jest.fn(),
    createBaselineItem: jest.fn(),
  };
}

function buildApp(deps: Parameters<typeof buildCaptureSessionActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter(deps));
  return app;
}

// ---------------------------------------------------------------------------
// Test 1: Happy path. Tool returns two operations + zero warnings.
// ---------------------------------------------------------------------------
test('extract-endpoints returns 200 + status=ok with the tool operation list', async () => {
  const mock = buildArchModelClientMock();
  const operations = [
    {
      operationName: 'getAccount',
      soapAction: 'urn:GetAccount',
      requestRootElement: 'GetAccountRequest',
      responseRootElement: 'GetAccountResponse',
      confidence: 0.9,
      confidence_tier: 'default' as const,
    },
    {
      operationName: 'createOrder',
      soapAction: 'urn:CreateOrder',
      requestRootElement: 'CreateOrderRequest',
      responseRootElement: 'CreateOrderResponse',
      confidence: 0.85,
      confidence_tier: 'default' as const,
    },
  ];
  const proposeEndpointsFromCode = jest.fn(
    async (_args: ProposeEndpointsArgs): Promise<ProposeEndpointsResult> => ({
      operations,
      warnings: [],
    }),
  );

  const app = buildApp({
    archModelClient: mock as any,
    proposeEndpointsFromCode,
  });
  const res = await request(app)
    .post(
      `/api/capture-sessions/${SESSION_ID}/extract-endpoints` +
        `?projectId=${PROJECT_ID}&architectureId=${ARCH_ID}`,
    )
    .send({
      interfaceId: INTERFACE_ID,
      discoveryRunId: RUN_ID,
      sourceFilePaths: ['src/main/java/com/foo/FooServlet.java'],
      parentServiceName: 'foo-service',
      parentInterfaceName: 'FooSoapApi',
    });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    sessionId: SESSION_ID,
    status: 'ok',
    operations,
    warnings: [],
  });

  // Tool was invoked exactly once with the wire-bound triple + the source
  // paths the body supplied.
  expect(proposeEndpointsFromCode).toHaveBeenCalledTimes(1);
  const toolArgs = proposeEndpointsFromCode.mock.calls[0][0];
  expect(toolArgs.interfaceCandidateId).toBe(INTERFACE_ID);
  expect(toolArgs.runId).toBe(RUN_ID);
  expect(toolArgs.projectId).toBe(PROJECT_ID);
  expect(toolArgs.architectureId).toBe(ARCH_ID);
  expect(toolArgs.sessionId).toBe(SESSION_ID);
  expect(toolArgs.sourceFilePaths).toEqual([
    'src/main/java/com/foo/FooServlet.java',
  ]);
  expect(toolArgs.parentServiceName).toBe('foo-service');
  expect(toolArgs.parentInterfaceName).toBe('FooSoapApi');
});

// ---------------------------------------------------------------------------
// Test 2: Malformed-twice path. The propose tool already swallowed the
// retry; it surfaces `malformed: true` plus warnings. The route translates
// that into a 200 with `status: 'malformed'` and empty operations so the
// frontend can fire the "LLM extraction failed -- review manually" toast.
// ---------------------------------------------------------------------------
test('extract-endpoints returns 200 + status=malformed + empty operations + warnings on malformed-twice', async () => {
  const mock = buildArchModelClientMock();
  const warnings = [
    'LLM returned malformed JSON twice; emitted evidence_gap finding.',
  ];
  const proposeEndpointsFromCode = jest.fn(
    async (): Promise<ProposeEndpointsResult> => ({
      operations: [],
      warnings,
      malformed: true,
    }),
  );

  const app = buildApp({
    archModelClient: mock as any,
    proposeEndpointsFromCode,
  });
  const res = await request(app)
    .post(
      `/api/capture-sessions/${SESSION_ID}/extract-endpoints` +
        `?projectId=${PROJECT_ID}&architectureId=${ARCH_ID}`,
    )
    .send({
      interfaceId: INTERFACE_ID,
      discoveryRunId: RUN_ID,
    });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    sessionId: SESSION_ID,
    status: 'malformed',
    operations: [],
    warnings,
  });
});

// ---------------------------------------------------------------------------
// Test 3: Clone-evicted path. The discovery-service source endpoint returned
// 410 Gone for the cached clone, so the tool short-circuits with
// `cloneEvicted: true`. The route translates that into a 200 with
// `status: 'clone_evicted'`; the body carries the runId so the frontend can
// display the secondary "Source no longer cached -- re-run discovery" text.
// ---------------------------------------------------------------------------
test('extract-endpoints returns 200 + status=clone_evicted when the source clone was GC-evicted', async () => {
  const mock = buildArchModelClientMock();
  const warnings = [
    `Source no longer cached -- discovery-service returned 410 Gone for runId=${RUN_ID}.`,
  ];
  const proposeEndpointsFromCode = jest.fn(
    async (): Promise<ProposeEndpointsResult> => ({
      operations: [],
      warnings,
      cloneEvicted: true,
    }),
  );

  const app = buildApp({
    archModelClient: mock as any,
    proposeEndpointsFromCode,
  });
  const res = await request(app)
    .post(
      `/api/capture-sessions/${SESSION_ID}/extract-endpoints` +
        `?projectId=${PROJECT_ID}&architectureId=${ARCH_ID}`,
    )
    .send({
      interfaceId: INTERFACE_ID,
      discoveryRunId: RUN_ID,
    });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    sessionId: SESSION_ID,
    status: 'clone_evicted',
    operations: [],
    warnings,
    runId: RUN_ID,
  });
});

// ---------------------------------------------------------------------------
// Test 4: Server-side 60-second deadline (W-15). When the propose tool runs
// longer than `extractEndpointsTimeoutMs`, the route releases the socket
// with a 202 + `status: 'still_working'` envelope. The tool keeps running in
// the background; Group 7 owns the late-landing emit path.
//
// We inject `extractEndpointsTimeoutMs: 25` so the test resolves promptly.
// ---------------------------------------------------------------------------
test('extract-endpoints returns 202 + status=still_working when the propose tool exceeds the server-side deadline', async () => {
  const mock = buildArchModelClientMock();
  // Stub: a promise that never resolves within the test window. We
  // deliberately do NOT pre-resolve it -- the deadline must win the race.
  const proposeEndpointsFromCode = jest.fn(
    (): Promise<ProposeEndpointsResult> =>
      new Promise<ProposeEndpointsResult>(() => {
        /* never resolves */
      }),
  );

  const app = buildApp({
    archModelClient: mock as any,
    proposeEndpointsFromCode,
    extractEndpointsTimeoutMs: 25,
  });
  const res = await request(app)
    .post(
      `/api/capture-sessions/${SESSION_ID}/extract-endpoints` +
        `?projectId=${PROJECT_ID}&architectureId=${ARCH_ID}`,
    )
    .send({
      interfaceId: INTERFACE_ID,
      discoveryRunId: RUN_ID,
    });

  expect(res.status).toBe(202);
  expect(res.body).toEqual({
    sessionId: SESSION_ID,
    status: 'still_working',
    message: 'Still working -- refresh in a minute',
  });
  expect(proposeEndpointsFromCode).toHaveBeenCalledTimes(1);
});
