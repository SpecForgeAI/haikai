/**
 * Tests for discovery-service archModelClient new layer methods.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 5: TypeScript Type Definitions and archModelClient Methods
 *
 * Tests the bulkSaveRelationships, getRelationshipsByRun, getRelationshipCount,
 * bulkSaveClusters, getCandidatesByRun, and updateCandidate methods.
 *
 * Gap Tests (Task Group 7: Test Review and Gap Analysis):
 * - getClusterCount calls GET to /count and returns numeric count
 * - getCandidateCount calls GET to /count and returns numeric count
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

const ARCH_ID = 'arch-uuid-test';

// Mock runArchitectureRegistry so _resolveArchitectureForRun returns ARCH_ID
// without falling back to resolveDefaultArchitectureId (which would itself
// need an axios.get mock).
jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

describe('archModelClient - new layer methods', () => {
  // ==========================================================================
  // Test 1: bulkSaveRelationships calls POST to correct URL with relationship array body
  // ==========================================================================
  describe('bulkSaveRelationships', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls POST to correct URL with relationship array body', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const relationships = [
        {
          id: 'rel-001',
          runId,
          sourceAtomId: 'atom-001',
          targetAtomId: 'atom-002',
          relationshipType: 'imports' as const,
          confidence: 0.95,
          data: { importStatement: "import { Foo } from './foo'", line: 1, isDefault: false },
          inferredAt: '2026-04-05T10:00:00Z',
        },
        {
          id: 'rel-002',
          runId,
          sourceAtomId: 'atom-003',
          targetAtomId: 'atom-004',
          relationshipType: 'calls' as const,
          confidence: 0.8,
          data: { callerSignature: 'main()', calleeSignature: 'helper()', line: 42 },
          inferredAt: '2026-04-05T10:00:00Z',
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({ data: undefined });
      const mockAxiosInstance = {
        post: mockPost,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.bulkSaveRelationships(projectId, runId, relationships);

      // Verify POST was called with the correct URL and body.
      // Production maps relationships to snake_case via mapRelationshipToBackend
      // before sending; assert the wire shape, not the camelCase TS shape.
      const expectedRelationshipsBody = relationships.map((r) => ({
        id: r.id,
        run_id: r.runId,
        source_atom_id: r.sourceAtomId,
        target_atom_id: r.targetAtomId,
        relationship_type: r.relationshipType,
        confidence: r.confidence,
        data: r.data,
        inferred_at: r.inferredAt,
      }));
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/relationships`,
        expectedRelationshipsBody
      );
    });
  });

  // ==========================================================================
  // Test 2: getRelationshipsByRun calls GET with optional ?type= param
  // ==========================================================================
  describe('getRelationshipsByRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET with optional ?type= param', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const mockRelationships = [
        {
          id: 'rel-001',
          runId,
          sourceAtomId: 'atom-001',
          targetAtomId: 'atom-002',
          relationshipType: 'imports',
          confidence: 0.95,
          data: { importStatement: "import { Foo } from './foo'", line: 1, isDefault: false },
          inferredAt: '2026-04-05T10:00:00Z',
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockRelationships });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Call with type filter
      const result = await archModelClient.getRelationshipsByRun(projectId, runId, 'imports');

      // Verify GET was called with the correct URL and params
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/relationships`,
        { params: { type: 'imports' } }
      );

      // Verify the returned data
      expect(result).toEqual(mockRelationships);
      expect(result.length).toBe(1);
      expect(result[0].relationshipType).toBe('imports');
    });

    it('calls GET without params when type is not specified', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.getRelationshipsByRun(projectId, runId);

      // Verify GET was called with empty params (no type filter)
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/relationships`,
        { params: {} }
      );
    });
  });

  // ==========================================================================
  // Test 3: getRelationshipCount calls GET to /count and returns numeric count
  // ==========================================================================
  describe('getRelationshipCount', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET to /count and returns numeric count', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: 42 });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getRelationshipCount(projectId, runId);

      // Verify GET was called with the correct URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/relationships/count`
      );

      // Verify numeric return value
      expect(result).toBe(42);
      expect(typeof result).toBe('number');
    });
  });

  // ==========================================================================
  // Test 4: bulkSaveClusters calls POST to correct URL with cluster array body
  // ==========================================================================
  describe('bulkSaveClusters', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls POST to correct URL with cluster array body', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const clusters = [
        {
          id: 'cluster-001',
          runId,
          clusterType: 'service_boundary' as const,
          name: 'User Service',
          confidence: 0.85,
          members: [
            { memberType: 'atom' as const, memberId: 'atom-001' },
            { memberType: 'relationship' as const, memberId: 'rel-001' },
          ],
          data: { dominantLanguage: 'TypeScript', directoryRoot: 'src/services/user' },
          formedAt: '2026-04-05T10:00:00Z',
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({ data: undefined });
      const mockAxiosInstance = {
        post: mockPost,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.bulkSaveClusters(projectId, runId, clusters);

      // Verify POST was called with the correct URL and body.
      // Production maps clusters to snake_case via mapClusterToBackend
      // (including nested member objects); assert the wire shape.
      const expectedClustersBody = clusters.map((c) => ({
        id: c.id,
        run_id: c.runId,
        cluster_type: c.clusterType,
        name: c.name,
        confidence: c.confidence,
        members: c.members.map((m) => ({
          member_type: m.memberType,
          member_id: m.memberId,
        })),
        data: c.data,
        formed_at: c.formedAt,
      }));
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/clusters`,
        expectedClustersBody
      );
    });
  });

  // ==========================================================================
  // Test 5: getCandidatesByRun calls GET with optional ?type= and ?status= params
  // ==========================================================================
  describe('getCandidatesByRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET with both ?type= and ?status= params when both are provided', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const mockCandidates = [
        {
          id: 'cand-001',
          runId,
          candidateType: 'application',
          name: 'User Management System',
          confidence: 0.9,
          status: 'proposed',
          sourceClusterIds: ['cluster-001', 'cluster-002'],
          data: { description: 'Main user management application' },
          synthesizedAt: '2026-04-05T10:00:00Z',
          // Model-Aware Discovery (2026-05-30): mapCandidateFromBackend defaults
          // operation to 'create' when the wire row omits it.
          operation: 'create',
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockCandidates });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getCandidatesByRun(
        projectId, runId, 'application', 'proposed'
      );

      // Verify GET was called with both params
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/candidates`,
        { params: { type: 'application', status: 'proposed' } }
      );

      // Verify the returned data
      expect(result).toEqual(mockCandidates);
      expect(result.length).toBe(1);
      expect(result[0].candidateType).toBe('application');
      expect(result[0].status).toBe('proposed');
    });

    it('calls GET with only ?status= param when type is omitted', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.getCandidatesByRun(projectId, runId, undefined, 'accepted');

      // Verify GET was called with only status param
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/candidates`,
        { params: { status: 'accepted' } }
      );
    });
  });

  // ==========================================================================
  // Test 6: updateCandidate calls PUT to correct URL with update body
  // ==========================================================================
  describe('updateCandidate', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT to correct URL with update body and returns updated candidate', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const candidateId = 'cand-001';
      const update = { status: 'accepted' as const };

      const mockResponse = {
        id: candidateId,
        runId,
        candidateType: 'application',
        name: 'User Management System',
        confidence: 0.9,
        status: 'accepted',
        sourceClusterIds: ['cluster-001'],
        data: { description: 'Main user management application' },
        synthesizedAt: '2026-04-05T10:00:00Z',
        // Model-Aware Discovery (2026-05-30): mapCandidateFromBackend defaults
        // operation to 'create' when the wire row omits it.
        operation: 'create',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        put: mockPut,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.updateCandidate(
        projectId, runId, candidateId, update
      );

      // Verify PUT was called with the correct URL and body.
      // Production calls mapCandidateToBackend(update as DiscoveryCandidate),
      // producing a fully-keyed snake_case object: missing fields become
      // `undefined`, while parentCandidateId and logEnrichment go through
      // `?? null` and become explicit `null`.
      const expectedUpdateBody = {
        id: undefined,
        run_id: undefined,
        candidate_type: undefined,
        name: undefined,
        confidence: undefined,
        status: update.status,
        source_cluster_ids: undefined,
        data: undefined,
        synthesized_at: undefined,
        parent_candidate_id: null,
        log_enrichment: null,
        // Model-Aware Discovery (2026-05-30): mapCandidateToBackend now emits an
        // operation field, defaulting to create for operation-agnostic callers.
        operation: 'create',
      };
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}`,
        expectedUpdateBody
      );

      // Verify the returned data
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe(candidateId);
      expect(result.status).toBe('accepted');
    });
  });

  // ==========================================================================
  // Gap Tests (Task Group 7: Test Review and Gap Analysis)
  // ==========================================================================

  // ==========================================================================
  // Gap Test 7: getClusterCount calls GET to /count and returns numeric count
  // ==========================================================================
  describe('getClusterCount', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET to /clusters/count and returns numeric count', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: 7 });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getClusterCount(projectId, runId);

      // Verify GET was called with the correct URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/clusters/count`
      );

      // Verify numeric return value
      expect(result).toBe(7);
      expect(typeof result).toBe('number');
    });
  });

  // ==========================================================================
  // Gap Test 8: getCandidateCount calls GET to /count and returns numeric count
  // ==========================================================================
  describe('getCandidateCount', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET to /candidates/count and returns numeric count', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: 12 });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getCandidateCount(projectId, runId);

      // Verify GET was called with the correct URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/candidates/count`
      );

      // Verify numeric return value
      expect(result).toBe(12);
      expect(typeof result).toBe('number');
    });
  });
});
