/**
 * Tests for Interface Composite Builder Utility
 *
 * Task Group 1: Tests for buildInterfaceCompositeNodes function
 *
 * These tests verify that the Interface composite builder correctly creates
 * Interface nodes with embedded endpoints and child entity nodes.
 */

import {
  buildInterfaceCompositeNodes,
  getLogicalEntityIdsForInterface,
  calculateEntityPositionsInInterface,
  InterfaceCompositeResult,
  InterfaceCompositeConfig,
} from '../utils/interfaceCompositeBuilder';
import { MetaModel, ENTITY_TYPES, DiagramNode } from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal MetaModel for testing Interface composite building.
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
        {
          id: 'ep-3', name: 'Update Customer', description: '', interface_id: 'int-1',
          endpoint_type: 'HTTP_REST' as const, path_or_address: '/customers/{id}', operation_verb: 'PUT', tags: ''
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
        { id: 'lda-3', name: 'street', description: '', logical_entity_id: 'lde-2', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
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
        // Spec 2026-01-11: rows now carry the unified dataEntityPointId
        // (dep_log_<id> / dep_phy_<id>) instead of logical_entity_id.
        { id: 'ile-1', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-1', description: '', tags: '' },
        { id: 'ile-2', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-2', description: '', tags: '' },
      ],
    },
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Interface Composite Builder', () => {
  let metaModel: MetaModel;

  beforeEach(() => {
    metaModel = createTestMetaModel();
  });

  // -------------------------------------------------------------------------
  // Test 1: Basic Interface node creation with render_style: 'contract'
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - basic Interface node creation', () => {
    it('should create Interface node with render_style: contract', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1', 'ep-2'],
        { logicalEntityIds: [], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result).toBeDefined();
      expect(result.interfaceNode).toBeDefined();
      expect(result.interfaceNode.entity_type).toBe(ENTITY_TYPES.INTERFACE);
      expect(result.interfaceNode.entity_id).toBe('int-1');
      expect(result.interfaceNode.render_style).toBe('contract');
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Correct embedded_endpoint_ids population
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - embedded_endpoint_ids', () => {
    it('should populate embedded_endpoint_ids correctly', () => {
      const selectedEndpointIds = ['ep-1', 'ep-3'];
      const result = buildInterfaceCompositeNodes(
        'int-1',
        selectedEndpointIds,
        { logicalEntityIds: [], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result.interfaceNode.embedded_endpoint_ids).toBeDefined();
      expect(result.interfaceNode.embedded_endpoint_ids).toEqual(['ep-1', 'ep-3']);
      expect(result.interfaceNode.embedded_endpoint_ids?.length).toBe(2);
    });

    it('should handle empty endpoint list', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        [],
        { logicalEntityIds: ['lde-1'], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result.interfaceNode.embedded_endpoint_ids).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Correct embedded_entity_ids population
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - embedded_entity_ids', () => {
    it('should populate embedded_entity_ids correctly', () => {
      const selectedLogicalEntityIds = ['lde-1', 'lde-2'];
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: selectedLogicalEntityIds, physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result.interfaceNode.embedded_entity_ids).toBeDefined();
      expect(result.interfaceNode.embedded_entity_ids).toEqual(['lde-1', 'lde-2']);
      expect(result.interfaceNode.embedded_entity_ids?.length).toBe(2);
    });

    it('should handle empty entity list', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1', 'ep-2'],
        { logicalEntityIds: [], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result.interfaceNode.embedded_entity_ids).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Child entity node creation with correct parent_node_id
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - child entity nodes', () => {
    it('should create child entity nodes with correct parent_node_id', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: ['lde-1', 'lde-2'], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result.entityNodes).toBeDefined();
      expect(result.entityNodes.length).toBe(2);

      // Each entity node should have parent_node_id pointing to the Interface
      for (const entityNode of result.entityNodes) {
        expect(entityNode.parent_node_id).toBe(result.interfaceNode.id);
        expect(entityNode.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
        expect(entityNode.render_style).toBe('erd');
      }

      // Verify entity IDs
      const entityIds = result.entityNodes.map(n => n.entity_id);
      expect(entityIds).toContain('lde-1');
      expect(entityIds).toContain('lde-2');
    });

    it('should return empty entityNodes array when no entities selected', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: [], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      expect(result.entityNodes).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Dimension calculations wrap all content correctly
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - dimension calculations', () => {
    it('should calculate Interface dimensions to wrap all content', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1', 'ep-2', 'ep-3'],
        { logicalEntityIds: ['lde-1', 'lde-2'], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // Interface should have reasonable dimensions
      expect(result.interfaceNode.width).toBeGreaterThan(0);
      expect(result.interfaceNode.height).toBeGreaterThan(0);

      // Child entities should be positioned inside Interface bounds
      for (const entityNode of result.entityNodes) {
        expect(entityNode.pos_x).toBeGreaterThanOrEqual(result.interfaceNode.pos_x);
        expect(entityNode.pos_x + entityNode.width).toBeLessThanOrEqual(
          result.interfaceNode.pos_x + result.interfaceNode.width
        );
        expect(entityNode.pos_y).toBeGreaterThanOrEqual(result.interfaceNode.pos_y);
        expect(entityNode.pos_y + entityNode.height).toBeLessThanOrEqual(
          result.interfaceNode.pos_y + result.interfaceNode.height
        );
      }
    });

    it('should adjust height based on number of endpoints', () => {
      // Interface with 1 endpoint
      const result1 = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: [], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // Interface with 3 endpoints
      const result3 = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1', 'ep-2', 'ep-3'],
        { logicalEntityIds: [], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // More endpoints should result in taller Interface
      expect(result3.interfaceNode.height).toBeGreaterThan(result1.interfaceNode.height);
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Z-index ordering (Interface lower than child entities)
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - z-index ordering', () => {
    it('should assign z-index with Interface lower than child entities', () => {
      const baseZIndex = 100;
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: ['lde-1', 'lde-2'], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        baseZIndex,
        null
      );

      // Interface should have base z-index
      expect(result.interfaceNode.z_index).toBe(baseZIndex);

      // Child entities should have higher z-index than Interface
      for (const entityNode of result.entityNodes) {
        expect(entityNode.z_index).toBeGreaterThan(result.interfaceNode.z_index as number);
      }

      // Verify z-indices are incrementing
      if (result.entityNodes.length > 1) {
        expect(result.entityNodes[1].z_index).toBeGreaterThan(result.entityNodes[0].z_index as number);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test: getLogicalEntityIdsForInterface helper
  // -------------------------------------------------------------------------
  describe('getLogicalEntityIdsForInterface', () => {
    it('should return logical entity IDs for an interface', () => {
      const entityIds = getLogicalEntityIdsForInterface('int-1', metaModel);

      expect(entityIds).toBeDefined();
      expect(entityIds.length).toBe(2);
      expect(entityIds).toContain('lde-1');
      expect(entityIds).toContain('lde-2');
    });

    it('should return empty array for interface with no entities', () => {
      const entityIds = getLogicalEntityIdsForInterface('int-2', metaModel);

      expect(entityIds).toEqual([]);
    });

    it('should return empty array for non-existent interface', () => {
      const entityIds = getLogicalEntityIdsForInterface('non-existent', metaModel);

      expect(entityIds).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Test: calculateEntityPositionsInInterface helper
  // -------------------------------------------------------------------------
  describe('calculateEntityPositionsInInterface', () => {
    it('should calculate vertical stacking positions for entities', () => {
      const entityHeights = [50, 60, 40];
      const interfaceBounds = { x: 100, y: 100, width: 300, height: 400 };
      const headerHeight = 24;
      const endpointSectionHeight = 50;

      const positions = calculateEntityPositionsInInterface(
        entityHeights,
        interfaceBounds,
        headerHeight,
        endpointSectionHeight
      );

      expect(positions).toBeDefined();
      expect(positions.length).toBe(3);

      // Positions should be vertically stacked
      expect(positions[0].y).toBeLessThan(positions[1].y);
      expect(positions[1].y).toBeLessThan(positions[2].y);

      // All positions should be within Interface bounds
      for (const pos of positions) {
        expect(pos.x).toBeGreaterThanOrEqual(interfaceBounds.x);
        expect(pos.x + 100).toBeLessThanOrEqual(interfaceBounds.x + interfaceBounds.width); // assuming 100px entity width
      }
    });

    it('should center entities horizontally within Interface', () => {
      const entityHeights = [50];
      const interfaceBounds = { x: 100, y: 100, width: 300, height: 200 };
      const headerHeight = 24;
      const endpointSectionHeight = 0;

      const positions = calculateEntityPositionsInInterface(
        entityHeights,
        interfaceBounds,
        headerHeight,
        endpointSectionHeight
      );

      // Entity should be centered horizontally
      // The exact centering depends on entity width which is calculated elsewhere
      expect(positions[0].x).toBeGreaterThan(interfaceBounds.x);
    });
  });

  // -------------------------------------------------------------------------
  // Test: Interface with parentNodeId
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - with parent node', () => {
    it('should set parent_node_id on Interface when provided', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: ['lde-1'], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        'parent-service-node-id'
      );

      expect(result.interfaceNode.parent_node_id).toBe('parent-service-node-id');
      // Child entities should still have Interface as parent, not the grandparent
      expect(result.entityNodes[0].parent_node_id).toBe(result.interfaceNode.id);
    });
  });

  // -------------------------------------------------------------------------
  // Test: Attributes passed to entity nodes
  // -------------------------------------------------------------------------
  describe('buildInterfaceCompositeNodes - selected attributes', () => {
    it('should pass selected attribute IDs to entity nodes', () => {
      const selectedAttributeIdsByEntity = new Map<string, string[]>();
      selectedAttributeIdsByEntity.set('lde-1', ['lda-1', 'lda-2']);

      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: ['lde-1'], physicalEntityIds: [] },
        selectedAttributeIdsByEntity,
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      const customerNode = result.entityNodes.find(n => n.entity_id === 'lde-1');
      expect(customerNode).toBeDefined();
      expect(customerNode?.embedded_attribute_ids).toEqual(['lda-1', 'lda-2']);
    });

    it('should include all attributes when map is empty', () => {
      const result = buildInterfaceCompositeNodes(
        'int-1',
        ['ep-1'],
        { logicalEntityIds: ['lde-1'], physicalEntityIds: [] },
        new Map(), // Empty map means all attributes
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      const customerNode = result.entityNodes.find(n => n.entity_id === 'lde-1');
      expect(customerNode).toBeDefined();
      // Should have all attributes for lde-1
      expect(customerNode?.embedded_attribute_ids?.length).toBe(2); // lda-1 and lda-2
    });
  });
});
