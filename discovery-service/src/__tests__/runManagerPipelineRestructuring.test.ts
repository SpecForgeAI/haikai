/**
 * Tests for RunManager Pipeline Step Restructuring
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 9: RunManager Pipeline Step Restructuring
 *
 * 4 focused tests covering:
 * - VALID_STEPS no longer contains '1c' or '1d' and contains the new LLM analysis step
 * - executeStep() for the new step routes to executeLlmFileAnalysis()
 * - Pipeline runs steps in order: 1a -> 1b -> new step
 * - Candidates from LLM analysis are persisted via archModelClient.bulkSaveCandidates()
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-tg9'),
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
      getEvidenceCount: jest.fn(),
      getEvidenceByRunPaginated: jest.fn(),
      bulkSaveRelationships: jest.fn(),
      getRelationshipsByRun: jest.fn(),
      getRelationshipCount: jest.fn(),
      getRelationshipsByRunPaginated: jest.fn(),
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
      // Methods added to archModelClient by committed specs that the V3
      // LLM-analysis step now calls. Defaults take the graceful/no-op path.
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

// Mock the triage engine (needed by step 1b)
jest.mock('../services/triageEngine', () => {
  return {
    triageCandidates: jest.fn().mockReturnValue({
      accepted: [],
      ambiguous: [],
      discarded: [],
      competingGroups: new Map(),
    }),
  };
});

// Mock the LLM file analysis step. The mocked `executeLlmFileAnalysis` returns a
// fixed candidate set; `sortCandidatesParentsFirst` is also exported by the real
// module and is called by executeStepLlmAnalysis before persistence, so the mock
// must provide it (identity sort here keeps the candidate order assertable).
jest.mock('../services/llmFileAnalysisStep', () => {
  return {
    executeLlmFileAnalysis: jest.fn().mockResolvedValue({
      candidates: [
        {
          id: 'cand-001',
          runId: 'run-001',
          candidateType: 'class',
          name: 'UserController',
          confidence: 0.92,
          status: 'proposed',
          sourceClusterIds: ['src/main/java/UserController.java'],
          data: { language: 'Java' },
          synthesizedAt: '2026-04-07T00:00:00.000Z',
        },
        {
          id: 'cand-002',
          runId: 'run-001',
          candidateType: 'method',
          name: 'getUser',
          confidence: 0.88,
          status: 'proposed',
          sourceClusterIds: ['src/main/java/UserController.java'],
          data: {},
          synthesizedAt: '2026-04-07T00:00:00.000Z',
          parentCandidateId: 'cand-001',
        },
      ],
      evidenceCount: 5,
      filesAnalyzed: 5,
      filesFailed: 0,
      findingInputs: [],
    }),
    sortCandidatesParentsFirst: jest.fn((c: unknown[]) => c),
  };
});

// Mock the repo access module
jest.mock('../services/repoAccess', () => {
  return {
    buildTempDir: jest.fn().mockReturnValue('/tmp/discovery-run-001/example-repo'),
    gitCloneRepoAccess: {
      cloneRepo: jest.fn().mockResolvedValue('/tmp/discovery-run-001/example-repo'),
      cleanup: jest.fn().mockResolvedValue(undefined),
    },
    repoSlug: jest.fn().mockReturnValue('example-repo'),
    isGitRepoUrl: jest.fn().mockReturnValue(true),
    normalizeRepoLocation: jest.fn((v: string) => v),
    normalizeRepoSubfolder: jest.fn((v: string) => v),
  };
});

import { archModelClient } from '../services/archModelClient';
import { VALID_STEPS, startRun } from '../services/runManager';
import { executeLlmFileAnalysis } from '../services/llmFileAnalysisStep';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockExecuteLlmFileAnalysis = executeLlmFileAnalysis as jest.MockedFunction<typeof executeLlmFileAnalysis>;

/**
 * Sample run DTO shape returned by archModelClient.
 */
function sampleRunDto() {
  return {
    id: 'run-001',
    project_id: 'proj-001',
    service_id: null,
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: {
      repos: [{ url: 'https://github.com/example/repo', branch: 'main' }],
      techHints: {},
    },
    steps_payload: {
      '1a': { status: 'pending' },
      '1b': { status: 'pending' },
      '1c-llm-analysis': { status: 'pending' },
    },
    error_message: null,
    created_at: '2026-04-07T00:00:00.000Z',
    updated_at: '2026-04-07T00:00:00.000Z',
  };
}

describe('RunManager Pipeline Step Restructuring (Task Group 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock return values for archModelClient methods
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveCandidates.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]);
    mockArchModelClient.getEvidenceCount.mockResolvedValue(0);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);
    mockArchModelClient.getRelationshipCount.mockResolvedValue(0);
  });

  // -------------------------------------------------------------------------
  // Test 1: VALID_STEPS no longer contains '1c' or '1d' and contains the new step
  // -------------------------------------------------------------------------
  test('VALID_STEPS contains 1a, 1b, and 1c-llm-analysis but not 1c or 1d', () => {
    expect(VALID_STEPS).toContain('1a');
    expect(VALID_STEPS).toContain('1b');
    expect(VALID_STEPS).toContain('1c-llm-analysis');
    expect(VALID_STEPS).not.toContain('1c');
    expect(VALID_STEPS).not.toContain('1d');
    expect(VALID_STEPS).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Test 2: executeStep() for the new step routes to executeLlmFileAnalysis()
  // -------------------------------------------------------------------------
  test('executeStep for 1c-llm-analysis routes to executeLlmFileAnalysis()', async () => {
    // startRun will execute all steps in sequence;
    // We verify that executeLlmFileAnalysis is called during the pipeline.
    await startRun('proj-001', 'run-001', 'arch-001');

    expect(mockExecuteLlmFileAnalysis).toHaveBeenCalledTimes(1);
    expect(mockExecuteLlmFileAnalysis).toHaveBeenCalledWith(
      'run-001',          // runId
      'proj-001',         // projectId
      expect.any(Array),  // atoms (from 1a/1b fetch)
      expect.any(Array),  // relationships (from 1b fetch)
      expect.objectContaining({
        repos: expect.any(Array),
      }),                  // discoveryConfig
      expect.any(String), // repoDir
      undefined,          // serviceScopedOptions (none on the project-scoped path)
      undefined           // tier (no StartRunOptions passed here)
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: Pipeline runs steps in order: 1a -> 1b -> 1c-llm-analysis
  // -------------------------------------------------------------------------
  test('pipeline runs steps in order: 1a -> 1b -> 1c-llm-analysis', async () => {
    await startRun('proj-001', 'run-001', 'arch-001');

    // Check that updateDiscoveryRun was called with the correct step sequence.
    // Each step triggers at least 1 update before execution (marking it as 'running')
    // and the final step triggers a COMPLETED update.
    const updateCalls = mockArchModelClient.updateDiscoveryRun.mock.calls;

    // Extract the current_step values from the RUNNING state updates
    const runningSteps = updateCalls
      .filter(call => call[2]?.status === 'RUNNING' && call[2]?.current_step)
      .map(call => call[2].current_step);

    expect(runningSteps).toEqual(['1a', '1b', '1c-llm-analysis']);

    // Verify the final update sets status to COMPLETED
    const finalUpdate = updateCalls[updateCalls.length - 1];
    expect(finalUpdate[2]).toMatchObject({
      status: 'COMPLETED',
      current_step: null,
    });

    // Verify the steps_payload in the final update has all 3 steps completed
    const finalStepsPayload = finalUpdate[2].steps_payload as Record<string, Record<string, unknown>>;
    expect(finalStepsPayload['1a']?.status).toBe('completed');
    expect(finalStepsPayload['1b']?.status).toBe('completed');
    expect(finalStepsPayload['1c-llm-analysis']?.status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // Test 4: Candidates from LLM analysis are persisted via bulkSaveCandidates()
  // -------------------------------------------------------------------------
  test('candidates from LLM analysis are persisted via archModelClient.bulkSaveCandidates()', async () => {
    await startRun('proj-001', 'run-001', 'arch-001');

    // Verify bulkSaveCandidates was called with the candidates from executeLlmFileAnalysis
    expect(mockArchModelClient.bulkSaveCandidates).toHaveBeenCalled();

    const saveCalls = mockArchModelClient.bulkSaveCandidates.mock.calls;
    // Find the call(s) that saved the LLM analysis candidates
    const allSavedCandidates = saveCalls.flatMap(call => call[2] as unknown[]);

    // The mock returns 2 candidates from executeLlmFileAnalysis
    expect(allSavedCandidates).toHaveLength(2);
    expect(allSavedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cand-001',
          candidateType: 'class',
          name: 'UserController',
        }),
        expect.objectContaining({
          id: 'cand-002',
          candidateType: 'method',
          name: 'getUser',
          parentCandidateId: 'cand-001',
        }),
      ])
    );

    // Verify the call used the correct projectId and runId
    const firstCall = saveCalls[0];
    expect(firstCall[0]).toBe('proj-001');
    expect(firstCall[1]).toBe('run-001');
  });
});
