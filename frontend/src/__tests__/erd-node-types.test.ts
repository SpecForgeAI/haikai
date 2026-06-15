/**
 * ERD Node Types Tests
 * Tests for ERD/UML-style rendering type definitions on DiagramNode
 * Task Group 1: Type Definitions for ERD Rendering
 */

import { DiagramNode, ENTITY_TYPES } from '../types/model';

// Test factory function for creating DiagramNode with ERD fields
function createTestDiagramNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'node-1',
    entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
    entity_id: 'entity-1',
    pos_x: 100,
    pos_y: 100,
    width: 200,
    height: 150,
    parent_node_id: null,
    ...overrides,
  };
}

describe('ERD Node Type Definitions', () => {
  describe('render_style field', () => {
    it('should allow DiagramNode to have optional render_style field', () => {
      // DiagramNode without render_style should be valid
      const nodeWithoutRenderStyle: DiagramNode = createTestDiagramNode();
      expect(nodeWithoutRenderStyle.render_style).toBeUndefined();
    });

    it('should accept "standard" as valid render_style value', () => {
      const nodeWithStandardStyle: DiagramNode = createTestDiagramNode({
        render_style: 'standard',
      });
      expect(nodeWithStandardStyle.render_style).toBe('standard');
    });

    it('should accept "erd" as valid render_style value', () => {
      const nodeWithERDStyle: DiagramNode = createTestDiagramNode({
        render_style: 'erd',
      });
      expect(nodeWithERDStyle.render_style).toBe('erd');
    });

    it('should support ERD render_style with LOGICAL_DATA_ENTITY type', () => {
      const logicalEntityNode: DiagramNode = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
      });
      expect(logicalEntityNode.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(logicalEntityNode.render_style).toBe('erd');
    });

    it('should support ERD render_style with PHYSICAL_DATA_ENTITY type', () => {
      const physicalEntityNode: DiagramNode = createTestDiagramNode({
        entity_type: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
        render_style: 'erd',
      });
      expect(physicalEntityNode.entity_type).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
      expect(physicalEntityNode.render_style).toBe('erd');
    });
  });

  describe('embedded_attribute_ids field', () => {
    it('should allow DiagramNode to have optional embedded_attribute_ids field', () => {
      // DiagramNode without embedded_attribute_ids should be valid
      const nodeWithoutAttributes: DiagramNode = createTestDiagramNode();
      expect(nodeWithoutAttributes.embedded_attribute_ids).toBeUndefined();
    });

    it('should accept empty array for embedded_attribute_ids', () => {
      const nodeWithEmptyAttributes: DiagramNode = createTestDiagramNode({
        embedded_attribute_ids: [],
      });
      expect(nodeWithEmptyAttributes.embedded_attribute_ids).toEqual([]);
      expect(Array.isArray(nodeWithEmptyAttributes.embedded_attribute_ids)).toBe(true);
    });

    it('should accept string array for embedded_attribute_ids', () => {
      const attributeIds = ['attr-1', 'attr-2', 'attr-3'];
      const nodeWithAttributes: DiagramNode = createTestDiagramNode({
        embedded_attribute_ids: attributeIds,
      });
      expect(nodeWithAttributes.embedded_attribute_ids).toEqual(attributeIds);
      expect(nodeWithAttributes.embedded_attribute_ids?.length).toBe(3);
    });

    it('should verify embedded_attribute_ids elements are strings', () => {
      const attributeIds = ['attr-1', 'attr-2'];
      const nodeWithAttributes: DiagramNode = createTestDiagramNode({
        embedded_attribute_ids: attributeIds,
      });

      nodeWithAttributes.embedded_attribute_ids?.forEach(id => {
        expect(typeof id).toBe('string');
      });
    });
  });

  describe('ERD-style node complete structure', () => {
    it('should support complete ERD-style node with all relevant fields', () => {
      const erdNode: DiagramNode = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        entity_id: 'customer-entity',
        render_style: 'erd',
        embedded_attribute_ids: ['attr-name', 'attr-email', 'attr-phone'],
        width: 200,
        height: 120,
        auto_size: true,
      });

      expect(erdNode.render_style).toBe('erd');
      expect(erdNode.embedded_attribute_ids).toHaveLength(3);
      expect(erdNode.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(erdNode.auto_size).toBe(true);
    });

    it('should support standard-style node (default) without ERD fields', () => {
      const standardNode: DiagramNode = createTestDiagramNode({
        entity_type: ENTITY_TYPES.APPLICATION,
        render_style: 'standard',
      });

      expect(standardNode.render_style).toBe('standard');
      expect(standardNode.embedded_attribute_ids).toBeUndefined();
    });

    it('should allow ERD fields to coexist with other DiagramNode fields', () => {
      const erdNode: DiagramNode = createTestDiagramNode({
        entity_type: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
        render_style: 'erd',
        embedded_attribute_ids: ['col-1', 'col-2'],
        z_index: 100,
        text_h_align: 'CENTER',
        text_v_align: 'TOP',
        background_color: '#FFFFCC',
        line_color: '#CC9900',
        text_color: '#333333',
      });

      expect(erdNode.render_style).toBe('erd');
      expect(erdNode.embedded_attribute_ids).toHaveLength(2);
      expect(erdNode.z_index).toBe(100);
      expect(erdNode.text_h_align).toBe('CENTER');
      expect(erdNode.background_color).toBe('#FFFFCC');
    });
  });
});
