/**
 * Tests for Layout Conversion with Interface Candidates
 *
 * Task Group 4: Tests for convertTodiagramNodes with Interface custom candidates.
 *
 * These tests verify that the layout conversion correctly handles Interface
 * custom candidates, creating contract-style nodes with embedded endpoints
 * and entity children.
 */

import {
  convertTodiagramNodes,
  layoutAdvancedAddSelection,
} from '../utils/compoundLayout';
import {
  findInterfaceCustomCandidates,
  InterfaceCustomCandidate,
} from '../utils/erdAdvancedAddUtils';
import { MetaModel, ENTITY_TYPES } from '../types/model';
import { TreeNodeData, LayoutTreeNode } from '../types/advancedAdd';

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
        { id: 'ile-1', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-1', description: '', tags: '' },
        { id: 'ile-2', interface_id: 'int-1', dataEntityPointId: 'dep_log_lde-2', description: '', tags: '' },
      ],
    },
  };
}

/**
 * Create a LayoutTreeNode for Interface with endpoints and logical entities.
 */
function createTestLayoutTree(): LayoutTreeNode {
  return {
    id: 'int-1',
    type: ENTITY_TYPES.INTERFACE,
    label: 'Customer API',
    children: [], // Children are filtered out before layout
  };
}

/**
 * Create tree data for Interface custom candidate detection.
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

describe('Layout Conversion with Interface Candidates', () => {
  let metaModel: MetaModel;

  beforeEach(() => {
    metaModel = createTestMetaModel();
  });

  // -------------------------------------------------------------------------
  // Test 1: convertTodiagramNodes creates Interface node with render_style: 'contract'
  // -------------------------------------------------------------------------
  describe('convertTodiagramNodes - Interface render_style', () => {
    it('should create Interface node with render_style: contract for candidates', () => {
      const treeData = createTestTreeData();
      const selectedKeys = new Set(['int-1', 'ep-1', 'ep-2', 'lde-1']);

      // Find Interface candidates
      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const candidate of candidates) {
        interfaceCandidateMap.set(candidate.interface.entityId, candidate);
      }

      // Create layout tree (Interface only, children filtered)
      const layoutTree = createTestLayoutTree();
      const layoutResult = layoutAdvancedAddSelection(layoutTree, { x: 500, y: 300 });

      // Convert to diagram nodes with Interface candidate map
      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      // Find the Interface node
      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      expect(interfaceNode).toBeDefined();
      expect(interfaceNode?.render_style).toBe('contract');
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: convertTodiagramNodes adds embedded_endpoint_ids to Interface candidates
  // -------------------------------------------------------------------------
  describe('convertTodiagramNodes - embedded_endpoint_ids', () => {
    it('should add embedded_endpoint_ids to Interface candidates', () => {
      const treeData = createTestTreeData();
      const selectedKeys = new Set(['int-1', 'ep-1', 'ep-2']);

      // Find Interface candidates
      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const candidate of candidates) {
        interfaceCandidateMap.set(candidate.interface.entityId, candidate);
      }

      const layoutTree = createTestLayoutTree();
      const layoutResult = layoutAdvancedAddSelection(layoutTree, { x: 500, y: 300 });

      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      expect(interfaceNode?.embedded_endpoint_ids).toBeDefined();
      expect(interfaceNode?.embedded_endpoint_ids).toContain('ep-1');
      expect(interfaceNode?.embedded_endpoint_ids).toContain('ep-2');
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: convertTodiagramNodes adds embedded_entity_ids to Interface candidates
  // -------------------------------------------------------------------------
  describe('convertTodiagramNodes - embedded_entity_ids', () => {
    it('should add embedded_entity_ids to Interface candidates', () => {
      const treeData = createTestTreeData();
      const selectedKeys = new Set(['int-1', 'lde-1', 'lde-2']);

      // Find Interface candidates
      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const candidate of candidates) {
        interfaceCandidateMap.set(candidate.interface.entityId, candidate);
      }

      const layoutTree = createTestLayoutTree();
      const layoutResult = layoutAdvancedAddSelection(layoutTree, { x: 500, y: 300 });

      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      expect(interfaceNode?.embedded_entity_ids).toBeDefined();
      expect(interfaceNode?.embedded_entity_ids).toContain('lde-1');
      expect(interfaceNode?.embedded_entity_ids).toContain('lde-2');
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Child entity nodes are created with correct positioning inside Interface
  // -------------------------------------------------------------------------
  describe('convertTodiagramNodes - child entity nodes', () => {
    it('should create child entity nodes inside Interface', () => {
      const treeData = createTestTreeData();
      const selectedKeys = new Set(['int-1', 'ep-1', 'lde-1', 'lde-2']);

      // Find Interface candidates
      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const candidate of candidates) {
        interfaceCandidateMap.set(candidate.interface.entityId, candidate);
      }

      const layoutTree = createTestLayoutTree();
      const layoutResult = layoutAdvancedAddSelection(layoutTree, { x: 500, y: 300 });

      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      // Find the Interface node
      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      expect(interfaceNode).toBeDefined();

      // Find child entity nodes
      const entityNodes = nodes.filter(n =>
        n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      // Entity nodes should be present
      expect(entityNodes.length).toBe(2);

      // Entity nodes should have parent_node_id pointing to Interface
      for (const entityNode of entityNodes) {
        expect(entityNode.parent_node_id).toBe(interfaceNode?.id);
        expect(entityNode.render_style).toBe('erd');
      }
    });

    it('should position entity nodes inside Interface bounds', () => {
      const treeData = createTestTreeData();
      const selectedKeys = new Set(['int-1', 'lde-1']);

      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const candidate of candidates) {
        interfaceCandidateMap.set(candidate.interface.entityId, candidate);
      }

      const layoutTree = createTestLayoutTree();
      const layoutResult = layoutAdvancedAddSelection(layoutTree, { x: 500, y: 300 });

      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      const entityNode = nodes.find(n => n.entity_id === 'lde-1');

      expect(interfaceNode).toBeDefined();
      expect(entityNode).toBeDefined();

      // Entity should be within Interface bounds
      expect(entityNode!.pos_x).toBeGreaterThanOrEqual(interfaceNode!.pos_x);
      expect(entityNode!.pos_y).toBeGreaterThanOrEqual(interfaceNode!.pos_y);
      expect(entityNode!.pos_x + entityNode!.width).toBeLessThanOrEqual(
        interfaceNode!.pos_x + interfaceNode!.width
      );
      expect(entityNode!.pos_y + entityNode!.height).toBeLessThanOrEqual(
        interfaceNode!.pos_y + interfaceNode!.height
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Z-index ordering is correct (Interface lower than children)
  // -------------------------------------------------------------------------
  describe('convertTodiagramNodes - z-index ordering', () => {
    it('should assign z-index with Interface lower than child entities', () => {
      const treeData = createTestTreeData();
      const selectedKeys = new Set(['int-1', 'ep-1', 'lde-1', 'lde-2']);

      const candidates = findInterfaceCustomCandidates([treeData], selectedKeys, metaModel);
      const interfaceCandidateMap = new Map<string, InterfaceCustomCandidate>();
      for (const candidate of candidates) {
        interfaceCandidateMap.set(candidate.interface.entityId, candidate);
      }

      const layoutTree = createTestLayoutTree();
      const layoutResult = layoutAdvancedAddSelection(layoutTree, { x: 500, y: 300 });

      const baseZIndex = 100;
      const nodes = convertTodiagramNodes(
        layoutResult,
        baseZIndex,
        undefined,
        metaModel,
        interfaceCandidateMap
      );

      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      const entityNodes = nodes.filter(n =>
        n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      // Interface should have a z-index
      expect(interfaceNode?.z_index).toBeDefined();

      // Entity nodes should have higher z-index than Interface
      for (const entityNode of entityNodes) {
        expect(entityNode.z_index).toBeGreaterThan(interfaceNode!.z_index as number);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Interface without candidates falls back to standard node
  // -------------------------------------------------------------------------
  describe('convertTodiagramNodes - standard Interface node', () => {
    it('should create standard node when Interface is not a candidate', () => {
      const layoutTree = createTestLayoutTree();
      const layoutResult = layoutAdvancedAddSelection(layoutTree, { x: 500, y: 300 });

      // No candidate map - standard node creation
      const nodes = convertTodiagramNodes(
        layoutResult,
        100,
        undefined,
        metaModel,
        undefined // No interface candidate map
      );

      const interfaceNode = nodes.find(n => n.entity_id === 'int-1');
      expect(interfaceNode).toBeDefined();

      // Standard node should NOT have render_style: 'contract'
      expect(interfaceNode?.render_style).toBeUndefined();

      // Should NOT have embedded_endpoint_ids or embedded_entity_ids
      expect(interfaceNode?.embedded_endpoint_ids).toBeUndefined();
      expect(interfaceNode?.embedded_entity_ids).toBeUndefined();
    });
  });
});
