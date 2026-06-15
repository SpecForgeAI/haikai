/**
 * Tests for save-back of new candidate types (class, method, endpoint, physical_attribute).
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 10: CANDIDATE_TYPE_CONFIG Updates for New Types
 *
 * Tests:
 * 1. CANDIDATE_TYPE_CONFIG has entries for 'class', 'method', 'endpoint', 'physical_attribute'
 * 2. class config maps to correct targetArrayKey, idPrefix, parentFkField
 * 3. method config maps to correct targetArrayKey, idPrefix, parentFkField
 * 4. endpoint config maps to correct targetArrayKey, idPrefix, parentFkField
 * 5. physical_attribute config maps to correct targetArrayKey, idPrefix, parentFkField
 * 6. convertCandidateToEntity() produces correct entity shape for each new type
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import {
  CANDIDATE_TYPE_CONFIG,
  convertCandidateToEntity,
  getTargetArrayKey,
} from '../services/candidateSaveBackService';

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
    synthesized_at: '2026-04-07T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

describe('candidateSaveBackService - new candidate types (TG10)', () => {

  // ==========================================================================
  // Test 1: CANDIDATE_TYPE_CONFIG has entries for all 4 new types
  // ==========================================================================
  describe('CANDIDATE_TYPE_CONFIG entries', () => {
    it('has entries for class, method, endpoint, and physical_attribute', () => {
      expect(CANDIDATE_TYPE_CONFIG).toHaveProperty('class');
      expect(CANDIDATE_TYPE_CONFIG).toHaveProperty('method');
      expect(CANDIDATE_TYPE_CONFIG).toHaveProperty('endpoints');
      expect(CANDIDATE_TYPE_CONFIG).toHaveProperty('physical_data_attributes');
    });
  });

  // ==========================================================================
  // Test 2: class config maps correctly
  // ==========================================================================
  describe('class config', () => {
    it('maps to { targetArrayKey: "classes", idPrefix: "cls-", parentFkField: "service_id" }', () => {
      const config = CANDIDATE_TYPE_CONFIG['class'];
      expect(config.targetArrayKey).toBe('classes');
      expect(config.idPrefix).toBe('cls-');
      expect(config.parentFkField).toBe('service_id');
    });
  });

  // ==========================================================================
  // Test 3: method config maps correctly
  // ==========================================================================
  describe('method config', () => {
    it('maps to { targetArrayKey: "methods", idPrefix: "mth-", parentFkField: "class_id" }', () => {
      const config = CANDIDATE_TYPE_CONFIG['method'];
      expect(config.targetArrayKey).toBe('methods');
      expect(config.idPrefix).toBe('mth-');
      expect(config.parentFkField).toBe('class_id');
    });
  });

  // ==========================================================================
  // Test 4: endpoint config maps correctly
  // ==========================================================================
  describe('endpoint config', () => {
    it('maps to { targetArrayKey: "endpoints", idPrefix: "ep-", parentFkField: "interface_id" }', () => {
      const config = CANDIDATE_TYPE_CONFIG['endpoints'];
      expect(config.targetArrayKey).toBe('endpoints');
      expect(config.idPrefix).toBe('ep-');
      expect(config.parentFkField).toBe('interface_id');
    });
  });

  // ==========================================================================
  // Test 5: physical_attribute config maps correctly
  // ==========================================================================
  describe('physical_attribute config', () => {
    it('maps to { targetArrayKey: "physical_data_attributes", idPrefix: "pda-", parentFkField: "physical_entity_id" }', () => {
      const config = CANDIDATE_TYPE_CONFIG['physical_data_attributes'];
      expect(config.targetArrayKey).toBe('physical_data_attributes');
      expect(config.idPrefix).toBe('pda-');
      expect(config.parentFkField).toBe('physical_entity_id');
    });
  });

  // ==========================================================================
  // Test 6: convertCandidateToEntity() produces correct entity shape for each new type
  // ==========================================================================
  describe('convertCandidateToEntity - new types', () => {
    it('produces correct entity shape for class type', () => {
      const candidate = makeCandidate({
        id: 'cand-cls-1',
        name: 'OrderController',
        candidate_type: 'class',
        data: {
          description: 'REST controller for orders',
        },
        parent_candidate_id: 'cand-svc-1',
      });

      const candidateIdToEntityId: Record<string, string> = {
        'cand-svc-1': 'svc-existing-123',
      };

      const entity = convertCandidateToEntity(candidate, 'TestProject', candidateIdToEntityId);

      expect(entity.id).toMatch(/^cls-/);
      expect(entity.name).toBe('OrderController');
      expect(entity.description).toBe('REST controller for orders');
      expect(entity.model_file_id).toBe('TestProject');
      expect(entity.service_id).toBe('svc-existing-123');
    });

    it('produces correct entity shape for method type', () => {
      const candidate = makeCandidate({
        id: 'cand-mth-1',
        name: 'processOrder',
        candidate_type: 'method',
        data: {
          description: 'Processes a new order',
        },
        parent_candidate_id: 'cand-cls-1',
      });

      const candidateIdToEntityId: Record<string, string> = {
        'cand-cls-1': 'cls-existing-456',
      };

      const entity = convertCandidateToEntity(candidate, 'TestProject', candidateIdToEntityId);

      expect(entity.id).toMatch(/^mth-/);
      expect(entity.name).toBe('processOrder');
      expect(entity.description).toBe('Processes a new order');
      expect(entity.model_file_id).toBe('TestProject');
      expect(entity.class_id).toBe('cls-existing-456');
    });

    it('produces correct entity shape for endpoint type with metadata', () => {
      const candidate = makeCandidate({
        id: 'cand-ep-1',
        name: 'POST /api/orders',
        candidate_type: 'endpoints',
        data: {
          description: 'Creates a new order',
          http_method: 'POST',
          path: '/api/orders',
        },
        parent_candidate_id: 'cand-ifc-1',
      });

      const candidateIdToEntityId: Record<string, string> = {
        'cand-ifc-1': 'ifc-existing-789',
      };

      const entity = convertCandidateToEntity(candidate, 'TestProject', candidateIdToEntityId);

      expect(entity.id).toMatch(/^ep-/);
      expect(entity.name).toBe('POST /api/orders');
      expect(entity.description).toBe('Creates a new order');
      expect(entity.model_file_id).toBe('TestProject');
      expect(entity.interface_id).toBe('ifc-existing-789');
      expect(entity.operation_verb).toBe('POST');
      expect(entity.path_or_address).toBe('/api/orders');
    });

    it('produces correct entity shape for physical_attribute type with data_type', () => {
      const candidate = makeCandidate({
        id: 'cand-pda-1',
        name: 'order_id',
        candidate_type: 'physical_data_attributes',
        data: {
          description: 'Primary key for orders table',
          data_type: 'BIGINT',
        },
        parent_candidate_id: 'cand-pde-1',
      });

      const candidateIdToEntityId: Record<string, string> = {
        'cand-pde-1': 'pde-existing-101',
      };

      const entity = convertCandidateToEntity(candidate, 'TestProject', candidateIdToEntityId);

      expect(entity.id).toMatch(/^pda-/);
      expect(entity.name).toBe('order_id');
      expect(entity.description).toBe('Primary key for orders table');
      expect(entity.model_file_id).toBe('TestProject');
      expect(entity.physical_entity_id).toBe('pde-existing-101');
      expect(entity.data_type).toBe('BIGINT');
    });

    it('getTargetArrayKey returns correct keys for new types', () => {
      expect(getTargetArrayKey('class')).toBe('classes');
      expect(getTargetArrayKey('method')).toBe('methods');
      expect(getTargetArrayKey('endpoints')).toBe('endpoints');
      expect(getTargetArrayKey('physical_data_attributes')).toBe('physical_data_attributes');
    });
  });
});
