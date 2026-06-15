/**
 * Tests for discovery-service run manager and run routes.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5), then reshaped by
 * Spec #4 (2026-05-01 Multi-Architecture Discovery Integration): the bare
 * `/discovery/runs` route was a HARD cutover to
 * `/discovery/projects/:projectId/architectures/:architectureId/runs`, and the
 * V3 pipeline restructure folded the former 1c (clustering) + 1d (candidate
 * generation) steps into a single LLM-driven `1c-llm-analysis` step.
 *
 * Focused tests covering:
 * - POST .../runs with a valid project + architecture returns 200 with run DTO
 * - POST .../runs with no discovery config returns 400 (missing prerequisite)
 * - GET .../runs/:runId returns 200 with run DTO (architectureId 3rd arg)
 * - GET .../runs/:runId returns 404 when not found
 * - runManager.startRun calls updateDiscoveryRun for each step and sets COMPLETED
 * - runManager.startRun sets FAILED and records error_message on step failure
 *
 * Gap Tests:
 * - Gap Test 3: runManager.startRun updates stepsPayload correctly at each transition
 * - Gap Test 4: POST .../runs returns the DTO immediately (fire-and-forget)
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid (needed by real executeStep1b)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-routes'),
}));

// Mock the archModelClient module (includes evidence, relationship, cluster, and decision task methods)
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
      getService: jest.fn(),
      // Methods added to archModelClient by committed specs that startRun /
      // the V3 LLM-analysis step now call. Defaults take the graceful/no-op path.
      resetDefaultArchitectureCache: jest.fn(),
      getModel: jest.fn().mockResolvedValue(null),
      getProject: jest.fn().mockResolvedValue(null),
      bulkCreateDiscoveryFindings: jest.fn().mockResolvedValue({ created: 0, findings: [] }),
    },
  };
});

// Mock the gateway client module (needed by real executeStep1b)
jest.mock('../services/gatewayClient', () => {
  return {
    gatewayClient: {
      resolveDecisionTasks: jest.fn(),
    },
  };
});

// Mock the repo-access seam so step `1c-llm-analysis` does NOT perform a real
// `git clone` of the fixture repo URL (which would fail on the network and turn
// the step into step_failed).
jest.mock('../services/repoAccess', () => ({
  gitCloneRepoAccess: {
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  },
  buildTempDir: jest.fn(() => '/tmp/routes-mock-repo'),
  isGitRepoUrl: jest.fn(() => true),
  normalizeRepoLocation: jest.fn((v: string) => v),
  normalizeRepoSubfolder: jest.fn((v: string) => v),
}));

// Mock the LLM file-analysis step so 1c-llm-analysis completes without invoking
// a real LLM. Empty candidates -> the persist + emit paths no-op.
jest.mock('../services/llmFileAnalysisStep', () => ({
  executeLlmFileAnalysis: jest.fn().mockResolvedValue({
    candidates: [],
    filesAnalyzed: 0,
    filesFailed: 0,
    evidenceCount: 0,
    findingInputs: [],
  }),
  sortCandidatesParentsFirst: jest.fn((c: unknown[]) => c),
}));

// Mock the analyzer registry so that 1a uses a mock pack returning empty atoms
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
  const mockStubPack = {
    id: 'stub-noop',
    name: 'Stub No-Op Analyzer',
    supportedPhases: ['phase0', 'phase1'],
    analyze: jest.fn().mockResolvedValue({
      analyzerId: 'stub-noop',
      phase: 'phase1',
      step: '1b',
      findings: [],
      metadata: { stub: true },
    }),
  };
  return {
    getAnalyzerRegistry: jest.fn().mockReturnValue(
      new Map([
        ['phase-1a-universal-extraction', mockPhase1aPack],
        ['stub-noop', mockStubPack],
      ])
    ),
    initializeAnalyzerRegistry: jest.fn(),
    registerAnalyzerPack: jest.fn(),
  };
});

// Mock the linker rule registry with an empty registry (no rules = no candidates)
jest.mock('../services/linkerRuleRegistry', () => {
  return {
    getLinkerRuleRegistry: jest.fn().mockReturnValue(new Map()),
    initializeLinkerRuleRegistry: jest.fn(),
    registerLinkerRule: jest.fn(),
  };
});


// Mock the runManager module for route tests (to prevent actual execution)
jest.mock('../services/runManager', () => {
  const original = jest.requireActual('../services/runManager');
  return {
    ...original,
    startRun: jest.fn().mockResolvedValue(undefined),
  };
});

import express from 'express';
import request from 'supertest';
import { archModelClient } from '../services/archModelClient';
import { discoveryRouter } from '../routes';

// We need the real startRun for unit tests -- import separately
// and use the unmocked version directly for runManager tests.

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;

const ARCH_ID = 'arch-001';

/**
 * Helper to create a test Express app.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/discovery', discoveryRouter);
  return app;
}

/**
 * Sample run DTO shape returned by archModelClient.
 */
function sampleRunDto(overrides: Partial<{
  id: string;
  project_id: string;
  status: string;
  current_step: string | null;
  architecture_id: string;
}> = {}) {
  return {
    id: overrides.id || 'run-uuid-001',
    project_id: overrides.project_id || '550e8400-e29b-41d4-a716-446655440000',
    service_id: null,
    mode: null,
    architecture_id: overrides.architecture_id ?? ARCH_ID,
    status: overrides.status || 'PENDING',
    current_step: overrides.current_step !== undefined ? overrides.current_step : null,
    config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
    steps_payload: {
      '1a': { status: 'pending' },
      '1b': { status: 'pending' },
      '1c-llm-analysis': { status: 'pending' },
    },
    error_message: null,
    created_at: '2026-04-04T10:00:00Z',
    updated_at: '2026-04-04T10:00:00Z',
  };
}

/**
 * Minimal discovery-config DTO so the project-scoped POST path reaches
 * `computeTier` and `createDiscoveryRun`. Empty techHints -> tier C.
 */
function sampleConfigDto() {
  return {
    id: 'config-uuid-001',
    project_id: '550e8400-e29b-41d4-a716-446655440000',
    service_id: null,
    config_payload: { repos: [{ url: 'https://github.com/example/repo' }], techHints: {} },
    status: 'ACTIVE',
    created_at: '2026-04-04T10:00:00Z',
    updated_at: '2026-04-04T10:00:00Z',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StepsPayload = Record<string, { status: string; [key: string]: any }>;

/**
 * Extracts the steps_payload from the third argument of an updateDiscoveryRun mock call.
 */
function getStepsPayload(callIndex: number): StepsPayload {
  const call = mockArchModelClient.updateDiscoveryRun.mock.calls[callIndex][2] as {
    steps_payload?: StepsPayload;
    status?: string;
    current_step?: string | null;
  };
  return call.steps_payload as StepsPayload;
}

function getCallArg(callIndex: number) {
  return mockArchModelClient.updateDiscoveryRun.mock.calls[callIndex][2] as {
    steps_payload?: StepsPayload;
    status?: string;
    current_step?: string | null;
    error_message?: string | null;
  };
}

describe('Run Manager and Run Routes', () => {
  let app: express.Express;
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const runsBase = `/discovery/projects/${'550e8400-e29b-41d4-a716-446655440000'}/architectures/${ARCH_ID}/runs`;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up default mock returns needed by executeStep('1a', ...)
    // getDiscoveryRun returns a valid run DTO so step 1a can read config_snapshot
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    // bulkSaveEvidence is a no-op by default
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    // Set up default returns for backbone step upstream count queries
    mockArchModelClient.getEvidenceCount.mockResolvedValue(0);
    mockArchModelClient.getRelationshipCount.mockResolvedValue(0);
    mockArchModelClient.getClusterCount.mockResolvedValue(0);
    // executeStep1b now uses getEvidenceByRun (returns empty array -> no candidates)
    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]);
    // 1c-llm-analysis fetches relationships via getRelationshipsByRun
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveClusters.mockResolvedValue(undefined);
    mockArchModelClient.deleteClustersByRunId.mockResolvedValue(0);
    mockArchModelClient.bulkSaveCandidates.mockResolvedValue(undefined);
    // Project-scoped POST reads the discovery config to compute the tier.
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue(sampleConfigDto());
  });

  // ==========================================================================
  // Test 1: POST .../runs with a valid project + architecture returns 200 with
  //         the created run DTO (additively enriched with mode/tier/warnings).
  // ==========================================================================
  test('POST .../runs with valid project + architecture returns 200 with run DTO', async () => {
    const mockRun = sampleRunDto({ project_id: projectId });
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(mockRun);

    // Empty techHints -> tier C, so opt-in is required to proceed past the gate.
    const res = await request(app)
      .post(runsBase)
      .send({ confirmLlmSolo: true });

    expect(res.status).toBe(200);
    // The route spreads the created run DTO and additively appends mode/tier/warnings.
    expect(res.body).toEqual(expect.objectContaining({
      id: 'run-uuid-001',
      status: 'PENDING',
      project_id: projectId,
    }));
    // projectId + architectureId come from the URL; createDiscoveryRun now takes
    // architectureId as ARG 2 and the tier metadata in the options object.
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      projectId,
      ARCH_ID,
      undefined,
      expect.objectContaining({ mode: 'C' }),
    );
  });

  // ==========================================================================
  // Test 2: POST .../runs with no discovery config returns 400.
  //
  // (Spec #4 cutover) The legacy "projectId is required" 400 is gone --
  // projectId is now a URL path segment. The surviving missing-prerequisite
  // guard on the project-scoped POST path is the no-config 400, which this
  // test now exercises in its place: no archmodel run is created.
  // ==========================================================================
  test('POST .../runs with no discovery config returns 400', async () => {
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue(null);

    const res = await request(app)
      .post(runsBase)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(400);
    expect(res.body.error.message).toContain('No discovery config found');
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 3: GET .../runs/:runId returns 200 with run DTO
  // ==========================================================================
  test('GET .../runs/:runId returns 200 with run DTO', async () => {
    const runId = 'run-uuid-001';
    const mockRun = sampleRunDto({ id: runId, project_id: projectId, status: 'COMPLETED' });
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(mockRun);

    const res = await request(app).get(`${runsBase}/${runId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockRun);
    expect(res.body.id).toBe(runId);
    expect(res.body.status).toBe('COMPLETED');
    // getDiscoveryRun now takes the URL architectureId as its 3rd argument.
    expect(mockArchModelClient.getDiscoveryRun).toHaveBeenCalledWith(projectId, runId, ARCH_ID);
  });

  // ==========================================================================
  // Test 4: GET .../runs/:runId returns 404 when not found
  // ==========================================================================
  test('GET .../runs/:runId returns 404 when run not found', async () => {
    const runId = 'nonexistent-run-id';
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(null);

    const res = await request(app).get(`${runsBase}/${runId}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(404);
    expect(res.body.error.message).toBe('Discovery run not found');
    expect(mockArchModelClient.getDiscoveryRun).toHaveBeenCalledWith(projectId, runId, ARCH_ID);
  });

  // ==========================================================================
  // Test 5: runManager.startRun calls updateDiscoveryRun for each step transition
  //         and sets final status to COMPLETED
  // ==========================================================================
  test('runManager.startRun calls updateDiscoveryRun for each step and sets COMPLETED', async () => {
    // We need the real startRun implementation here, not the mocked one.
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    const runId = 'run-uuid-001';

    // Mock updateDiscoveryRun to return a DTO on each call
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());

    await realStartRun(projectId, runId, ARCH_ID);

    // Should be called 4 times total: 3 before + 1 final (1a, 1b, 1c-llm-analysis)
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenCalledTimes(4);

    // Verify first call: step 1a starts running
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenNthCalledWith(
      1,
      projectId,
      runId,
      expect.objectContaining({
        status: 'RUNNING',
        current_step: '1a',
        steps_payload: expect.objectContaining({
          '1a': expect.objectContaining({ status: 'running' }),
        }),
      })
    );

    // Verify second call: step 1b starts running (1a is completed with atomCounts)
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenNthCalledWith(
      2,
      projectId,
      runId,
      expect.objectContaining({
        status: 'RUNNING',
        current_step: '1b',
        steps_payload: expect.objectContaining({
          '1a': expect.objectContaining({ status: 'completed' }),
          '1b': expect.objectContaining({ status: 'running' }),
        }),
      })
    );

    // Verify final call: COMPLETED with all steps completed
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenNthCalledWith(
      4,
      projectId,
      runId,
      expect.objectContaining({
        status: 'COMPLETED',
        current_step: null,
        steps_payload: expect.objectContaining({
          '1a': expect.objectContaining({ status: 'completed' }),
          '1b': expect.objectContaining({ status: 'completed' }),
          '1c-llm-analysis': expect.objectContaining({ status: 'completed' }),
        }),
      })
    );
  });

  // ==========================================================================
  // Test 6: runManager.startRun sets FAILED and records error_message on failure
  // ==========================================================================
  test('runManager.startRun sets status to FAILED and records error_message when a step fails', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    const runId = 'run-uuid-002';

    // Make updateDiscoveryRun succeed for step 1a "before" call,
    // then fail on step 1b "before" call to simulate a step failure.
    // Step 1a now calls getDiscoveryRun + analyzer, so we need those to succeed.
    mockArchModelClient.updateDiscoveryRun
      .mockResolvedValueOnce(sampleRunDto()) // 1a before: success
      .mockRejectedValueOnce(new Error('Connection refused')) // 1b before: fails
      .mockResolvedValue(sampleRunDto()); // subsequent calls succeed (the error handler call)

    await realStartRun(projectId, runId, ARCH_ID);

    // Verify that after failure, FAILED status was set
    // The error happens during the 1b "before" call (2nd call).
    // The catch block then makes a 3rd call to set FAILED.
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenCalledTimes(3);

    // Verify the failure update call
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenNthCalledWith(
      3,
      projectId,
      runId,
      expect.objectContaining({
        status: 'FAILED',
        current_step: null,
        error_message: 'Step 1b failed: Connection refused',
        steps_payload: expect.objectContaining({
          '1a': expect.objectContaining({ status: 'completed' }),
          '1b': expect.objectContaining({ status: 'failed', errorMessage: 'Connection refused', step: '1b' }),
          '1c-llm-analysis': { status: 'pending' },
        }),
      })
    );
  });

  // ==========================================================================
  // Gap Tests (Task Group 8: Test Review and Integration Verification)
  // ==========================================================================

  // ==========================================================================
  // Gap Test 3: runManager.startRun updates stepsPayload correctly at each
  //             transition -- verify intermediate state shape
  // ==========================================================================
  test('Gap Test 3: runManager.startRun updates stepsPayload correctly at each intermediate transition', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    const runId = 'run-uuid-003';

    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());

    await realStartRun(projectId, runId, ARCH_ID);

    // Verify all 4 calls have the correct stepsPayload shape at every transition
    // Call 1: 1a starts running -- all others pending
    const sp1 = getStepsPayload(0);
    expect(sp1['1a']).toEqual(expect.objectContaining({ status: 'running' }));
    expect(sp1['1b']).toEqual({ status: 'pending' });
    expect(sp1['1c-llm-analysis']).toEqual({ status: 'pending' });

    // Call 2: 1b starts running -- 1a completed (with atomCounts from 1a), 1c-llm-analysis pending
    const sp2 = getStepsPayload(1);
    expect(sp2['1a'].status).toBe('completed');
    expect(sp2['1b']).toEqual(expect.objectContaining({ status: 'running' }));
    expect(sp2['1c-llm-analysis']).toEqual({ status: 'pending' });

    // Call 3: 1c-llm-analysis starts running -- 1a/1b completed
    const sp3 = getStepsPayload(2);
    expect(sp3['1a'].status).toBe('completed');
    expect(sp3['1b'].status).toBe('completed');
    expect(sp3['1c-llm-analysis']).toEqual(expect.objectContaining({ status: 'running' }));

    // Call 4: COMPLETED -- all steps completed
    const call4 = getCallArg(3);
    const sp4 = call4.steps_payload as StepsPayload;
    expect(sp4['1a'].status).toBe('completed');
    expect(sp4['1b'].status).toBe('completed');
    expect(sp4['1c-llm-analysis'].status).toBe('completed');
    expect(call4.status).toBe('COMPLETED');
    expect(call4.current_step).toBeNull();
  });

  // ==========================================================================
  // Gap Test 4: POST .../runs returns the DTO immediately (before
  //             startRun completes) confirming fire-and-forget behavior
  // ==========================================================================
  test('Gap Test 4: POST .../runs returns DTO immediately confirming fire-and-forget', async () => {
    const mockRun = sampleRunDto({ project_id: projectId });
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(mockRun);

    // The mocked startRun from jest.mock at the top resolves immediately.
    // The key verification is that the response body has status PENDING (the
    // initial state before any steps have run) and that the route does not
    // wait for step execution.

    const startTime = Date.now();

    const res = await request(app)
      .post(runsBase)
      .send({ confirmLlmSolo: true });

    const elapsed = Date.now() - startTime;

    // Response should be nearly instant (well under 1 second)
    expect(elapsed).toBeLessThan(1000);

    // The response should contain the created run DTO with PENDING status
    // (not RUNNING or COMPLETED, which would indicate the route waited for execution)
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.id).toBe('run-uuid-001');

    // Verify createDiscoveryRun was called (the synchronous part). architectureId
    // is ARG 2; tier metadata rides in the options object.
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      projectId,
      ARCH_ID,
      undefined,
      expect.objectContaining({ mode: 'C' }),
    );

    // The mocked startRun should have been called (fire-and-forget) with the
    // architectureId as the 3rd arg and the pre-computed tier in options.
    const { startRun: mockedStartRun } = require('../services/runManager');
    expect(mockedStartRun).toHaveBeenCalledWith(
      projectId,
      mockRun.id,
      ARCH_ID,
      undefined,
      expect.objectContaining({ tier: 'C' }),
    );
  });
});
