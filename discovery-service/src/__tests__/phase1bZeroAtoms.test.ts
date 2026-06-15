/**
 * Phase 1b Gap Test: executeStep1b with zero atoms
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 11: Test Review and Gap Analysis
 *
 * Test:
 * 5. executeStep1b with zero atoms returns zero-count summary without errors
 *
 * Separated into its own file because it requires jest.mock on the linkerRuleRegistry
 * and other dependencies, which would conflict with pure unit tests that import
 * the real modules.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid
let uuidCounter = 200;
jest.mock('uuid', () => ({
  v4: jest.fn(() => {
    uuidCounter++;
    return `zero-uuid-${String(uuidCounter).padStart(4, '0')}`;
  }),
}));

// Mock the archModelClient
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

// Mock the gateway client
jest.mock('../services/gatewayClient', () => {
  return {
    gatewayClient: {
      resolveDecisionTasks: jest.fn(),
    },
  };
});

// Mock the analyzer registry
jest.mock('../services/analyzerRegistry', () => {
  return {
    getAnalyzerRegistry: jest.fn().mockReturnValue(new Map()),
    initializeAnalyzerRegistry: jest.fn(),
    registerAnalyzerPack: jest.fn(),
  };
});

// Mock the linker rule registry
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
import { LinkerRule } from '../types/linkerRule';

const mockArchClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockGateway = gatewayClient as jest.Mocked<typeof gatewayClient>;
const mockGetLinkerRegistry = getLinkerRuleRegistry as jest.MockedFunction<typeof getLinkerRuleRegistry>;

describe('executeStep1b with zero atoms (Phase 1b Gap Test)', () => {
  const projectId = 'proj-zero-atoms';
  const runId = 'run-zero-atoms';

  beforeEach(() => {
    jest.clearAllMocks();
    uuidCounter = 200;
  });

  test('executeStep1b with zero atoms returns zero-count summary without errors', async () => {
    const { executeStep1b } = jest.requireActual('../services/runManager') as {
      executeStep1b: (projectId: string, runId: string) => Promise<Record<string, unknown>>;
    };

    // Return empty atoms array
    mockArchClient.getEvidenceByRun.mockResolvedValue([]);

    // Registry with one rule that receives the empty atom list
    const rule: LinkerRule = {
      id: 'test-rule',
      name: 'Test Rule',
      description: 'A rule for testing',
      targetRelationshipType: 'imports',
      match: jest.fn().mockReturnValue([]),
    };

    const registry = new Map<string, LinkerRule>();
    registry.set('test-rule', rule);
    mockGetLinkerRegistry.mockReturnValue(registry);

    const result = await executeStep1b(projectId, runId);

    // Verify the summary metadata has all zero counts
    expect(result).toEqual({
      relationshipCount: 0,
      autoAcceptedCount: 0,
      decisionTaskCount: 0,
      decisionTaskResolvedCount: 0,
      decisionTaskFailedCount: 0,
      discardedCount: 0,
      upstreamAtomCount: 0,
    });

    // Verify atoms were fetched
    expect(mockArchClient.getEvidenceByRun).toHaveBeenCalledWith(projectId, runId);

    // The rule's match function should have been called with the empty array
    expect(rule.match).toHaveBeenCalledWith([]);

    // No relationships, tasks, or gateway calls should have been made
    expect(mockArchClient.bulkSaveRelationships).not.toHaveBeenCalled();
    expect(mockArchClient.bulkSaveDecisionTasks).not.toHaveBeenCalled();
    expect(mockGateway.resolveDecisionTasks).not.toHaveBeenCalled();
    expect(mockArchClient.updateDecisionTask).not.toHaveBeenCalled();
  });
});
