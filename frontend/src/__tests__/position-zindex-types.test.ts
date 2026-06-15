/**
 * Tests for Position/Z-Index Type Extensions
 *
 * Task Group 1: Extend Type System for Z-Index and Auto-Size
 * Tests the type definitions for z_index on DiagramEdge and auto_size on ShapeDecoration
 */

import {
  DiagramEdge,
  ShapeDecoration,
  DiagramNode,
  Decoration,
  LINE_DECORATION_TYPES,
  SHAPE_DECORATION_TYPES,
} from '../types/model';

// Import ElementContextMenuState type
import { ElementContextMenuState } from '../types/model';

describe('Position/Z-Index Type Extensions', () => {
  // Test 1: DiagramEdge interface includes optional z_index field
  describe('DiagramEdge z_index field', () => {
    it('should allow DiagramEdge with z_index field', () => {
      const edge: DiagramEdge = {
        id: 'edge-1',
        relationship_type: 'DATA_MOVEMENT',
        relationship_id: 'dm-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
          { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
        ],
        z_index: 150,
      };

      expect(edge.z_index).toBe(150);
    });

    it('should allow DiagramEdge without z_index field (optional)', () => {
      const edge: DiagramEdge = {
        id: 'edge-2',
        relationship_type: 'DATA_MOVEMENT',
        relationship_id: 'dm-2',
        source_node_id: 'node-3',
        target_node_id: 'node-4',
        edge_points: [],
      };

      expect(edge.z_index).toBeUndefined();
    });

    it('should have z_index as number type', () => {
      const edge: DiagramEdge = {
        id: 'edge-3',
        relationship_type: 'DATA_MOVEMENT',
        relationship_id: 'dm-3',
        source_node_id: 'node-5',
        target_node_id: 'node-6',
        edge_points: [],
        z_index: 200,
      };

      expect(typeof edge.z_index).toBe('number');
    });
  });

  // Test 2: ShapeDecoration includes optional auto_size field
  describe('ShapeDecoration auto_size field', () => {
    it('should allow ShapeDecoration with auto_size field', () => {
      const decoration: ShapeDecoration = {
        id: 'dec-1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
        auto_size: true,
      };

      expect(decoration.auto_size).toBe(true);
    });

    it('should allow ShapeDecoration without auto_size field (optional)', () => {
      const decoration: ShapeDecoration = {
        id: 'dec-2',
        type: 'OVAL',
        pos_x: 50,
        pos_y: 50,
        width: 100,
        height: 80,
      };

      expect(decoration.auto_size).toBeUndefined();
    });

    it('should have auto_size as boolean type', () => {
      const decorationTrue: ShapeDecoration = {
        id: 'dec-3',
        type: 'DIAMOND',
        pos_x: 0,
        pos_y: 0,
        width: 60,
        height: 60,
        auto_size: true,
      };

      const decorationFalse: ShapeDecoration = {
        id: 'dec-4',
        type: 'HEXAGON',
        pos_x: 0,
        pos_y: 0,
        width: 80,
        height: 80,
        auto_size: false,
      };

      expect(typeof decorationTrue.auto_size).toBe('boolean');
      expect(typeof decorationFalse.auto_size).toBe('boolean');
      expect(decorationTrue.auto_size).toBe(true);
      expect(decorationFalse.auto_size).toBe(false);
    });
  });

  // Test 3: DiagramNode already has z_index and auto_size
  describe('DiagramNode existing fields', () => {
    it('should have z_index field on DiagramNode', () => {
      const node: DiagramNode = {
        id: 'node-1',
        entity_type: 'APPLICATION',
        entity_id: 'app-1',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 80,
        parent_node_id: null,
        z_index: 100,
      };

      expect(node.z_index).toBe(100);
    });

    it('should have auto_size field on DiagramNode', () => {
      const node: DiagramNode = {
        id: 'node-2',
        entity_type: 'SERVICE',
        entity_id: 'svc-1',
        pos_x: 200,
        pos_y: 200,
        width: 120,
        height: 60,
        parent_node_id: null,
        auto_size: true,
      };

      expect(node.auto_size).toBe(true);
    });
  });

  // Test 4: ElementContextMenuState type
  describe('ElementContextMenuState type', () => {
    it('should have all required fields', () => {
      const menuState: ElementContextMenuState = {
        visible: true,
        x: 150,
        y: 200,
        elementType: 'node',
        elementId: 'node-123',
        currentAutoSize: false,
      };

      expect(menuState.visible).toBe(true);
      expect(menuState.x).toBe(150);
      expect(menuState.y).toBe(200);
      expect(menuState.elementType).toBe('node');
      expect(menuState.elementId).toBe('node-123');
      expect(menuState.currentAutoSize).toBe(false);
    });

    it('should support all element types', () => {
      const nodeMenu: ElementContextMenuState = {
        visible: true,
        x: 0,
        y: 0,
        elementType: 'node',
        elementId: 'n-1',
      };

      const edgeMenu: ElementContextMenuState = {
        visible: true,
        x: 0,
        y: 0,
        elementType: 'edge',
        elementId: 'e-1',
      };

      const shapeDecMenu: ElementContextMenuState = {
        visible: true,
        x: 0,
        y: 0,
        elementType: 'shape-decoration',
        elementId: 'sd-1',
        currentAutoSize: true,
      };

      const lineDecMenu: ElementContextMenuState = {
        visible: true,
        x: 0,
        y: 0,
        elementType: 'line-decoration',
        elementId: 'ld-1',
      };

      expect(nodeMenu.elementType).toBe('node');
      expect(edgeMenu.elementType).toBe('edge');
      expect(shapeDecMenu.elementType).toBe('shape-decoration');
      expect(lineDecMenu.elementType).toBe('line-decoration');
    });

    it('should allow currentAutoSize to be undefined for edges/line decorations', () => {
      const edgeMenu: ElementContextMenuState = {
        visible: false,
        x: 100,
        y: 100,
        elementType: 'edge',
        elementId: 'edge-1',
      };

      expect(edgeMenu.currentAutoSize).toBeUndefined();
    });
  });

  // Test 5: Decoration types are properly separated
  describe('Decoration type separation', () => {
    it('should have shape decoration types without line types', () => {
      expect(SHAPE_DECORATION_TYPES).toContain('BOX');
      expect(SHAPE_DECORATION_TYPES).toContain('OVAL');
      expect(SHAPE_DECORATION_TYPES).toContain('DIAMOND');
      expect(SHAPE_DECORATION_TYPES).not.toContain('LINE');
      expect(SHAPE_DECORATION_TYPES).not.toContain('ARROW_SINGLE');
    });

    it('should have line decoration types without shape types', () => {
      expect(LINE_DECORATION_TYPES).toContain('LINE');
      expect(LINE_DECORATION_TYPES).toContain('ARROW_SINGLE');
      expect(LINE_DECORATION_TYPES).toContain('ARROW_DOUBLE');
      expect(LINE_DECORATION_TYPES).not.toContain('BOX');
      expect(LINE_DECORATION_TYPES).not.toContain('OVAL');
    });
  });
});
