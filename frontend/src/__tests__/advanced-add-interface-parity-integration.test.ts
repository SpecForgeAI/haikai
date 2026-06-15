/**
 * Integration Tests for Advanced Add Interface Parity
 *
 * Task Group 5: Integration tests verifying end-to-end workflows for
 * Interface custom layout in Advanced Add dialog.
 *
 * These tests verify the acceptance criteria:
 * - AC1: "Add with all children" unchanged (no regression)
 * - AC2: Full chain produces custom Interface layout
 * - AC3: Visual parity between both paths
 * - AC4: Partial selection includes only selected children
 * - AC5: Interface-only selection produces plain node
 */

import { MetaModel, ENTITY_TYPES, DiagramNode } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import {
  buildInterfaceCompositeNodes,
  getLogicalEntityIdsForInterface,
} from '../utils/interfaceCompositeBuilder';
import {
  findInterfaceCustomCandidates,
  isEmbeddedInterfaceChild,
  InterfaceCustomCandidate,
} from '../utils/erdAdvancedAddUtils';
import {
  layoutAdvancedAddSelection,
  convertTodiagramNodes,
} from '../utils/compoundLayout';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a comprehensive MetaModel with full hierarchy:
 * Application -> Service -> Interface -> Endpoints + Logical Entities
 */
function createComprehensiveMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Customer Service', description: 'Customer management application', app_type: 'WEB', status: 'ACTIVE', tags: '' },
      ],
      app_components: [
        { id: 'comp-1', name: 'API Gateway', description: '', application_id: 'app-1', component_type: 'GATEWAY', tags: '' },
      ],
      services: [
        { id: 'svc-1', name: 'Customer Service API', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', name: 'Customer REST API', description: 'REST API for customer operations', service_id: 'svc-1', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [
        {
          id: 'ep-1', name: 'Get Customer', description: 'Retrieve customer by ID', interface_id: 'int-1',
          endpoint_type: 'HTTP_REST' as const, path_or_address: '/customers/{id}', operation_verb: 'GET', tags: ''
        },
        {
          id: 'ep-2', name: 'Create Customer', description: 'Create new customer', interface_id: 'int-1',
          endpoint_type: 'HTTP_REST' as const, path_or_address: '/customers', operation_verb: 'POST', tags: ''
        },
        {
          id: 'ep-3', name: 'Update Customer', description: 'Update existing customer', interface_id: 'int-1',
          endpoint_type: 'HTTP_REST' as const, path_or_address: '/customers/{id}', operation_verb: 'PUT', tags: ''
        },
      ],
      application_points: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer', description: 'Customer entity', tags: '' },
        { id: 'lde-2', name: 'Address', description: 'Address entity', tags: '' },
        { id: 'lde-3', name: 'Contact', description: 'Contact information', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'lda-1', name: 'id', description: '', logical_entity_id: 'lde-1', data_type: 'string_uuid', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'lda-2', name: 'name', description: '', logical_entity_id: 'lde-1', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'lda-3', name: 'email', description: '', logical_entity_id: 'lde-1', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'lda-4', name: 'street', description: '', logical_entity_id: 'lde-2', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'lda-5', name: 'city', description: '', logical_entity_id: 'lde-2', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'lda-6', name: 'phone', description: '', logical_entity_id: 'lde-3', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
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
        { id: 'ile-3', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-3', description: '', tags: '' },
      ],
    },
  };
}

/**
 * Create a tree structure representing the full hierarchy.
 */
function createFullHierarchyTree(): TreeNodeData {
  return {
    key: 'app-1',
    title: 'Customer Service',
    entityId: 'app-1',
    entityType: ENTITY_TYPES.APPLICATION,
    children: [
      {
        key: 'comp-1',
        title: 'API Gateway',
        entityId: 'comp-1',
        entityType: ENTITY_TYPES.APP_COMPONENT,
        children: [],
      },
      {
        key: 'svc-1',
        title: 'Customer Service API',
        entityId: 'svc-1',
        entityType: ENTITY_TYPES.SERVICE,
        children: [
          {
            key: 'int-1',
            title: 'Customer REST API',
            entityId: 'int-1',
            entityType: ENTITY_TYPES.INTERFACE,
            children: [
              { key: 'ep-1', title: 'Get Customer', entityId: 'ep-1', entityType: ENTITY_TYPES.ENDPOINT, children: [] },
              { key: 'ep-2', title: 'Create Customer', entityId: 'ep-2', entityType: ENTITY_TYPES.ENDPOINT, children: [] },
              { key: 'ep-3', title: 'Update Customer', entityId: 'ep-3', entityType: ENTITY_TYPES.ENDPOINT, children: [] },
              {
                key: 'lde-1',
                title: 'Customer',
                entityId: 'lde-1',
                entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
                children: [
                  { key: 'lda-1', title: 'id', entityId: 'lda-1', entityType: ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, children: [] },
                  { key: 'lda-2', title: 'name', entityId: 'lda-2', entityType: ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, children: [] },
                  { key: 'lda-3', title: 'email', entityId: 'lda-3', entityType: ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, children: [] },
                ],
              },
              {
                key: 'lde-2',
                title: 'Address',
                entityId: 'lde-2',
                entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
                children: [
                  { key: 'lda-4', title: 'street', entityId: 'lda-4', entityType: ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, children: [] },
                  { key: 'lda-5', title: 'city', entityId: 'lda-5', entityType: ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, children: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Integration Test Suite
// ============================================================================

describe('Advanced Add Interface Parity - Integration', () => {
  let metaModel: MetaModel;

  beforeEach(() => {
    metaModel = createComprehensiveMetaModel();
  });

  // -------------------------------------------------------------------------
  // AC2 Test: Full chain (Application -> Component -> Service -> Interface -> Entities + Endpoints)
  // -------------------------------------------------------------------------
  describe('AC2: Full chain produces custom Interface layout', () => {
    it('should detect Interface candidate in full hierarchy selection', () => {
      const treeData = createFullHierarchyTree();

      // Select full chain including Interface with children
      const selectedKeys = new Set([
        'app-1', 'svc-1', 'int-1',
        'ep-1', 'ep-2', 'ep-3',
        'lde-1', 'lde-2'
      ]);

      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);

      expect(candidates.length).toBe(1);
      expect(candidates[0].interface.entityId).toBe('int-1');
      expect(candidates[0].endpoints.length).toBe(3);
      expect(candidates[0].logicalEntities.length).toBe(2);
    });

    it('should filter embedded children from orderedNodes', () => {
      const treeData = createFullHierarchyTree();

      const selectedKeys = new Set([
        'app-1', 'svc-1', 'int-1',
        'ep-1', 'ep-2',
        'lde-1'
      ]);

      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);

      // Get Interface node from tree
      const svcNode = treeData.children.find(c => c.entityId === 'svc-1');
      const intNode = svcNode?.children.find(c => c.entityId === 'int-1');
      const epNode = intNode?.children.find(c => c.entityId === 'ep-1');
      const ldeNode = intNode?.children.find(c => c.entityId === 'lde-1');

      // Endpoints and logical entities should be identified as embedded
      expect(isEmbeddedInterfaceChild(epNode!, candidates)).toBe(true);
      expect(isEmbeddedInterfaceChild(ldeNode!, candidates)).toBe(true);

      // Interface itself should NOT be embedded
      expect(isEmbeddedInterfaceChild(intNode!, candidates)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // AC3 Test: JSON parity between "Add with all children" and Advanced Add for same Interface
  // -------------------------------------------------------------------------
  describe('AC3: Visual parity between both paths', () => {
    it('should produce same render_style for Interface via both paths', () => {
      const interfaceId = 'int-1';
      const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);
      const logicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);

      // Path 1: "Add with all children" uses buildInterfaceCompositeNodes directly
      const directResult = buildInterfaceCompositeNodes(
        interfaceId,
        endpoints.map(ep => ep.id),
        { logicalEntityIds: logicalEntityIds, physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // Path 2: Advanced Add uses convertTodiagramNodes with interfaceCandidateMap
      const treeData = createFullHierarchyTree();
      const svcNode = treeData.children.find(c => c.entityId === 'svc-1');
      const intNode = svcNode?.children.find(c => c.entityId === 'int-1');

      const selectedKeys = new Set(['int-1', 'ep-1', 'ep-2', 'ep-3', 'lde-1', 'lde-2', 'lde-3']);
      const candidates = findInterfaceCustomCandidates([intNode!], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const c of candidates) {
        interfaceCandidateMap.set(c.interface.entityId, c);
      }

      // Create layout node for Interface (children filtered)
      const layoutResult = layoutAdvancedAddSelection(
        { id: 'int-1', type: ENTITY_TYPES.INTERFACE, label: 'Customer REST API', children: [] },
        { x: 500, y: 300 }
      );

      const advancedAddNodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      const advancedAddInterfaceNode = advancedAddNodes.find(n => n.entity_id === 'int-1');

      // Both should have same render_style
      expect(directResult.interfaceNode.render_style).toBe('contract');
      expect(advancedAddInterfaceNode?.render_style).toBe('contract');

      // Both should have embedded_endpoint_ids
      expect(directResult.interfaceNode.embedded_endpoint_ids?.length).toBeGreaterThan(0);
      expect(advancedAddInterfaceNode?.embedded_endpoint_ids?.length).toBeGreaterThan(0);

      // Both should have embedded_entity_ids
      expect(directResult.interfaceNode.embedded_entity_ids?.length).toBeGreaterThan(0);
      expect(advancedAddInterfaceNode?.embedded_entity_ids?.length).toBeGreaterThan(0);
    });

    it('should create entity children with ERD render_style via both paths', () => {
      const interfaceId = 'int-1';
      const endpoints = metaModel.entities.endpoints.filter(ep => ep.interface_id === interfaceId);
      const logicalEntityIds = getLogicalEntityIdsForInterface(interfaceId, metaModel);

      // Path 1: Direct
      const directResult = buildInterfaceCompositeNodes(
        interfaceId,
        endpoints.map(ep => ep.id),
        { logicalEntityIds: logicalEntityIds, physicalEntityIds: [] },
        new Map(),
        metaModel,
        { x: 500, y: 300 },
        100,
        null
      );

      // Path 2: Advanced Add
      const treeData = createFullHierarchyTree();
      const svcNode = treeData.children.find(c => c.entityId === 'svc-1');
      const intNode = svcNode?.children.find(c => c.entityId === 'int-1');

      const selectedKeys = new Set(['int-1', 'ep-1', 'ep-2', 'ep-3', 'lde-1', 'lde-2', 'lde-3']);
      const candidates = findInterfaceCustomCandidates([intNode!], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const c of candidates) {
        interfaceCandidateMap.set(c.interface.entityId, c);
      }

      const layoutResult = layoutAdvancedAddSelection(
        { id: 'int-1', type: ENTITY_TYPES.INTERFACE, label: 'Customer REST API', children: [] },
        { x: 500, y: 300 }
      );

      const advancedAddNodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      // Both should create entity nodes with ERD render_style
      for (const entityNode of directResult.entityNodes) {
        expect(entityNode.render_style).toBe('erd');
      }

      const advancedAddEntityNodes = advancedAddNodes.filter(
        n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );
      for (const entityNode of advancedAddEntityNodes) {
        expect(entityNode.render_style).toBe('erd');
      }
    });
  });

  // -------------------------------------------------------------------------
  // AC4 Test: Partial selection (only some endpoints/entities selected)
  // -------------------------------------------------------------------------
  describe('AC4: Partial selection includes only selected children', () => {
    it('should include only selected endpoints in candidate', () => {
      const treeData = createFullHierarchyTree();
      const svcNode = treeData.children.find(c => c.entityId === 'svc-1');
      const intNode = svcNode?.children.find(c => c.entityId === 'int-1');

      // Select Interface with only 2 of 3 endpoints
      const selectedKeys = new Set(['int-1', 'ep-1', 'ep-3']); // ep-2 not selected

      const candidates = findInterfaceCustomCandidates([intNode!], selectedKeys, metaModel);

      expect(candidates.length).toBe(1);
      expect(candidates[0].endpoints.length).toBe(2);
      expect(candidates[0].endpoints.map(e => e.entityId)).toContain('ep-1');
      expect(candidates[0].endpoints.map(e => e.entityId)).toContain('ep-3');
      expect(candidates[0].endpoints.map(e => e.entityId)).not.toContain('ep-2');
    });

    it('should include only selected logical entities in candidate', () => {
      const treeData = createFullHierarchyTree();
      const svcNode = treeData.children.find(c => c.entityId === 'svc-1');
      const intNode = svcNode?.children.find(c => c.entityId === 'int-1');

      // Select Interface with only 1 of 2 logical entities (note: lde-3 not in tree for simplicity)
      const selectedKeys = new Set(['int-1', 'lde-1']); // lde-2 not selected

      const candidates = findInterfaceCustomCandidates([intNode!], selectedKeys, metaModel);

      expect(candidates.length).toBe(1);
      expect(candidates[0].logicalEntities.length).toBe(1);
      expect(candidates[0].logicalEntities[0].entityId).toBe('lde-1');
    });

    it('should create Interface with partial embedded_endpoint_ids', () => {
      const treeData = createFullHierarchyTree();
      const svcNode = treeData.children.find(c => c.entityId === 'svc-1');
      const intNode = svcNode?.children.find(c => c.entityId === 'int-1');

      const selectedKeys = new Set(['int-1', 'ep-1']); // Only one endpoint
      const candidates = findInterfaceCustomCandidates([intNode!], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const c of candidates) {
        interfaceCandidateMap.set(c.interface.entityId, c);
      }

      const layoutResult = layoutAdvancedAddSelection(
        { id: 'int-1', type: ENTITY_TYPES.INTERFACE, label: 'Customer REST API', children: [] },
        { x: 500, y: 300 }
      );

      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      expect(interfaceNode?.embedded_endpoint_ids?.length).toBe(1);
      expect(interfaceNode?.embedded_endpoint_ids).toContain('ep-1');
    });
  });

  // -------------------------------------------------------------------------
  // AC5 Test: Interface-only selection falls back to plain node
  // -------------------------------------------------------------------------
  describe('AC5: Interface-only selection produces plain node', () => {
    it('should not create Interface candidate when no children selected', () => {
      const treeData = createFullHierarchyTree();
      const svcNode = treeData.children.find(c => c.entityId === 'svc-1');
      const intNode = svcNode?.children.find(c => c.entityId === 'int-1');

      // Select only Interface, no children
      const selectedKeys = new Set(['int-1']);

      const candidates = findInterfaceCustomCandidates([intNode!], selectedKeys, metaModel);

      expect(candidates.length).toBe(0);
    });

    it('should create plain node for Interface-only selection', () => {
      const layoutResult = layoutAdvancedAddSelection(
        { id: 'int-1', type: ENTITY_TYPES.INTERFACE, label: 'Customer REST API', children: [] },
        { x: 500, y: 300 }
      );

      // No interface candidate map = plain node
      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        undefined
      );

      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      expect(interfaceNode).toBeDefined();
      expect(interfaceNode?.render_style).toBeUndefined();
      expect(interfaceNode?.embedded_endpoint_ids).toBeUndefined();
      expect(interfaceNode?.embedded_entity_ids).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Additional: Entity positioning test
  // -------------------------------------------------------------------------
  describe('Entity positioning inside Interface', () => {
    it('should position entities inside Interface bounds', () => {
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

      const interfaceNode = result.interfaceNode;

      // All entity nodes should be inside Interface bounds
      for (const entityNode of result.entityNodes) {
        expect(entityNode.pos_x).toBeGreaterThanOrEqual(interfaceNode.pos_x);
        expect(entityNode.pos_y).toBeGreaterThanOrEqual(interfaceNode.pos_y);
        expect(entityNode.pos_x + entityNode.width).toBeLessThanOrEqual(
          interfaceNode.pos_x + interfaceNode.width
        );
        expect(entityNode.pos_y + entityNode.height).toBeLessThanOrEqual(
          interfaceNode.pos_y + interfaceNode.height
        );
      }
    });
  });
});
