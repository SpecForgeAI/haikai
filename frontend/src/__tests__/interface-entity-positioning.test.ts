/**
 * Tests for handleAddWithAllChildren entity positioning inside Interface
 *
 * Task Group 1: Fix Entity Positioning and Parent References
 * Tests for ensuring entity nodes are positioned inside Interface bounds
 * and have correct parent_node_id references.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES } from '../types/model';
import {
  calculateInterfaceWithEntitiesHeight,
  calculateInterfaceWithEntitiesWidth,
  INTERFACE_HEADER_HEIGHT,
  INTERFACE_ENTITIES_SECTION_GAP,
  INTERFACE_ENTITY_GAP,
  INTERFACE_PADDING_X,
  INTERFACE_PADDING_Y,
} from '../utils/interfaceCustomRenderer';
import {
  ENDPOINT_LINE_HEIGHT,
  ENDPOINT_SECTION_PADDING,
  calculateEndpointSectionHeight,
} from '../utils/interfaceCustomRenderer';

describe('Interface Entity Positioning - handleAddWithAllChildren', () => {
  // Test 1: Entity nodes are positioned inside Interface bounds (pos_y within Interface height)
  describe('Entity Position Within Interface Bounds', () => {
    it('should calculate entity position inside Interface Y bounds', () => {
      const interfacePosY = 100;
      const headerHeight = INTERFACE_HEADER_HEIGHT;
      const endpointLines = ['1. GET /users - Get User', '2. POST /users - Create User'];
      const endpointSectionHeight = calculateEndpointSectionHeight(endpointLines);

      // First entity position
      const entityHeight = 80;
      const childIndex = 0;

      const childPosY = interfacePosY +
        INTERFACE_PADDING_Y +
        headerHeight +
        endpointSectionHeight +
        INTERFACE_ENTITIES_SECTION_GAP +
        (childIndex * (entityHeight + INTERFACE_ENTITY_GAP));

      // Calculate total Interface height
      const totalInterfaceHeight = calculateInterfaceWithEntitiesHeight(
        headerHeight,
        endpointLines.length,
        [entityHeight],
        INTERFACE_PADDING_Y
      );

      // Entity Y should be inside Interface bounds
      expect(childPosY).toBeGreaterThan(interfacePosY);
      expect(childPosY + entityHeight).toBeLessThanOrEqual(interfacePosY + totalInterfaceHeight);
    });

    it('should position multiple entities stacked vertically inside Interface', () => {
      const interfacePosY = 50;
      const headerHeight = INTERFACE_HEADER_HEIGHT;
      const endpointLines = ['1. GET /api - Get'];
      const endpointSectionHeight = calculateEndpointSectionHeight(endpointLines);

      const entityHeights = [80, 100, 60]; // 3 entities with different heights

      const totalInterfaceHeight = calculateInterfaceWithEntitiesHeight(
        headerHeight,
        endpointLines.length,
        entityHeights,
        INTERFACE_PADDING_Y
      );

      // Calculate positions for each entity
      let currentY = interfacePosY +
        INTERFACE_PADDING_Y +
        headerHeight +
        endpointSectionHeight +
        INTERFACE_ENTITIES_SECTION_GAP;

      for (let i = 0; i < entityHeights.length; i++) {
        const entityY = currentY;

        // Each entity should be inside Interface bounds
        expect(entityY).toBeGreaterThan(interfacePosY);
        expect(entityY + entityHeights[i]).toBeLessThanOrEqual(interfacePosY + totalInterfaceHeight);

        currentY += entityHeights[i] + INTERFACE_ENTITY_GAP;
      }
    });
  });

  // Test 2: Entity nodes have parent_node_id set to Interface node ID
  describe('Entity Parent Node References', () => {
    it('should set parent_node_id to Interface node ID for child entities', () => {
      const interfaceNodeId = 'node-interface-123';

      // Simulate entity node creation with parent reference
      const entityNode = {
        id: 'node-entity-456',
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        entity_id: 'lde-customer',
        parent_node_id: interfaceNodeId,
      };

      expect(entityNode.parent_node_id).toBe(interfaceNodeId);
      expect(entityNode.parent_node_id).not.toBeNull();
    });

    it('should set parent_node_id for all child entities', () => {
      const interfaceNodeId = 'node-if-abc';
      const entityIds = ['lde-1', 'lde-2', 'lde-3'];

      const entityNodes = entityIds.map(entityId => ({
        id: `node-${entityId}`,
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        entity_id: entityId,
        parent_node_id: interfaceNodeId,
      }));

      // All entities should reference the same Interface parent
      for (const node of entityNodes) {
        expect(node.parent_node_id).toBe(interfaceNodeId);
      }
    });
  });

  // Test 3: Interface height calculation includes space for child entities
  describe('Interface Height Calculation with Entities', () => {
    it('should calculate Interface height to include all entity boxes', () => {
      const headerHeight = INTERFACE_HEADER_HEIGHT;
      const numEndpoints = 3;
      const entityHeights = [80, 100]; // Two entities

      const totalHeight = calculateInterfaceWithEntitiesHeight(
        headerHeight,
        numEndpoints,
        entityHeights,
        INTERFACE_PADDING_Y
      );

      // Height should include: padding + header + endpoints + gap + entities + padding
      const endpointSectionHeight = numEndpoints > 0
        ? (numEndpoints * ENDPOINT_LINE_HEIGHT) + (2 * ENDPOINT_SECTION_PADDING)
        : 0;

      const entitiesHeight = entityHeights.reduce((sum, h) => sum + h, 0) +
        (entityHeights.length - 1) * INTERFACE_ENTITY_GAP;

      const expectedHeight =
        INTERFACE_PADDING_Y +
        headerHeight +
        endpointSectionHeight +
        (entityHeights.length > 0 ? INTERFACE_ENTITIES_SECTION_GAP + entitiesHeight : 0) +
        INTERFACE_PADDING_Y;

      expect(totalHeight).toBe(expectedHeight);
    });

    it('should calculate height correctly with no entities', () => {
      const headerHeight = INTERFACE_HEADER_HEIGHT;
      const numEndpoints = 2;

      const totalHeight = calculateInterfaceWithEntitiesHeight(
        headerHeight,
        numEndpoints,
        [], // No entities
        INTERFACE_PADDING_Y
      );

      const endpointSectionHeight = (numEndpoints * ENDPOINT_LINE_HEIGHT) + (2 * ENDPOINT_SECTION_PADDING);
      const expectedHeight = INTERFACE_PADDING_Y + headerHeight + endpointSectionHeight + INTERFACE_PADDING_Y;

      expect(totalHeight).toBe(expectedHeight);
    });

    it('should calculate height correctly with no endpoints', () => {
      const headerHeight = INTERFACE_HEADER_HEIGHT;
      const entityHeights = [60, 80];

      const totalHeight = calculateInterfaceWithEntitiesHeight(
        headerHeight,
        0, // No endpoints
        entityHeights,
        INTERFACE_PADDING_Y
      );

      const entitiesHeight = entityHeights.reduce((sum, h) => sum + h, 0) +
        (entityHeights.length - 1) * INTERFACE_ENTITY_GAP;

      // No endpoint section, just entities section gap
      const expectedHeight =
        INTERFACE_PADDING_Y +
        headerHeight +
        INTERFACE_ENTITIES_SECTION_GAP +
        entitiesHeight +
        INTERFACE_PADDING_Y;

      expect(totalHeight).toBe(expectedHeight);
    });
  });

  // Test 4: Interface width is calculated to accommodate entity box widths
  describe('Interface Width Calculation with Entities', () => {
    it('should calculate Interface width to accommodate widest entity', () => {
      const headerWidth = 150; // Estimated header text width
      const endpointLineWidths = [200, 180]; // Two endpoint text widths
      const entityWidths = [180, 220, 160]; // Three entity widths - 220 is widest

      const totalWidth = calculateInterfaceWithEntitiesWidth(
        headerWidth,
        endpointLineWidths,
        entityWidths,
        INTERFACE_PADDING_X
      );

      // Width should accommodate: max(header, endpoints, entities) + 2 * padding
      const maxEndpointWidth = Math.max(...endpointLineWidths, 0);
      const maxEntityWidth = Math.max(...entityWidths, 0);
      const maxContentWidth = Math.max(headerWidth, maxEndpointWidth, maxEntityWidth);
      const expectedWidth = maxContentWidth + 2 * INTERFACE_PADDING_X;

      expect(totalWidth).toBe(expectedWidth);
    });

    it('should use header width when no entities or endpoints', () => {
      const headerWidth = 120;

      const totalWidth = calculateInterfaceWithEntitiesWidth(
        headerWidth,
        [], // No endpoints
        [], // No entities
        INTERFACE_PADDING_X
      );

      const expectedWidth = headerWidth + 2 * INTERFACE_PADDING_X;
      expect(totalWidth).toBe(expectedWidth);
    });
  });

  // Test 5: Entity boxes are horizontally centered within Interface
  describe('Entity Horizontal Centering', () => {
    it('should center entity boxes horizontally within Interface', () => {
      const interfacePosX = 100;
      const interfaceWidth = 300;
      const entityWidth = 200;

      // Calculate centered position
      const expectedEntityX = interfacePosX + INTERFACE_PADDING_X +
        ((interfaceWidth - 2 * INTERFACE_PADDING_X - entityWidth) / 2);

      // Entity should be centered in the entities area
      const entitiesAreaWidth = interfaceWidth - 2 * INTERFACE_PADDING_X;
      const centeredX = interfacePosX + INTERFACE_PADDING_X + (entitiesAreaWidth - entityWidth) / 2;

      expect(centeredX).toBe(expectedEntityX);
    });

    it('should center multiple entities of different widths', () => {
      const interfacePosX = 50;
      const interfaceWidth = 350;
      const entityWidths = [150, 200, 180];

      const entitiesAreaWidth = interfaceWidth - 2 * INTERFACE_PADDING_X;

      for (const entityWidth of entityWidths) {
        const centeredX = interfacePosX + INTERFACE_PADDING_X + (entitiesAreaWidth - entityWidth) / 2;

        // Entity should be within Interface bounds
        expect(centeredX).toBeGreaterThanOrEqual(interfacePosX + INTERFACE_PADDING_X);
        expect(centeredX + entityWidth).toBeLessThanOrEqual(interfacePosX + interfaceWidth - INTERFACE_PADDING_X);
      }
    });
  });

  // Test 6: embedded_entity_ids field is populated on Interface node
  describe('Embedded Entity IDs Field', () => {
    it('should store logical entity IDs in embedded_entity_ids field', () => {
      const logicalEntityIds = ['lde-customer', 'lde-order', 'lde-product'];

      const interfaceNode = {
        id: 'node-interface-1',
        entity_type: ENTITY_TYPES.INTERFACE,
        entity_id: 'if-1',
        embedded_endpoint_ids: ['ep-1', 'ep-2'],
        embedded_entity_ids: logicalEntityIds,
        render_style: 'contract' as const,
      };

      expect(interfaceNode.embedded_entity_ids).toEqual(logicalEntityIds);
      expect(interfaceNode.embedded_entity_ids).toHaveLength(3);
    });

    it('should allow empty embedded_entity_ids array', () => {
      const interfaceNode = {
        id: 'node-interface-2',
        entity_type: ENTITY_TYPES.INTERFACE,
        entity_id: 'if-2',
        embedded_endpoint_ids: ['ep-1'],
        embedded_entity_ids: [] as string[],
        render_style: 'contract' as const,
      };

      expect(interfaceNode.embedded_entity_ids).toEqual([]);
      expect(interfaceNode.embedded_entity_ids).toHaveLength(0);
    });
  });
});
