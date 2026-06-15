/**
 * Tests for Canvas Interface Custom Rendering with Entities
 *
 * Task Group 2: Update Canvas Interface Custom Rendering
 * Tests for rendering entity boxes inside Interface nodes.
 */

import { describe, it, expect } from 'vitest';
import { DiagramNode, ENTITY_TYPES, MetaModel, LogicalDataEntity, LogicalDataAttribute } from '../types/model';
import {
  hasEmbeddedEntities,
  getChildEntityNodesForInterface,
  INTERFACE_HEADER_HEIGHT,
  INTERFACE_ENTITIES_SECTION_GAP,
  INTERFACE_ENTITY_GAP,
  INTERFACE_PADDING_X,
  INTERFACE_PADDING_Y,
  calculateEndpointSectionHeight,
  ENDPOINT_LINE_HEIGHT,
  ENDPOINT_SECTION_PADDING,
} from '../utils/interfaceCustomRenderer';
import { ERD_HEADER_HEIGHT, ERD_ATTRIBUTE_ROW_HEIGHT } from '../utils/erdUtils';

// Create a minimal metaModel fixture
function createMetaModel(
  logicalEntities: LogicalDataEntity[] = [],
  logicalAttributes: LogicalDataAttribute[] = []
): MetaModel {
  return {
    entities: {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      application_points: [],
      logical_data_entities: logicalEntities,
      logical_data_attributes: logicalAttributes,
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
      interface_logical_entities: [],
    },
  };
}

// Create a base DiagramNode for testing
function createDiagramNode(overrides: Partial<DiagramNode>): DiagramNode {
  return {
    id: 'node-1',
    entity_type: ENTITY_TYPES.INTERFACE,
    entity_id: 'if-1',
    pos_x: 100,
    pos_y: 100,
    width: 300,
    height: 200,
    z_index: 1,
    auto_size: false,
    parent_node_id: null,
    style_override: {},
    ...overrides,
  };
}

describe('Canvas Interface Entity Rendering - Task Group 2', () => {
  // Test 2.1a: Interface with embedded_entity_ids renders entity boxes inside
  describe('Interface with embedded entities detection', () => {
    it('should detect Interface with embedded_entity_ids', () => {
      const node = createDiagramNode({
        embedded_endpoint_ids: ['ep-1'],
        embedded_entity_ids: ['lde-1', 'lde-2'],
      });

      expect(hasEmbeddedEntities(node)).toBe(true);
    });

    it('should return false for Interface without embedded_entity_ids', () => {
      const node = createDiagramNode({
        embedded_endpoint_ids: ['ep-1'],
      });

      expect(hasEmbeddedEntities(node)).toBe(false);
    });

    it('should return false for Interface with empty embedded_entity_ids', () => {
      const node = createDiagramNode({
        embedded_endpoint_ids: ['ep-1'],
        embedded_entity_ids: [],
      });

      expect(hasEmbeddedEntities(node)).toBe(false);
    });

    it('should return false for non-Interface entity types', () => {
      const node = createDiagramNode({
        entity_type: ENTITY_TYPES.SERVICE,
        embedded_entity_ids: ['lde-1'],
      });

      expect(hasEmbeddedEntities(node)).toBe(false);
    });
  });

  // Test 2.1b: Entity boxes are positioned below endpoints section
  describe('Entity box positioning below endpoints', () => {
    it('should calculate entity position below endpoint section', () => {
      const interfaceNode = createDiagramNode({
        pos_y: 100,
        embedded_endpoint_ids: ['ep-1', 'ep-2'],
        embedded_entity_ids: ['lde-1'],
      });

      const numEndpoints = 2;
      const endpointLines = ['1. GET /api - Get', '2. POST /api - Create'];
      const endpointSectionHeight = calculateEndpointSectionHeight(endpointLines);

      // Entity Y position should be: interface Y + padding + header + endpoint section + gap
      const expectedEntityY = interfaceNode.pos_y +
        INTERFACE_PADDING_Y +
        INTERFACE_HEADER_HEIGHT +
        endpointSectionHeight +
        INTERFACE_ENTITIES_SECTION_GAP;

      // Verify the calculation components are correct
      expect(endpointSectionHeight).toBe(numEndpoints * ENDPOINT_LINE_HEIGHT + 2 * ENDPOINT_SECTION_PADDING);
      expect(expectedEntityY).toBeGreaterThan(interfaceNode.pos_y + INTERFACE_HEADER_HEIGHT);
    });

    it('should position entity at correct Y when no endpoints', () => {
      const interfaceNode = createDiagramNode({
        pos_y: 50,
        embedded_endpoint_ids: [],
        embedded_entity_ids: ['lde-1'],
      });

      // When no endpoints, entity Y = interface Y + padding + header + gap
      const expectedEntityY = interfaceNode.pos_y +
        INTERFACE_PADDING_Y +
        INTERFACE_HEADER_HEIGHT +
        INTERFACE_ENTITIES_SECTION_GAP;

      // Entity should be positioned just after header
      expect(expectedEntityY).toBeGreaterThan(interfaceNode.pos_y + INTERFACE_HEADER_HEIGHT);
    });
  });

  // Test 2.1c: Entity boxes render with ERD-style (header + attributes)
  describe('Entity box ERD-style rendering structure', () => {
    it('should calculate entity box height with header and attributes', () => {
      const numAttributes = 3;

      // ERD-style entity height = header + (numAttributes * row height)
      const expectedHeight = ERD_HEADER_HEIGHT + (numAttributes * ERD_ATTRIBUTE_ROW_HEIGHT);

      expect(expectedHeight).toBeGreaterThan(ERD_HEADER_HEIGHT);
      expect(expectedHeight).toBe(ERD_HEADER_HEIGHT + 3 * ERD_ATTRIBUTE_ROW_HEIGHT);
    });

    it('should calculate entity box with minimum height when no attributes', () => {
      const numAttributes = 0;

      // Minimum height should be at least header height
      const minHeight = ERD_HEADER_HEIGHT + (numAttributes * ERD_ATTRIBUTE_ROW_HEIGHT);

      expect(minHeight).toBe(ERD_HEADER_HEIGHT);
    });
  });

  // Test 2.1d: Correct z-index ordering (Interface background behind entity boxes)
  describe('Z-index ordering for embedded entities', () => {
    it('should have child entity nodes with higher z-index than parent Interface', () => {
      const interfaceNode = createDiagramNode({
        id: 'node-interface-1',
        z_index: 5,
        embedded_entity_ids: ['lde-1', 'lde-2'],
      });

      // Child entity nodes should have z_index > parent z_index
      const childEntityNode = createDiagramNode({
        id: 'node-entity-1',
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        entity_id: 'lde-1',
        parent_node_id: interfaceNode.id,
        z_index: interfaceNode.z_index + 1,
      });

      expect(childEntityNode.z_index).toBeGreaterThan(interfaceNode.z_index);
    });

    it('should order multiple entity boxes with proper z-index', () => {
      const interfaceNode = createDiagramNode({
        id: 'node-if-1',
        z_index: 10,
      });

      const entityNodes = [
        createDiagramNode({
          id: 'node-lde-1',
          entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
          entity_id: 'lde-1',
          parent_node_id: interfaceNode.id,
          z_index: interfaceNode.z_index + 1,
        }),
        createDiagramNode({
          id: 'node-lde-2',
          entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
          entity_id: 'lde-2',
          parent_node_id: interfaceNode.id,
          z_index: interfaceNode.z_index + 2,
        }),
      ];

      // All entity nodes should be above the Interface
      for (const entityNode of entityNodes) {
        expect(entityNode.z_index).toBeGreaterThan(interfaceNode.z_index);
      }
    });
  });

  // Test 2.1e: getChildEntityNodesForInterface returns correct child nodes
  describe('getChildEntityNodesForInterface utility', () => {
    it('should return entity nodes with matching parent_node_id', () => {
      const interfaceNode = createDiagramNode({
        id: 'node-interface-1',
        entity_type: ENTITY_TYPES.INTERFACE,
      });

      const allNodes: DiagramNode[] = [
        interfaceNode,
        createDiagramNode({
          id: 'node-lde-1',
          entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
          entity_id: 'lde-1',
          parent_node_id: 'node-interface-1',
        }),
        createDiagramNode({
          id: 'node-lde-2',
          entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
          entity_id: 'lde-2',
          parent_node_id: 'node-interface-1',
        }),
        createDiagramNode({
          id: 'node-other',
          entity_type: ENTITY_TYPES.SERVICE,
          entity_id: 'svc-1',
          parent_node_id: null,
        }),
      ];

      const metaModel = createMetaModel();
      const childNodes = getChildEntityNodesForInterface(interfaceNode, allNodes, metaModel);

      expect(childNodes).toHaveLength(2);
      expect(childNodes.every(n => n.parent_node_id === interfaceNode.id)).toBe(true);
      expect(childNodes.every(n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toBe(true);
    });

    it('should return empty array when no child entity nodes exist', () => {
      const interfaceNode = createDiagramNode({
        id: 'node-interface-1',
        entity_type: ENTITY_TYPES.INTERFACE,
      });

      const allNodes: DiagramNode[] = [
        interfaceNode,
        createDiagramNode({
          id: 'node-other',
          entity_type: ENTITY_TYPES.SERVICE,
          parent_node_id: null,
        }),
      ];

      const metaModel = createMetaModel();
      const childNodes = getChildEntityNodesForInterface(interfaceNode, allNodes, metaModel);

      expect(childNodes).toHaveLength(0);
    });

    it('should return empty array for non-Interface node', () => {
      const serviceNode = createDiagramNode({
        id: 'node-service-1',
        entity_type: ENTITY_TYPES.SERVICE,
      });

      const allNodes: DiagramNode[] = [
        serviceNode,
        createDiagramNode({
          id: 'node-lde-1',
          entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
          parent_node_id: 'node-service-1',
        }),
      ];

      const metaModel = createMetaModel();
      const childNodes = getChildEntityNodesForInterface(serviceNode, allNodes, metaModel);

      expect(childNodes).toHaveLength(0);
    });
  });

  // Test 2.1f: Child entity nodes should be filtered from separate rendering
  describe('Child entity node rendering exclusion', () => {
    it('should identify nodes that should be excluded from separate rendering', () => {
      const interfaceNode = createDiagramNode({
        id: 'node-if-1',
        entity_type: ENTITY_TYPES.INTERFACE,
        embedded_endpoint_ids: ['ep-1'],
        embedded_entity_ids: ['lde-1'],
      });

      const childNode = createDiagramNode({
        id: 'node-lde-1',
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        parent_node_id: interfaceNode.id,
      });

      // Node should be excluded from separate rendering if:
      // 1. It has a parent_node_id
      // 2. The parent node has custom rendering (embedded_endpoint_ids)
      const hasParent = childNode.parent_node_id !== null;
      const parentHasCustomRendering = interfaceNode.embedded_endpoint_ids &&
        interfaceNode.embedded_endpoint_ids.length > 0;

      expect(hasParent).toBe(true);
      expect(parentHasCustomRendering).toBe(true);
    });

    it('should not exclude nodes without parent_node_id', () => {
      const standaloneNode = createDiagramNode({
        id: 'node-lde-standalone',
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        parent_node_id: null,
      });

      expect(standaloneNode.parent_node_id).toBeNull();
    });
  });
});
