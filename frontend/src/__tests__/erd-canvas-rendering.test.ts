/**
 * ERD Canvas Rendering Tests
 * Tests for ERD-style node rendering on canvas
 * Task Group 5: ERD Canvas Rendering
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, DiagramNode } from '../types/model';
import { shouldRenderAsERD } from '../utils/erdUtils';

// Test factory for creating DiagramNode with ERD fields
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

describe('ERD Canvas Rendering', () => {
  describe('shouldRenderAsERD', () => {
    it('should return true for ERD-style logical data entity', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
      });

      const result = shouldRenderAsERD(node);
      expect(result).toBe(true);
    });

    it('should return true for ERD-style physical data entity', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
        render_style: 'erd',
      });

      const result = shouldRenderAsERD(node);
      expect(result).toBe(true);
    });

    it('should return false for standard-style logical data entity', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'standard',
      });

      const result = shouldRenderAsERD(node);
      expect(result).toBe(false);
    });

    it('should return false for node without render_style (defaults to standard)', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        // render_style not set
      });

      const result = shouldRenderAsERD(node);
      expect(result).toBe(false);
    });

    it('should return false for non-data entity with ERD style', () => {
      // Even if render_style is 'erd', non-data entities should not render as ERD
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.APPLICATION,
        render_style: 'erd',
      });

      const result = shouldRenderAsERD(node);
      expect(result).toBe(false);
    });

    it('should return false for business process with ERD style', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        render_style: 'erd',
      });

      const result = shouldRenderAsERD(node);
      expect(result).toBe(false);
    });

    it('should return false for service with ERD style', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.SERVICE,
        render_style: 'erd',
      });

      const result = shouldRenderAsERD(node);
      expect(result).toBe(false);
    });
  });

  describe('ERD Node with embedded attributes', () => {
    it('should have embedded_attribute_ids for ERD-style node', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
        embedded_attribute_ids: ['attr-1', 'attr-2', 'attr-3'],
      });

      expect(node.render_style).toBe('erd');
      expect(node.embedded_attribute_ids).toHaveLength(3);
      expect(node.embedded_attribute_ids).toContain('attr-1');
    });

    it('should allow empty embedded_attribute_ids array', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
        embedded_attribute_ids: [],
      });

      expect(node.render_style).toBe('erd');
      expect(node.embedded_attribute_ids).toEqual([]);
    });
  });

  describe('ERD rendering dimensions', () => {
    it('should have width and height for ERD node', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
        embedded_attribute_ids: ['attr-1', 'attr-2'],
        width: 200,
        height: 90, // header(30) + 2 rows(40) + padding(20)
      });

      expect(node.width).toBeGreaterThanOrEqual(150); // MIN_WIDTH
      expect(node.height).toBeGreaterThanOrEqual(40); // header + padding
    });
  });

  describe('ERD node styling', () => {
    it('should support custom background color', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
        background_color: '#FFFFCC',
      });

      expect(node.background_color).toBe('#FFFFCC');
    });

    it('should support custom line color', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
        line_color: '#CC9900',
      });

      expect(node.line_color).toBe('#CC9900');
    });

    it('should support custom text color', () => {
      const node = createTestDiagramNode({
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        render_style: 'erd',
        text_color: '#333333',
      });

      expect(node.text_color).toBe('#333333');
    });
  });
});
