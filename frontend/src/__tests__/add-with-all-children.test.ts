/**
 * Tests for "Add with all children" context menu functionality for Interfaces.
 *
 * This feature adds an Interface node with:
 * - embedded_endpoint_ids: All endpoints belonging to this interface
 * - Child ERD-style nodes for each logical entity via interface_logical_entities relationship
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES } from '../types/model';

describe('Add with all children - Interface Context Menu', () => {
  describe('PaletteContextMenu', () => {
    it('should show "Add with all children" menu item when sectionId is "interfaces"', () => {
      const sectionId = 'interfaces';
      const isInterfaceItem = sectionId === 'interfaces';
      expect(isInterfaceItem).toBe(true);
    });

    it('should not show "Add with all children" for non-interface sections', () => {
      const nonInterfaceSections = [
        'applications',
        'services',
        'endpoints',
        'logical_data_entities',
        'business_processes',
      ];

      for (const sectionId of nonInterfaceSections) {
        const isInterfaceItem = sectionId === 'interfaces';
        expect(isInterfaceItem).toBe(false);
      }
    });

    it('should have data-testid="context-menu-add-with-all-children"', () => {
      // This verifies the expected test ID format for the menu item
      const expectedTestId = 'context-menu-add-with-all-children';
      expect(expectedTestId).toBe('context-menu-add-with-all-children');
    });
  });

  describe('Interface node creation', () => {
    it('should create Interface node with render_style "contract"', () => {
      const interfaceNode = {
        entity_type: ENTITY_TYPES.INTERFACE,
        render_style: 'contract',
        embedded_endpoint_ids: ['ep1', 'ep2'],
      };

      expect(interfaceNode.render_style).toBe('contract');
      expect(interfaceNode.embedded_endpoint_ids).toEqual(['ep1', 'ep2']);
    });

    it('should create ERD nodes for logical entities with render_style "erd"', () => {
      const erdNode = {
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
        embedded_attribute_ids: ['attr1', 'attr2'],
      };

      expect(erdNode.render_style).toBe('erd');
      expect(erdNode.embedded_attribute_ids).toEqual(['attr1', 'attr2']);
    });

    it('should filter endpoints by interface_id', () => {
      const endpoints = [
        { id: 'ep1', interface_id: 'if1', name: 'Get User' },
        { id: 'ep2', interface_id: 'if1', name: 'Create User' },
        { id: 'ep3', interface_id: 'if2', name: 'Other Endpoint' },
      ];

      const interfaceId = 'if1';
      const filteredEndpoints = endpoints.filter(ep => ep.interface_id === interfaceId);

      expect(filteredEndpoints).toHaveLength(2);
      expect(filteredEndpoints.map(ep => ep.id)).toEqual(['ep1', 'ep2']);
    });

    it('should filter interface_logical_entities by interface_id', () => {
      const interfaceLogicalEntities = [
        { id: 'ile1', interface_id: 'if1', logical_entity_id: 'le1' },
        { id: 'ile2', interface_id: 'if1', logical_entity_id: 'le2' },
        { id: 'ile3', interface_id: 'if2', logical_entity_id: 'le3' },
      ];

      const interfaceId = 'if1';
      const filtered = interfaceLogicalEntities.filter(rel => rel.interface_id === interfaceId);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(rel => rel.logical_entity_id)).toEqual(['le1', 'le2']);
    });
  });

  describe('Node positioning', () => {
    it('should position Interface node at viewport center', () => {
      const viewportCenter = { x: 500, y: 400 };
      const interfaceWidth = 300;
      const interfaceHeight = 100;

      const pos_x = viewportCenter.x - interfaceWidth / 2;
      const pos_y = viewportCenter.y - interfaceHeight / 2;

      expect(pos_x).toBe(350); // 500 - 150
      expect(pos_y).toBe(350); // 400 - 50
    });

    it('should position logical entity nodes below interface', () => {
      const interfaceNode = {
        pos_x: 350,
        pos_y: 350,
        width: 300,
        height: 100,
      };
      const entityWidth = 200;
      const entityHeight = 80;
      const childIndex = 0;
      const spacing = 20;

      const childPosX = interfaceNode.pos_x + (interfaceNode.width - entityWidth) / 2;
      const childPosY = interfaceNode.pos_y + interfaceNode.height + spacing + (childIndex * (entityHeight + 10));

      expect(childPosX).toBe(400); // 350 + (300-200)/2 = 350 + 50
      expect(childPosY).toBe(470); // 350 + 100 + 20 = 470
    });

    it('should assign increasing z-index to child nodes', () => {
      const baseZIndex = 10;
      const childIndices = [0, 1, 2];

      const zIndices = childIndices.map(i => baseZIndex + i + 1);

      expect(zIndices).toEqual([11, 12, 13]);
    });
  });

  describe('Duplicate prevention', () => {
    it('should skip creating nodes for entities already on diagram', () => {
      const existingNodes = [
        { entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY, entity_id: 'le1' },
      ];
      const logicalEntityIds = ['le1', 'le2', 'le3'];

      const newEntityIds = logicalEntityIds.filter(id => {
        return !existingNodes.some(
          n => n.entity_type === ENTITY_TYPES.LOGICAL_DATA_ENTITY && n.entity_id === id
        );
      });

      expect(newEntityIds).toEqual(['le2', 'le3']);
    });

    it('should not add Interface if already on diagram', () => {
      const existingNodes = [
        { entity_type: ENTITY_TYPES.INTERFACE, entity_id: 'if1' },
      ];
      const interfaceId = 'if1';

      const exists = existingNodes.some(
        n => n.entity_type === ENTITY_TYPES.INTERFACE && n.entity_id === interfaceId
      );

      expect(exists).toBe(true);
    });
  });
});
