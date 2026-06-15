/**
 * Tests for candidateSaveBackService review mode support.
 *
 * Spec: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 3: Save-Approved Backend Endpoint
 *
 * 4 focused tests covering:
 * 1. Auto mode: candidates with review_status = 'rejected' are excluded from eligibility
 * 2. Auto mode: candidates with review_status = 'deferred' are excluded from eligibility
 * 3. Manual mode: only candidates with review_status = 'approved' are eligible (ignores confidence)
 * 4. Manual mode: candidates with review_status = 'pending_review' and high confidence are excluded
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

import { DiscoveryCandidateDto } from '../services/archModelClient';

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
    synthesized_at: '2026-04-05T10:00:00Z',
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

function createMockClient(candidates: DiscoveryCandidateDto[]) {
  return {
    get: jest.fn().mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({
          data: [{ id: 'proj-001', name: 'TestProject' }],
        });
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

describe('candidateSaveBackService - review mode support (Increment 13)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // Test 1: Auto mode excludes candidates with review_status = 'rejected'
  // ==========================================================================
  describe('auto mode - review_status rejected exclusion', () => {
    it('excludes candidates with review_status = rejected even when confidence is high', async () => {
      const axios = require('axios');

      const eligibleCandidate = makeCandidate({
        id: 'cand-1',
        name: 'GoodApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        review_status: 'pending_review',
        data: { description: 'Eligible' },
      });

      const rejectedByReview = makeCandidate({
        id: 'cand-2',
        name: 'RejectedApp',
        candidate_type: 'application',
        confidence: 0.95,
        status: 'proposed',
        review_status: 'rejected',
        data: { description: 'Rejected by reviewer' },
      });

      const mockClient = createMockClient([eligibleCandidate, rejectedByReview]);
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'auto');

      // Only cand-1 should pass; cand-2 is excluded due to review_status = 'rejected'
      expect(result.entitiesCreated).toBe(1);
      expect(result.candidatesCommitted).toBe(1);

      // Verify only GoodApp was saved to the model
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.applications[0].name).toBe('GoodApp');
    });
  });

  // ==========================================================================
  // Test 2: Auto mode excludes candidates with review_status = 'deferred'
  // ==========================================================================
  describe('auto mode - review_status deferred exclusion', () => {
    it('excludes candidates with review_status = deferred even when confidence is high', async () => {
      const axios = require('axios');

      const eligibleCandidate = makeCandidate({
        id: 'cand-1',
        name: 'GoodApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'Eligible' },
      });

      const deferredByReview = makeCandidate({
        id: 'cand-2',
        name: 'DeferredApp',
        candidate_type: 'application',
        confidence: 0.88,
        status: 'proposed',
        review_status: 'deferred',
        data: { description: 'Deferred by reviewer' },
      });

      const mockClient = createMockClient([eligibleCandidate, deferredByReview]);
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'auto');

      // Only cand-1 should pass; cand-2 is excluded due to review_status = 'deferred'
      expect(result.entitiesCreated).toBe(1);
      expect(result.candidatesCommitted).toBe(1);

      // Verify only GoodApp was saved to the model
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(1);
      expect(savedModel.metaModel.entities.applications[0].name).toBe('GoodApp');
    });
  });

  // ==========================================================================
  // Test 3: Manual mode selects only approved candidates (ignores confidence)
  // ==========================================================================
  describe('manual mode - only approved candidates are eligible', () => {
    it('selects only candidates with review_status = approved regardless of confidence', async () => {
      const axios = require('axios');

      const approvedLowConfidence = makeCandidate({
        id: 'cand-1',
        name: 'ApprovedLowConf',
        candidate_type: 'application',
        confidence: 0.3, // Below auto threshold but approved
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'Low confidence but approved' },
      });

      const approvedHighConfidence = makeCandidate({
        id: 'cand-2',
        name: 'ApprovedHighConf',
        candidate_type: 'application',
        confidence: 0.95,
        status: 'proposed',
        review_status: 'approved',
        data: { description: 'High confidence and approved' },
      });

      const pendingHighConfidence = makeCandidate({
        id: 'cand-3',
        name: 'PendingHighConf',
        candidate_type: 'application',
        confidence: 0.92,
        status: 'proposed',
        review_status: 'pending_review',
        data: { description: 'High confidence but pending' },
      });

      const rejectedCandidate = makeCandidate({
        id: 'cand-4',
        name: 'RejectedApp',
        candidate_type: 'application',
        confidence: 0.9,
        status: 'proposed',
        review_status: 'rejected',
        data: { description: 'Rejected' },
      });

      const mockClient = createMockClient([
        approvedLowConfidence,
        approvedHighConfidence,
        pendingHighConfidence,
        rejectedCandidate,
      ]);
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual');

      // Only 2 approved candidates (cand-1 and cand-2) should be eligible
      expect(result.entitiesCreated).toBe(2);
      expect(result.candidatesCommitted).toBe(2);

      // Verify both approved candidates were saved
      const putModelCalls = mockClient.put.mock.calls.filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001'));
      expect(putModelCalls).toHaveLength(1);
      const savedModel = putModelCalls[0][1];
      expect(savedModel.metaModel.entities.applications).toHaveLength(2);
      const names = savedModel.metaModel.entities.applications.map((a: any) => a.name);
      expect(names).toContain('ApprovedLowConf');
      expect(names).toContain('ApprovedHighConf');
      // Pending and rejected should NOT be in the model
      expect(names).not.toContain('PendingHighConf');
      expect(names).not.toContain('RejectedApp');
    });
  });

  // ==========================================================================
  // Test 4: Manual mode excludes pending_review candidates with high confidence
  // ==========================================================================
  describe('manual mode - pending_review excluded despite high confidence', () => {
    it('excludes candidates with review_status = pending_review even when confidence exceeds auto threshold', async () => {
      const axios = require('axios');

      const pendingHighConfidence = makeCandidate({
        id: 'cand-1',
        name: 'PendingApp',
        candidate_type: 'application',
        confidence: 0.99,
        status: 'proposed',
        review_status: 'pending_review',
        data: { description: 'Very high confidence but pending review' },
      });

      const deferredHighConfidence = makeCandidate({
        id: 'cand-2',
        name: 'DeferredApp',
        candidate_type: 'application',
        confidence: 0.95,
        status: 'proposed',
        review_status: 'deferred',
        data: { description: 'High confidence but deferred' },
      });

      const mockClient = createMockClient([pendingHighConfidence, deferredHighConfidence]);
      axios.create = jest.fn().mockReturnValue(mockClient);

      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual');

      // No candidates should be eligible -- neither is approved
      expect(result.entitiesCreated).toBe(0);
      expect(result.entitiesSkipped).toBe(0);
      expect(result.candidatesCommitted).toBe(0);

      // Verify getModel was never called (early return path)
      const getModelCalls = mockClient.get.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/model/projects/') && c[0].endsWith('/architectures/arch-001')
      );
      expect(getModelCalls).toHaveLength(0);

      // Verify putModel was never called
      expect(mockClient.put).not.toHaveBeenCalled();
    });
  });
});
