/**
 * Migration Discovery Context -- Group 6 cross-stack tests
 * (api-migration-validation-service slice).
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration (Task Group 6).
 *
 * These tests close strategic gaps that the per-group tests left open:
 *
 *   1. AMS-emitted `contextWarnings` (e.g. `high_severity_unreviewed_findings`)
 *      from the aggregation response reach the 202 `warnings[]` array so the
 *      wizard can surface readiness signals alongside the local fail-soft
 *      `context_unavailable` marker. The aggregation contract emits these
 *      warnings; we already test the local fail-soft path -- this proves the
 *      AMS-driven propagation works end-to-end.
 *
 *   2. The capture-session row is NOT mutated to carry a `discoveryContextSummary`
 *      (or any discovery-context payload) during /start. Per shaping note,
 *      persistence is deferred to v2. The patch must only flip status fields.
 *      This guards against accidental schema growth in future refactors.
 *
 *   3. The `maxFindings` / `maxEvidenceItems` count caps the wizard sends in
 *      the /start body are forwarded verbatim to AMS via the
 *      `getMigrationDiscoveryContext` client call (no clamping, no defaults).
 *      Proves the v1 count-bound (100/100) contract holds end-to-end from the
 *      wizard's submission shape down to AMS request body.
 */

import express from 'express';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type {
  CaptureSessionDto,
  MigrationDiscoveryContextDto,
} from '../services/archModelClient';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = '00000000-0000-0000-0000-0000000000a1';
const ARCH_ID = '00000000-0000-0000-0000-0000000000b1';
const SESSION_ID = '00000000-0000-0000-0000-0000000000c1';

function buildSessionDto(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'cross-stack-session',
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
    summary: 'cross-stack-mock-context',
    contextWarnings: [],
    highPriorityFindings: [],
    evidenceHighlights: [],
    unresolvedDecisionTasks: [],
    ...overrides,
  };
}

function buildArchModelClientMock(opts: {
  session?: CaptureSessionDto;
  discoveryContext?: MigrationDiscoveryContextDto;
  discoveryError?: Error;
} = {}) {
  const session = opts.session ?? buildSessionDto();
  const sessionPatches: Array<{ projectId: string; sessionId: string; body: any }> = [];
  const discoveryCalls: Array<{ projectId: string; body: any }> = [];

  const mock = {
    getCaptureSession: jest.fn(async () => session),
    listInterfacesForArchitecture: jest.fn(async () => []),
    listOperationsBySession: jest.fn(async () => []),
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

function buildSpawn() {
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
  return { spawn, spawnCalls };
}

// ---------------------------------------------------------------------------
// Cross-stack test 1: AMS-emitted contextWarnings reach the 202 warnings[]
// ---------------------------------------------------------------------------
test(
  'start: AMS-emitted contextWarnings propagate into the 202 response warnings[] array',
  async () => {
    const session = buildSessionDto({ status: 'configured' });
    // AMS reports two distinct readiness-style warning codes for the wizard
    // to surface. The /start route forwards these alongside the local
    // `context_unavailable` warning (which is NOT raised here -- happy path).
    const ctxDto = buildDiscoveryContextDto({
      summary: 'context-with-warnings',
      contextWarnings: [
        'high_severity_unreviewed_findings',
        'no_database_discovery_findings',
      ],
    });
    const { mock } = buildArchModelClientMock({ session, discoveryContext: ctxDto });

    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
    oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });

    const { spawn, spawnCalls } = buildSpawn();
    const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });

    const res = await request(app)
      .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
      .send({});

    expect(res.status).toBe(202);
    // The two AMS-emitted warnings round-trip; `context_unavailable` is NOT
    // appended because the aggregation call succeeded.
    expect(res.body.warnings).toEqual([
      'high_severity_unreviewed_findings',
      'no_database_discovery_findings',
    ]);
    expect(res.body.warnings).not.toContain('context_unavailable');

    // Orchestrator still receives the context (warnings are informational --
    // the prompt is enriched, not blocked).
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawnCalls[0].deps.discoveryContext).toBe(ctxDto);
  }
);

// ---------------------------------------------------------------------------
// Cross-stack test 2: /start does NOT persist discoveryContext to the session row
// ---------------------------------------------------------------------------
test(
  'start: PATCH to capture session row carries only status fields -- no discoveryContextSummary, ' +
    'no discoveryContext payload (persistence deferral guard)',
  async () => {
    const session = buildSessionDto({ status: 'configured' });
    const ctxDto = buildDiscoveryContextDto({
      summary: 'must-not-persist',
      highPriorityFindings: [
        {
          findingId: 'finding-no-persist',
          runId: 'run-1',
          findingType: 'missing_contract_detail',
          category: 'business_logic',
          severity: 'high',
          status: 'needs_review',
          title: 'should-stay-runtime-only',
          summary: null,
          source: null,
          confidence: 0.9,
        },
      ],
    });
    const { mock, sessionPatches } = buildArchModelClientMock({
      session,
      discoveryContext: ctxDto,
    });

    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
    oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });

    const { spawn } = buildSpawn();
    const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });

    const res = await request(app)
      .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
      .send({ discoveryRunIds: ['run-1'] });

    expect(res.status).toBe(202);

    // Exactly one PATCH was issued (the status -> running transition).
    expect(mock.patchCaptureSession).toHaveBeenCalledTimes(1);
    expect(sessionPatches).toHaveLength(1);

    const patchedBody = sessionPatches[0].body;
    // Status fields the route is allowed to set.
    expect(patchedBody.status).toBe('running');
    expect(patchedBody.started_at).toEqual(expect.any(String));
    expect(patchedBody.error_message).toBeNull();

    // Discovery payload MUST NOT leak into the persisted row. None of these
    // keys may appear on the PATCH body.
    expect(patchedBody.discoveryContext).toBeUndefined();
    expect(patchedBody.discoveryContextSummary).toBeUndefined();
    expect(patchedBody.discoveryContextDto).toBeUndefined();
    expect(patchedBody.discoveryRunIds).toBeUndefined();
    expect(patchedBody.discoveryFindings).toBeUndefined();

    // Belt-and-braces: dump the PATCH body keys to a sorted list and assert
    // nothing in that list contains the substring "discovery".
    const allKeys = Object.keys(patchedBody);
    expect(
      allKeys.filter((k) => k.toLowerCase().includes('discovery'))
    ).toEqual([]);

    // Orchestrator did still get the runtime context.
    expect(spawn).toHaveBeenCalledTimes(1);
  }
);

// ---------------------------------------------------------------------------
// Cross-stack test 3: maxFindings / maxEvidenceItems forwarded to AMS verbatim
// ---------------------------------------------------------------------------
test(
  'start: maxFindings and maxEvidenceItems from the start body are forwarded to AMS verbatim ' +
    '(end-to-end count-bound contract)',
  async () => {
    const session = buildSessionDto({ status: 'configured' });
    const { mock, discoveryCalls } = buildArchModelClientMock({ session });

    secretsStore.set({ sessionId: SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() });
    oasInventoryStore.set(SESSION_ID, { operations: [], title: null, version: null });

    const { spawn } = buildSpawn();
    const app = buildApp({ archModelClient: mock as any, spawnOrchestrator: spawn as any });

    // The wizard submits 100/100 by default per the v1 contract, but we use
    // distinctive values (33/77) to prove pass-through rather than a defaults
    // substitution at any layer.
    const res = await request(app)
      .post(`/api/capture-sessions/${SESSION_ID}/start?projectId=${PROJECT_ID}`)
      .send({
        discoveryRunIds: ['run-1'],
        maxFindings: 33,
        maxEvidenceItems: 77,
      });

    expect(res.status).toBe(202);

    expect(mock.getMigrationDiscoveryContext).toHaveBeenCalledTimes(1);
    expect(discoveryCalls).toHaveLength(1);

    const sentBody = discoveryCalls[0].body;
    expect(sentBody.currentArchitectureId).toBe(ARCH_ID);
    expect(sentBody.discoveryRunIds).toEqual(['run-1']);
    expect(sentBody.maxFindings).toBe(33);
    expect(sentBody.maxEvidenceItems).toBe(77);

    expect(spawn).toHaveBeenCalledTimes(1);
  }
);
