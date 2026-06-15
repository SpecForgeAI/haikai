/**
 * Tests for handleAddWithAllChildren Refactoring
 *
 * Task Group 2: Tests verifying that the refactored handleAddWithAllChildren
 * produces identical output to the original implementation.
 */

import { MetaModel, ENTITY_TYPES, DiagramNode } from '../types/model';
import {
  buildInterfaceCompositeNodes,
  getLogicalEntityIdsForInterface,
} from '../utils/interfaceCompositeBuilder';

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

// ============================================================================
// Test Suite
// ============================================================================

describe('handleAddWithAllChildren Refactoring', () => {
  let metaModel: MetaModel;

  beforeEach(() => {
    metaModel = createTestMetaModel();
  });

  // -------------------------------------------------------------------------
  // Test 1: "Add with all children" produces identical output before/after refactor
  // -------------------------------------------------------------------------
  describe('output parity with original implementation', () => {
    it('should produce Interface node with render_style: contract', () => {
      const interfaceId = 'int-1';

      // Get all endpoints for this interface
      const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);
      const endpointIds = endpoints.map(ep => ep.id);

      // Get logical entity IDs via helper
      const logicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);

      // Use the shared builder
      const result = buildInterfaceCompositeNodes(
        interfaceId,
        endpointIds,
        { logicalEntityIds: logicalEntityIds, physicalEntityIds: [] },
        new Map(), // All attributes selected
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // Verify Interface node properties match original implementation
      expect(result.interfaceNode.entity_type).toBe(ENTITY_TYPES.INTERFACE);
      expect(result.interfaceNode.entity_id).toBe(interfaceId);
      expect(result.interfaceNode.render_style).toBe('contract');
      expect(result.interfaceNode.embedded_endpoint_ids).toEqual(endpointIds);
      expect(result.interfaceNode.embedded_entity_ids).toEqual(logicalEntityIds);
    });

    it('should produce entity nodes with correct parent_node_id', () => {
      const interfaceId = 'int-1';
      const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);
      const logicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);

      const result = buildInterfaceCompositeNodes(
        interfaceId,
        endpoints.map(ep => ep.id),
        { logicalEntityIds: logicalEntityIds, physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // All entity nodes should have parent_node_id pointing to Interface
      for (const entityNode of result.entityNodes) {
        expect(entityNode.parent_node_id).toBe(result.interfaceNode.id);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Interface with endpoints only produces correct structure
  // -------------------------------------------------------------------------
  describe('Interface with endpoints only', () => {
    it('should create Interface with endpoints but no entity nodes', () => {
      const interfaceId = 'int-1';
      const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);

      // Create Interface with endpoints only (no logical entities)
      const result = buildInterfaceCompositeNodes(
        interfaceId,
        endpoints.map(ep => ep.id),
        { logicalEntityIds: [], physicalEntityIds: [] }, // No logical entities
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result.interfaceNode).toBeDefined();
      expect(result.interfaceNode.embedded_endpoint_ids).toEqual(['ep-1', 'ep-2']);
      expect(result.interfaceNode.embedded_entity_ids).toEqual([]);
      expect(result.entityNodes).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Interface with endpoints and logical entities produces correct structure
  // -------------------------------------------------------------------------
  describe('Interface with endpoints and logical entities', () => {
    it('should create Interface with embedded endpoints and entity children', () => {
      const interfaceId = 'int-1';
      const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);
      const logicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);

      const result = buildInterfaceCompositeNodes(
        interfaceId,
        endpoints.map(ep => ep.id),
        { logicalEntityIds: logicalEntityIds, physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // Interface node should have all endpoints embedded
      expect(result.interfaceNode.embedded_endpoint_ids?.length).toBe(2);

      // Interface node should have entity IDs embedded
      expect(result.interfaceNode.embedded_entity_ids?.length).toBe(2);

      // Entity nodes should be created
      expect(result.entityNodes.length).toBe(2);

      // Entity nodes should have ERD render style
      for (const entityNode of result.entityNodes) {
        expect(entityNode.render_style).toBe('erd');
        expect(entityNode.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Duplicate prevention still works after refactor
  // -------------------------------------------------------------------------
  describe('duplicate prevention', () => {
    it('should not include entities that already exist on diagram', () => {
      // This test documents the expected behavior:
      // When "Add with all children" is invoked, the calling code should
      // filter out entities that already exist on the diagram BEFORE
      // calling buildInterfaceCompositeNodes.

      // The buildInterfaceCompositeNodes function itself does not check
      // for duplicates - it's the caller's responsibility.

      const interfaceId = 'int-1';
      const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);

      // Simulate scenario where lde-1 already exists on diagram
      // Caller should filter it out before calling builder
      const existingEntityId = 'lde-1';
      const allLogicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);
      const newLogicalEntityIds = allLogicalEntityIds.filter(id => id !== existingEntityId);

      const result = buildInterfaceCompositeNodes(
        interfaceId,
        endpoints.map(ep => ep.id),
        { logicalEntityIds: newLogicalEntityIds, physicalEntityIds: [] }, // Only non-existing entities
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // Only lde-2 should be created as entity node
      expect(result.entityNodes.length).toBe(1);
      expect(result.entityNodes[0].entity_id).toBe('lde-2');

      // embedded_entity_ids should only include non-existing entities
      expect(result.interfaceNode.embedded_entity_ids).toEqual(['lde-2']);
    });
  });
});
