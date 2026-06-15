/**
 * Tests for performance bottleneck removal: pagination and batching behavior.
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 5: Performance Bottleneck Removal and Batch-Size Awareness.
 *
 * Reshaped by the V3 pipeline restructure: the former 1c (clustering) and 1d
 * (candidate generation) steps were folded into the single LLM-driven
 * `executeStepLlmAnalysis` (step id `1c-llm-analysis`). That step now owns the
 * paginated atom + relationship fetches the old 1c performed, so the
 * "third-step pagination" regression now targets `executeStepLlmAnalysis`.
 *
 * The `PAGINATION_THRESHOLD` constant is read from the module rather than
 * hardcoded: production deliberately set it very high (single-fetch until the
 * backend supports offset/limit), so the tests pin the *branch-selection*
 * regression (above-threshold -> paginated, below -> single) against whatever
 * the current threshold value is.
 *
 * 4 focused tests covering:
 * 1. executeStep1b paginates atom fetches when count exceeds threshold
 * 2. executeStepLlmAnalysis paginates atom and relationship fetches when counts exceed threshold
 * 3. Bulk save calls in step 1b respect BULK_SAVE_BATCH_SIZE
 * 4. Linker rule loop in step 1b does not re-fetch atoms per rule (operates on in-memory set)
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-perf-test'),
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
      // Methods added to archModelClient by committed specs that the V3
      // LLM-analysis step now calls. Defaults take the graceful/no-op path.
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

// Mock the repo-access seam so executeStepLlmAnalysis does NOT perform a real
// `git clone` after its (paginated) atom/relationship fetches.
jest.mock('../services/repoAccess', () => ({
  gitCloneRepoAccess: {
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  },
  buildTempDir: jest.fn(() => '/tmp/perf-mock-repo'),
  isGitRepoUrl: jest.fn(() => true),
  normalizeRepoLocation: jest.fn((v: string) => v),
  normalizeRepoSubfolder: jest.fn((v: string) => v),
}));

// Mock the LLM file-analysis step so executeStepLlmAnalysis completes without a
// real LLM call once it has performed the upstream fetches under test.
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
        atomCounts: { file_structure: 0, symbol: 0, string_pattern: 0 },
        totalAtoms: 0,
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

// Mock the linker rule registry -- returns a single rule that records each call
const mockLinkerRuleMatch = jest.fn().mockReturnValue([]);
jest.mock('../services/linkerRuleRegistry', () => {
  return {
    getLinkerRuleRegistry: jest.fn().mockReturnValue(
      new Map([
        ['mock-linker-rule-A', { id: 'mock-linker-rule-A', match: mockLinkerRuleMatch }],
        ['mock-linker-rule-B', { id: 'mock-linker-rule-B', match: mockLinkerRuleMatch }],
      ])
    ),
    initializeLinkerRuleRegistry: jest.fn(),
    registerLinkerRule: jest.fn(),
  };
});

// Mock the triage engine so tests can drive the accepted/ambiguous/discarded
// buckets directly (runManager imports `triageCandidates` from here). A default
// empty-bucket return is installed in beforeEach so steps that don't care about
// triage still run. (The pre-restructure version of this file cast the import
// to a MockedFunction but never registered the module mock, so its batching
// tests could never have driven triage -- this closes that gap while keeping
// the original batching intent.)
jest.mock('../services/triageEngine', () => ({
  triageCandidates: jest.fn(),
}));


import { archModelClient } from '../services/archModelClient';
import { triageCandidates } from '../services/triageEngine';
import { EvidenceAtom } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockTriageCandidates = triageCandidates as jest.MockedFunction<typeof triageCandidates>;

// Pagination constants read from the real module (see file header for why these
// are not hardcoded).
const {
  PAGINATION_THRESHOLD,
  PAGINATION_PAGE_SIZE,
  BULK_SAVE_BATCH_SIZE,
} = jest.requireActual('../services/runManager') as {
  PAGINATION_THRESHOLD: number;
  PAGINATION_PAGE_SIZE: number;
  BULK_SAVE_BATCH_SIZE: number;
};

/** Empty triage result used as the default mock return. */
function emptyTriageResult() {
  return {
    accepted: [],
    ambiguous: [],
    discarded: [],
    competingGroups: new Map(),
  };
}

/**
 * Creates N minimal EvidenceAtom objects for testing.
 */
function createAtoms(count: number): EvidenceAtom[] {
  const atoms: EvidenceAtom[] = [];
  for (let i = 0; i < count; i++) {
    atoms.push({
      id: `atom-${i}`,
      runId: 'run-perf-001',
      repoUrl: 'https://github.com/example/repo',
      type: 'file_structure',
      filePath: `/src/file${i}.ts`,
      data: { relativePath: `/src/file${i}.ts`, extension: '.ts', sizeBytes: 100, lineCount: 10 },
      extractedAt: '2026-04-06T10:00:00Z',
    });
  }
  return atoms;
}

/**
 * Creates N minimal EvidenceRelationship objects for testing.
 */
function createRelationships(count: number): EvidenceRelationship[] {
  const relationships: EvidenceRelationship[] = [];
  for (let i = 0; i < count; i++) {
    relationships.push({
      id: `rel-${i}`,
      runId: 'run-perf-001',
      sourceAtomId: `atom-${i}`,
      targetAtomId: `atom-${(i + 1) % count}`,
      relationshipType: 'imports',
      confidence: 0.9,
      data: { importStatement: 'import x', line: 1, isDefault: false },
      inferredAt: '2026-04-06T10:00:00Z',
    });
  }
  return relationships;
}

/**
 * Sample run DTO shape returned by archModelClient.
 */
function sampleRunDto() {
  return {
    id: 'run-perf-001',
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

describe('Performance Bottleneck Removal: Pagination and Batching (TG5)', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const runId = 'run-perf-001';

  beforeEach(() => {
    jest.clearAllMocks();
    mockLinkerRuleMatch.mockReturnValue([]);
    // Default: triage yields empty buckets (steps that don't drive triage).
    mockTriageCandidates.mockReturnValue(emptyTriageResult() as any);

    // Default mock returns
    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.updateDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.bulkSaveEvidence.mockResolvedValue(undefined);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue([]);
    mockArchModelClient.getEvidenceByRunPaginated.mockResolvedValue([]);
    mockArchModelClient.getEvidenceCount.mockResolvedValue(0);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue([]);
    mockArchModelClient.getRelationshipsByRunPaginated.mockResolvedValue([]);
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
  // Test 1: executeStep1b paginates atom fetches when count exceeds threshold
  // ==========================================================================
  test('executeStep1b paginates atom fetches when count exceeds threshold', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    // Set the atom count above the threshold (threshold is read from the module,
    // not hardcoded -- production deliberately set it very high).
    const largeAtomCount = PAGINATION_THRESHOLD + 1000;
    const allAtoms = createAtoms(10); // payload content irrelevant; branch is what matters

    mockArchModelClient.getEvidenceCount.mockResolvedValue(largeAtomCount);
    mockArchModelClient.getEvidenceByRunPaginated.mockResolvedValue(allAtoms);

    await executeStep1b(projectId, runId);

    // Should have called getEvidenceCount to check the count
    expect(mockArchModelClient.getEvidenceCount).toHaveBeenCalledWith(projectId, runId);

    // Since count exceeds threshold, it should use paginated fetch
    expect(mockArchModelClient.getEvidenceByRunPaginated).toHaveBeenCalledWith(
      projectId, runId, largeAtomCount, PAGINATION_PAGE_SIZE
    );

    // Should NOT have called the non-paginated getEvidenceByRun
    expect(mockArchModelClient.getEvidenceByRun).not.toHaveBeenCalled();

    // Now test the below-threshold case: reset mocks
    jest.clearAllMocks();
    mockTriageCandidates.mockReturnValue(emptyTriageResult() as any);
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);

    const smallAtomCount = 100;
    const smallAtoms = createAtoms(smallAtomCount);

    mockArchModelClient.getEvidenceCount.mockResolvedValue(smallAtomCount);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(smallAtoms);

    await executeStep1b(projectId, runId);

    // Since count is below threshold, it should use the regular fetch
    expect(mockArchModelClient.getEvidenceByRun).toHaveBeenCalledWith(projectId, runId);

    // Should NOT have called the paginated fetch
    expect(mockArchModelClient.getEvidenceByRunPaginated).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 2: executeStepLlmAnalysis (the post-restructure third step that
  //         absorbed the old 1c) paginates atom and relationship fetches when
  //         counts exceed threshold.
  // ==========================================================================
  test('executeStepLlmAnalysis paginates atom and relationship fetches when counts exceed threshold', async () => {
    const { executeStepLlmAnalysis } = jest.requireActual('../services/runManager') as {
      executeStepLlmAnalysis: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    // Set both atom and relationship counts above the threshold
    const largeAtomCount = PAGINATION_THRESHOLD + 2000;
    const largeRelCount = PAGINATION_THRESHOLD + 7000;
    const allAtoms = createAtoms(10);
    const allRelationships = createRelationships(10);

    mockArchModelClient.getEvidenceCount.mockResolvedValue(largeAtomCount);
    mockArchModelClient.getEvidenceByRunPaginated.mockResolvedValue(allAtoms);
    mockArchModelClient.getRelationshipCount.mockResolvedValue(largeRelCount);
    mockArchModelClient.getRelationshipsByRunPaginated.mockResolvedValue(allRelationships);

    await executeStepLlmAnalysis(projectId, runId);

    // Should have called count endpoints for both atoms and relationships
    expect(mockArchModelClient.getEvidenceCount).toHaveBeenCalledWith(projectId, runId);
    expect(mockArchModelClient.getRelationshipCount).toHaveBeenCalledWith(projectId, runId);

    // Since both counts exceed threshold, should use paginated fetches
    expect(mockArchModelClient.getEvidenceByRunPaginated).toHaveBeenCalledWith(
      projectId, runId, largeAtomCount, PAGINATION_PAGE_SIZE
    );
    expect(mockArchModelClient.getRelationshipsByRunPaginated).toHaveBeenCalledWith(
      projectId, runId, largeRelCount, PAGINATION_PAGE_SIZE
    );

    // Non-paginated fetches should NOT have been called
    expect(mockArchModelClient.getEvidenceByRun).not.toHaveBeenCalled();
    expect(mockArchModelClient.getRelationshipsByRun).not.toHaveBeenCalled();

    // Now test the below-threshold case for both: reset mocks
    jest.clearAllMocks();
    mockTriageCandidates.mockReturnValue(emptyTriageResult() as any);

    const smallAtomCount = 200;
    const smallRelCount = 300;
    const smallAtoms = createAtoms(smallAtomCount);
    const smallRels = createRelationships(smallRelCount);

    mockArchModelClient.getDiscoveryRun.mockResolvedValue(sampleRunDto());
    mockArchModelClient.getEvidenceCount.mockResolvedValue(smallAtomCount);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(smallAtoms);
    mockArchModelClient.getRelationshipCount.mockResolvedValue(smallRelCount);
    mockArchModelClient.getRelationshipsByRun.mockResolvedValue(smallRels);

    await executeStepLlmAnalysis(projectId, runId);

    // Since both counts are below threshold, should use regular fetches
    expect(mockArchModelClient.getEvidenceByRun).toHaveBeenCalledWith(projectId, runId);
    expect(mockArchModelClient.getRelationshipsByRun).toHaveBeenCalledWith(projectId, runId);

    // Paginated fetches should NOT have been called
    expect(mockArchModelClient.getEvidenceByRunPaginated).not.toHaveBeenCalled();
    expect(mockArchModelClient.getRelationshipsByRunPaginated).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 3: Bulk save calls in step 1b respect BULK_SAVE_BATCH_SIZE
  // ==========================================================================
  test('bulk save calls in step 1b respect BULK_SAVE_BATCH_SIZE', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    // Verify the batch size constant is 500
    expect(BULK_SAVE_BATCH_SIZE).toBe(500);

    // ---------- Step 1b: test relationship batching ----------

    // Create 1200 auto-accepted candidates (> 500 batch size = 3 batches)
    const atoms = createAtoms(10);
    mockArchModelClient.getEvidenceCount.mockResolvedValue(10);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    // Generate candidates that will be auto-accepted by triage
    const candidateRelationships: Array<{
      sourceAtomId: string;
      targetAtomId: string;
      relationshipType: string;
      confidence: number;
      ruleId: string;
      data: object;
    }> = [];
    for (let i = 0; i < 1200; i++) {
      candidateRelationships.push({
        sourceAtomId: `atom-${i % 10}`,
        targetAtomId: `atom-${(i + 1) % 10}`,
        relationshipType: 'imports',
        confidence: 0.95,
        ruleId: `rule-${i}`,
        data: {},
      });
    }

    // Mock triageCandidates to return all candidates as accepted
    mockTriageCandidates.mockReturnValue({
      accepted: candidateRelationships as any,
      ambiguous: [],
      discarded: [],
      competingGroups: new Map(),
    });

    await executeStep1b(projectId, runId);

    // With 1200 relationships and batch size 500, should be 3 batches (500 + 500 + 200)
    expect(mockArchModelClient.bulkSaveRelationships).toHaveBeenCalledTimes(3);

    // First batch should have 500 items
    const firstBatch = mockArchModelClient.bulkSaveRelationships.mock.calls[0][2];
    expect(firstBatch).toHaveLength(BULK_SAVE_BATCH_SIZE);

    // Second batch should have 500 items
    const secondBatch = mockArchModelClient.bulkSaveRelationships.mock.calls[1][2];
    expect(secondBatch).toHaveLength(BULK_SAVE_BATCH_SIZE);

    // Third batch should have 200 items (remainder)
    const thirdBatch = mockArchModelClient.bulkSaveRelationships.mock.calls[2][2];
    expect(thirdBatch).toHaveLength(200);
  });

  // ==========================================================================
  // Test 4: Linker rule loop in step 1b does not re-fetch atoms per rule
  //         (operates on in-memory set)
  // ==========================================================================
  test('linker rule loop in step 1b does not re-fetch atoms per rule (operates on in-memory set)', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    const atoms = createAtoms(50);
    mockArchModelClient.getEvidenceCount.mockResolvedValue(50);
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    // Triage returns empty results (no accepted)
    mockTriageCandidates.mockReturnValue(emptyTriageResult() as any);

    // Reset the linker rule match mock and track calls
    mockLinkerRuleMatch.mockReturnValue([]);

    await executeStep1b(projectId, runId);

    // There are 2 linker rules in the mock registry (A and B).
    // Both should have been called with the same in-memory atoms array.
    // The key assertion: getEvidenceByRun (or getEvidenceByRunPaginated) should
    // have been called only ONCE (for the initial fetch), not per-rule.

    // Verify atoms were fetched exactly once (via count + single non-paginated fetch)
    expect(mockArchModelClient.getEvidenceCount).toHaveBeenCalledTimes(1);
    expect(mockArchModelClient.getEvidenceByRun).toHaveBeenCalledTimes(1);
    expect(mockArchModelClient.getEvidenceByRunPaginated).not.toHaveBeenCalled();

    // Each linker rule should have been called exactly once with the full atom array
    expect(mockLinkerRuleMatch).toHaveBeenCalledTimes(2); // 2 rules in registry
    expect(mockLinkerRuleMatch).toHaveBeenNthCalledWith(1, atoms);
    expect(mockLinkerRuleMatch).toHaveBeenNthCalledWith(2, atoms);

    // No additional HTTP calls were made between or during rule execution.
    // Only 1 getEvidenceCount + 1 getEvidenceByRun total for the atom fetch phase.
    const totalEvidenceGetCalls =
      mockArchModelClient.getEvidenceByRun.mock.calls.length +
      mockArchModelClient.getEvidenceByRunPaginated.mock.calls.length;
    expect(totalEvidenceGetCalls).toBe(1);
  });
});
