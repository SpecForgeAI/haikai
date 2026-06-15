/**
 * Tests for Interface Custom Candidate Detection
 *
 * Task Group 3: Tests for findInterfaceCustomCandidates function and related utilities.
 *
 * These tests verify that Interface custom layout candidates are correctly
 * identified and that their children (endpoints and logical entities) are
 * properly filtered from normal rendering.
 */

import {
  findInterfaceCustomCandidates,
  isEmbeddedInterfaceChild,
  isInterfaceCustomLayoutCandidate,
  InterfaceCustomCandidate,
} from '../utils/erdAdvancedAddUtils';
import { MetaModel, ENTITY_TYPES } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a test MetaModel with Interface, Endpoints, and Logical Entities.
 */
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Test App', description: '', app_type: 'WEB', status: 'ACTIVE', tags: '' },
      ],
      app_components: [],
      services: [
        { id: 'svc-1', name: 'Test Service', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', name: 'Customer API', description: '', service_id: 'svc-1', interface_type: 'REST_API', tags: '' },
        { id: 'int-2', name: 'Order API', description: '', service_id: 'svc-1', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [
        {
          id: 'ep-1', name: 'Get Customer', description: '', interface_id: 'int-1',
          endpoint_type: 'HTTP_REST' as const, path_or_address: '/customers/{id}', operation_verb: 'GET', tags: ''
        },
        {
          id: 'ep-2', name: 'Create Customer', description: '', interface_id: 'int-1',
          endpoint_type: 'HTTP_REST' as const, path_or_address: '/customers', operation_verb: 'POST', tags: ''
        },
      ],
      application_points: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer', description: '', tags: '' },
        { id: 'lde-2', name: 'Address', description: '', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'lda-1', name: 'id', description: '', logical_entity_id: 'lde-1', data_type: 'string_uuid', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'lda-2', name: 'name', description: '', logical_entity_id: 'lde-1', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
      ],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [
        { id: 'ile-1', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-1', description: '', tags: '' },
        { id: 'ile-2', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-2', description: '', tags: '' },
      ],
    },
  };
}

/**
 * Create a tree structure for Advanced Add selection.
 */
function createTestTreeData(): TreeNodeData {
  return {
    key: 'int-1',
    title: 'Customer API',
    entityId: 'int-1',
    entityType: ENTITY_TYPES.INTERFACE,
    children: [
      {
        key: 'ep-1',
        title: 'Get Customer',
        entityId: 'ep-1',
        entityType: ENTITY_TYPES.ENDPOINT,
        children: [],
      },
      {
        key: 'ep-2',
        title: 'Create Customer',
        entityId: 'ep-2',
        entityType: ENTITY_TYPES.ENDPOINT,
        children: [],
      },
      {
        key: 'lde-1',
        title: 'Customer',
        entityId: 'lde-1',
        entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        children: [],
      },
      {
        key: 'lde-2',
        title: 'Address',
        entityId: 'lde-2',
        entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        children: [],
      },
    ],
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Interface Custom Candidate Detection', () => {
  let metaModel: MetaModel;
  let treeData: TreeNodeData;

  beforeEach(() => {
    metaModel = createTestMetaModel();
    treeData = createTestTreeData();
  });

  // -------------------------------------------------------------------------
  // Test 1: findInterfaceCustomCandidates finds Interface with selected endpoints
  // -------------------------------------------------------------------------
  describe('findInterfaceCustomCandidates - endpoints detection', () => {
    it('should find Interface with selected endpoints', () => {
      // Select Interface and endpoints
      const selectedKeys = new Set(['int-1', 'ep-1', 'ep-2']);

      const candidates = findInterfaceCustomCandidates(
        [treeData],
        selectedKeys,
        metaModel
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].interface.entityId).toBe('int-1');
      expect(candidates[0].endpoints.length).toBe(2);
      expect(candidates[0].endpoints.map(ep => ep.entityId)).toContain('ep-1');
      expect(candidates[0].endpoints.map(ep => ep.entityId)).toContain('ep-2');
    });

    it('should find Interface with partially selected endpoints', () => {
      // Select Interface and only one endpoint
      const selectedKeys = new Set(['int-1', 'ep-1']);

      const candidates = findInterfaceCustomCandidates(
        [treeData],
        selectedKeys,
        metaModel
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].endpoints.length).toBe(1);
      expect(candidates[0].endpoints[0].entityId).toBe('ep-1');
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: findInterfaceCustomCandidates finds Interface with selected logical entities
  // -------------------------------------------------------------------------
  describe('findInterfaceCustomCandidates - logical entities detection', () => {
    it('should find Interface with selected logical entities', () => {
      // Select Interface and logical entities
      const selectedKeys = new Set(['int-1', 'lde-1', 'lde-2']);

      const candidates = findInterfaceCustomCandidates(
        [treeData],
        selectedKeys,
        metaModel
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].interface.entityId).toBe('int-1');
      expect(candidates[0].logicalEntities.length).toBe(2);
      expect(candidates[0].logicalEntities.map(le => le.entityId)).toContain('lde-1');
      expect(candidates[0].logicalEntities.map(le => le.entityId)).toContain('lde-2');
    });

    it('should find Interface with mixed endpoints and logical entities', () => {
      // Select Interface, one endpoint, and one logical entity
      const selectedKeys = new Set(['int-1', 'ep-1', 'lde-1']);

      const candidates = findInterfaceCustomCandidates(
        [treeData],
        selectedKeys,
        metaModel
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].endpoints.length).toBe(1);
      expect(candidates[0].logicalEntities.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Filtering removes endpoints from orderedNodes when parent Interface is a candidate
  // -------------------------------------------------------------------------
  describe('isEmbeddedInterfaceChild - endpoint filtering', () => {
    it('should identify endpoints as embedded children', () => {
      const selectedKeys = new Set(['int-1', 'ep-1', 'ep-2']);
      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);

      const endpointNode = treeData.children[0]; // ep-1
      expect(isEmbeddedInterfaceChild(endpointNode, candidates)).toBe(true);

      const endpointNode2 = treeData.children[1]; // ep-2
      expect(isEmbeddedInterfaceChild(endpointNode2, candidates)).toBe(true);
    });

    it('should not identify Interface itself as embedded child', () => {
      const selectedKeys = new Set(['int-1', 'ep-1']);
      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);

      expect(isEmbeddedInterfaceChild(treeData, candidates)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Filtering removes logical entities from orderedNodes when parent Interface is a candidate
  // -------------------------------------------------------------------------
  describe('isEmbeddedInterfaceChild - logical entity filtering', () => {
    it('should identify logical entities as embedded children', () => {
      const selectedKeys = new Set(['int-1', 'lde-1', 'lde-2']);
      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);

      const entityNode = treeData.children[2]; // lde-1
      expect(isEmbeddedInterfaceChild(entityNode, candidates)).toBe(true);

      const entityNode2 = treeData.children[3]; // lde-2
      expect(isEmbeddedInterfaceChild(entityNode2, candidates)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Interface without selected children is NOT a candidate (falls back to plain node)
  // -------------------------------------------------------------------------
  describe('Interface-only selection', () => {
    it('should NOT identify Interface without children as a candidate', () => {
      // Select only the Interface, no children
      const selectedKeys = new Set(['int-1']);

      const candidates = findInterfaceCustomCandidates(
        [treeData],
        selectedKeys,
        metaModel
      );

      expect(candidates.length).toBe(0);
    });

    it('should not be a custom layout candidate when no children selected', () => {
      const selectedKeys = new Set(['int-1']);

      const isCandidate = isInterfaceCustomLayoutCandidate(
        treeData,
        selectedKeys,
        metaModel
      );

      expect(isCandidate).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Non-Interface nodes are not candidates
  // -------------------------------------------------------------------------
  describe('Non-Interface nodes', () => {
    it('should not identify non-Interface nodes as candidates', () => {
      const applicationNode: TreeNodeData = {
        key: 'app-1',
        title: 'Test App',
        entityId: 'app-1',
        entityType: ENTITY_TYPES.APPLICATION,
        children: [treeData],
      };

      const selectedKeys = new Set(['app-1', 'int-1', 'ep-1']);

      const candidates = findInterfaceCustomCandidates(
        [applicationNode],
        selectedKeys,
        metaModel
      );

      // Should find the Interface candidate, not the Application
      expect(candidates.length).toBe(1);
      expect(candidates[0].interface.entityId).toBe('int-1');
    });
  });
});
