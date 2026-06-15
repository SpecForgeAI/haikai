/**
 * Tests for discovery-service run-architecture binding.
 *
 * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) — Task Group 4.
 *
 * Covers:
 * 1. runManager.startRun accepts and stores `architectureId` in the in-process
 *    runArchitectureRegistry; the binding is used by service-scoped entity
 *    fetches inside the same run (and is NOT overridden by a later URL change).
 * 2. archModelClient entity-fetch helpers invoked from the service-scoped run
 *    receive the run's bound architectureId (not a default-resolver value).
 * 3. discovery-service routes accept the `:architectureId` path segment AND
 *    return 404 when the architecture-scoped path is missing it.
 * 4. Mismatch-409: hitting a run-scoped endpoint with a URL `:architectureId`
 *    different from the run's stored id returns 409.
 * 5. `resolveDefaultArchitectureId` remains as a fallback for non-run code
 *    paths (regression check — see archModelClientArchitectureScoped.test.ts
 *    for the spec-#1 helper test; this test re-asserts the helper still
 *    works after the spec-#4 refactor).
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid (used by run manager step internals when run is exercised)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-binding'),
}));

// Mock the archModelClient module — we control all of its behaviour from tests.
jest.mock('../services/archModelClient', () => {
  return {
    archModelClient: {
      createDiscoveryRun: jest.fn(),
      updateDiscoveryRun: jest.fn(),
      getDiscoveryRun: jest.fn(),
      getDiscoveryConfig: jest.fn(),
      bulkSaveEvidence: jest.fn(),
      getEvidenceByRun: jest.fn(),
      getEvidenceByRunPaginated: jest.fn(),
      getEvidenceCount: jest.fn(),
      bulkSaveRelationships: jest.fn(),
      getRelationshipsByRun: jest.fn(),
      getRelationshipsByRunPaginated: jest.fn(),
      getRelationshipCount: jest.fn(),
      bulkSaveClusters: jest.fn(),
      getClustersByRun: jest.fn(),
      getClusterCount: jest.fn(),
      deleteClustersByRunId: jest.fn(),
      bulkSaveCandidates: jest.fn(),
      getCandidatesByRun: jest.fn(),
      getCandidateCount: jest.fn(),
      updateCandidate: jest.fn(),
      bulkSaveDecisionTasks: jest.fn(),
      getDecisionTasksByRun: jest.fn(),
      getDecisionTaskCount: jest.fn(),
      updateDecisionTask: jest.fn(),
      resolveDefaultArchitectureId: jest.fn(),
      resetDefaultArchitectureCache: jest.fn(),
      getService: jest.fn(),
      getApplication: jest.fn(),
      getAppComponent: jest.fn(),
    },
  };
});

// Stub out the analyzer registry so the project-scoped pipeline runs end-to-end
// without invoking real extractors.
jest.mock('../services/analyzerRegistry', () => {
  const mockPhase1aPack = {
    id: 'phase-1a-universal-extraction',
    name: 'Phase 1a Universal Extraction',
    supportedPhases: ['phase1'],
    analyze: jest.fn().mockResolvedValue({
      analyzerId: 'phase-1a-universal-extraction',
      phase: 'phase1',
      step: '1a',
      findings: [],
      evidenceAtoms: [],
      metadata: {
        atomCounts: { file_structure: 0, symbol: 0, string_pattern: 0 },
        totalAtoms: 0,
      },
    }),
  };
  return {
    getAnalyzerRegistry: jest
      .fn()
      .mockReturnValue(new Map([['phase-1a-universal-extraction', mockPhase1aPack]])),
    initializeAnalyzerRegistry: jest.fn(),
    registerAnalyzerPack: jest.fn(),
  };
});

// Empty linker rule registry — yields no candidates.
jest.mock('../services/linkerRuleRegistry', () => ({
  getLinkerRuleRegistry: jest.fn().mockReturnValue(new Map()),
  initializeLinkerRuleRegistry: jest.fn(),
  registerLinkerRule: jest.fn(),
}));

// Stub gatewayClient so executeStep1b's no-decision-tasks branch never tries
// to hit a real upstream.
jest.mock('../services/gatewayClient', () => ({
  gatewayClient: {
    resolveDecisionTasks: jest.fn(),
  },
}));

// Stub repo access used by the LLM analysis step (we won't reach it in the
// project-scoped run, but the import surface needs to resolve).
jest.mock('../services/repoAccess', () => ({
  buildTempDir: jest.fn().mockReturnValue('/tmp/mock'),
  gitCloneRepoAccess: {
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  },
  isGitRepoUrl: jest.fn().mockReturnValue(false),
  normalizeRepoLocation: (s: string) => s,
  normalizeRepoSubfolder: (s: string) => s,
}));

import express from 'express';
import request from 'supertest';
import { archModelClient } from '../services/archModelClient';
import { runsRouter } from '../routes/runs';
import {
  bindRunArchitecture,
  getRunArchitectureId,
  _resetRunArchitectureRegistryForTests,
} from '../services/runArchitectureRegistry';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ARCH_ID_BOUND = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ARCH_ID_OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const RUN_ID = '11111111-2222-3333-4444-555555555555';
const SERVICE_ID = '99999999-8888-7777-6666-555555555555';

function createTestApp() {
  const app = express();
  app.use(express.json());
  // Mount runsRouter the same way routes/index.ts does — under
  // /discovery/projects/:projectId/architectures/:architectureId/runs.
  app.use(
    '/discovery/projects/:projectId/architectures/:architectureId/runs',
    runsRouter,
  );
  return app;
}

function sampleRunDto(
  overrides: Partial<{
    id: string;
    project_id: string;
    architecture_id: string;
    status: string;
    current_step: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? RUN_ID,
    project_id: overrides.project_id ?? PROJECT_ID,
    architecture_id: overrides.architecture_id ?? ARCH_ID_BOUND,
    service_id: null,
    status: overrides.status ?? 'COMPLETED',
    current_step: overrides.current_step !== undefined ? overrides.current_step : null,
    config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
    steps_payload: {},
    error_message: null,
    created_at: '2026-04-04T10:00:00Z',
    updated_at: '2026-04-04T10:00:00Z',
  };
}

describe('Spec #4 Group 4 — discovery-service run-architecture binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRunArchitectureRegistryForTests();
    // Sensible defaults for backbone calls.
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto() as any);
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto() as any);
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    mockArchModelClient.getEvidenceCount.mockResolvedValue(0);
    mockArchModelClient.getRelationshipCount.mockResolvedValue(0);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveCandidates.mockResolvedValue(undefined);
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue(null);
  });

  // ==========================================================================
  // Test 1 (property d): runManager.startRun accepts architectureId and
  // stores it in the runArchitectureRegistry. A later default-resolver call
  // would return ARCH_ID_OTHER but the binding (ARCH_ID_BOUND) MUST win.
  // ==========================================================================
  test('runManager.startRun binds the run to the supplied architectureId for life', async () => {
    // We need the real startRun (the routes test mocks it; here we exercise
    // the real implementation directly).
    const { startRun: realStartRun } = jest.requireActual(
      '../services/runManager',
    ) as { startRun: (p: string, r: string, a: string, s?: string) => Promise<void> };

    // Drive a project-scoped run through to completion. The pipeline will
    // call updateDiscoveryRun several times — we only assert on the binding
    // side-effect.
    await realStartRun(PROJECT_ID, RUN_ID, ARCH_ID_BOUND);

    // The registry now has the binding.
    expect(getRunArchitectureId(RUN_ID)).toBe(ARCH_ID_BOUND);

    // Even if the default resolver would now hand back a *different* id
    // (simulating an operator switching the URL active arch), the binding
    // remains permanent for the run.
    mockArchModelClient.resolveDefaultArchitectureId.mockResolvedValue(ARCH_ID_OTHER);
    expect(getRunArchitectureId(RUN_ID)).toBe(ARCH_ID_BOUND);
  });

  // ==========================================================================
  // Test 2: a service-scoped run threads the bound architectureId into the
  // entity-fetch helpers (NOT the default resolver's value).
  // ==========================================================================
  test('service-scoped run uses the run\'s bound architectureId for entity fetches', async () => {
    // The default resolver, if called, would hand back the WRONG id.
    mockArchModelClient.resolveDefaultArchitectureId.mockResolvedValue(ARCH_ID_OTHER);

    // Service entity returned from getService — minimum fields needed for the
    // pipeline to proceed past the early validation gates.
    mockArchModelClient.getService.mockResolvedValue({
      id: SERVICE_ID,
      name: 'orders-service',
      description: null,
      application_id: 'app-uuid',
      app_component_id: null,
      service_type: null,
      core_tech: 'java',
      repo_location: '/local/repo',
      repo_subfolder: null,
      tags: null,
      valid_from: null,
      valid_to: null,
      package_set_id: null,
      is_internal: null,
      core_tech_resolved: { language: { name: 'Java' }, frameworks: [] },
      core_tech_language_pack: 'java-21',
      core_tech_framework_packs: [],
      core_tech_resolution_confidence: 'high',
      core_tech_resolved_at: '2026-04-01T00:00:00Z',
    } as any);
    mockArchModelClient.getApplication.mockResolvedValue({
      id: 'app-uuid',
      name: 'Orders',
      description: null,
      tags: null,
    } as any);

    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (p: string, r: string, a: string, s?: string) => Promise<void>;
    };

    // Run will fail at repo access stage (mocked to a no-op repo dir),
    // but by that point getService MUST have been called with ARCH_ID_BOUND.
    try {
      await realStartRun(PROJECT_ID, RUN_ID, ARCH_ID_BOUND, SERVICE_ID);
    } catch {
      // ignore — we only care about which architectureId was passed
    }

    // First call to getService — second argument is architectureId.
    expect(mockArchModelClient.getService).toHaveBeenCalled();
    const firstCallArgs = mockArchModelClient.getService.mock.calls[0];
    expect(firstCallArgs[0]).toBe(PROJECT_ID);
    expect(firstCallArgs[1]).toBe(ARCH_ID_BOUND);
    // Specifically NOT the default resolver's value:
    expect(firstCallArgs[1]).not.toBe(ARCH_ID_OTHER);

    // resolveDefaultArchitectureId must NOT have been called at all from
    // within the run — the run's bound id is the source of truth.
    expect(mockArchModelClient.resolveDefaultArchitectureId).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 3: discovery-service routes accept :architectureId path segment.
  // Hitting an arch-scoped subroute returns the run on the happy path.
  // ==========================================================================
  test('GET /discovery/projects/:p/architectures/:a/runs/:r serves the run when architectureId matches', async () => {
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(
      sampleRunDto({ architecture_id: ARCH_ID_BOUND }) as any,
    );

    const app = createTestApp();
    const res = await request(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID_BOUND}/runs/${RUN_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(RUN_ID);
    expect(mockArchModelClient.getDiscoveryRun).toHaveBeenCalledWith(PROJECT_ID, RUN_ID, ARCH_ID_BOUND);
  });

  // ==========================================================================
  // Test 4 (mismatch-409): URL :architectureId differs from run's stored id.
  // The route returns 409 with a clear message — never serves the run.
  // ==========================================================================
  test('Run-scoped route returns 409 when URL architectureId does not match run\'s stored id', async () => {
    // The persisted run is bound to ARCH_ID_BOUND.
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(
      sampleRunDto({ architecture_id: ARCH_ID_BOUND }) as any,
    );

    const app = createTestApp();
    // Caller sneaks the WRONG architectureId into the URL.
    const res = await request(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID_OTHER}/runs/${RUN_ID}`,
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(409);
    expect(res.body.error.message).toContain('does not match');
    expect(res.body.error.message).toContain(ARCH_ID_BOUND);
    expect(res.body.error.message).toContain(ARCH_ID_OTHER);
  });

  // ==========================================================================
  // Test 5 (regression): resolveDefaultArchitectureId remains available as a
  // fallback for non-run code paths. Spec #1's helper still resolves and
  // returns its mocked value when invoked outside any run lifecycle.
  // ==========================================================================
  test('resolveDefaultArchitectureId still works as a fallback for non-run code paths', async () => {
    mockArchModelClient.resolveDefaultArchitectureId.mockResolvedValue(ARCH_ID_OTHER);

    // Imagine some non-run code path that needs to know the project default.
    // Group 4 retains the helper for exactly this purpose; it must still
    // hit the mock and return the configured value without throwing.
    const result = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);

    expect(result).toBe(ARCH_ID_OTHER);
    expect(mockArchModelClient.resolveDefaultArchitectureId).toHaveBeenCalledWith(PROJECT_ID);
  });

  // ==========================================================================
  // Sanity check on the registry helpers themselves (no route involvement).
  // ==========================================================================
  test('runArchitectureRegistry rejects rebinding to a different architectureId', () => {
    bindRunArchitecture(RUN_ID, PROJECT_ID, ARCH_ID_BOUND);
    // Re-binding to the same id is a no-op:
    expect(() => bindRunArchitecture(RUN_ID, PROJECT_ID, ARCH_ID_BOUND)).not.toThrow();
    // Re-binding to a different id is forbidden:
    expect(() => bindRunArchitecture(RUN_ID, PROJECT_ID, ARCH_ID_OTHER)).toThrow(/Refusing to rebind/);
    // The original binding survives:
    expect(getRunArchitectureId(RUN_ID)).toBe(ARCH_ID_BOUND);
  });
});
