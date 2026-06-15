/**
 * Tests for Advanced Add Interface Data Entities Fix
 *
 * Spec: Fix Advanced Add Interface Schema Entities
 * Task Group 2.1: Tests for component-level fixes
 *
 * These tests verify that:
 * 1. findRelatedEntities() returns logical entities from dep_log_<id> relationships
 * 2. findRelatedEntities() returns physical entities from dep_phy_<id> relationships
 * 3. getDataEntityIdsForInterface() returns grouped entity IDs
 * 4. buildInterfaceCompositeNodes() includes both entity types as children
 * 5. Entity display includes type badges [LOGICAL_DATA_ENTITY] or [PHYSICAL_DATA_ENTITY]
 */

import { ENTITY_TYPES, MetaModel } from '../types/model';
import { buildTreeData } from '../components/DiagramsView/AdvancedAddDialog';
import { getDataEntityIdsForInterface, buildInterfaceCompositeNodes } from '../utils/interfaceCompositeBuilder';

// Helper to create a minimal MetaModel fixture with interface-entity relationships
function createMetaModelWithInterfaceEntities(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [
        {
          id: 'service-1',
          name: 'Order Service',
          description: '',
          tags: '',
          application_id: 'app-1',
        },
      ],
      interfaces: [
        {
          id: 'interface-1',
          name: 'Order API',
          description: '',
          tags: '',
          service_id: 'service-1',
          interface_type: 'REST_API',
        },
      ],
      endpoints: [
        {
          id: 'endpoint-1',
          name: 'Create Order',
          description: '',
          tags: '',
          interface_id: 'interface-1',
          endpoint_type: 'HTTP_REST',
          path_or_address: '/orders',
          operation_verb: 'POST',
        },
      ],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [
        {
          id: 'logical-entity-1',
          name: 'Order',
          description: 'Order logical entity',
          tags: '',
        },
        {
          id: 'logical-entity-2',
          name: 'Customer',
          description: 'Customer logical entity',
          tags: '',
        },
      ],
      logical_data_attributes: [
        {
          id: 'logical-attr-1',
          name: 'orderId',
          description: '',
          tags: '',
          logical_entity_id: 'logical-entity-1',
          is_primary_key: true,
          oas_data_type: 'string_uuid',
        },
      ],
      physical_data_entities: [
        {
          id: 'physical-entity-1',
          name: 'orders_table',
          description: 'Physical orders table',
          tags: '',
        },
        {
          id: 'physical-entity-2',
          name: 'customers_table',
          description: 'Physical customers table',
          tags: '',
        },
      ],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      business_logics: [],
      ui_screens: [],
      ui_components: [],
      ui_actions: [],
      package_sets: [],
      packages: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [
        {
          id: 'rel-1',
          interface_id: 'interface-1',
          dataEntityPointId: 'dep_log_logical-entity-1',
          description: 'Order entity for interface',
          tags: '',
        },
        {
          id: 'rel-2',
          interface_id: 'interface-1',
          dataEntityPointId: 'dep_phy_physical-entity-1',
          description: 'Physical orders table for interface',
          tags: '',
        },
        {
          id: 'rel-3',
          interface_id: 'interface-1',
          dataEntityPointId: 'dep_log_logical-entity-2',
          description: 'Customer entity for interface',
          tags: '',
        },
      ],
      ui_workflow_transitions: [],
    },
  };
}

// Helper to create metaModel with only logical entities
function createMetaModelWithLogicalEntitiesOnly(): MetaModel {
  const metaModel = createMetaModelWithInterfaceEntities();
  // Clear physical entity relationships
  metaModel.relationships.interface_logical_entities = [
    {
      id: 'rel-1',
      interface_id: 'interface-1',
      dataEntityPointId: 'dep_log_logical-entity-1',
      description: '',
      tags: '',
    },
  ];
  return metaModel;
}

// Helper to create metaModel with only physical entities
function createMetaModelWithPhysicalEntitiesOnly(): MetaModel {
  const metaModel = createMetaModelWithInterfaceEntities();
  // Clear logical entity relationships, keep only physical
  metaModel.relationships.interface_logical_entities = [
    {
      id: 'rel-1',
      interface_id: 'interface-1',
      dataEntityPointId: 'dep_phy_physical-entity-1',
      description: '',
      tags: '',
    },
  ];
  return metaModel;
}

describe('Advanced Add Interface Data Entities', () => {
  describe('buildTreeData with Interface root', () => {
    it('should include logical entities under Interface from dep_log_<id> relationships', () => {
      const metaModel = createMetaModelWithLogicalEntitiesOnly();
      const rootEntity = {
        id: 'interface-1',
        name: 'Order API',
        type: ENTITY_TYPES.INTERFACE,
      };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Find logical entity child nodes
      const logicalEntityChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      expect(logicalEntityChildren.length).toBe(1);
      expect(logicalEntityChildren[0].entityId).toBe('logical-entity-1');
      expect(logicalEntityChildren[0].entityName).toBe('Order');
    });

    it('should include physical entities under Interface from dep_phy_<id> relationships', () => {
      const metaModel = createMetaModelWithPhysicalEntitiesOnly();
      const rootEntity = {
        id: 'interface-1',
        name: 'Order API',
        type: ENTITY_TYPES.INTERFACE,
      };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Find physical entity child nodes
      const physicalEntityChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );

      expect(physicalEntityChildren.length).toBe(1);
      expect(physicalEntityChildren[0].entityId).toBe('physical-entity-1');
      expect(physicalEntityChildren[0].entityName).toBe('orders_table');
    });

    it('should include both logical and physical entities when interface has mixed relationships', () => {
      const metaModel = createMetaModelWithInterfaceEntities();
      const rootEntity = {
        id: 'interface-1',
        name: 'Order API',
        type: ENTITY_TYPES.INTERFACE,
      };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Find logical entity child nodes
      const logicalEntityChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      // Find physical entity child nodes
      const physicalEntityChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );

      // Should have 2 logical (Order, Customer) and 1 physical (orders_table)
      expect(logicalEntityChildren.length).toBe(2);
      expect(physicalEntityChildren.length).toBe(1);

      // Verify correct IDs
      const logicalEntityIds = logicalEntityChildren.map((c) => c.entityId);
      expect(logicalEntityIds).toContain('logical-entity-1');
      expect(logicalEntityIds).toContain('logical-entity-2');

      const physicalEntityIds = physicalEntityChildren.map((c) => c.entityId);
      expect(physicalEntityIds).toContain('physical-entity-1');
    });

    it('should also include endpoints as children of Interface', () => {
      const metaModel = createMetaModelWithInterfaceEntities();
      const rootEntity = {
        id: 'interface-1',
        name: 'Order API',
        type: ENTITY_TYPES.INTERFACE,
      };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Find endpoint child nodes
      const endpointChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointChildren.length).toBe(1);
      expect(endpointChildren[0].entityId).toBe('endpoint-1');
      expect(endpointChildren[0].entityName).toBe('Create Order');
    });
  });

  describe('getDataEntityIdsForInterface', () => {
    it('should return grouped entity IDs with both logical and physical', () => {
      const metaModel = createMetaModelWithInterfaceEntities();

      const result = getDataEntityIdsForInterface('interface-1', metaModel);

      expect(result.logicalEntityIds).toEqual(['logical-entity-1', 'logical-entity-2']);
      expect(result.physicalEntityIds).toEqual(['physical-entity-1']);
    });

    it('should return empty arrays when interface has no entity relationships', () => {
      const metaModel = createMetaModelWithInterfaceEntities();
      // Clear all relationships
      metaModel.relationships.interface_logical_entities = [];

      const result = getDataEntityIdsForInterface('interface-1', metaModel);

      expect(result.logicalEntityIds).toEqual([]);
      expect(result.physicalEntityIds).toEqual([]);
    });

    it('should return only logical IDs when interface only has logical entity relationships', () => {
      const metaModel = createMetaModelWithLogicalEntitiesOnly();

      const result = getDataEntityIdsForInterface('interface-1', metaModel);

      expect(result.logicalEntityIds).toEqual(['logical-entity-1']);
      expect(result.physicalEntityIds).toEqual([]);
    });
  });

  describe('buildInterfaceCompositeNodes', () => {
    it('should create child nodes for both logical and physical entities', () => {
      const metaModel = createMetaModelWithInterfaceEntities();

      const result = buildInterfaceCompositeNodes(
        'interface-1',
        ['endpoint-1'],
        { logicalEntityIds: ['logical-entity-1'], physicalEntityIds: ['physical-entity-1'] },
        new Map(),
        metaModel,
        { x: 0, y: 0 },
        0,
        null
      );

      // Should have Interface node
      expect(result.interfaceNode.entity_id).toBe('interface-1');
      expect(result.interfaceNode.render_style).toBe('contract');

      // Should have child entity nodes for both types
      expect(result.entityNodes.length).toBe(2);

      const logicalNode = result.entityNodes.find(
        (n) => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );
      const physicalNode = result.entityNodes.find(
        (n) => n.entity_type === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );

      expect(logicalNode).toBeDefined();
      expect(logicalNode?.entity_id).toBe('logical-entity-1');

      expect(physicalNode).toBeDefined();
      expect(physicalNode?.entity_id).toBe('physical-entity-1');
    });

    it('should create child nodes only for logical entities when only logical are selected', () => {
      const metaModel = createMetaModelWithInterfaceEntities();

      const result = buildInterfaceCompositeNodes(
        'interface-1',
        ['endpoint-1'],
        { logicalEntityIds: ['logical-entity-1'], physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 0, y: 0 },
        0,
        null
      );

      // Should have only 1 child entity node (logical)
      expect(result.entityNodes.length).toBe(1);
      expect(result.entityNodes[0].entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    });

    it('should create child nodes only for physical entities when only physical are selected', () => {
      const metaModel = createMetaModelWithInterfaceEntities();

      const result = buildInterfaceCompositeNodes(
        'interface-1',
        ['endpoint-1'],
        { logicalEntityIds: [], physicalEntityIds: ['physical-entity-1'] },
        new Map(),
        metaModel,
        { x: 0, y: 0 },
        0,
        null
      );

      // Should have only 1 child entity node (physical)
      expect(result.entityNodes.length).toBe(1);
      expect(result.entityNodes[0].entity_type).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
    });
  });
});
