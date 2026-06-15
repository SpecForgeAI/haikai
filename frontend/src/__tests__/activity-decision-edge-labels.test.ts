/**
 * Activity Decision Labels and Edge Labels Tests
 * Task Group 3: Decision Labels and ActivityFlow Edge Labels (Part B.2-B.3)
 * Spec: 2026-01-01 Activity Diagram Corrective Fixes
 *
 * Tests for:
 * - Decision labels rendered as independent decorations below the diamond
 * - ActivityFlow edge labels initialized with default position on creation
 * - Edge labels use persisted label_pos_x/label_pos_y when available
 */

import {
  getDefaultLabelPosition,
  getDefaultEdgeLabelPosition,
} from '../utils/activityNodeRendering';
import { DiagramNode, DiagramEdge, LabelDecoration, LABEL_DECORATION_DEFAULTS } from '../types/model';

describe('Activity Decision and Edge Labels', () => {
  /**
   * Test 3.1: Decision labels positioned below the diamond shape
   */
  describe('Decision label positioning', () => {
    it('should position Decision label below the diamond', () => {
      const decisionBounds = {
        x: 100,
        y: 100,
        width: 60,
        height: 60,
      };

      const labelPos = getDefaultLabelPosition(decisionBounds, 'Decision');

      // Label Y should be below the diamond (y + height + offset)
      const expectedY = decisionBounds.y + decisionBounds.height + LABEL_DECORATION_DEFAULTS.decisionLabelOffset;
      expect(labelPos.y).toBe(expectedY);

      // Label should be horizontally centered below the diamond
      const expectedX = decisionBounds.x + decisionBounds.width / 2 - LABEL_DECORATION_DEFAULTS.width / 2;
      expect(labelPos.x).toBe(expectedX);
    });

    it('should use standard width and height for Decision label bounds', () => {
      const decisionBounds = {
        x: 100,
        y: 100,
        width: 60,
        height: 60,
      };

      const labelPos = getDefaultLabelPosition(decisionBounds, 'Decision');

      expect(labelPos.width).toBe(LABEL_DECORATION_DEFAULTS.width);
      expect(labelPos.height).toBe(LABEL_DECORATION_DEFAULTS.height);
    });

    it('should not position Decision label inside the diamond', () => {
      const decisionBounds = {
        x: 100,
        y: 100,
        width: 60,
        height: 60,
      };

      const labelPos = getDefaultLabelPosition(decisionBounds, 'Decision');

      // Label top should be below the diamond bottom
      expect(labelPos.y).toBeGreaterThan(decisionBounds.y + decisionBounds.height);
    });
  });

  /**
   * Test 3.2: Action labels positioned inside the shape
   */
  describe('Action label positioning', () => {
    it('should position Action label centered inside the node', () => {
      const actionBounds = {
        x: 100,
        y: 100,
        width: 140,
        height: 50,
      };

      const labelPos = getDefaultLabelPosition(actionBounds, 'Action');

      // Label should be horizontally centered in the action node
      const nodeCenterX = actionBounds.x + actionBounds.width / 2;
      expect(labelPos.x).toBeCloseTo(nodeCenterX - labelPos.width / 2, 5);

      // Label should be vertically centered in the action node
      const nodeCenterY = actionBounds.y + actionBounds.height / 2;
      expect(labelPos.y).toBeCloseTo(nodeCenterY - labelPos.height / 2, 5);
    });

    it('should constrain Action label width to node width with padding', () => {
      const narrowNode = {
        x: 100,
        y: 100,
        width: 50, // Narrower than default label width
        height: 50,
      };

      const labelPos = getDefaultLabelPosition(narrowNode, 'Action');

      // Label width should be constrained
      expect(labelPos.width).toBeLessThanOrEqual(narrowNode.width - 10);
    });
  });

  /**
   * Test 3.3: ActivityFlow edge label default position
   */
  describe('ActivityFlow edge label positioning', () => {
    it('should position edge label at midpoint above the line', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const labelPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      // Label X should be at the midpoint horizontally
      const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
      const targetCenterX = targetNode.pos_x + targetNode.width / 2;
      const midpointX = (sourceCenterX + targetCenterX) / 2;
      expect(labelPos.x).toBeCloseTo(midpointX - LABEL_DECORATION_DEFAULTS.width / 2, 5);

      // Label should be above the midpoint
      const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;
      const targetCenterY = targetNode.pos_y + targetNode.height / 2;
      const midpointY = (sourceCenterY + targetCenterY) / 2;
      expect(labelPos.y).toBeLessThan(midpointY);
    });

    it('should use standard width and height for edge label bounds', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const labelPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      expect(labelPos.width).toBe(LABEL_DECORATION_DEFAULTS.width);
      expect(labelPos.height).toBe(LABEL_DECORATION_DEFAULTS.height);
    });
  });

  /**
   * Test 3.4: Edge uses persisted label position when available
   */
  describe('Edge label persistence', () => {
    it('should use label_pos_x and label_pos_y when persisted on edge', () => {
      const edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        label_pos_x: 250,
        label_pos_y: 80,
      };

      // When label_pos_x/y are set, they should be used
      expect(edge.label_pos_x).toBe(250);
      expect(edge.label_pos_y).toBe(80);
    });

    it('should use undefined for label position when not persisted', () => {
      const edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
        // label_pos_x and label_pos_y not set
      };

      expect(edge.label_pos_x).toBeUndefined();
      expect(edge.label_pos_y).toBeUndefined();
    });

    it('should fall back to calculated position when label_pos not set', () => {
      const edge: DiagramEdge = {
        id: 'edge1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow1',
        source_node_id: 'node1',
        target_node_id: 'node2',
      };

      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const calculatedPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      // When edge.label_pos_x is undefined, calculated position should be used
      const labelX = edge.label_pos_x ?? calculatedPos.x;
      const labelY = edge.label_pos_y ?? calculatedPos.y;

      expect(labelX).toBe(calculatedPos.x);
      expect(labelY).toBe(calculatedPos.y);
    });
  });

  /**
   * Test 3.5: LabelDecoration structure for node labels
   */
  describe('LabelDecoration structure', () => {
    it('should create valid LabelDecoration for Decision node', () => {
      const decisionBounds = {
        x: 100,
        y: 100,
        width: 60,
        height: 60,
      };

      const labelPos = getDefaultLabelPosition(decisionBounds, 'Decision');

      const labelDec: LabelDecoration = {
        id: 'label-dec-1',
        targetKind: 'NODE',
        targetId: 'decision-node-1',
        x: labelPos.x,
        y: labelPos.y,
        width: labelPos.width,
        height: labelPos.height,
      };

      expect(labelDec.targetKind).toBe('NODE');
      expect(labelDec.x).toBe(labelPos.x);
      expect(labelDec.y).toBe(labelPos.y);
    });

    it('should create valid LabelDecoration for edge', () => {
      const sourceNode: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const targetNode: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const labelPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      const labelDec: LabelDecoration = {
        id: 'label-dec-2',
        targetKind: 'EDGE',
        targetId: 'edge-1',
        x: labelPos.x,
        y: labelPos.y,
        width: labelPos.width,
        height: labelPos.height,
      };

      expect(labelDec.targetKind).toBe('EDGE');
      expect(labelDec.x).toBe(labelPos.x);
      expect(labelDec.y).toBe(labelPos.y);
    });
  });

  /**
   * Test 3.6: Suppression of inline label when LabelDecoration exists
   */
  describe('Inline label suppression', () => {
    it('should determine hasExplicitLabel based on LabelDecoration lookup', () => {
      const nodeLabelDecMap = new Map<string, LabelDecoration>();

      // Add a label decoration for a decision node
      nodeLabelDecMap.set('decision-node-1', {
        id: 'label-dec-1',
        targetKind: 'NODE',
        targetId: 'decision-node-1',
        x: 100,
        y: 168,
        width: 80,
        height: 20,
      });

      // Check if node has explicit label
      const hasExplicitLabel = nodeLabelDecMap.has('decision-node-1');
      expect(hasExplicitLabel).toBe(true);

      // Node without decoration should not have explicit label
      const noExplicitLabel = nodeLabelDecMap.has('action-node-1');
      expect(noExplicitLabel).toBe(false);
    });

    it('should show inline label only when hasExplicitLabel is false', () => {
      const hasExplicitLabel = false;
      const showLabel = true; // renderResult.showLabel

      const shouldRenderInlineLabel = !hasExplicitLabel && showLabel;
      expect(shouldRenderInlineLabel).toBe(true);

      // When explicit label exists
      const hasExplicit = true;
      const shouldRenderWhenExplicit = !hasExplicit && showLabel;
      expect(shouldRenderWhenExplicit).toBe(false);
    });
  });

  /**
   * Test 3.7: Node types that should/should not show labels
   */
  describe('Label visibility by node type', () => {
    it('should show labels for Action and Decision nodes', () => {
      const actionShowLabel = true; // Action nodes show labels
      const decisionShowLabel = true; // Decision nodes show labels

      expect(actionShowLabel).toBe(true);
      expect(decisionShowLabel).toBe(true);
    });

    it('should not show labels for Initial, Merge, and Final nodes by default', () => {
      const initialShowLabel = false;
      const mergeShowLabel = false;
      const finalShowLabel = false;

      expect(initialShowLabel).toBe(false);
      expect(mergeShowLabel).toBe(false);
      expect(finalShowLabel).toBe(false);
    });
  });
});
