/**
 * Migration Discovery Context integration tests.
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 3
 * sub-task 3.1.
 *
 * Covers:
 *   1. `archModelClient.getMigrationDiscoveryContext` issues POST to the
 *      expected AMS endpoint with the expected body shape.
 *   2. `POST /capture-sessions/:id/start` happy path -- successful AMS fetch
 *      -> orchestrator spawned WITH `discoveryContext` -> 202 response
 *      surfaces session row.
 *   3. /start fail-soft when AMS is unreachable (network error) -- 202
 *      includes `context_unavailable` in `warnings[]` and the orchestrator
 *      is spawned WITHOUT context (still runs).
 *   4. /start fail-soft when AMS returns 404 -- same fail-soft behaviour.
 *   5. /start skip path -- `includeDiscoveryContext: false` -> AMS not
 *      called, orchestrator spawned without context.
 *   6. `buildScenarioPrompt` appends Discovery Context section when present.
 *   7. `buildScenarioPrompt` omits Discovery Context section when absent
 *      (no regression for the no-discovery capture flow).
 *   8. `buildScenarioPrompt` filters Discovery Context for the current
 *      operation (per-operation match only).
 *   9. `buildScenarioPrompt` includes the explicit "do not invent behaviour"
 *      prompt guard.
 *  10. `buildScenarioPrompt` falls back to session-wide highlights when no
 *      per-operation match lands (small bounded slice, no per-op flag).
 */

import express from 'express';
import request from 'supertest';
import axios from 'axios';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { oasInventoryStore } from '../services/oasInventoryStore';
import { ArchModelClient } from '../services/archModelClient';
import { buildScenarioPrompt } from '../services/captureSessionOrchestrator';
import type {
  CaptureSessionDto,
  MigrationDiscoveryContextDto,
  OperationDto,
} from '../services/archModelClient';
import type { CaptureSession } from '../types/captureSession';

// ---------------------------------------------------------------------------
// Common fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = '00000000-0000-0000-0000-000000000aaa';
const ARCH_ID = '00000000-0000-0000-0000-000000000bbb';
const SESSION_ID = '00000000-0000-0000-0000-000000000ccc';

function buildSessionDto(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
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

function buildDiscoveryContextDto(
  overrides: Partial<MigrationDiscoveryContextDto> = {},
): MigrationDiscoveryContextDto {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: null,
    discoveryRunIds: [],
    apiBehaviourBaselineIds: [],
    generatedAt: new Date().toISOString(),
    summary: 'mock-context',
    contextWarnings: [],
    highPriorityFindings: [],
    evidenceHighlights: [],
    unresolvedDecisionTasks: [],
    ...overrides,
  };
}

function buildSessionDomain(): CaptureSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    name: 'test',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: 'https://api.example.test',
    authType: 'bearer',
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: true,
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildArchModelClientMock(opts: {
  session?: CaptureSessionDto;
  operations?: OperationDto[];
  discoveryContext?: MigrationDiscoveryContextDto;
  discoveryError?: Error;
} = {}) {
  const session = opts.session ?? buildSessionDto();
  const sessionPatches: Array<{ projectId: string; sessionId: string; body: any }> = [];
  const discoveryCalls: Array<{ projectId: string; body: any }> = [];

  const mock = {
    getCaptureSession: jest.fn(async () => session),
    listInterfacesForArchitecture: jest.fn(async () => []),
    listOperationsBySession: jest.fn(async () => opts.operations ?? []),
    createOperation: jest.fn(),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ projectId, sessionId, body });
      return { ...session, ...body, id: sessionId, project_id: projectId } as CaptureSessionDto;
    }),
    getMigrationDiscoveryContext: jest.fn(async (projectId: string, body: any) => {
      discoveryCalls.push({ projectId, body });
      if (opts.discoveryError) throw opts.discoveryError;
      return opts.discoveryContext ?? buildDiscoveryContextDto();
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
    createCaptureSession: jest.fn(),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    createBaseline: jest.fn(),
    createBaselineItem: jest.fn(),
  };
  return { mock, sessionPatches, discoveryCalls };
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

afterEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Test 1: archModelClient.getMigrationDiscoveryContext URL + body shape.
// ---------------------------------------------------------------------------
describe('archModelClient.getMigrationDiscoveryContext', () => {
  test('issues POST to /api/projects/{projectId}/migration-discovery-context with the expected body shape', async () => {
    // We instantiate a fresh ArchModelClient and intercept its internal axios
    // instance to assert URL + method + body verbatim.
    const client = new ArchModelClient();
    const internal = (client as any).client; // AxiosInstance
    const postSpy = jest.spyOn(internal, 'post').mockResolvedValue({
      data: buildDiscoveryContextDto(),
    });

    const reqBody = {
      currentArchitectureId: ARCH_ID,
      discoveryRunIds: ['run-1', 'run-2'],
      maxFindings: 50,
      maxEvidenceItems: 25,
    };
    const result = await client.getMigrationDiscoveryContext(PROJECT_ID, reqBody);

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body] = postSpy.mock.calls[0] as unknown as [string, any];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/migration-discovery-context`);
    expect(body).toEqual({
      currentArchitectureId: ARCH_ID,
      discoveryRunIds: ['run-1', 'run-2'],
      maxFindings: 50,
      maxEvidenceItems: 25,
    });
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.currentArchitectureId).toBe(ARCH_ID);
    postSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 2: /start happy path -- successful AMS fetch -> orchestrator gets
// discoveryContext via the new deps field.
// ---------------------------------------------------------------------------
test('start: AMS fetch succeeds -> orchestrator spawned WITH discoveryContext, 202 returned', async () => {
  const session = buildSessionDto({ status: 'configured' });
  const ctxDto = buildDiscoveryContextDto({
    summary: 'happy-path-context',
    highPriorityFindings: [
      {
        findingId: 'finding-1',
        runId: 'run-1',
        findingType: 'missing_contract_detail',
        category: 'business_logic',
        severity: 'high',
        status: 'needs_review',
        title: 'Endpoint GET /pets/{id} returns 404 without body',
        summary: null,
        source: null,
        confidence: 0.9,
      },
    ],
  });
  const { mock, discoveryCalls } = buildArchModelClientMock({
    session,
    discoveryContext: ctxDto,
  });

  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });

  const spawnCalls: Array<{ session: any; deps: any }> = [];
  const spawn = jest.fn(async (s: any, d: any) => {
    spawnCalls.push({ session: s, deps: d });
    return {
      sessionId: s.id,
      scenariosAttempted: 0,
      scenariosCompleted: 0,
      scenariosErrored: 0,
      finalStatus: 'completed' as const,
      errorMessage: null,
    };
  });

  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ discoveryRunIds: ['run-1'] });

  expect(res.status).toBe(202);
  expect(res.body.id).toBe(SESSION_ID);
  expect(res.body.warnings).toEqual([]);

  // AMS aggregation was called exactly once with the session's arch id +
  // user-supplied run filter.
  expect(mock.getMigrationDiscoveryContext).toHaveBeenCalledTimes(1);
  expect(discoveryCalls).toHaveLength(1);
  expect(discoveryCalls[0].projectId).toBe(PROJECT_ID);
  expect(discoveryCalls[0].body.currentArchitectureId).toBe(ARCH_ID);
  expect(discoveryCalls[0].body.discoveryRunIds).toEqual(['run-1']);

  // Orchestrator received the fetched context.
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawnCalls[0].deps.discoveryContext).toBe(ctxDto);
});

// ---------------------------------------------------------------------------
// Test 3: /start fail-soft -- AMS unreachable (network failure).
// ---------------------------------------------------------------------------
test('start: AMS unreachable -> 202 with warning context_unavailable, orchestrator spawned WITHOUT context', async () => {
  const session = buildSessionDto({ status: 'configured' });
  const networkErr = new Error('ECONNREFUSED');
  const { mock } = buildArchModelClientMock({ session, discoveryError: networkErr });

  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });

  const spawnCalls: Array<{ session: any; deps: any }> = [];
  const spawn = jest.fn(async (s: any, d: any) => {
    spawnCalls.push({ session: s, deps: d });
    return {
      sessionId: s.id,
      scenariosAttempted: 0,
      scenariosCompleted: 0,
      scenariosErrored: 0,
      finalStatus: 'completed' as const,
      errorMessage: null,
    };
  });

  // Suppress the expected console.warn for clean test output.
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(202);
  expect(res.body.warnings).toEqual(['context_unavailable']);

  // Orchestrator still spawned, but without discoveryContext.
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawnCalls[0].deps.discoveryContext).toBeUndefined();
  // The session WAS still patched to running -- fail-soft must not block.
  expect(mock.patchCaptureSession).toHaveBeenCalledTimes(1);

  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Test 4: /start fail-soft -- AMS returns 404 (architecture mismatch, etc.).
// ---------------------------------------------------------------------------
test('start: AMS returns 404 -> 202 with warning context_unavailable, orchestrator spawned WITHOUT context', async () => {
  const session = buildSessionDto({ status: 'configured' });
  const httpErr: any = new Error('Request failed with status code 404');
  httpErr.response = { status: 404, data: { error: 'Not found' } };
  const { mock } = buildArchModelClientMock({ session, discoveryError: httpErr });

  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });

  const spawnCalls: Array<{ session: any; deps: any }> = [];
  const spawn = jest.fn(async (s: any, d: any) => {
    spawnCalls.push({ session: s, deps: d });
    return {
      sessionId: s.id,
      scenariosAttempted: 0,
      scenariosCompleted: 0,
      scenariosErrored: 0,
      finalStatus: 'completed' as const,
      errorMessage: null,
    };
  });

  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(202);
  expect(res.body.warnings).toEqual(['context_unavailable']);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawnCalls[0].deps.discoveryContext).toBeUndefined();

  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Test 5: /start skip path -- includeDiscoveryContext=false.
// ---------------------------------------------------------------------------
test('start: includeDiscoveryContext=false -> AMS NOT called, orchestrator spawned without context', async () => {
  const session = buildSessionDto({ status: 'configured' });
  const { mock } = buildArchModelClientMock({ session });

  secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
  oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });

  const spawnCalls: Array<{ session: any; deps: any }> = [];
  const spawn = jest.fn(async (s: any, d: any) => {
    spawnCalls.push({ session: s, deps: d });
    return {
      sessionId: s.id,
      scenariosAttempted: 0,
      scenariosCompleted: 0,
      scenariosErrored: 0,
      finalStatus: 'completed' as const,
      errorMessage: null,
    };
  });

  const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
    .send({ includeDiscoveryContext: false });

  expect(res.status).toBe(202);
  expect(res.body.warnings).toEqual([]);
  expect(mock.getMigrationDiscoveryContext).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawnCalls[0].deps.discoveryContext).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Test 6: buildScenarioPrompt appends Discovery Context section when present.
// ---------------------------------------------------------------------------
test('buildScenarioPrompt: appends Discovery Context section when discoveryContext is present', () => {
  const session = buildSessionDomain();
  const ctxDto = buildDiscoveryContextDto({
    highPriorityFindings: [
      {
        findingId: 'finding-1',
        runId: 'run-1',
        findingType: 'missing_contract_detail',
        category: 'business_logic',
        severity: 'high',
        status: 'needs_review',
        title: 'GET /pets/{id} response shape incomplete',
        summary: null,
        source: null,
        confidence: 0.9,
      },
    ],
  });

  const messages = buildScenarioPrompt(session, 'getPetById', 'happy_path', 'GET', '/pets/{id}', ctxDto);
  expect(messages).toHaveLength(2);
  const userMsg = messages[1];
  expect(userMsg.role).toBe('user');
  const parsed = JSON.parse(userMsg.content as string);
  expect(parsed.discoveryContext).toBeDefined();
  expect(parsed.discoveryContext.highPriorityFindings).toHaveLength(1);
  expect(parsed.discoveryContext.highPriorityFindings[0].findingId).toBe('finding-1');
});

// ---------------------------------------------------------------------------
// Test 7: buildScenarioPrompt omits Discovery Context section when absent.
// ---------------------------------------------------------------------------
test('buildScenarioPrompt: omits Discovery Context section when no context provided (no regression)', () => {
  const session = buildSessionDomain();
  // No discoveryContext arg -> no discoveryContext field.
  const messages = buildScenarioPrompt(session, 'getPetById', 'happy_path', 'GET', '/pets/{id}');
  expect(messages).toHaveLength(2);
  const parsed = JSON.parse(messages[1].content as string);
  expect(parsed.discoveryContext).toBeUndefined();
  // Existing fields still present.
  expect(parsed.sessionId).toBe(SESSION_ID);
  expect(parsed.operationId).toBe('getPetById');
});

// ---------------------------------------------------------------------------
// Test 8: buildScenarioPrompt filters Discovery Context for the current op.
// ---------------------------------------------------------------------------
test('buildScenarioPrompt: filters findings to those matching the current operation', () => {
  const session = buildSessionDomain();
  const ctxDto = buildDiscoveryContextDto({
    highPriorityFindings: [
      // Match: path appears in title.
      {
        findingId: 'finding-matches',
        runId: 'run-1',
        findingType: 'missing_contract_detail',
        category: 'business_logic',
        severity: 'high',
        status: 'needs_review',
        title: 'GET /pets/{id} returns 404 without body',
        summary: null,
        source: null,
        confidence: 0.9,
      },
      // No-match: refers to a different endpoint.
      {
        findingId: 'finding-unrelated',
        runId: 'run-1',
        findingType: 'runtime_usage',
        category: 'runtime_usage',
        severity: 'medium',
        status: 'accepted',
        title: 'POST /orders called from legacy worker',
        summary: 'No relation to pets endpoint',
        source: null,
        confidence: 0.6,
      },
    ],
  });

  const messages = buildScenarioPrompt(session, 'getPetById', 'happy_path', 'GET', '/pets/{id}', ctxDto);
  const parsed = JSON.parse(messages[1].content as string);
  expect(parsed.discoveryContext.perOperationMatched).toBe(true);
  const ids = parsed.discoveryContext.highPriorityFindings.map((f: any) => f.findingId);
  expect(ids).toContain('finding-matches');
  expect(ids).not.toContain('finding-unrelated');
});

// ---------------------------------------------------------------------------
// Test 9: buildScenarioPrompt frames discovery context as AUTHORITATIVE for
// input formats/conventions (reframed guidance: prefer a discovered value over
// a guess), NOT passive "do not invent" supporting evidence.
// ---------------------------------------------------------------------------
test('buildScenarioPrompt: frames discovery context as authoritative for input formats', () => {
  const session = buildSessionDomain();
  const ctxDto = buildDiscoveryContextDto({
    highPriorityFindings: [
      {
        findingId: 'finding-1',
        runId: 'run-1',
        findingType: 'missing_contract_detail',
        category: 'business_logic',
        severity: 'high',
        status: 'needs_review',
        title: 'irrelevant',
        summary: null,
        source: null,
        confidence: 0.9,
      },
    ],
  });
  const messages = buildScenarioPrompt(session, 'getPetById', 'happy_path', 'GET', '/pets/{id}', ctxDto);
  const parsed = JSON.parse(messages[1].content as string);
  const guard: string = parsed.discoveryContext.guidance;
  expect(guard).toContain('AUTHORITATIVE');
  expect(guard.toLowerCase()).toContain('prefer a discovered concrete value');
});

// ---------------------------------------------------------------------------
// Test 11 (fix 5 + Kiro #1/#2): buildScenarioPrompt threads cross-scenario
// learned facts -- now BOTH directions. The guidance must teach the LLM to
// REUSE `OK`/`OK id:` lines AND to AVOID the inputs on `FAILED` lines.
// ---------------------------------------------------------------------------
test('buildScenarioPrompt: threads cross-scenario learned facts (reuse OK, avoid FAILED) into the prompt', () => {
  const session = buildSessionDomain();
  const facts = [
    'OK GET /pets/{id} -> 200 query={"date":"01-JAN-2024"}',
    'OK id: hierarchyNodeId=90000 (from GET /search)',
    'FAILED: GET /pets query={"date":"2026-06-17"} -> 400 Invalid format: 2026-06-17 is malformed',
  ];
  const messages = buildScenarioPrompt(
    session,
    'getPetById',
    'happy_path',
    'GET',
    '/pets/{id}',
    undefined,
    undefined,
    facts,
  );
  const parsed = JSON.parse(messages[1].content as string);
  expect(parsed.knownGood).toBeDefined();
  expect(parsed.knownGood.examples).toEqual(facts);
  const guidance = String(parsed.knownGood.guidance);
  // Reuse direction: working OK values/formats + prefer a surfaced id.
  expect(guidance).toContain('REUSE');
  expect(guidance).toContain('OK');
  // Avoid direction (Kiro #1): the prompt now teaches the LLM to skip the
  // inputs the API already rejected, instead of re-guessing them.
  expect(guidance).toContain('AVOID');
  expect(guidance).toContain('FAILED');
  expect(guidance.toLowerCase()).toContain('rejected by the api');
});

// ---------------------------------------------------------------------------
// Test 10: buildScenarioPrompt falls back to session-wide highlights when no
// per-operation match lands.
// ---------------------------------------------------------------------------
test('buildScenarioPrompt: falls back to session-wide highlights when no per-operation match', () => {
  const session = buildSessionDomain();
  const ctxDto = buildDiscoveryContextDto({
    highPriorityFindings: [
      // None mention the operation under test.
      {
        findingId: 'finding-other-1',
        runId: 'run-1',
        findingType: 'runtime_usage',
        category: 'runtime_usage',
        severity: 'medium',
        status: 'accepted',
        title: 'Some other endpoint usage',
        summary: null,
        source: null,
        confidence: 0.6,
      },
      {
        findingId: 'finding-other-2',
        runId: 'run-1',
        findingType: 'data_quality',
        category: 'data_quality',
        severity: 'low',
        status: 'accepted',
        title: 'Unrelated data quality issue',
        summary: null,
        source: null,
        confidence: 0.7,
      },
    ],
  });

  const messages = buildScenarioPrompt(session, 'getPetById', 'happy_path', 'GET', '/pets/{id}', ctxDto);
  const parsed = JSON.parse(messages[1].content as string);
  expect(parsed.discoveryContext.perOperationMatched).toBe(false);
  // Both still surface (small bounded slice fallback).
  const ids = parsed.discoveryContext.highPriorityFindings.map((f: any) => f.findingId);
  expect(ids).toContain('finding-other-1');
  expect(ids).toContain('finding-other-2');
});

// Silence axios's unhandled-rejection log noise from test 1 if any teardown
// happens after the spy is restored. No-op assertion to keep jest from
// flagging an unused import.
test('axios is imported (sanity)', () => {
  expect(typeof axios).toBe('function');
});
