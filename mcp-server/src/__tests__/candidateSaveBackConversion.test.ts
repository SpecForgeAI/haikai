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
  describe('convertCandidateToEntity - physical_data_attributes structural fidelity (2026-08-01)', () => {
    it('carries the six DTO fidelity slots, preserving falsy scale 0 / is_identity false', () => {
      const candidate = makeCandidate({
        id: 'cand-attr-1',
        name: 'amount',
        candidate_type: 'physical_data_attributes',
        parent_candidate_id: 'cand-pde-parent',
        data: {
          dataType: 'numeric',
          isPrimaryKey: false,
          isNullable: false,
          source_type: 'numeric(19,0)',
          scale: 0,
          precision: 19,
          column_default: '0',
          ordinal: 3,
          is_identity: false,
        },
      });

      const entity = convertCandidateToEntity(candidate, 'TestProject', {
        'cand-pde-parent': 'pde-parent-001',
      });

      expect(entity.physical_entity_id).toBe('pde-parent-001');
      expect(entity.data_type).toBe('numeric');
      expect(entity.source_type).toBe('numeric(19,0)');
      expect(entity.scale).toBe(0);
      expect(entity.precision).toBe(19);
      expect(entity.column_default).toBe('0');
      expect(entity.ordinal).toBe(3);
      expect(entity.is_identity).toBe(false);
    });

    it('leaves absent fidelity keys ABSENT for non-DB candidates', () => {
      const candidate = makeCandidate({
        id: 'cand-attr-plain',
        name: 'plain',
        candidate_type: 'physical_data_attributes',
        parent_candidate_id: 'cand-pde-parent',
        data: { dataType: 'string' },
      });
      const entity = convertCandidateToEntity(candidate, 'TestProject', {
        'cand-pde-parent': 'pde-parent-001',
      });
      expect('source_type' in entity).toBe(false);
      expect('scale' in entity).toBe(false);
      expect('is_identity' in entity).toBe(false);
    });
  });

  describe('convertCandidateToEntity - logical_data_entity_relationships fk_columns (2026-08-01)', () => {
    it('carries fk_columns on the direct-conversion branch', () => {
      const fk = {
        join_columns: ['order_id'],
        referenced_columns: ['id'],
        on_delete: 'CASCADE',
      };
      const candidate = makeCandidate({
        id: 'cand-rel-1',
        name: 'orders -> customers',
        candidate_type: 'logical_data_entity_relationships',
        data: {
          sourceEntity: 'orders',
          targetEntity: 'customers',
          cardinality: 'MANY_TO_ONE',
          relationshipType: 'ASSOCIATION',
          fk_columns: fk,
        },
      });
      const entity = convertCandidateToEntity(candidate, 'TestProject', {});
      expect(entity.fk_columns).toEqual(fk);
    });
  });

  describe('convertCandidateToEntity - physical_data_entities type', () => {
    it('populates physical_type and the database (DTO wire key) from candidate data', () => {
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

      // Type-specific fields. 2026-08-01: the row key is `database` -- the
      // PhysicalDataEntityDto wire key -- because the old `database_name`
      // write was silently ignored by the AMS PUT (Jackson unknown key).
      expect(entity.physical_type).toBe('TABLE');
      expect(entity.database).toBe('order_db');
      expect(entity.database_name).toBeUndefined();

      // Default fields
      expect(entity.tags).toBe('');
      expect(entity.valid_from).toBeNull();
      expect(entity.valid_to).toBeNull();

      // Should NOT have parent FK
      expect(entity.application_id).toBeUndefined();
      expect(entity.service_id).toBeUndefined();
    });

    it('carries constraints_metadata through to the entity (snake DTO key)', () => {
      const constraints = {
        primary_key: { name: 'orders_pk', columns: ['order_id'] },
        unique_constraints: [{ name: 'orders_ref_uq', columns: ['order_ref'] }],
        check_constraints: [{ name: 'orders_qty_ck', expression: 'qty > 0' }],
        indexes: [{ name: 'orders_cust_ix', columns: ['customer_id'], is_unique: false }],
      };
      const candidate = makeCandidate({
        id: 'cand-pde-cm',
        name: 'orders_table',
        candidate_type: 'physical_data_entities',
        data: {
          physical_type: 'TABLE',
          database_name: 'order_db',
          constraints_metadata: constraints,
        },
      });

      const entity = convertCandidateToEntity(candidate, 'TestProject', {});
      expect(entity.constraints_metadata).toEqual(constraints);
    });

    it('leaves constraints_metadata ABSENT (not null) for non-DB candidates', () => {
      const candidate = makeCandidate({
        id: 'cand-pde-nocm',
        name: 'plain_entity',
        candidate_type: 'physical_data_entities',
        data: { physical_type: 'TABLE' },
      });
      const entity = convertCandidateToEntity(candidate, 'TestProject', {});
      expect('constraints_metadata' in entity).toBe(false);
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
      // databaseName (camelCase from DB pack) maps to `database` on the row
      // (the DTO wire key; 2026-08-01).
      expect(entity.database).toBe('hier_dev1');
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
