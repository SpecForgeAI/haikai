/**
 * Tests for partial failure tolerance and run state machine behavior.
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 1: Partial Failure Tolerance and Run State Machine.
 *
 * Reshaped by the V3 pipeline restructure: the pipeline is now
 * `1a -> 1b -> 1c-llm-analysis` (the former 1c clustering + 1d candidate
 * generation steps were folded into the single LLM-driven `1c-llm-analysis`
 * step). The "later step fails" tests therefore target `1c-llm-analysis` as
 * the failing third step.
 *
 * 6 focused tests covering:
 * 1. When step 1b throws, stepsPayload records 1a as completed and 1b as failed with error detail
 * 2. error_message includes step identifier prefix (e.g., "Step 1c-llm-analysis failed: ...")
 * 3. stepsPayload on failure includes the failing step name and error message
 * 4. After a FAILED run, a fresh POST creates a new independent run starting from 1a
 * 5. Run status transitions follow PENDING -> RUNNING -> COMPLETED|FAILED only
 * 6. Successful prior step results are preserved in stepsPayload when a later step fails
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-partial-failure'),
}));

// Mock the archModelClient module with all methods needed by run manager
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
      deleteCandidatesByRunId: jest.fn(),
      bulkSaveDecisionTasks: jest.fn(),
      getDecisionTasksByRun: jest.fn(),
      getDecisionTaskCount: jest.fn(),
      updateDecisionTask: jest.fn(),
      // Methods added to archModelClient by committed specs that startRun /
      // the V3 LLM-analysis step now call. Defaults take the graceful/no-op path.
      resetDefaultArchitectureCache: jest.fn(),
      getModel: jest.fn().mockResolvedValue(null),
      getProject: jest.fn().mockResolvedValue(null),
      bulkCreateDiscoveryFindings: jest.fn().mockResolvedValue({ created: 0, findings: [] }),
    },
  };
});

// Mock the gateway client module
jest.mock('../services/gatewayClient', () => {
  return {
    gatewayClient: {
      resolveDecisionTasks: jest.fn(),
    },
  };
});

// Mock the repo-access seam so step `1c-llm-analysis` does NOT perform a real
// `git clone` of the fixture repo URL when it is reached (Test 4's second run).
jest.mock('../services/repoAccess', () => ({
  gitCloneRepoAccess: {
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  },
  buildTempDir: jest.fn(() => '/tmp/partial-failure-mock-repo'),
  isGitRepoUrl: jest.fn(() => true),
  normalizeRepoLocation: jest.fn((v: string) => v),
  normalizeRepoSubfolder: jest.fn((v: string) => v),
}));

// Mock the LLM file-analysis step so 1c-llm-analysis completes without invoking
// a real LLM when it is reached. Empty candidates -> persist + emit no-op.
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

// Mock the analyzer registry so that 1a uses a mock pack returning atoms
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
        atomCounts: { file_structure: 10, symbol: 5, string_pattern: 2 },
        totalAtoms: 17,
      },
    }),
  };
  return {
    getAnalyzerRegistry: jest.fn().mockReturnValue(
      new Map([
        ['phase-1a-universal-extraction', mockPhase1aPack],
      ])
    ),
    initializeAnalyzerRegistry: jest.fn(),
    registerAnalyzerPack: jest.fn(),
  };
});

// Mock the linker rule registry with empty registry
jest.mock('../services/linkerRuleRegistry', () => {
  return {
    getLinkerRuleRegistry: jest.fn().mockReturnValue(new Map()),
    initializeLinkerRuleRegistry: jest.fn(),
    registerLinkerRule: jest.fn(),
  };
});


import { archModelClient } from '../services/archModelClient';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;

const ARCH_ID = 'arch-001';

/**
 * Sample run DTO shape returned by archModelClient.
 */
function sampleRunDto() {
  return {
    id: 'run-uuid-pf-001',
    project_id: '550e8400-e29b-41d4-a716-446655440000',
    service_id: null,
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
    steps_payload: {
      '1a': { status: 'pending' },
      '1b': { status: 'pending' },
      '1c-llm-analysis': { status: 'pending' },
    },
    error_message: null,
    created_at: '2026-04-06T10:00:00Z',
    updated_at: '2026-04-06T10:00:00Z',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StepsPayload = Record<string, { status: string; [key: string]: any }>;

/**
 * Extracts the full update argument from an updateDiscoveryRun mock call.
 */
function getCallArg(callIndex: number) {
  return mockArchModelClient.updateDiscoveryRun.mock.calls[callIndex][2] as {
    steps_payload?: StepsPayload;
    status?: string;
    current_step?: string | null;
    error_message?: string | null;
  };
}

describe('Partial Failure Tolerance and Run State Machine (TG1)', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const runId = 'run-uuid-pf-001';

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock returns
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]);
    mockArchModelClient.getEvidenceCount.mockResolvedValue(0);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);
    mockArchModelClient.getRelationshipCount.mockResolvedValue(0);
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveClusters.mockResolvedValue(undefined);
    mockArchModelClient.deleteClustersByRunId.mockResolvedValue(0);
    mockArchModelClient.deleteCandidatesByRunId.mockResolvedValue(0);
    mockArchModelClient.bulkSaveCandidates.mockResolvedValue(undefined);
    mockArchModelClient.getClustersByRun.mockResolvedValue([]);
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue(null);
  });

  // ==========================================================================
  // Test 1: When step 1b throws, stepsPayload records 1a as completed and
  //         1b as failed with error detail
  // ==========================================================================
  test('when step 1b throws, stepsPayload records 1a as completed and 1b as failed with error detail', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    // 1a succeeds normally, but 1b fails because getEvidenceByRun throws
    mockArchModelClient.getEvidenceByRun.mockRejectedValue(
      new Error('connection timeout')
    );

    await realStartRun(projectId, runId, ARCH_ID);

    // Find the FAILED update call (the last one)
    const totalCalls = mockArchModelClient.updateDiscoveryRun.mock.calls.length;
    const failedCall = getCallArg(totalCalls - 1);

    expect(failedCall.status).toBe('FAILED');

    const sp = failedCall.steps_payload as StepsPayload;

    // 1a should be completed with metadata
    expect(sp['1a'].status).toBe('completed');
    expect(sp['1a'].atomCounts).toBeDefined();

    // 1b should be failed with error detail
    expect(sp['1b'].status).toBe('failed');
    expect(sp['1b'].errorMessage).toBe('connection timeout');
    expect(sp['1b'].step).toBe('1b');
  });

  // ==========================================================================
  // Test 2: error_message includes step identifier prefix
  // ==========================================================================
  test('error_message includes step identifier prefix (e.g., "Step 1c-llm-analysis failed: ...")', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    // Make the third step (1c-llm-analysis) fail: 1a and 1b succeed, but the
    // LLM-analysis step fails when fetching atoms. Both 1b and 1c-llm-analysis
    // call getEvidenceByRun, so make the first call succeed (1b) and the second
    // fail (1c-llm-analysis, before it reaches the clone).
    mockArchModelClient.getEvidenceByRun
      .mockResolvedValueOnce([]) // 1b fetches atoms: success
      .mockRejectedValueOnce(new Error('service unavailable')); // 1c-llm-analysis fetches atoms: fail

    await realStartRun(projectId, runId, ARCH_ID);

    // Find the FAILED update call (the last one)
    const totalCalls = mockArchModelClient.updateDiscoveryRun.mock.calls.length;
    const failedCall = getCallArg(totalCalls - 1);

    expect(failedCall.status).toBe('FAILED');
    expect(failedCall.error_message).toBe('Step 1c-llm-analysis failed: service unavailable');
    expect(failedCall.error_message).toMatch(/^Step 1c-llm-analysis failed: /);
  });

  // ==========================================================================
  // Test 3: stepsPayload on failure includes the failing step name and error message
  // ==========================================================================
  test('stepsPayload on failure includes the failing step name and error message', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    // Make step 1b fail
    mockArchModelClient.getEvidenceByRun.mockRejectedValue(
      new Error('network error')
    );

    await realStartRun(projectId, runId, ARCH_ID);

    // Find the FAILED update call
    const totalCalls = mockArchModelClient.updateDiscoveryRun.mock.calls.length;
    const failedCall = getCallArg(totalCalls - 1);
    const sp = failedCall.steps_payload as StepsPayload;

    // The failing step entry must include status, errorMessage, and step
    expect(sp['1b']).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'network error',
        step: '1b',
      })
    );
  });

  // ==========================================================================
  // Test 4: After a FAILED run, a fresh POST creates a new independent run
  //         starting from 1a
  // ==========================================================================
  test('after a FAILED run, a fresh POST creates a new independent run starting from 1a', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    // First run: make step 1b fail
    mockArchModelClient.getEvidenceByRun.mockRejectedValue(
      new Error('first run failure')
    );

    await realStartRun(projectId, runId, ARCH_ID);

    // Verify the first run ended in FAILED
    const firstRunCalls = mockArchModelClient.updateDiscoveryRun.mock.calls.length;
    const firstRunFailed = getCallArg(firstRunCalls - 1);
    expect(firstRunFailed.status).toBe('FAILED');

    // Clear mocks for the second run
    jest.clearAllMocks();
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]); // Now succeeds
    mockArchModelClient.getEvidenceCount.mockResolvedValue(0);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);
    mockArchModelClient.getRelationshipCount.mockResolvedValue(0);
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveClusters.mockResolvedValue(undefined);
    mockArchModelClient.deleteClustersByRunId.mockResolvedValue(0);
    mockArchModelClient.deleteCandidatesByRunId.mockResolvedValue(0);
    mockArchModelClient.bulkSaveCandidates.mockResolvedValue(undefined);
    mockArchModelClient.getClustersByRun.mockResolvedValue([]);
    mockArchModelClient.getDiscoveryConfig.mockResolvedValue(null);

    // Second run: fresh run with a new runId, should start from 1a and complete
    const newRunId = 'run-uuid-pf-002';
    await realStartRun(projectId, newRunId, ARCH_ID);

    // The second run should start fresh from step 1a
    // First updateDiscoveryRun call should be for step 1a with status RUNNING
    const firstCallOfSecondRun = getCallArg(0);
    expect(firstCallOfSecondRun.status).toBe('RUNNING');
    expect(firstCallOfSecondRun.current_step).toBe('1a');

    // stepsPayload at start of second run should show all steps starting from pending
    const sp = firstCallOfSecondRun.steps_payload as StepsPayload;
    expect(sp['1a'].status).toBe('running');
    expect(sp['1b'].status).toBe('pending');
    expect(sp['1c-llm-analysis'].status).toBe('pending');

    // The second run should complete successfully
    const secondRunCalls = mockArchModelClient.updateDiscoveryRun.mock.calls.length;
    const lastCall = getCallArg(secondRunCalls - 1);
    expect(lastCall.status).toBe('COMPLETED');
  });

  // ==========================================================================
  // Test 5: Run status transitions follow PENDING -> RUNNING -> COMPLETED|FAILED only
  // ==========================================================================
  test('run status transitions follow PENDING -> RUNNING -> COMPLETED|FAILED only', () => {
    const { validateStatusTransition } = jest.requireActual('../services/runManager') as {
      validateStatusTransition: (currentStatus: string, newStatus: string) => void;
    };

    // Valid transitions should not throw
    expect(() => validateStatusTransition('PENDING', 'RUNNING')).not.toThrow();
    expect(() => validateStatusTransition('RUNNING', 'RUNNING')).not.toThrow();
    expect(() => validateStatusTransition('RUNNING', 'COMPLETED')).not.toThrow();
    expect(() => validateStatusTransition('RUNNING', 'FAILED')).not.toThrow();

    // Invalid transitions should throw descriptive errors
    expect(() => validateStatusTransition('PENDING', 'COMPLETED')).toThrow(
      'Invalid run status transition: PENDING -> COMPLETED'
    );
    expect(() => validateStatusTransition('PENDING', 'FAILED')).toThrow(
      'Invalid run status transition: PENDING -> FAILED'
    );
    expect(() => validateStatusTransition('COMPLETED', 'RUNNING')).toThrow(
      'Invalid run status transition: COMPLETED -> RUNNING'
    );
    // FAILED -> RUNNING is a VALID transition (resume path), so it must NOT throw.
    expect(() => validateStatusTransition('FAILED', 'RUNNING')).not.toThrow();
    expect(() => validateStatusTransition('COMPLETED', 'FAILED')).toThrow(
      'Invalid run status transition: COMPLETED -> FAILED'
    );
    expect(() => validateStatusTransition('FAILED', 'COMPLETED')).toThrow(
      'Invalid run status transition: FAILED -> COMPLETED'
    );
  });

  // ==========================================================================
  // Test 6: Successful prior step results are preserved in stepsPayload when
  //         a later step fails
  // ==========================================================================
  test('successful prior step results are preserved in stepsPayload when a later step fails', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    // Make the third step (1c-llm-analysis) fail: 1a and 1b succeed, 1c-llm-analysis
    // fails when fetching atoms.
    mockArchModelClient.getEvidenceByRun
      .mockResolvedValueOnce([]) // 1b fetches atoms: success
      .mockRejectedValueOnce(new Error('disk full')); // 1c-llm-analysis fetches atoms: fail

    await realStartRun(projectId, runId, ARCH_ID);

    // Find the FAILED update call
    const totalCalls = mockArchModelClient.updateDiscoveryRun.mock.calls.length;
    const failedCall = getCallArg(totalCalls - 1);
    const sp = failedCall.steps_payload as StepsPayload;

    // 1a should be completed with its full metadata preserved
    expect(sp['1a'].status).toBe('completed');
    expect(sp['1a'].atomCounts).toEqual({ file_structure: 10, symbol: 5, string_pattern: 2 });

    // 1b should be completed with its full metadata preserved
    expect(sp['1b'].status).toBe('completed');
    expect(sp['1b'].relationshipCount).toBe(0);
    expect(sp['1b'].upstreamAtomCount).toBe(0);
    expect(sp['1b'].autoAcceptedCount).toBe(0);
    expect(sp['1b'].decisionTaskCount).toBe(0);

    // 1c-llm-analysis should be failed with error detail
    expect(sp['1c-llm-analysis'].status).toBe('failed');
    expect(sp['1c-llm-analysis'].errorMessage).toBe('disk full');
    expect(sp['1c-llm-analysis'].step).toBe('1c-llm-analysis');
  });
});
