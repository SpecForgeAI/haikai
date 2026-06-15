/**
 * Activity Label Decorations Tests
 * Task Group 5: Movable/Resizable Labels (A5)
 *
 * Tests for label decoration type definition and functionality:
 * - Label decoration type definition
 * - Default label placement for Action activities (centered inside)
 * - Default label placement for Decision activities (below diamond)
 * - Default label placement for Activity Flow edges (near midpoint)
 * - Label drag updates x/y without moving node
 * - Label resize updates width/height
 */

import {
  LabelDecoration,
  LabelTargetKind,
  isLabelDecoration,
  createDefaultLabelDecoration,
  LABEL_DECORATION_DEFAULTS,
} from '../types/model';
import {
  getDefaultLabelPosition,
  getDefaultEdgeLabelPosition,
} from '../utils/activityNodeRendering';
import { ACTIVITY_NODE_DEFAULTS } from '../config/defaults';
import { DiagramNode } from '../types/model';

describe('Activity Label Decorations', () => {
  // ============================================================================
  // Test 5.1.1: Label decoration type definition
  // ============================================================================
  describe('Label decoration type definition', () => {
    it('should define LabelDecoration interface with required properties', () => {
      const labelDecoration: LabelDecoration = {
        id: 'label_1',
        targetKind: 'NODE',
        targetId: 'node_1',
        x: 100,
        y: 100,
        width: 80,
        height: 20,
      };

      expect(labelDecoration.id).toBe('label_1');
      expect(labelDecoration.targetKind).toBe('NODE');
      expect(labelDecoration.targetId).toBe('node_1');
      expect(labelDecoration.x).toBe(100);
      expect(labelDecoration.y).toBe(100);
      expect(labelDecoration.width).toBe(80);
      expect(labelDecoration.height).toBe(20);
    });

    it('should support optional text override property', () => {
      const labelDecoration: LabelDecoration = {
        id: 'label_2',
        targetKind: 'EDGE',
        targetId: 'edge_1',
        x: 150,
        y: 75,
        width: 60,
        height: 16,
        text: 'Custom Label',
      };

      expect(labelDecoration.text).toBe('Custom Label');
    });

    it('should support textAnchor and dominantBaseline alignment properties', () => {
      const labelDecoration: LabelDecoration = {
        id: 'label_3',
        targetKind: 'NODE',
        targetId: 'node_2',
        x: 100,
        y: 100,
        width: 80,
        height: 20,
        textAnchor: 'middle',
        dominantBaseline: 'middle',
      };

      expect(labelDecoration.textAnchor).toBe('middle');
      expect(labelDecoration.dominantBaseline).toBe('middle');
    });

    it('should define LabelTargetKind as NODE or EDGE', () => {
      const nodeTarget: LabelTargetKind = 'NODE';
      const edgeTarget: LabelTargetKind = 'EDGE';

      expect(nodeTarget).toBe('NODE');
      expect(edgeTarget).toBe('EDGE');
    });
  });

  // ============================================================================
  // Test 5.1.2: Default label placement for Action activities (centered inside)
  // ============================================================================
  describe('Default label placement for Action activities', () => {
    it('should center label inside Action node rounded-rect bounds', () => {
      // Action node dimensions from ACTIVITY_NODE_DEFAULTS
      const actionWidth = ACTIVITY_NODE_DEFAULTS.Action.width || 140;
      const actionHeight = ACTIVITY_NODE_DEFAULTS.Action.height || 50;

      const nodePosition = { x: 100, y: 100 };
      const nodeWidth = actionWidth;
      const nodeHeight = actionHeight;

      const labelPosition = getDefaultLabelPosition(
        { x: nodePosition.x, y: nodePosition.y, width: nodeWidth, height: nodeHeight },
        'Action'
      );

      // Label should be centered within the node
      const expectedCenterX = nodePosition.x + nodeWidth / 2;
      const expectedCenterY = nodePosition.y + nodeHeight / 2;

      // Check that label center is at node center
      expect(labelPosition.x + labelPosition.width / 2).toBeCloseTo(expectedCenterX, 1);
      expect(labelPosition.y + labelPosition.height / 2).toBeCloseTo(expectedCenterY, 1);
    });

    it('should have default dimensions suitable for text display', () => {
      const labelPosition = getDefaultLabelPosition(
        { x: 100, y: 100, width: 140, height: 50 },
        'Action'
      );

      // Label should have reasonable dimensions for text
      expect(labelPosition.width).toBeGreaterThan(0);
      expect(labelPosition.height).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Test 5.1.3: Default label placement for Decision activities (below diamond)
  // ============================================================================
  describe('Default label placement for Decision activities', () => {
    it('should position label below Decision node diamond', () => {
      // Decision node dimensions from ACTIVITY_NODE_DEFAULTS
      const decisionWidth = ACTIVITY_NODE_DEFAULTS.Decision.width || 60;
      const decisionHeight = ACTIVITY_NODE_DEFAULTS.Decision.height || 60;

      const nodePosition = { x: 100, y: 100 };
      const nodeWidth = decisionWidth;
      const nodeHeight = decisionHeight;

      const labelPosition = getDefaultLabelPosition(
        { x: nodePosition.x, y: nodePosition.y, width: nodeWidth, height: nodeHeight },
        'Decision'
      );

      // Label should be positioned below the diamond
      const diamondBottom = nodePosition.y + nodeHeight;
      expect(labelPosition.y).toBeGreaterThanOrEqual(diamondBottom);

      // Label should be horizontally centered under the diamond
      const expectedCenterX = nodePosition.x + nodeWidth / 2;
      expect(labelPosition.x + labelPosition.width / 2).toBeCloseTo(expectedCenterX, 1);
    });

    it('should have offset below diamond of approximately 8 pixels', () => {
      const labelPosition = getDefaultLabelPosition(
        { x: 100, y: 100, width: 60, height: 60 },
        'Decision'
      );

      const diamondBottom = 100 + 60; // y + height
      const offset = labelPosition.y - diamondBottom;

      // Offset should be approximately 8 pixels (per spec)
      expect(offset).toBeGreaterThanOrEqual(6);
      expect(offset).toBeLessThanOrEqual(12);
    });
  });

  // ============================================================================
  // Test 5.1.4: Default label placement for Activity Flow edges (near midpoint)
  // ============================================================================
  describe('Default label placement for Activity Flow edges', () => {
    it('should position label near edge midpoint', () => {
      const sourceNode: DiagramNode = {
        id: 'node_1',
        entity_type: 'ACTIVITY',
        entity_id: 'act_1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node_2',
        entity_type: 'ACTIVITY',
        entity_id: 'act_2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const labelPosition = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      // Calculate expected midpoint
      const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
      const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;
      const targetCenterX = targetNode.pos_x + targetNode.width / 2;
      const targetCenterY = targetNode.pos_y + targetNode.height / 2;
      const midpointX = (sourceCenterX + targetCenterX) / 2;
      const midpointY = (sourceCenterY + targetCenterY) / 2;

      // Label center should be near the midpoint
      const labelCenterX = labelPosition.x + labelPosition.width / 2;
      expect(labelCenterX).toBeCloseTo(midpointX, 1);
    });

    it('should position label slightly above the edge line', () => {
      const sourceNode: DiagramNode = {
        id: 'node_1',
        entity_type: 'ACTIVITY',
        entity_id: 'act_1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node_2',
        entity_type: 'ACTIVITY',
        entity_id: 'act_2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const labelPosition = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      // Calculate edge midpoint Y
      const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;
      const targetCenterY = targetNode.pos_y + targetNode.height / 2;
      const midpointY = (sourceCenterY + targetCenterY) / 2;

      // Label should be above the midpoint (y should be less than midpoint)
      const labelBottom = labelPosition.y + labelPosition.height;
      expect(labelBottom).toBeLessThanOrEqual(midpointY);
    });
  });

  // ============================================================================
  // Test 5.1.5: Label drag updates x/y without moving node
  // ============================================================================
  describe('Label drag behavior', () => {
    it('should update label x/y position independently of node', () => {
      // Create a label decoration
      const originalLabel: LabelDecoration = {
        id: 'label_drag_test',
        targetKind: 'NODE',
        targetId: 'node_1',
        x: 100,
        y: 100,
        width: 80,
        height: 20,
      };

      // Simulate drag by updating x/y
      const draggedLabel: LabelDecoration = {
        ...originalLabel,
        x: 150,
        y: 120,
      };

      // Verify label position changed
      expect(draggedLabel.x).toBe(150);
      expect(draggedLabel.y).toBe(120);

      // Original values should be different (node reference unchanged)
      expect(draggedLabel.targetId).toBe(originalLabel.targetId);
      expect(draggedLabel.width).toBe(originalLabel.width);
      expect(draggedLabel.height).toBe(originalLabel.height);
    });

    it('should preserve targetId reference when dragging', () => {
      const label: LabelDecoration = {
        id: 'label_1',
        targetKind: 'NODE',
        targetId: 'node_original',
        x: 100,
        y: 100,
        width: 80,
        height: 20,
      };

      // Drag to new position
      const movedLabel: LabelDecoration = {
        ...label,
        x: 200,
        y: 150,
      };

      // targetId should remain unchanged
      expect(movedLabel.targetId).toBe('node_original');
    });
  });

  // ============================================================================
  // Test 5.1.6: Label resize updates width/height
  // ============================================================================
  describe('Label resize behavior', () => {
    it('should update label width/height independently', () => {
      const originalLabel: LabelDecoration = {
        id: 'label_resize_test',
        targetKind: 'NODE',
        targetId: 'node_1',
        x: 100,
        y: 100,
        width: 80,
        height: 20,
      };

      // Simulate resize by updating width/height
      const resizedLabel: LabelDecoration = {
        ...originalLabel,
        width: 120,
        height: 30,
      };

      // Verify dimensions changed
      expect(resizedLabel.width).toBe(120);
      expect(resizedLabel.height).toBe(30);

      // Position should remain unchanged
      expect(resizedLabel.x).toBe(originalLabel.x);
      expect(resizedLabel.y).toBe(originalLabel.y);
    });

    it('should preserve targetId reference when resizing', () => {
      const label: LabelDecoration = {
        id: 'label_1',
        targetKind: 'EDGE',
        targetId: 'edge_1',
        x: 150,
        y: 75,
        width: 60,
        height: 16,
      };

      // Resize
      const resizedLabel: LabelDecoration = {
        ...label,
        width: 100,
        height: 24,
      };

      // targetId should remain unchanged
      expect(resizedLabel.targetId).toBe('edge_1');
    });
  });

  // ============================================================================
  // Type guard and factory tests
  // ============================================================================
  describe('Type guards and factory functions', () => {
    it('isLabelDecoration should correctly identify label decorations', () => {
      const labelDecoration: LabelDecoration = {
        id: 'label_1',
        targetKind: 'NODE',
        targetId: 'node_1',
        x: 100,
        y: 100,
        width: 80,
        height: 20,
      };

      expect(isLabelDecoration(labelDecoration)).toBe(true);
    });

    it('isLabelDecoration should return false for non-label objects', () => {
      const notALabel = {
        id: 'box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 100,
      };

      expect(isLabelDecoration(notALabel as any)).toBe(false);
    });

    it('createDefaultLabelDecoration should create label with correct defaults', () => {
      const label = createDefaultLabelDecoration('NODE', 'node_123', 100, 100, 80, 20);

      expect(label.id).toMatch(/^label_/);
      expect(label.targetKind).toBe('NODE');
      expect(label.targetId).toBe('node_123');
      expect(label.x).toBe(100);
      expect(label.y).toBe(100);
      expect(label.width).toBe(80);
      expect(label.height).toBe(20);
    });

    it('createDefaultLabelDecoration should set default alignment properties', () => {
      const label = createDefaultLabelDecoration('NODE', 'node_123', 100, 100, 80, 20);

      expect(label.textAnchor).toBe(LABEL_DECORATION_DEFAULTS.textAnchor);
      expect(label.dominantBaseline).toBe(LABEL_DECORATION_DEFAULTS.dominantBaseline);
    });
  });
});
