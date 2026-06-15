/**
 * Regression Test: Advanced Add Interface Schema Entities
 *
 * Spec: Fix Advanced Add Interface Schema Entities
 * Task Group 3.2, 3.3: Regression test file and integration scenario
 *
 * This test file validates the complete fix for the bug where code was reading
 * the deprecated `logical_entity_id` field instead of the new `dataEntityPointId` field.
 *
 * Key scenarios tested:
 * 1. parseDataEntityPointId correctly parses dep_log_ and dep_phy_ prefixes
 * 2. resolveDataEntitiesForInterface returns grouped entity IDs
 * 3. findRelatedEntities in AdvancedAddDialog returns correct entities by type
 * 4. buildInterfaceCompositeNodes creates nodes for both entity types
 * 5. Integration: Full workflow from Interface root to child entity tree nodes
 */

import { ENTITY_TYPES, MetaModel } from '../types/model';
import { buildTreeData } from '../components/DiagramsView/AdvancedAddDialog';
import {
  parseDataEntityPointId,
  resolveDataEntitiesForInterface,
} from '../utils/dataEntityPointOptions';
import {
  getDataEntityIdsForInterface,
  buildInterfaceCompositeNodes,
} from '../utils/interfaceCompositeBuilder';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a MetaModel fixture representing the bug scenario:
 * - Interface with mixed logical and physical entity relationships
 * - Uses dataEntityPointId format (dep_log_<id> and dep_phy_<id>)
 * - NO logical_entity_id field (deprecated and should not be used)
 */
function createBugScenarioMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        {
          id: 'app-1',
          name: 'Order Management System',
          description: '',
          tags: '',
        },
      ],
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
          name: 'Order REST API',
          description: 'REST API for order operations',
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
        {
          id: 'endpoint-2',
          name: 'Get Order',
          description: '',
          tags: '',
          interface_id: 'interface-1',
          endpoint_type: 'HTTP_REST',
          path_or_address: '/orders/{id}',
          operation_verb: 'GET',
        },
      ],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [
        {
          id: 'logical-order',
          name: 'Order',
          description: 'Logical Order entity',
          tags: '',
        },
        {
          id: 'logical-customer',
          name: 'Customer',
          description: 'Logical Customer entity',
          tags: '',
        },
        {
          id: 'logical-product',
          name: 'Product',
          description: 'Logical Product entity - NOT linked to this interface',
          tags: '',
        },
      ],
      logical_data_attributes: [
        {
          id: 'attr-order-id',
          name: 'orderId',
          description: '',
          tags: '',
          logical_entity_id: 'logical-order',
          is_primary_key: true,
          oas_data_type: 'string_uuid',
        },
        {
          id: 'attr-order-total',
          name: 'totalAmount',
          description: '',
          tags: '',
          logical_entity_id: 'logical-order',
          is_primary_key: false,
          oas_data_type: 'number',
        },
      ],
      physical_data_entities: [
        {
          id: 'physical-orders-table',
          name: 'orders_table',
          description: 'Physical orders table',
          tags: '',
        },
        {
          id: 'physical-customers-table',
          name: 'customers_table',
          description: 'Physical customers table',
          tags: '',
        },
      ],
      physical_data_attributes: [
        {
          id: 'pattr-order-id',
          name: 'order_id',
          description: '',
          tags: '',
          physical_entity_id: 'physical-orders-table',
          is_primary_key: true,
          oas_data_type: 'string_uuid',
        },
      ],
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
      // The key relationship table - uses dataEntityPointId format
      interface_logical_entities: [
        {
          id: 'rel-1',
          interface_id: 'interface-1',
          dataEntityPointId: 'dep_log_logical-order',  // Logical Order entity
          description: 'Order entity schema',
          tags: '',
        },
        {
          id: 'rel-2',
          interface_id: 'interface-1',
          dataEntityPointId: 'dep_log_logical-customer',  // Logical Customer entity
          description: 'Customer entity schema',
          tags: '',
        },
        {
          id: 'rel-3',
          interface_id: 'interface-1',
          dataEntityPointId: 'dep_phy_physical-orders-table',  // Physical orders table
          description: 'Physical storage for orders',
          tags: '',
        },
      ],
      ui_workflow_transitions: [],
    },
  };
}

// ============================================================================
// Test Suite: parseDataEntityPointId
// ============================================================================

describe('Regression: parseDataEntityPointId', () => {
  it('should parse dep_log_ prefix correctly', () => {
    const result = parseDataEntityPointId('dep_log_logical-order');
    expect(result).toEqual({
      entityType: 'logical',
      entityId: 'logical-order',
    });
  });

  it('should parse dep_phy_ prefix correctly', () => {
    const result = parseDataEntityPointId('dep_phy_physical-orders-table');
    expect(result).toEqual({
      entityType: 'physical',
      entityId: 'physical-orders-table',
    });
  });

  it('should return null for invalid format', () => {
    expect(parseDataEntityPointId('invalid-format')).toBeNull();
    expect(parseDataEntityPointId('')).toBeNull();
    expect(parseDataEntityPointId('logical-order')).toBeNull();  // Missing prefix
  });
});

// ============================================================================
// Test Suite: resolveDataEntitiesForInterface
// ============================================================================

describe('Regression: resolveDataEntitiesForInterface', () => {
  it('should return grouped entity IDs from dataEntityPointId field', () => {
    const metaModel = createBugScenarioMetaModel();
    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    // Should have 2 logical entities
    expect(result.logicalEntityIds).toContain('logical-order');
    expect(result.logicalEntityIds).toContain('logical-customer');
    expect(result.logicalEntityIds.length).toBe(2);

    // Should have 1 physical entity
    expect(result.physicalEntityIds).toContain('physical-orders-table');
    expect(result.physicalEntityIds.length).toBe(1);
  });

  it('should not read deprecated logical_entity_id field', () => {
    // Create a model with both old and new fields to verify we use the new one
    const metaModel = createBugScenarioMetaModel();

    // Add a relationship with deprecated field that should be ignored
    (metaModel.relationships.interface_logical_entities as any).push({
      id: 'rel-deprecated',
      interface_id: 'interface-1',
      logical_entity_id: 'should-be-ignored',  // Deprecated field
      dataEntityPointId: 'dep_log_logical-product',  // New field
      description: '',
      tags: '',
    });

    const result = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    // Should include logical-product (from dataEntityPointId), not 'should-be-ignored'
    expect(result.logicalEntityIds).toContain('logical-product');
    expect(result.logicalEntityIds).not.toContain('should-be-ignored');
  });
});

// ============================================================================
// Test Suite: getDataEntityIdsForInterface
// ============================================================================

describe('Regression: getDataEntityIdsForInterface', () => {
  it('should return same result as resolveDataEntitiesForInterface (uses shared utility)', () => {
    const metaModel = createBugScenarioMetaModel();

    const result1 = resolveDataEntitiesForInterface(metaModel, 'interface-1');
    const result2 = getDataEntityIdsForInterface('interface-1', metaModel);

    expect(result2.logicalEntityIds).toEqual(result1.logicalEntityIds);
    expect(result2.physicalEntityIds).toEqual(result1.physicalEntityIds);
  });
});

// ============================================================================
// Test Suite: buildTreeData Integration
// ============================================================================

describe('Regression: buildTreeData with Interface root', () => {
  it('should include both logical and physical entities as children', () => {
    const metaModel = createBugScenarioMetaModel();
    const rootEntity = {
      id: 'interface-1',
      name: 'Order REST API',
      type: ENTITY_TYPES.INTERFACE,
    };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Get all child entity types
    const childEntityTypes = treeData.children.map(c => c.entityType);

    // Should include LOGICAL_DATA_ENTITY children
    const logicalChildren = treeData.children.filter(
      c => c.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
    );
    expect(logicalChildren.length).toBe(2);

    // Should include PHYSICAL_DATA_ENTITY children
    const physicalChildren = treeData.children.filter(
      c => c.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
    );
    expect(physicalChildren.length).toBe(1);

    // Should include ENDPOINT children
    const endpointChildren = treeData.children.filter(
      c => c.entityType === ENTITY_TYPES.ENDPOINT
    );
    expect(endpointChildren.length).toBe(2);
  });

  it('should correctly resolve entity names from entity collections', () => {
    const metaModel = createBugScenarioMetaModel();
    const rootEntity = {
      id: 'interface-1',
      name: 'Order REST API',
      type: ENTITY_TYPES.INTERFACE,
    };

    const treeData = buildTreeData(metaModel, rootEntity);

    // Find logical Order entity by ID
    const orderNode = treeData.children.find(
      c => c.entityId === 'logical-order' && c.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
    );
    expect(orderNode).toBeDefined();
    expect(orderNode?.entityName).toBe('Order');

    // Find physical orders_table entity by ID
    const physicalOrderNode = treeData.children.find(
      c => c.entityId === 'physical-orders-table' && c.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
    );
    expect(physicalOrderNode).toBeDefined();
    expect(physicalOrderNode?.entityName).toBe('orders_table');
  });
});

// ============================================================================
// Test Suite: buildInterfaceCompositeNodes Integration
// ============================================================================

describe('Regression: buildInterfaceCompositeNodes', () => {
  it('should create child nodes for both logical and physical entities', () => {
    const metaModel = createBugScenarioMetaModel();

    const result = buildInterfaceCompositeNodes(
      'interface-1',
      ['endpoint-1', 'endpoint-2'],
      {
        logicalEntityIds: ['logical-order', 'logical-customer'],
        physicalEntityIds: ['physical-orders-table'],
      },
      new Map(),
      metaModel,
      { x: 500, y: 500 },
      0,
      null
    );

    // Should have 3 child entity nodes (2 logical + 1 physical)
    expect(result.entityNodes.length).toBe(3);

    // Verify entity types
    const logicalNodes = result.entityNodes.filter(
      n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY
    );
    const physicalNodes = result.entityNodes.filter(
      n => n.entity_type === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
    );

    expect(logicalNodes.length).toBe(2);
    expect(physicalNodes.length).toBe(1);

    // Verify all nodes have parent_node_id set to the interface node
    result.entityNodes.forEach(node => {
      expect(node.parent_node_id).toBe(result.interfaceNode.id);
    });
  });

  it('should set embedded_entity_ids on interface node with all entity IDs', () => {
    const metaModel = createBugScenarioMetaModel();

    const result = buildInterfaceCompositeNodes(
      'interface-1',
      ['endpoint-1'],
      {
        logicalEntityIds: ['logical-order'],
        physicalEntityIds: ['physical-orders-table'],
      },
      new Map(),
      metaModel,
      { x: 500, y: 500 },
      0,
      null
    );

    // embedded_entity_ids should include both logical and physical
    expect(result.interfaceNode.embedded_entity_ids).toContain('logical-order');
    expect(result.interfaceNode.embedded_entity_ids).toContain('physical-orders-table');
  });
});

// ============================================================================
// Test Suite: Full Integration Scenario
// ============================================================================

describe('Regression: Full Integration Scenario', () => {
  it('should correctly handle the complete workflow from Interface to child entities', () => {
    const metaModel = createBugScenarioMetaModel();

    // Step 1: Resolve entities for interface using shared utility
    const resolvedEntities = resolveDataEntitiesForInterface(metaModel, 'interface-1');

    // Verify correct entity counts
    expect(resolvedEntities.logicalEntityIds.length).toBe(2);
    expect(resolvedEntities.physicalEntityIds.length).toBe(1);

    // Step 2: Build tree data for Advanced Add dialog
    const treeData = buildTreeData(metaModel, {
      id: 'interface-1',
      name: 'Order REST API',
      type: ENTITY_TYPES.INTERFACE,
    });

    // Verify tree has correct structure
    const totalDataEntityChildren = treeData.children.filter(
      c => c.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
           c.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
    ).length;
    expect(totalDataEntityChildren).toBe(3);  // 2 logical + 1 physical

    // Step 3: Build composite nodes for diagram rendering
    const compositeResult = buildInterfaceCompositeNodes(
      'interface-1',
      ['endpoint-1', 'endpoint-2'],
      resolvedEntities,
      new Map(),
      metaModel,
      { x: 500, y: 500 },
      0,
      null
    );

    // Verify composite has correct structure
    expect(compositeResult.interfaceNode.render_style).toBe('contract');
    expect(compositeResult.entityNodes.length).toBe(3);

    // Verify all entity IDs match between tree and composite
    const treeEntityIds = treeData.children
      .filter(c =>
        c.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY ||
        c.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      )
      .map(c => c.entityId)
      .sort();

    const compositeEntityIds = compositeResult.entityNodes
      .map(n => n.entity_id)
      .sort();

    expect(compositeEntityIds).toEqual(treeEntityIds);
  });
});
