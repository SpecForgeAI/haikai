/**
 * Tests for candidateSaveBackService conversion utilities and topological sort.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 5: Entity Conversion and Topological Sort Utilities
 *
 * Tests buildDepthMap, convertCandidateToEntity, and getTargetArrayKey.
 *
 * Updated 2026-04-20: discovery-originated candidate_type keys renamed to
 * plural form to match meta-model reference. MCP-predates-discovery keys
 * (application, app_component, service, business_process, class, method,
 * data_entity) remain singular.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import {
  buildDepthMap,
  convertCandidateToEntity,
  getTargetArrayKey,
  CANDIDATE_TYPE_CONFIG,
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
    synthesized_at: '2026-04-05T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

describe('candidateSaveBackService - conversion and topological sort', () => {
  // ==========================================================================
  // Test 1: buildDepthMap with a flat list (no parents) returns all at depth 0
  // ==========================================================================
  describe('buildDepthMap - flat list', () => {
    it('returns all candidates at depth 0 when none have parents', () => {
      const candidates = [
        makeCandidate({ id: 'c1', name: 'App1', candidate_type: 'application' }),
        makeCandidate({ id: 'c2', name: 'App2', candidate_type: 'application' }),
        makeCandidate({ id: 'c3', name: 'BP1', candidate_type: 'business_process' }),
      ];

      const depthMap = buildDepthMap(candidates);

      expect(depthMap.size).toBe(3);
      expect(depthMap.get('c1')).toBe(0);
      expect(depthMap.get('c2')).toBe(0);
      expect(depthMap.get('c3')).toBe(0);
    });
  });

  // ==========================================================================
  // Test 2: buildDepthMap with a two-level hierarchy (application -> service)
  // ==========================================================================
  describe('buildDepthMap - two-level hierarchy', () => {
    it('returns correct depths 0 and 1 for application -> service', () => {
      const candidates = [
        makeCandidate({ id: 'app-1', name: 'OrderApp', candidate_type: 'application' }),
        makeCandidate({
          id: 'svc-1',
          name: 'OrderService',
          candidate_type: 'service',
          parent_candidate_id: 'app-1',
        }),
        makeCandidate({
          id: 'svc-2',
          name: 'PaymentService',
          candidate_type: 'service',
          parent_candidate_id: 'app-1',
        }),
      ];

      const depthMap = buildDepthMap(candidates);

      expect(depthMap.size).toBe(3);
      expect(depthMap.get('app-1')).toBe(0);
      expect(depthMap.get('svc-1')).toBe(1);
      expect(depthMap.get('svc-2')).toBe(1);
    });
  });

  // ==========================================================================
  // Test 3: buildDepthMap with a three-level hierarchy
  //          (application -> service -> interfaces)
  // ==========================================================================
  describe('buildDepthMap - three-level hierarchy', () => {
    it('returns depths 0, 1, 2 for application -> service -> interfaces', () => {
      const candidates = [
        makeCandidate({ id: 'app-1', name: 'OrderApp', candidate_type: 'application' }),
        makeCandidate({
          id: 'svc-1',
          name: 'OrderService',
          candidate_type: 'service',
          parent_candidate_id: 'app-1',
        }),
        makeCandidate({
          id: 'ifc-1',
          name: 'OrderAPI',
          candidate_type: 'interfaces',
          parent_candidate_id: 'svc-1',
        }),
      ];

      const depthMap = buildDepthMap(candidates);

      expect(depthMap.size).toBe(3);
      expect(depthMap.get('app-1')).toBe(0);
      expect(depthMap.get('svc-1')).toBe(1);
      expect(depthMap.get('ifc-1')).toBe(2);
    });
  });

  // ==========================================================================
  // Test 4: convertCandidateToEntity for `application` type
  // ==========================================================================
  describe('convertCandidateToEntity - application type', () => {
    it('produces correct entity shape with id, name, description, model_file_id, and default null fields', () => {
      const candidate = makeCandidate({
        id: 'cand-app-1',
        name: 'OrderApp',
        candidate_type: 'application',
        data: { description: 'Manages order lifecycle' },
      });

      const entity = convertCandidateToEntity(candidate, 'TestProject', {});

      // Check generated ID prefix
      expect(entity.id).toMatch(/^app-/);
      expect(entity.name).toBe('OrderApp');
      expect(entity.description).toBe('Manages order lifecycle');
      expect(entity.model_file_id).toBe('TestProject');

      // Check default null fields following anchorEntitiesService pattern
      expect(entity.app_type).toBe('');
      expect(entity.status).toBe('');
      expect(entity.tags).toBe('');
      expect(entity.valid_from).toBeNull();
      expect(entity.valid_to).toBeNull();
      expect(entity.is_internal).toBeNull();

      // Should NOT have parent FK fields
      expect(entity.application_id).toBeUndefined();
      expect(entity.service_id).toBeUndefined();
    });
  });

  // ==========================================================================
  // Test 5: convertCandidateToEntity for `service` type populates service_type,
  //          core_tech, and resolves application_id from candidateIdToEntityId
  // ==========================================================================
  describe('convertCandidateToEntity - service type', () => {
    it('populates service_type and core_tech from candidate data and resolves application_id via parent', () => {
      const candidate = makeCandidate({
        id: 'cand-svc-1',
        name: 'OrderService',
        candidate_type: 'service',
        data: {
          description: 'Processes orders',
          service_type: 'microservice',
          core_tech: 'Node.js',
        },
        parent_candidate_id: 'cand-app-1',
      });

      const candidateIdToEntityId: Record<string, string> = {
        'cand-app-1': 'app-existing-123',
      };

      const entity = convertCandidateToEntity(candidate, 'TestProject', candidateIdToEntityId);

      // Check generated ID prefix
      expect(entity.id).toMatch(/^svc-/);
      expect(entity.name).toBe('OrderService');
      expect(entity.description).toBe('Processes orders');
      expect(entity.model_file_id).toBe('TestProject');

      // Type-specific fields from data
      expect(entity.service_type).toBe('microservice');
      expect(entity.core_tech).toBe('Node.js');

      // Parent FK resolved from map
      expect(entity.application_id).toBe('app-existing-123');

      // Default fields
      expect(entity.app_component_id).toBeNull();
      expect(entity.tags).toBe('');
      expect(entity.valid_from).toBeNull();
      expect(entity.valid_to).toBeNull();
      expect(entity.package_set_id).toBeNull();
      expect(entity.is_internal).toBeNull();
    });
  });

  // ==========================================================================
  // Test 6: convertCandidateToEntity for `physical_data_entities` type
  // ==========================================================================
  describe('convertCandidateToEntity - physical_data_entities type', () => {
    it('populates physical_type and database_name from candidate data', () => {
      const candidate = makeCandidate({
        id: 'cand-pde-1',
        name: 'orders_table',
        candidate_type: 'physical_data_entities',
        data: {
          description: 'Orders database table',
          physical_type: 'TABLE',
          database_name: 'order_db',
        },
      });

      const entity = convertCandidateToEntity(candidate, 'TestProject', {});

      // Check generated ID prefix
      expect(entity.id).toMatch(/^pde-/);
      expect(entity.name).toBe('orders_table');
      expect(entity.description).toBe('Orders database table');
      expect(entity.model_file_id).toBe('TestProject');

      // Type-specific fields
      expect(entity.physical_type).toBe('TABLE');
      expect(entity.database_name).toBe('order_db');

      // Default fields
      expect(entity.tags).toBe('');
      expect(entity.valid_from).toBeNull();
      expect(entity.valid_to).toBeNull();

      // Should NOT have parent FK
      expect(entity.application_id).toBeUndefined();
      expect(entity.service_id).toBeUndefined();
    });

    // ------------------------------------------------------------------------
    // Bug fix (2026-05-17): database-discovery candidates put the kind on
    // data.objectType ('table' / 'view' / 'materialized_view'), NOT
    // data.physical_type. Before the fix every DB candidate landed with
    // physical_type='' and disappeared from the Physical Entities grid's
    // type filter.
    // ------------------------------------------------------------------------
    it("falls back to data.objectType when physical_type is absent, mapping 'table' -> 'Table'", () => {
      const candidate = makeCandidate({
        id: 'cand-pde-table',
        name: 'TRADE',
        candidate_type: 'physical_data_entities',
        data: {
          dbEngine: 'sybase',
          objectType: 'table',
          databaseName: 'hier_dev1',
        },
      });
      const entity = convertCandidateToEntity(candidate, 'TestProject', {});
      expect(entity.physical_type).toBe('Table');
      // databaseName (camelCase from DB pack) maps to database_name on the row.
      expect(entity.database_name).toBe('hier_dev1');
    });

    it("falls back to data.objectType='view' -> 'View'", () => {
      const candidate = makeCandidate({
        id: 'cand-pde-view',
        name: 'v_active_trades',
        candidate_type: 'physical_data_entities',
        data: { objectType: 'view' },
      });
      const entity = convertCandidateToEntity(candidate, 'TestProject', {});
      expect(entity.physical_type).toBe('View');
    });

    it("falls back to data.objectType='materialized_view' -> 'Materialized View'", () => {
      const candidate = makeCandidate({
        id: 'cand-pde-mv',
        name: 'mv_daily_totals',
        candidate_type: 'physical_data_entities',
        data: { objectType: 'materialized_view' },
      });
      const entity = convertCandidateToEntity(candidate, 'TestProject', {});
      expect(entity.physical_type).toBe('Materialized View');
    });

    it('uses data.physical_type when present (existing callers unchanged)', () => {
      const candidate = makeCandidate({
        id: 'cand-pde-explicit',
        name: 'legacy_entity',
        candidate_type: 'physical_data_entities',
        data: { physical_type: 'TABLE', objectType: 'view' },
      });
      const entity = convertCandidateToEntity(candidate, 'TestProject', {});
      // Existing field wins over the fallback so non-DB callers see no diff.
      expect(entity.physical_type).toBe('TABLE');
    });
  });

  // ==========================================================================
  // Test 7: convertCandidateToEntity for `interfaces` type
  // ==========================================================================
  describe('convertCandidateToEntity - interfaces type', () => {
    it('populates interface_type and resolves service_id via parent chain', () => {
      const candidate = makeCandidate({
        id: 'cand-ifc-1',
        name: 'OrderAPI',
        candidate_type: 'interfaces',
        data: {
          description: 'REST API for orders',
          interface_type: 'REST',
        },
        parent_candidate_id: 'cand-svc-1',
      });

      const candidateIdToEntityId: Record<string, string> = {
        'cand-svc-1': 'svc-existing-456',
      };

      const entity = convertCandidateToEntity(candidate, 'TestProject', candidateIdToEntityId);

      // Check generated ID prefix
      expect(entity.id).toMatch(/^ifc-/);
      expect(entity.name).toBe('OrderAPI');
      expect(entity.description).toBe('REST API for orders');
      expect(entity.model_file_id).toBe('TestProject');

      // Type-specific fields
      expect(entity.interface_type).toBe('REST');

      // Parent FK resolved from map
      expect(entity.service_id).toBe('svc-existing-456');

      // Default fields
      expect(entity.spec_link).toBeNull();
      expect(entity.tags).toBe('');
      expect(entity.valid_from).toBeNull();
      expect(entity.valid_to).toBeNull();
    });
  });

  // ==========================================================================
  // Test 8: getTargetArrayKey returns correct model array keys for all
  //          originally-tested 8 candidate types
  // ==========================================================================
  describe('getTargetArrayKey - all 8 candidate types', () => {
    it('returns correct model array keys for all 8 candidate types', () => {
      expect(getTargetArrayKey('application')).toBe('applications');
      expect(getTargetArrayKey('app_component')).toBe('app_components');
      expect(getTargetArrayKey('service')).toBe('services');
      expect(getTargetArrayKey('interfaces')).toBe('interfaces');
      expect(getTargetArrayKey('logical_data_entities')).toBe('logical_data_entities');
      expect(getTargetArrayKey('physical_data_entities')).toBe('physical_data_entities');
      expect(getTargetArrayKey('data_entity')).toBe('physical_data_entities');
      expect(getTargetArrayKey('business_process')).toBe('business_processes');
    });
  });
});
