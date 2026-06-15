/**
 * Tests for archModelClient candidate and provenance mapping methods.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 4: Candidate Fetching and Provenance Mapping Methods
 *
 * Tests the getCandidatesByRun, updateCandidate, and bulkCreateCandidateEntityMappings
 * methods that were added to archModelClient.
 *
 * Multi-architecture migration (2026-05-11): all URLs are now architecture-scoped
 * via the /api/model/projects/{projectId}/architectures/{architectureId}/...
 * prefix. Each method validates architectureId loudly to prevent silent
 * fall-back to legacy URLs that corrupt cross-architecture model_files.
 */

import { AxiosError } from 'axios';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ARCHITECTURE_ID = '770e8400-e29b-41d4-a716-446655440002';
const RUN_ID = '660e8400-e29b-41d4-a716-446655440001';

describe('archModelClient - candidate save-back methods', () => {
  // ==========================================================================
  // Test 1: getCandidatesByRun sends GET to the architecture-scoped URL
  // ==========================================================================
  describe('getCandidatesByRun - basic fetch', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET /api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/candidates and returns DiscoveryCandidateDto[]', async () => {
      const mockCandidates = [
        {
          id: 'cand-001',
          run_id: RUN_ID,
          candidate_type: 'application',
          name: 'OrderApp',
          confidence: 0.92,
          status: 'proposed',
          source_cluster_ids: ['cluster-1', 'cluster-2'],
          data: { description: 'Order management application' },
          synthesized_at: '2026-04-05T10:00:00Z',
          parent_candidate_id: null,
        },
        {
          id: 'cand-002',
          run_id: RUN_ID,
          candidate_type: 'service',
          name: 'OrderService',
          confidence: 0.85,
          status: 'proposed',
          source_cluster_ids: ['cluster-3'],
          data: { description: 'Order processing service', service_type: 'microservice' },
          synthesized_at: '2026-04-05T10:01:00Z',
          parent_candidate_id: 'cand-001',
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockCandidates });
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getCandidatesByRun(PROJECT_ID, ARCHITECTURE_ID, RUN_ID);

      // Verify the GET call was made to the architecture-scoped URL with empty params
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCHITECTURE_ID)}/discovery/runs/${encodeURIComponent(RUN_ID)}/candidates`,
        { params: {} }
      );

      // Verify the returned data matches
      expect(result).toEqual(mockCandidates);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('OrderApp');
      expect(result[0].candidate_type).toBe('application');
      expect(result[1].parent_candidate_id).toBe('cand-001');
    });
  });

  // ==========================================================================
  // Test 2: getCandidatesByRun with type and status appends query params
  // ==========================================================================
  describe('getCandidatesByRun - with query params', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('appends type and status as query params when provided', async () => {
      const mockCandidates = [
        {
          id: 'cand-001',
          run_id: RUN_ID,
          candidate_type: 'application',
          name: 'OrderApp',
          confidence: 0.92,
          status: 'proposed',
          source_cluster_ids: ['cluster-1'],
          data: {},
          synthesized_at: '2026-04-05T10:00:00Z',
          parent_candidate_id: null,
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockCandidates });
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getCandidatesByRun(
        PROJECT_ID,
        ARCHITECTURE_ID,
        RUN_ID,
        'application',
        'proposed'
      );

      // Verify the GET call includes type and status query params on the architecture-scoped URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCHITECTURE_ID)}/discovery/runs/${encodeURIComponent(RUN_ID)}/candidates`,
        { params: { type: 'application', status: 'proposed' } }
      );

      // Verify the returned data
      expect(result).toEqual(mockCandidates);
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Test 3: updateCandidate sends PUT to the architecture-scoped URL
  // ==========================================================================
  describe('updateCandidate - successful update', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT /api/model/projects/{p}/architectures/{a}/discovery/runs/{r}/candidates/{c} and returns updated candidate', async () => {
      const candidateId = 'cand-001';

      const updateBody = {
        status: 'committed',
        data: {
          description: 'Order management application',
          committedEntityId: 'app-mk8r1ccg-bd7tv',
          committedEntityType: 'applications',
        },
      };

      const mockUpdated = {
        id: candidateId,
        run_id: RUN_ID,
        candidate_type: 'application',
        name: 'OrderApp',
        confidence: 0.92,
        status: 'committed',
        source_cluster_ids: ['cluster-1', 'cluster-2'],
        data: {
          description: 'Order management application',
          committedEntityId: 'app-mk8r1ccg-bd7tv',
          committedEntityType: 'applications',
        },
        synthesized_at: '2026-04-05T10:00:00Z',
        parent_candidate_id: null,
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockUpdated });
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.updateCandidate(
        PROJECT_ID,
        ARCHITECTURE_ID,
        RUN_ID,
        candidateId,
        updateBody
      );

      // Verify the PUT call was made with the architecture-scoped URL and body
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCHITECTURE_ID)}/discovery/runs/${encodeURIComponent(RUN_ID)}/candidates/${encodeURIComponent(candidateId)}`,
        updateBody
      );

      // Verify the returned data
      expect(result).toEqual(mockUpdated);
      expect(result.status).toBe('committed');
      expect(result.data.committedEntityId).toBe('app-mk8r1ccg-bd7tv');
      expect(result.data.committedEntityType).toBe('applications');
    });
  });

  // ==========================================================================
  // Test 4: bulkCreateCandidateEntityMappings sends POST with mappings array
  // ==========================================================================
  describe('bulkCreateCandidateEntityMappings - successful bulk create', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls POST architecture-scoped /candidate-entity-mappings with the mappings array', async () => {
      const mappings = [
        {
          id: '',
          candidate_id: 'cand-001',
          run_id: RUN_ID,
          entity_type: 'applications',
          entity_id: 'app-mk8r1ccg-bd7tv',
          action: 'created',
          created_at: '',
        },
        {
          id: '',
          candidate_id: 'cand-002',
          run_id: RUN_ID,
          entity_type: 'services',
          entity_id: 'svc-nk9s2ddh-ce8uw',
          action: 'reused',
          created_at: '',
        },
      ];

      const mockPersistedMappings = [
        {
          id: 'mapping-uuid-001',
          candidate_id: 'cand-001',
          run_id: RUN_ID,
          entity_type: 'applications',
          entity_id: 'app-mk8r1ccg-bd7tv',
          action: 'created',
          created_at: '2026-04-05T12:00:00Z',
        },
        {
          id: 'mapping-uuid-002',
          candidate_id: 'cand-002',
          run_id: RUN_ID,
          entity_type: 'services',
          entity_id: 'svc-nk9s2ddh-ce8uw',
          action: 'reused',
          created_at: '2026-04-05T12:00:00Z',
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({ data: mockPersistedMappings });
      const mockAxiosInstance = {
        post: mockPost,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.bulkCreateCandidateEntityMappings(
        PROJECT_ID,
        ARCHITECTURE_ID,
        RUN_ID,
        mappings
      );

      // Verify the POST call was made with the architecture-scoped URL and body
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCHITECTURE_ID)}/discovery/runs/${encodeURIComponent(RUN_ID)}/candidate-entity-mappings`,
        mappings
      );

      // Verify the returned data
      expect(result).toEqual(mockPersistedMappings);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('mapping-uuid-001');
      expect(result[0].action).toBe('created');
      expect(result[1].action).toBe('reused');
    });
  });

  // ==========================================================================
  // Test 5: getCandidatesByRun handles error responses by throwing with
  //          preserved status code
  // ==========================================================================
  describe('getCandidatesByRun - error handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws AxiosError with preserved status code on non-200 response', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 502',
        response: {
          status: 502,
          data: { message: 'Bad Gateway' },
          statusText: 'Bad Gateway',
          headers: {},
          config: {},
        },
      } as AxiosError;

      // Setup axios mock to reject with the error
      const axios = require('axios');
      const mockGet = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Verify the error is thrown (not swallowed) and status code is preserved
      await expect(
        archModelClient.getCandidatesByRun(PROJECT_ID, ARCHITECTURE_ID, RUN_ID)
      ).rejects.toMatchObject({
        isAxiosError: true,
        message: 'Request failed with status code 502',
        response: {
          status: 502,
        },
      });
    });
  });

  // ==========================================================================
  // Test 6: Loud-failure validation when architectureId is missing
  // ==========================================================================
  describe('architectureId loud-failure validation', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('getCandidatesByRun throws when architectureId is empty', async () => {
      const axios = require('axios');
      const mockGet = jest.fn();
      axios.create = jest.fn().mockReturnValue({ get: mockGet });

      const { archModelClient } = require('../services/archModelClient');

      await expect(
        archModelClient.getCandidatesByRun(PROJECT_ID, '', RUN_ID)
      ).rejects.toThrow(/architectureId is required/);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('updateCandidate throws when architectureId is empty', async () => {
      const axios = require('axios');
      const mockPut = jest.fn();
      axios.create = jest.fn().mockReturnValue({ put: mockPut });

      const { archModelClient } = require('../services/archModelClient');

      await expect(
        archModelClient.updateCandidate(PROJECT_ID, '', RUN_ID, 'cand-1', {})
      ).rejects.toThrow(/architectureId is required/);
      expect(mockPut).not.toHaveBeenCalled();
    });

    it('getCandidateEntityMappingsByRun throws when architectureId is empty', async () => {
      const axios = require('axios');
      const mockGet = jest.fn();
      axios.create = jest.fn().mockReturnValue({ get: mockGet });

      const { archModelClient } = require('../services/archModelClient');

      await expect(
        archModelClient.getCandidateEntityMappingsByRun(PROJECT_ID, '', RUN_ID)
      ).rejects.toThrow(/architectureId is required/);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('bulkCreateCandidateEntityMappings throws when architectureId is empty', async () => {
      const axios = require('axios');
      const mockPost = jest.fn();
      axios.create = jest.fn().mockReturnValue({ post: mockPost });

      const { archModelClient } = require('../services/archModelClient');

      await expect(
        archModelClient.bulkCreateCandidateEntityMappings(PROJECT_ID, '', RUN_ID, [])
      ).rejects.toThrow(/architectureId is required/);
      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});
