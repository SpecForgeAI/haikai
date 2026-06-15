/**
 * Tests for run manager backbone step execution (1b, 1c-llm-analysis).
 *
 * Spec: Phase 1 Evidence Schema Backbone, then restructured by the V3
 * pipeline (steps 1c clustering + 1d candidate generation folded into a
 * single LLM-driven `1c-llm-analysis` step via `executeStepLlmAnalysis`).
 *
 * Focused tests covering:
 * - executeStep1b fetches upstream atoms via getEvidenceByRun, runs linker
 *   rules (empty registry = no candidates), returns summary metadata with
 *   zero counts
 * - executeStepLlmAnalysis (the post-restructure third step) fetches atoms /
 *   relationships, clones the repo via the mocked repo-access seam, runs the
 *   mocked LLM file analysis (empty = no candidates), and returns a zero-count
 *   summary
 * - startRun completes all three steps (1a, 1b, 1c-llm-analysis) sequentially
 *   with correct stepsPayload metadata for each step
 *
 * Gap Tests:
 * - Step 1b failure sets stepsPayload to failed and stops the pipeline
 *
 * NOTE: executeStep1b was upgraded from a backbone stub to real orchestration
 * in Phase 1b Linker and DecisionTask Engine. The former 1c (clustering) and
 * 1d (candidate generation) steps were REMOVED and replaced by
 * executeStepLlmAnalysis (LLM-driven file analysis producing typed candidates
 * directly). These tests verify the real implementations with empty rule
 * registries and a mocked LLM seam (no rules / empty analysis = no
 * candidates/relationships/proposals).
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid (needed by real executeStep1b)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-backbone'),
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
      // the V3 LLM-analysis step now call. Defaults take the graceful/no-op
      // path so these backbone tests stay focused on the run loop.
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
// the step into step_failed). These backbone tests only care about the run
// loop's step sequencing, not a real clone.
jest.mock('../services/repoAccess', () => ({
  gitCloneRepoAccess: {
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  },
  buildTempDir: jest.fn(() => '/tmp/backbone-mock-repo'),
  isGitRepoUrl: jest.fn(() => true),
  normalizeRepoLocation: jest.fn((v: string) => v),
  normalizeRepoSubfolder: jest.fn((v: string) => v),
}));

// Mock the LLM file-analysis step so 1c-llm-analysis completes without invoking
// a real LLM. Empty candidates -> zero candidates / findings, so the downstream
// persist + emit paths no-op and the step reaches step_complete.
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
        atomCounts: { file_structure: 5, symbol: 12, string_pattern: 3 },
        totalAtoms: 20,
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

// Mock the linker rule registry with an empty registry (no rules = no candidates)
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
    id: 'run-uuid-backbone-001',
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
    created_at: '2026-04-05T10:00:00Z',
    updated_at: '2026-04-05T10:00:00Z',
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
  };
  return call.steps_payload as StepsPayload;
}

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

describe('Run Manager Backbone Steps (1b, 1c-llm-analysis)', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const runId = 'run-uuid-backbone-001';

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock returns
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    // executeStep1b now calls getEvidenceByRun instead of getEvidenceCount
    // With empty linker rule registry, no candidates are produced, so no
    // relationships or decision tasks are created.
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
  // Test 1: executeStep1b fetches atoms and returns summary metadata
  // ==========================================================================
  test('executeStep1b fetches upstream atoms via getEvidenceByRun and returns summary metadata with zero counts when no rules registered', async () => {
    // Import the real module to access executeStep1b
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    // Mock getEvidenceByRun to return 42 atoms (empty array would also work,
    // but using a populated array to verify upstreamAtomCount)
    const mockAtoms = Array.from({ length: 42 }, (_, i) => ({
      id: `atom-${i}`,
      runId,
      repoUrl: 'https://github.com/example/repo',
      filePath: `src/file${i}.ts`,
      type: 'file_structure' as const,
      data: { relativePath: `src/file${i}.ts`, extension: '.ts', sizeBytes: 100, lineCount: 10 },
      extractedAt: '2026-04-05T10:00:00Z',
    }));
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(mockAtoms);

    const result = await executeStep1b(projectId, runId);

    // Verify it fetched the upstream atoms
    expect(mockArchModelClient.getEvidenceByRun).toHaveBeenCalledWith(projectId, runId);

    // Verify the result shape: with empty rule registry, no relationships or decision tasks
    expect(result).toEqual(expect.objectContaining({
      relationshipCount: 0,
      autoAcceptedCount: 0,
      decisionTaskCount: 0,
      decisionTaskResolvedCount: 0,
      decisionTaskFailedCount: 0,
      discardedCount: 0,
      upstreamAtomCount: 42,
    }));
  });

  // ==========================================================================
  // Test 2: executeStepLlmAnalysis (post-restructure third step, replacing the
  //         removed 1c clustering + 1d candidate-generation steps) fetches
  //         atoms/relationships, clones via the mocked repo seam, runs the
  //         mocked LLM analysis (empty = no candidates), returns a zero-count
  //         summary.
  // ==========================================================================
  test('executeStepLlmAnalysis fetches atoms and relationships and returns a zero-count summary when the LLM analysis yields no candidates', async () => {
    const { executeStepLlmAnalysis } = jest.requireActual('../services/runManager') as {
      executeStepLlmAnalysis: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);

    const result = await executeStepLlmAnalysis(projectId, runId);

    // Verify it fetched the upstream atoms and relationships
    expect(mockArchModelClient.getEvidenceByRun).toHaveBeenCalledWith(projectId, runId);
    expect(mockArchModelClient.getRelationshipsByRun).toHaveBeenCalledWith(projectId, runId);

    // Verify the result shape: with empty LLM analysis, no candidates / evidence
    expect(result).toEqual(expect.objectContaining({
      filesAnalyzed: 0,
      filesFailed: 0,
      candidateCount: 0,
      evidenceCount: 0,
      candidatesByType: {},
    }));
  });

  // ==========================================================================
  // Test 3: startRun completes all three steps with correct stepsPayload metadata
  // ==========================================================================
  test('startRun completes all three steps (1a, 1b, 1c-llm-analysis) sequentially with correct stepsPayload metadata', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    await realStartRun(projectId, runId, ARCH_ID);

    // Should be called 4 times total: 3 "before" (mark running) + 1 final (COMPLETED)
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenCalledTimes(4);

    // Call 1: 1a starts running
    const sp1 = getStepsPayload(0);
    expect(sp1['1a']).toEqual(expect.objectContaining({ status: 'running' }));
    expect(sp1['1b']).toEqual({ status: 'pending' });
    expect(sp1['1c-llm-analysis']).toEqual({ status: 'pending' });

    // Call 2: 1b starts running -- 1a completed with atomCounts
    const sp2 = getStepsPayload(1);
    expect(sp2['1a']).toEqual(expect.objectContaining({
      status: 'completed',
      atomCounts: { file_structure: 5, symbol: 12, string_pattern: 3 },
    }));
    expect(sp2['1b']).toEqual(expect.objectContaining({ status: 'running' }));

    // Call 3: 1c-llm-analysis starts running -- 1b completed with relationship metadata
    // With real executeStep1b (empty registry), the result includes all 7 summary fields
    const sp3 = getStepsPayload(2);
    expect(sp3['1b'].status).toBe('completed');
    expect(sp3['1b'].relationshipCount).toBe(0);
    expect(sp3['1b'].upstreamAtomCount).toBe(0); // getEvidenceByRun returns []
    expect(sp3['1c-llm-analysis']).toEqual(expect.objectContaining({ status: 'running' }));

    // Call 4: COMPLETED -- 1c-llm-analysis completed with candidate metadata, all steps done
    const sp4 = getStepsPayload(3);
    expect(sp4['1c-llm-analysis'].status).toBe('completed');
    expect(sp4['1c-llm-analysis'].candidateCount).toBe(0);
    expect(sp4['1c-llm-analysis'].candidatesByType).toEqual({});
    expect(sp4['1a'].status).toBe('completed');
    expect(sp4['1b'].status).toBe('completed');
    expect(sp4['1c-llm-analysis'].status).toBe('completed');

    // Verify the final call has COMPLETED status
    const finalCall = mockArchModelClient.updateDiscoveryRun.mock.calls[3][2] as {
      status: string;
      current_step: string | null;
    };
    expect(finalCall.status).toBe('COMPLETED');
    expect(finalCall.current_step).toBeNull();
  });

  // ==========================================================================
  // Gap Tests (Task Group 7: Test Review and Gap Analysis)
  // ==========================================================================

  // ==========================================================================
  // Gap Test: step 1b failure (getEvidenceByRun throws) sets stepsPayload
  //           to failed and stops the pipeline
  // ==========================================================================
  test('Gap Test: step 1b failure sets stepsPayload to failed and stops pipeline', async () => {
    const { startRun: realStartRun } = jest.requireActual('../services/runManager') as {
      startRun: (projectId: string, runId: string, architectureId: string) => Promise<void>;
    };

    // 1a succeeds normally, but 1b fails because getEvidenceByRun throws
    mockArchModelClient.getEvidenceByRun.mockRejectedValue(
      new Error('Upstream evidence service unavailable')
    );

    await realStartRun(projectId, runId, ARCH_ID);

    // 1a before (running) + 1b before (running) + error handler (FAILED) = 3 calls
    // Note: 1a completes but 1b fails during executeStep1b (getEvidenceByRun throws)
    // so the catch block fires on the 1b iteration.
    expect(mockArchModelClient.updateDiscoveryRun).toHaveBeenCalledTimes(3);

    // Call 1: 1a starts running
    const sp1 = getStepsPayload(0);
    expect(sp1['1a']).toEqual(expect.objectContaining({ status: 'running' }));

    // Call 2: 1b starts running (1a completed)
    const sp2 = getStepsPayload(1);
    expect(sp2['1a'].status).toBe('completed');
    expect(sp2['1b']).toEqual(expect.objectContaining({ status: 'running' }));

    // Call 3: FAILED -- 1b set to failed, 1c-llm-analysis remains pending
    const failedCall = getCallArg(2);
    expect(failedCall.status).toBe('FAILED');
    expect(failedCall.current_step).toBeNull();
    expect(failedCall.error_message).toBe('Step 1b failed: Upstream evidence service unavailable');

    const sp3 = failedCall.steps_payload as StepsPayload;
    expect(sp3['1a'].status).toBe('completed');
    expect(sp3['1b']).toEqual({ status: 'failed', errorMessage: 'Upstream evidence service unavailable', step: '1b' });
    expect(sp3['1c-llm-analysis']).toEqual({ status: 'pending' });
  });
});
