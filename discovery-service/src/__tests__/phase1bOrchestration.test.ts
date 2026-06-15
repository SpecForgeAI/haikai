/**
 * Tests for the executeStep1b orchestration (Phase 1b real linking logic).
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 9: Replace executeStep1b Stub with Real Orchestration
 *
 * Tests:
 * 1. Full happy path: atoms returned, rules produce candidates across all confidence bands,
 *    auto-accepted relationships persisted, DecisionTasks created and resolved, summary metadata correct
 * 2. High-confidence candidates bypass DecisionTask creation and are persisted directly
 * 3. Low-confidence candidates (below AMBIGUOUS_THRESHOLD) are discarded
 * 4. Competing ambiguous candidates produce a single resolve_competing_relationships DecisionTask
 * 5. Failed DecisionTask resolution increments decisionTaskFailedCount and does not persist a relationship
 * 6. Relationships from confirmed DecisionTasks use adjustedConfidence from LLM output
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid to return deterministic IDs
let uuidCounter = 0;
jest.mock('uuid', () => ({
  v4: jest.fn(() => {
    uuidCounter++;
    return `mock-uuid-${String(uuidCounter).padStart(4, '0')}`;
  }),
}));

// Mock the archModelClient module with all methods needed
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
      bulkSaveRelationships: jest.fn(),
      getRelationshipsByRun: jest.fn(),
      getRelationshipCount: jest.fn(),
      bulkSaveClusters: jest.fn(),
      getClustersByRun: jest.fn(),
      getClusterCount: jest.fn(),
      bulkSaveCandidates: jest.fn(),
      getCandidatesByRun: jest.fn(),
      getCandidateCount: jest.fn(),
      updateCandidate: jest.fn(),
      bulkSaveDecisionTasks: jest.fn(),
      getDecisionTasksByRun: jest.fn(),
      getDecisionTaskCount: jest.fn(),
      updateDecisionTask: jest.fn(),
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

// Mock the analyzer registry (needed because executeStep is in the same module as executeStep1a)
jest.mock('../services/analyzerRegistry', () => {
  return {
    getAnalyzerRegistry: jest.fn().mockReturnValue(new Map()),
    initializeAnalyzerRegistry: jest.fn(),
    registerAnalyzerPack: jest.fn(),
  };
});

// Mock the linker rule registry with controlled rule behavior
const mockRuleMatch = jest.fn();
jest.mock('../services/linkerRuleRegistry', () => {
  return {
    getLinkerRuleRegistry: jest.fn(),
    initializeLinkerRuleRegistry: jest.fn(),
    registerLinkerRule: jest.fn(),
  };
});

import { archModelClient } from '../services/archModelClient';
import { gatewayClient } from '../services/gatewayClient';
import { getLinkerRuleRegistry } from '../services/linkerRuleRegistry';
import { EvidenceAtom } from '../types/evidenceAtom';
import { CandidateRelationship, LinkerRule } from '../types/linkerRule';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockGatewayClient = gatewayClient as jest.Mocked<typeof gatewayClient>;
const mockGetLinkerRuleRegistry = getLinkerRuleRegistry as jest.MockedFunction<typeof getLinkerRuleRegistry>;

/**
 * Helper: creates a sample EvidenceAtom.
 */
function makeAtom(overrides: Partial<EvidenceAtom> & { id: string; type: EvidenceAtom['type'] }): EvidenceAtom {
  return {
    runId: 'run-uuid-001',
    repoUrl: 'https://github.com/example/repo',
    filePath: 'src/example.ts',
    data: overrides.type === 'symbol'
      ? { name: 'Example', kind: 'class', line: 1, scope: null, language: 'TypeScript' }
      : overrides.type === 'file_structure'
        ? { relativePath: 'src/example.ts', extension: '.ts', sizeBytes: 1000, lineCount: 50 }
        : { patternName: 'import_statement', matchedText: 'import Example', line: 1, contextSnippet: 'import Example from...' },
    extractedAt: '2026-04-05T10:00:00Z',
    ...overrides,
  };
}

/**
 * Helper: creates a linker rule mock.
 */
function makeRule(id: string, matchFn: (atoms: EvidenceAtom[]) => CandidateRelationship[]): LinkerRule {
  return {
    id,
    name: `Rule ${id}`,
    description: `Test rule ${id}`,
    targetRelationshipType: 'imports',
    match: matchFn,
  };
}

describe('executeStep1b Orchestration (Phase 1b)', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const runId = 'run-uuid-001';

  beforeEach(() => {
    jest.clearAllMocks();
    uuidCounter = 0;

    // Default: no relationships to persist, no decision tasks
    mockArchModelClient.bulkSaveRelationships.mockResolvedValue(undefined);
    mockArchModelClient.bulkSaveDecisionTasks.mockResolvedValue(undefined);
    mockArchModelClient.updateDecisionTask.mockResolvedValue({} as any);
  });

  // ==========================================================================
  // Test 1: Full happy path -- atoms, rules, candidates across all bands,
  //         auto-accepted persisted, DecisionTasks created/resolved, summary correct
  // ==========================================================================
  test('full happy path: atoms returned, rules produce candidates across all confidence bands, summary metadata is correct', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    // Set up atoms
    const atoms: EvidenceAtom[] = [
      makeAtom({ id: 'atom-001', type: 'symbol', data: { name: 'Foo', kind: 'class', line: 1, scope: null, language: 'TypeScript' } }),
      makeAtom({ id: 'atom-002', type: 'symbol', data: { name: 'Bar', kind: 'class', line: 10, scope: null, language: 'TypeScript' } }),
      makeAtom({ id: 'atom-003', type: 'string_pattern', data: { patternName: 'import_statement', matchedText: 'import Foo', line: 1, contextSnippet: 'import Foo from...' } }),
      makeAtom({ id: 'atom-004', type: 'string_pattern', data: { patternName: 'reference', matchedText: 'Baz', line: 20, contextSnippet: 'use Baz' } }),
    ];
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    // Create a rule that produces candidates across all three bands
    const rule = makeRule('test-rule', () => [
      // High confidence (auto-accept): >= 0.8
      {
        sourceAtomId: 'atom-003',
        targetAtomId: 'atom-001',
        relationshipType: 'imports' as const,
        confidence: 0.9,
        data: { importStatement: 'import Foo', line: 1, isDefault: false },
        ruleId: 'test-rule',
      },
      // Ambiguous confidence: 0.4 - 0.79
      {
        sourceAtomId: 'atom-003',
        targetAtomId: 'atom-002',
        relationshipType: 'references' as const,
        confidence: 0.6,
        data: { referenceContext: 'ambiguous ref', line: 5 },
        ruleId: 'test-rule',
      },
      // Low confidence (discard): < 0.4
      {
        sourceAtomId: 'atom-004',
        targetAtomId: 'atom-001',
        relationshipType: 'references' as const,
        confidence: 0.2,
        data: { referenceContext: 'weak ref', line: 20 },
        ruleId: 'test-rule',
      },
    ]);

    const ruleRegistry = new Map<string, LinkerRule>();
    ruleRegistry.set('test-rule', rule);
    mockGetLinkerRuleRegistry.mockReturnValue(ruleRegistry);

    // Mock gateway resolution for the 1 ambiguous task
    mockGatewayClient.resolveDecisionTasks.mockResolvedValue({
      results: [
        {
          // First uuidv4() in executeStep1b is the confirm_relationship
          // DecisionTask: auto-accepted relationships use a DETERMINISTIC
          // hash id (generateRelationshipId), NOT uuidv4(), so they do not
          // consume the mocked uuid counter. The single ambiguous task is
          // therefore 'mock-uuid-0001'.
          taskId: 'mock-uuid-0001',
          status: 'resolved',
          outputData: {
            decision: 'confirm' as const,
            adjustedConfidence: 0.75,
            reasoning: 'Confirmed by LLM.',
          },
          error: null,
        },
      ],
    });

    const result = await executeStep1b(projectId, runId);

    // Verify atoms were fetched
    expect(mockArchModelClient.getEvidenceByRun).toHaveBeenCalledWith(projectId, runId);

    // Verify auto-accepted relationships were persisted (1 high-confidence)
    expect(mockArchModelClient.bulkSaveRelationships).toHaveBeenCalled();

    // Verify decision tasks were created and persisted (1 ambiguous)
    expect(mockArchModelClient.bulkSaveDecisionTasks).toHaveBeenCalled();

    // Verify gateway was called to resolve decision tasks
    expect(mockGatewayClient.resolveDecisionTasks).toHaveBeenCalledWith(
      projectId,
      runId,
      expect.arrayContaining([
        expect.objectContaining({
          taskType: 'confirm_relationship',
          status: 'pending',
        }),
      ])
    );

    // Verify summary metadata
    expect(result).toEqual(expect.objectContaining({
      upstreamAtomCount: 4,
      autoAcceptedCount: 1,
      decisionTaskCount: 1,
      decisionTaskResolvedCount: 1,
      decisionTaskFailedCount: 0,
      discardedCount: 1,
      relationshipCount: 2, // 1 auto-accepted + 1 LLM-confirmed
    }));
  });

  // ==========================================================================
  // Test 2: High-confidence candidates bypass DecisionTask creation
  //         and are persisted directly as relationships
  // ==========================================================================
  test('high-confidence candidates bypass DecisionTask creation and are persisted directly via bulkSaveRelationships', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    const atoms: EvidenceAtom[] = [
      makeAtom({ id: 'atom-001', type: 'file_structure', data: { relativePath: 'src/', extension: '', sizeBytes: 0, lineCount: 0 } }),
      makeAtom({ id: 'atom-002', type: 'file_structure', data: { relativePath: 'src/app.ts', extension: '.ts', sizeBytes: 500, lineCount: 25 } }),
    ];
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    // Rule produces only high-confidence candidates (>= 0.8)
    const rule = makeRule('high-only', () => [
      {
        sourceAtomId: 'atom-001',
        targetAtomId: 'atom-002',
        relationshipType: 'contains' as const,
        confidence: 1.0,
        data: { containerPath: 'src/', containedPath: 'src/app.ts' },
        ruleId: 'high-only',
      },
      {
        sourceAtomId: 'atom-001',
        targetAtomId: 'atom-002',
        relationshipType: 'imports' as const,
        confidence: 0.9,
        data: { importStatement: 'import app', line: 1, isDefault: false },
        ruleId: 'high-only',
      },
    ]);

    const ruleRegistry = new Map<string, LinkerRule>();
    ruleRegistry.set('high-only', rule);
    mockGetLinkerRuleRegistry.mockReturnValue(ruleRegistry);

    // Gateway should NOT be called since there are no ambiguous tasks
    mockGatewayClient.resolveDecisionTasks.mockResolvedValue({ results: [] });

    const result = await executeStep1b(projectId, runId);

    // Verify relationships were persisted
    expect(mockArchModelClient.bulkSaveRelationships).toHaveBeenCalled();
    const savedRelationships = mockArchModelClient.bulkSaveRelationships.mock.calls[0][2];
    expect(savedRelationships).toHaveLength(2);

    // Each saved relationship should have an id, runId, and inferredAt
    for (const rel of savedRelationships) {
      expect(rel.id).toBeDefined();
      expect(rel.runId).toBe(runId);
      expect(rel.inferredAt).toBeDefined();
    }

    // Verify no DecisionTasks were created (nothing ambiguous)
    expect(mockArchModelClient.bulkSaveDecisionTasks).not.toHaveBeenCalled();

    // Verify gateway was NOT called (no tasks to resolve)
    expect(mockGatewayClient.resolveDecisionTasks).not.toHaveBeenCalled();

    // Verify summary metadata
    expect(result).toEqual(expect.objectContaining({
      autoAcceptedCount: 2,
      decisionTaskCount: 0,
      decisionTaskResolvedCount: 0,
      decisionTaskFailedCount: 0,
      discardedCount: 0,
      relationshipCount: 2,
    }));
  });

  // ==========================================================================
  // Test 3: Low-confidence candidates (below AMBIGUOUS_THRESHOLD) are discarded
  // ==========================================================================
  test('low-confidence candidates below AMBIGUOUS_THRESHOLD are discarded -- not persisted and not turned into DecisionTasks', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    const atoms: EvidenceAtom[] = [
      makeAtom({ id: 'atom-001', type: 'symbol', data: { name: 'Foo', kind: 'class', line: 1, scope: null, language: 'TypeScript' } }),
      makeAtom({ id: 'atom-002', type: 'string_pattern', data: { patternName: 'reference', matchedText: 'foo', line: 10, contextSnippet: 'maybe foo' } }),
    ];
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    // Rule produces only low-confidence candidates (< 0.4)
    const rule = makeRule('low-only', () => [
      {
        sourceAtomId: 'atom-002',
        targetAtomId: 'atom-001',
        relationshipType: 'references' as const,
        confidence: 0.3,
        data: { referenceContext: 'weak match', line: 10 },
        ruleId: 'low-only',
      },
      {
        sourceAtomId: 'atom-002',
        targetAtomId: 'atom-001',
        relationshipType: 'calls' as const,
        confidence: 0.1,
        data: { callerSignature: 'a()', calleeSignature: 'b()', line: 10 },
        ruleId: 'low-only',
      },
    ]);

    const ruleRegistry = new Map<string, LinkerRule>();
    ruleRegistry.set('low-only', rule);
    mockGetLinkerRuleRegistry.mockReturnValue(ruleRegistry);

    const result = await executeStep1b(projectId, runId);

    // Verify NO relationships were persisted
    expect(mockArchModelClient.bulkSaveRelationships).not.toHaveBeenCalled();

    // Verify NO DecisionTasks were created
    expect(mockArchModelClient.bulkSaveDecisionTasks).not.toHaveBeenCalled();

    // Verify gateway was NOT called
    expect(mockGatewayClient.resolveDecisionTasks).not.toHaveBeenCalled();

    // Verify summary: everything discarded
    expect(result).toEqual(expect.objectContaining({
      autoAcceptedCount: 0,
      decisionTaskCount: 0,
      decisionTaskResolvedCount: 0,
      decisionTaskFailedCount: 0,
      discardedCount: 2,
      relationshipCount: 0,
      upstreamAtomCount: 2,
    }));
  });

  // ==========================================================================
  // Test 4: Competing ambiguous candidates produce a single
  //         resolve_competing_relationships DecisionTask
  // ==========================================================================
  test('competing ambiguous candidates produce a single resolve_competing_relationships DecisionTask instead of individual confirm tasks', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    const atoms: EvidenceAtom[] = [
      makeAtom({ id: 'atom-src', type: 'string_pattern', data: { patternName: 'import_statement', matchedText: 'import Foo', line: 1, contextSnippet: 'import Foo from...' } }),
      makeAtom({ id: 'atom-target-a', type: 'symbol', data: { name: 'Foo', kind: 'class', line: 1, scope: null, language: 'TypeScript' }, filePath: 'src/a/Foo.ts' }),
      makeAtom({ id: 'atom-target-b', type: 'symbol', data: { name: 'Foo', kind: 'interfaces', line: 1, scope: null, language: 'TypeScript' }, filePath: 'src/b/Foo.ts' }),
    ];
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    // Rule produces two ambiguous candidates with the same sourceAtomId and same relationshipType
    // These should be grouped as competing relationships
    const rule = makeRule('competing-rule', () => [
      {
        sourceAtomId: 'atom-src',
        targetAtomId: 'atom-target-a',
        relationshipType: 'imports' as const,
        confidence: 0.6,
        data: { importStatement: 'import Foo', line: 1, isDefault: false },
        ruleId: 'competing-rule',
      },
      {
        sourceAtomId: 'atom-src',
        targetAtomId: 'atom-target-b',
        relationshipType: 'imports' as const,
        confidence: 0.5,
        data: { importStatement: 'import Foo', line: 1, isDefault: false },
        ruleId: 'competing-rule',
      },
    ]);

    const ruleRegistry = new Map<string, LinkerRule>();
    ruleRegistry.set('competing-rule', rule);
    mockGetLinkerRuleRegistry.mockReturnValue(ruleRegistry);

    // Mock the gateway to resolve the competing task by selecting index 0
    mockGatewayClient.resolveDecisionTasks.mockResolvedValue({
      results: [
        {
          taskId: 'mock-uuid-0001', // First UUID generated goes to the DecisionTask
          status: 'resolved',
          outputData: {
            selectedIndex: 0,
            adjustedConfidence: 0.85,
            reasoning: 'First Foo is the correct target.',
          },
          error: null,
        },
      ],
    });

    const result = await executeStep1b(projectId, runId);

    // Verify DecisionTasks were created
    expect(mockArchModelClient.bulkSaveDecisionTasks).toHaveBeenCalled();
    const savedTasks = mockArchModelClient.bulkSaveDecisionTasks.mock.calls[0][2];

    // Should be exactly 1 task of type resolve_competing_relationships (not 2 individual confirm tasks)
    expect(savedTasks).toHaveLength(1);
    expect(savedTasks[0].taskType).toBe('resolve_competing_relationships');
    expect(savedTasks[0].status).toBe('pending');

    // The input data should include competitors with full atom data
    const inputData = savedTasks[0].inputData as any;
    expect(inputData.sourceAtom).toBeDefined();
    expect(inputData.competitors).toHaveLength(2);

    // Verify summary
    expect(result).toEqual(expect.objectContaining({
      autoAcceptedCount: 0,
      decisionTaskCount: 1,
      decisionTaskResolvedCount: 1,
      decisionTaskFailedCount: 0,
      discardedCount: 0,
      relationshipCount: 1, // 1 relationship from the resolved competing task
    }));
  });

  // ==========================================================================
  // Test 5: Failed DecisionTask resolution increments decisionTaskFailedCount
  //         and does NOT persist a relationship
  // ==========================================================================
  test('failed DecisionTask resolution increments decisionTaskFailedCount and does not persist a relationship', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    const atoms: EvidenceAtom[] = [
      makeAtom({ id: 'atom-001', type: 'string_pattern', data: { patternName: 'import_statement', matchedText: 'import Foo', line: 1, contextSnippet: 'import Foo' } }),
      makeAtom({ id: 'atom-002', type: 'symbol', data: { name: 'Foo', kind: 'class', line: 1, scope: null, language: 'TypeScript' } }),
    ];
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    // Rule produces a single ambiguous candidate
    const rule = makeRule('fail-rule', () => [
      {
        sourceAtomId: 'atom-001',
        targetAtomId: 'atom-002',
        relationshipType: 'imports' as const,
        confidence: 0.6,
        data: { importStatement: 'import Foo', line: 1, isDefault: false },
        ruleId: 'fail-rule',
      },
    ]);

    const ruleRegistry = new Map<string, LinkerRule>();
    ruleRegistry.set('fail-rule', rule);
    mockGetLinkerRuleRegistry.mockReturnValue(ruleRegistry);

    // Mock the gateway to return a FAILED status for the task
    mockGatewayClient.resolveDecisionTasks.mockResolvedValue({
      results: [
        {
          taskId: 'mock-uuid-0001',
          status: 'failed',
          outputData: null,
          error: 'LLM call timed out',
        },
      ],
    });

    const result = await executeStep1b(projectId, runId);

    // Verify NO additional relationships were persisted (beyond auto-accepted, which is 0)
    expect(mockArchModelClient.bulkSaveRelationships).not.toHaveBeenCalled();

    // Verify the failed task was updated
    expect(mockArchModelClient.updateDecisionTask).toHaveBeenCalledWith(
      projectId,
      runId,
      'mock-uuid-0001',
      expect.objectContaining({
        status: 'failed',
      })
    );

    // Verify summary metadata
    expect(result).toEqual(expect.objectContaining({
      autoAcceptedCount: 0,
      decisionTaskCount: 1,
      decisionTaskResolvedCount: 0,
      decisionTaskFailedCount: 1,
      discardedCount: 0,
      relationshipCount: 0,
    }));
  });

  // ==========================================================================
  // Test 6: Relationships from confirmed DecisionTasks use the adjustedConfidence
  //         from the LLM output, not the original rule confidence
  // ==========================================================================
  test('relationships from confirmed DecisionTasks use adjustedConfidence from LLM output, not original rule confidence', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    const atoms: EvidenceAtom[] = [
      makeAtom({ id: 'atom-001', type: 'string_pattern', data: { patternName: 'import_statement', matchedText: 'import Bar', line: 1, contextSnippet: 'import Bar' } }),
      makeAtom({ id: 'atom-002', type: 'symbol', data: { name: 'Bar', kind: 'class', line: 1, scope: null, language: 'TypeScript' } }),
    ];
    mockArchModelClient.getEvidenceByRun.mockResolvedValue(atoms);

    const originalConfidence = 0.55;
    const adjustedConfidence = 0.92;

    // Rule produces a single ambiguous candidate
    const rule = makeRule('adjust-rule', () => [
      {
        sourceAtomId: 'atom-001',
        targetAtomId: 'atom-002',
        relationshipType: 'imports' as const,
        confidence: originalConfidence,
        data: { importStatement: 'import Bar', line: 1, isDefault: false },
        ruleId: 'adjust-rule',
      },
    ]);

    const ruleRegistry = new Map<string, LinkerRule>();
    ruleRegistry.set('adjust-rule', rule);
    mockGetLinkerRuleRegistry.mockReturnValue(ruleRegistry);

    // Mock gateway to return a confirmed result with adjustedConfidence
    mockGatewayClient.resolveDecisionTasks.mockResolvedValue({
      results: [
        {
          taskId: 'mock-uuid-0001',
          status: 'resolved',
          outputData: {
            decision: 'confirm' as const,
            adjustedConfidence,
            reasoning: 'Import clearly matches the Bar class.',
          },
          error: null,
        },
      ],
    });

    const result = await executeStep1b(projectId, runId);

    // The confirmed relationship should be persisted
    // It will be in the second call to bulkSaveRelationships (after auto-accepted ones)
    // or mixed in -- let's check all calls
    const allBulkSaveCalls = mockArchModelClient.bulkSaveRelationships.mock.calls;

    // Find the relationship that was saved with the confirmed result
    let confirmedRelationship: any = null;
    for (const call of allBulkSaveCalls) {
      const rels = call[2]; // third argument is the relationships array
      for (const rel of rels) {
        if (rel.sourceAtomId === 'atom-001' && rel.targetAtomId === 'atom-002') {
          confirmedRelationship = rel;
        }
      }
    }

    expect(confirmedRelationship).not.toBeNull();
    // The confidence should be the LLM's adjustedConfidence, NOT the original rule confidence
    expect(confirmedRelationship.confidence).toBe(adjustedConfidence);
    expect(confirmedRelationship.confidence).not.toBe(originalConfidence);

    // Verify summary
    expect(result).toEqual(expect.objectContaining({
      decisionTaskResolvedCount: 1,
      relationshipCount: 1,
    }));
  });
});
