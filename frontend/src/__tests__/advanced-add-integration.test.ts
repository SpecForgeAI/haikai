/**
 * Integration Tests for Advanced Add Feature
 *
 * Task Group 6: Tests
 * Tests the complete Advanced Add workflow from relationships map
 * to tree building to selection handling.
 */

import { ENTITY_TYPES, MetaModel } from '../types/model';
import {
  getExpandableRelationships,
  hasExpandableRelationships,
  getRelationshipKindLabel,
} from '../utils/advancedAddRelationships';
import { buildTreeData, getEntityTypeDisplayName } from '../components/DiagramsView/AdvancedAddDialog';
import { processExpansionResponse } from '../utils/diagramApi';
import { AdvancedAddResponse, NodeDescriptor, EdgeDescriptor } from '../types/advancedAdd';

// ============================================================================
// Mock Data
// ============================================================================

const createMockMetaModel = (): MetaModel => ({
  entities: {
    business_users: [
      { id: 'bu-1', name: 'Business User 1', description: '', tags: '' },
    ],
    business_processes: [
      { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
      { id: 'bp-2', name: 'Process 2', description: '', tags: '' },
    ],
    process_activities: [
      { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity 1', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      { id: 'pa-2', business_process_id: 'bp-1', name: 'Activity 2', description: '', sequence_order: 2, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
    ],
    applications: [
      { id: 'app-1', name: 'Test Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ],
    app_components: [
      { id: 'ac-1', application_id: 'app-1', name: 'Component 1', description: '', tags: '' },
      { id: 'ac-2', application_id: 'app-1', name: 'Component 2', description: '', tags: '' },
    ],
    services: [
      { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Service 1', description: '', service_type: 'API', tags: '' },
      { id: 'svc-2', application_id: 'app-1', name: 'Service 2', description: '', service_type: 'API', tags: '' },
    ],
    interfaces: [
      { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
    ],
    application_points: [
      { id: 'ap-1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
    ],
    business_points: [
      { id: 'bpt-1', name: 'Process 1 Point', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
    ],
    logical_data_entities: [
      { id: 'lde-1', name: 'Logical Entity 1', description: '', tags: '' },
    ],
    logical_data_attributes: [
      { id: 'lda-1', logical_entity_id: 'lde-1', name: 'Attribute 1', description: '', data_type: 'String', is_primary_key: false, is_nullable: true, tags: '' },
    ],
    physical_data_entities: [
      { id: 'pde-1', name: 'Physical Entity 1', description: '', physical_type: 'Table', database: 'DB1', tags: '' },
    ],
    physical_data_attributes: [
      { id: 'pda-1', physical_entity_id: 'pde-1', name: 'Column 1', description: '', data_type: 'VARCHAR', is_primary_key: false, is_nullable: true, tags: '' },
    ],
  },
  relationships: {
    business_user_business_points: [],
    application_point_business_points: [
      { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
    ],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [
      { id: 'ldepde-1', logical_entity_id: 'lde-1', physical_entity_id: 'pde-1', description: '', tags: '' },
    ],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  },
});

// ============================================================================
// Test 1: Tree structure matches meta-model relationships
// ============================================================================

describe('Tree structure matches meta-model relationships', () => {
  const metaModel = createMockMetaModel();

  it('should build Application tree with correct children', () => {
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should be the application
    expect(treeData.isRoot).toBe(true);
    expect(treeData.entityId).toBe('app-1');
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);

    // Should have app components as children
    const acChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.APP_COMPONENT);
    expect(acChildren.length).toBe(2);

    // Should have services as children
    const svcChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.SERVICE);
    // With deduplication: svc-1 under ac-1, only svc-2 direct child of Application
    expect(svcChildren.length).toBe(1);

    // Should have business processes as children (via association)
    const bpChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.BUSINESS_PROCESS);
    expect(bpChildren.length).toBe(1);
    expect(bpChildren[0].relationshipKind).toBe('ASSOCIATION');
  });

  it('should build BusinessProcess tree with process activities', () => {
    const rootEntity = { id: 'bp-1', name: 'Process 1', type: ENTITY_TYPES.BUSINESS_PROCESS };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Root should be the business process
    expect(treeData.isRoot).toBe(true);
    expect(treeData.entityId).toBe('bp-1');

    // Should have process activities as children
    const paChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(paChildren.length).toBe(2);
    expect(paChildren[0].relationshipKind).toBe('PARENT_CHILD');
  });

  it('should build LogicalDataEntity tree with attributes and physical entities', () => {
    const rootEntity = { id: 'lde-1', name: 'Logical Entity 1', type: ENTITY_TYPES.LOGICAL_DATA_ENTITY };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Should have logical attributes as parent/child
    const ldaChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE);
    expect(ldaChildren.length).toBe(1);
    expect(ldaChildren[0].relationshipKind).toBe('PARENT_CHILD');

    // Should have physical entities as association
    const pdeChildren = treeData.children.filter((c) => c.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
    expect(pdeChildren.length).toBe(1);
    expect(pdeChildren[0].relationshipKind).toBe('ASSOCIATION');
  });

  it('should correctly label relationship kinds', () => {
    expect(getRelationshipKindLabel('PARENT_CHILD')).toBe('(parent/child)');
    expect(getRelationshipKindLabel('ASSOCIATION')).toBe('(association)');
  });
});

// ============================================================================
// Test 2: No duplicate nodes/edges on repeated expansions
// ============================================================================

describe('No duplicate nodes/edges on repeated expansions', () => {
  it('should filter out nodes already on diagram', () => {
    const response: AdvancedAddResponse = {
      nodes: [
        { entityType: 'APPLICATION', entityId: 'app-1', entityName: 'App 1', alreadyOnDiagram: true },
        { entityType: 'APP_COMPONENT', entityId: 'ac-1', entityName: 'Component 1', alreadyOnDiagram: false },
        { entityType: 'APP_COMPONENT', entityId: 'ac-2', entityName: 'Component 2', alreadyOnDiagram: true },
        { entityType: 'SERVICE', entityId: 'svc-1', entityName: 'Service 1', alreadyOnDiagram: false },
      ],
      edges: [
        { relationshipType: 'test', relationshipId: 'rel-1', sourceEntityId: 'app-1', targetEntityId: 'ac-1', alreadyOnDiagram: true },
        { relationshipType: 'test', relationshipId: 'rel-2', sourceEntityId: 'app-1', targetEntityId: 'ac-2', alreadyOnDiagram: false },
      ],
    };

    const { newNodes, newEdges } = processExpansionResponse(response);

    // Should only include nodes not on diagram
    expect(newNodes.length).toBe(2);
    expect(newNodes.map((n) => n.entityId)).toEqual(['ac-1', 'svc-1']);

    // Should only include edges not on diagram
    expect(newEdges.length).toBe(1);
    expect(newEdges[0].relationshipId).toBe('rel-2');
  });

  it('should handle empty responses', () => {
    const response: AdvancedAddResponse = {
      nodes: [],
      edges: [],
    };

    const { newNodes, newEdges } = processExpansionResponse(response);

    expect(newNodes.length).toBe(0);
    expect(newEdges.length).toBe(0);
  });

  it('should handle all nodes already on diagram', () => {
    const response: AdvancedAddResponse = {
      nodes: [
        { entityType: 'APPLICATION', entityId: 'app-1', entityName: 'App 1', alreadyOnDiagram: true },
        { entityType: 'APP_COMPONENT', entityId: 'ac-1', entityName: 'Component 1', alreadyOnDiagram: true },
      ],
      edges: [],
    };

    const { newNodes, newEdges } = processExpansionResponse(response);

    expect(newNodes.length).toBe(0);
    expect(newEdges.length).toBe(0);
  });
});

// ============================================================================
// Test 3: Multi-level depth support
// ============================================================================

describe('Multi-level depth support', () => {
  const metaModel = createMockMetaModel();

  it('should support Application -> AppComponent -> Service -> Interface chain with deduplication', () => {
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // With deduplication, svc-1 is under ac-1, not directly under Application
    const ac1 = treeData.children.find(
      (c) => c.entityType === ENTITY_TYPES.APP_COMPONENT && c.entityId === 'ac-1'
    );
    expect(ac1).toBeDefined();

    // Find svc-1 under ac-1
    const svc1 = ac1?.children.find(
      (c) => c.entityType === ENTITY_TYPES.SERVICE && c.entityId === 'svc-1'
    );
    expect(svc1).toBeDefined();

    // svc-1 should have interface children
    const interfaceChildren = svc1?.children.filter((c) => c.entityType === ENTITY_TYPES.INTERFACE);
    expect(interfaceChildren?.length).toBe(1);
    expect(interfaceChildren?.[0].entityId).toBe('int-1');
  });

  it('should support AppComponent -> Service nesting', () => {
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Find ac-1 in children
    const ac1 = treeData.children.find(
      (c) => c.entityType === ENTITY_TYPES.APP_COMPONENT && c.entityId === 'ac-1'
    );
    expect(ac1).toBeDefined();

    // ac-1 should have service children (svc-1 has app_component_id = ac-1)
    const serviceChildren = ac1?.children.filter((c) => c.entityType === ENTITY_TYPES.SERVICE);
    expect(serviceChildren?.length).toBe(1);
    expect(serviceChildren?.[0].entityId).toBe('svc-1');
  });
});

// ============================================================================
// Test 4: Entity type display names
// ============================================================================

describe('Entity type display names', () => {
  const testCases = [
    { type: ENTITY_TYPES.APPLICATION, expected: 'Application' },
    { type: ENTITY_TYPES.APP_COMPONENT, expected: 'App Component' },
    { type: ENTITY_TYPES.SERVICE, expected: 'Service' },
    { type: ENTITY_TYPES.INTERFACE, expected: 'Interface' },
    { type: ENTITY_TYPES.BUSINESS_PROCESS, expected: 'Business Process' },
    { type: ENTITY_TYPES.PROCESS_ACTIVITY, expected: 'Process Activity' },
    { type: ENTITY_TYPES.LOGICAL_DATA_ENTITY, expected: 'Logical Data Entity' },
    { type: ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, expected: 'Logical Data Attribute' },
    { type: ENTITY_TYPES.PHYSICAL_DATA_ENTITY, expected: 'Physical Data Entity' },
    { type: ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE, expected: 'Physical Data Attribute' },
    { type: ENTITY_TYPES.BUSINESS_USER, expected: 'Business User' },
    { type: ENTITY_TYPES.APPLICATION_POINT, expected: 'Application Point' },
  ];

  testCases.forEach(({ type, expected }) => {
    it(`should return "${expected}" for ${type}`, () => {
      expect(getEntityTypeDisplayName(type)).toBe(expected);
    });
  });
});

// ============================================================================
// Test 5: Expandable relationships completeness
// ============================================================================

describe('Expandable relationships completeness', () => {
  const entityTypesWithRelationships = [
    ENTITY_TYPES.APPLICATION,
    ENTITY_TYPES.BUSINESS_PROCESS,
    ENTITY_TYPES.APP_COMPONENT,
    ENTITY_TYPES.SERVICE,
    ENTITY_TYPES.LOGICAL_DATA_ENTITY,
    ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
    ENTITY_TYPES.BUSINESS_USER,
    ENTITY_TYPES.INTERFACE,
  ];

  const leafEntityTypes = [
    ENTITY_TYPES.PROCESS_ACTIVITY,
    ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE,
    ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE,
  ];

  entityTypesWithRelationships.forEach((type) => {
    it(`${type} should have expandable relationships`, () => {
      expect(hasExpandableRelationships(type)).toBe(true);
      expect(getExpandableRelationships(type).length).toBeGreaterThan(0);
    });
  });

  leafEntityTypes.forEach((type) => {
    it(`${type} should be a leaf entity (no expandable relationships)`, () => {
      expect(hasExpandableRelationships(type)).toBe(false);
      expect(getExpandableRelationships(type).length).toBe(0);
    });
  });
});

// ============================================================================
// Test 6: Tree node structure
// ============================================================================

describe('Tree node structure', () => {
  const metaModel = createMockMetaModel();

  it('should include all required fields in tree nodes', () => {
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    // Check root node structure
    expect(treeData.key).toBeDefined();
    expect(treeData.label).toBeDefined();
    expect(treeData.entityType).toBe(ENTITY_TYPES.APPLICATION);
    expect(treeData.entityId).toBe('app-1');
    expect(treeData.entityName).toBe('Test Application');
    expect(treeData.isRoot).toBe(true);
    expect(treeData.children).toBeDefined();

    // Check child node structure
    if (treeData.children.length > 0) {
      const child = treeData.children[0];
      expect(child.key).toBeDefined();
      expect(child.label).toBeDefined();
      expect(child.entityType).toBeDefined();
      expect(child.entityId).toBeDefined();
      expect(child.entityName).toBeDefined();
      expect(child.isRoot).toBe(false);
      expect(child.relationshipKind).toBeDefined();
      expect(child.parentKey).toBe(treeData.key);
      expect(child.children).toBeDefined();
    }
  });

  it('should generate unique keys for each node', () => {
    const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };
    const treeData = buildTreeData(metaModel, rootEntity);

    const allKeys = new Set<string>();

    function collectKeys(node: typeof treeData) {
      allKeys.add(node.key);
      node.children.forEach(collectKeys);
    }

    collectKeys(treeData);

    // All keys should be unique
    let nodeCount = 1; // root
    function countNodes(node: typeof treeData): number {
      return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
    }
    nodeCount = countNodes(treeData);

    expect(allKeys.size).toBe(nodeCount);
  });
});
