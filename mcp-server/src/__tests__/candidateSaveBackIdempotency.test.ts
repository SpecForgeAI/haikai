/**
 * Tests for candidateSaveBackService idempotent save-back (Increment 16).
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening
 * Task Group 3: Idempotent Candidate Save-Back
 *
 * 4 focused tests covering:
 * 1. Save-approved skips candidates already in `committed` review_status
 * 2. Save-approved checks DiscoveryCandidateEntityMappingEntity for previously saved
 *    candidates and skips them
 * 3. Only candidates with review_status `approved` (not `committed`) are processed
 * 4. After successful save-back, candidate review_status transitions to `committed`
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios at the module level so archModelClient uses our mock
jest.mock('axios');

// Mock generateId to produce deterministic IDs
let generateIdCounter = 0;
jest.mock('../utils/generateId', () => ({
  generateId: (prefix: string) => {
    generateIdCounter++;
    return `${prefix}test-${String(generateIdCounter).padStart(3, '0')}`;
  },
}));

import { DiscoveryCandidateDto, CandidateEntityMappingDto } from '../services/archModelClient';

// ============================================================================
// Helper: create a mock DiscoveryCandidateDto
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-default',
    run_id: 'run-001',
    candidate_type: 'application',
    name: 'DefaultApp',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-04-06T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

// ============================================================================
// Helper: create an empty model shell for mock returns
// ============================================================================

function makeEmptyModel(): any {
  return {
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        classes: [],
        methods: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        data_entity_points: [],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
        application_point_business_logics: [],
      },
    },
    diagrams: [],
  };
}

// ============================================================================
// Helper: create a standard mock client for axios
// ============================================================================

function createMockClient(
  candidates: DiscoveryCandidateDto[],
  existingMappings: CandidateEntityMappingDto[] = []
) {
  return {
    get: jest.fn().mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({
          data: [{ id: 'proj-001', name: 'TestProject' }],
        });
      }
      if (url.includes('/candidate-entity-mappings')) {
        return Promise.resolve({ data: existingMappings });
      }
      if (url.includes('/candidates')) {
        return Promise.resolve({ data: candidates });
      }
      if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
        return Promise.resolve({ data: makeEmptyModel() });
      }
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: [] }),
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe('candidateSaveBackService - idempotent save-back (Increment 16, TG3)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // Test 1: Save-approved skips candidates already in `committed` review_status
  // ==========================================================================
  describe('committed review_status exclusion', () => {
    it('skips candidates with review_status = committed when using manual mode', async () => {
      const axios = require('axios');

      const approvedCandidate = makeCandidate({
        id: 'cand-1',
        name: 'ApprovedApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'Ready to save' },
      });

      // This candidate has already been committed -- its status is 'committed'
      // which is in EXCLUDED_STATUSES, so it should be filtered out
      const committedCandidate = makeCandidate({
        id: 'cand-2',
        name: 'AlreadyCommittedApp',
        candidate_type: 'application',
        confidence: 0.95,
        status: 'committed',
        review_status: 'committed',
        data: { description: 'Already saved back' },
      });

      const mockClient = createMockClient([approvedCandidate, committedCandidate]);
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual');

      // Only the approved candidate should be processed; the committed one is excluded
      // by EXCLUDED_STATUSES (status = 'committed')
      expect(result.entitiesCreated).toBe(1);
      expect(result.candidatesCommitted).toBe(1);

      // Verify only ApprovedApp was saved to the model
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.applications[0].name).toBe('ApprovedApp');
    });
  });

  // ==========================================================================
  // Test 2: Save-approved checks DiscoveryCandidateEntityMappingEntity for
  //         previously saved candidates and skips them
  // ==========================================================================
  describe('existing mapping exclusion', () => {
    it('skips candidates that already have a candidate-entity mapping (previously saved back)', async () => {
      const axios = require('axios');

      const approvedNew = makeCandidate({
        id: 'cand-1',
        name: 'NewApp',
        candidate_type: 'application',
        confidence: 0.85,
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'Not yet saved' },
      });

      const approvedAlreadySaved = makeCandidate({
        id: 'cand-2',
        name: 'PreviouslySavedApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'Was saved in a prior execution' },
      });

      // Existing mapping for cand-2 indicates it was already saved back
      const existingMappings: CandidateEntityMappingDto[] = [
        {
          id: 'mapping-001',
          candidate_id: 'cand-2',
          run_id: 'run-001',
          entity_type: 'applications',
          entity_id: 'app-existing-001',
          action: 'created',
          created_at: '2026-04-05T12:00:00Z',
        },
      ];

      const mockClient = createMockClient(
        [approvedNew, approvedAlreadySaved],
        existingMappings
      );
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual');

      // Only cand-1 should be processed; cand-2 has an existing mapping
      expect(result.entitiesCreated).toBe(1);
      expect(result.candidatesCommitted).toBe(1);

      // Verify only NewApp was saved to the model
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.applications[0].name).toBe('NewApp');

      // Verify the mapping GET was called for the run
      const mappingGetCalls = mockClient.get.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/candidate-entity-mappings')
      );
      expect(mappingGetCalls).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Test 3: Only candidates with review_status 'approved' (not 'committed')
  //         are processed in manual mode
  // ==========================================================================
  describe('review_status filtering in manual mode', () => {
    it('processes only approved candidates, excluding committed, pending_review, rejected, and deferred', async () => {
      const axios = require('axios');

      const approvedCandidate = makeCandidate({
        id: 'cand-1',
        name: 'ApprovedApp',
        candidate_type: 'application',
        confidence: 0.5, // Low confidence -- manual mode ignores this
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'Approved by reviewer' },
      });

      const committedReviewCandidate = makeCandidate({
        id: 'cand-2',
        name: 'CommittedReviewApp',
        candidate_type: 'application',
        confidence: 0.95,
        status: 'committed',
        review_status: 'committed',
        data: { description: 'Already committed' },
      });

      const pendingCandidate = makeCandidate({
        id: 'cand-3',
        name: 'PendingApp',
        candidate_type: 'application',
        confidence: 0.99,
        status: 'proposed',
        review_status: 'pending_review',
        data: { description: 'Still pending' },
      });

      const rejectedCandidate = makeCandidate({
        id: 'cand-4',
        name: 'RejectedApp',
        candidate_type: 'application',
        confidence: 0.92,
        status: 'proposed',
        review_status: 'rejected',
        data: { description: 'Rejected by reviewer' },
      });

      const deferredCandidate = makeCandidate({
        id: 'cand-5',
        name: 'DeferredApp',
        candidate_type: 'application',
        confidence: 0.88,
        status: 'proposed',
        review_status: 'deferred',
        data: { description: 'Deferred for now' },
      });

      const mockClient = createMockClient([
        approvedCandidate,
        committedReviewCandidate,
        pendingCandidate,
        rejectedCandidate,
        deferredCandidate,
      ]);
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual');

      // Only cand-1 (approved, proposed status) should be processed
      // cand-2: status = 'committed' -> excluded by EXCLUDED_STATUSES
      // cand-3: review_status = 'pending_review' -> not 'approved'
      // cand-4: review_status = 'rejected' -> not 'approved'
      // cand-5: review_status = 'deferred' -> not 'approved'
      expect(result.entitiesCreated).toBe(1);
      expect(result.candidatesCommitted).toBe(1);

      // Verify only ApprovedApp was saved
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.applications[0].name).toBe('ApprovedApp');
    });
  });

  // ==========================================================================
  // Test 4: After successful save-back, candidate review_status transitions
  //         to 'committed'
  // ==========================================================================
  describe('review_status transition to committed', () => {
    it('updates both status and review_status to committed after successful save-back', async () => {
      const axios = require('axios');

      const candidate1 = makeCandidate({
        id: 'cand-1',
        name: 'AppOne',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'First app' },
      });

      const candidate2 = makeCandidate({
        id: 'cand-2',
        name: 'AppTwo',
        candidate_type: 'application',
        confidence: 0.85,
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'Second app' },
      });

      const mockClient = createMockClient([candidate1, candidate2]);
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual');

      expect(result.entitiesCreated).toBe(2);
      expect(result.candidatesCommitted).toBe(2);

      // Verify updateCandidate was called for each candidate with both
      // status and review_status set to 'committed'
      const candidateUpdateCalls = mockClient.put.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/candidates/')
      );
      expect(candidateUpdateCalls).toHaveLength(2);

      for (const call of candidateUpdateCalls) {
        const body = call[1];
        expect(body.status).toBe('committed');
        expect(body.review_status).toBe('committed');
        expect(body.data.committedEntityId).toBeDefined();
        expect(body.data.committedEntityType).toBe('applications');
      }
    });
  });
});
