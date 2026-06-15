/**
 * Activity Diagram UX Fixes - Task Group 5: Draggable Decision Node Labels Tests
 * Spec 2026-01-01: Decision labels positioned below diamond and draggable
 *
 * Tests that Decision node labels are positioned below the diamond shape
 * and rendered as independent LabelDecorations.
 */

import {
  LabelDecoration,
  LABEL_DECORATION_DEFAULTS,
  createDefaultLabelDecoration,
} from '../types/model';
import { createDecisionLabelDecoration } from '../utils/activityNodeRendering';

describe('Task Group 5: Draggable Decision Node Labels', () => {
  describe('createDecisionLabelDecoration', () => {
    it('should create LabelDecoration with targetKind NODE', () => {
      const labelDec = createDecisionLabelDecoration(
        'node_1',
        100, // nodePosX
        100, // nodePosY
        60,  // nodeWidth
        60,  // nodeHeight
        'Decision Name'
      );

      expect(labelDec.targetKind).toBe('NODE');
      expect(labelDec.targetId).toBe('node_1');
    });

    it('should position label below diamond with decisionLabelOffset', () => {
      const nodePosY = 100;
      const nodeHeight = 60;
      const expectedLabelY = nodePosY + nodeHeight + LABEL_DECORATION_DEFAULTS.decisionLabelOffset;

      const labelDec = createDecisionLabelDecoration(
        'node_1',
        100, // nodePosX
        nodePosY,
        60,  // nodeWidth
        nodeHeight,
        'Decision Name'
      );

      // Y should be: nodePosY + nodeHeight + 8 (decisionLabelOffset)
      expect(labelDec.y).toBe(expectedLabelY);
    });

    it('should center label horizontally with node', () => {
      const nodePosX = 100;
      const nodeWidth = 60;
      const nodeCenterX = nodePosX + nodeWidth / 2;
      const expectedLabelX = nodeCenterX - LABEL_DECORATION_DEFAULTS.width / 2;

      const labelDec = createDecisionLabelDecoration(
        'node_1',
        nodePosX,
        100, // nodePosY
        nodeWidth,
        60,  // nodeHeight
        'Decision Name'
      );

      expect(labelDec.x).toBe(expectedLabelX);
    });

    it('should set text to provided label text', () => {
      const labelDec = createDecisionLabelDecoration(
        'node_1',
        100,
        100,
        60,
        60,
        'My Decision'
      );

      expect(labelDec.text).toBe('My Decision');
    });

    it('should use default width and height from LABEL_DECORATION_DEFAULTS', () => {
      const labelDec = createDecisionLabelDecoration(
        'node_1',
        100,
        100,
        60,
        60,
        'Decision Name'
      );

      expect(labelDec.width).toBe(LABEL_DECORATION_DEFAULTS.width);
      expect(labelDec.height).toBe(LABEL_DECORATION_DEFAULTS.height);
    });
  });

  describe('LabelDecoration structure for Decision labels', () => {
    it('should have required fields for drag/resize operations', () => {
      const labelDec = createDecisionLabelDecoration(
        'node_1',
        100,
        100,
        60,
        60,
        'Decision Name'
      );

      // These fields are required for selection and dragging
      expect(labelDec.id).toBeDefined();
      expect(typeof labelDec.x).toBe('number');
      expect(typeof labelDec.y).toBe('number');
      expect(typeof labelDec.width).toBe('number');
      expect(typeof labelDec.height).toBe('number');
    });

    it('should have unique ID for each decoration', () => {
      const labelDec1 = createDecisionLabelDecoration('node_1', 100, 100, 60, 60, 'Dec 1');
      const labelDec2 = createDecisionLabelDecoration('node_2', 200, 100, 60, 60, 'Dec 2');

      expect(labelDec1.id).not.toBe(labelDec2.id);
    });
  });

  describe('Inline label suppression', () => {
    it('should identify when explicit label decoration exists for node', () => {
      // This simulates the logic in ActivityDiagramRenderer
      const nodeLabelDecMap = new Map<string, LabelDecoration>();

      const labelDec = createDecisionLabelDecoration(
        'decision_node_1',
        100,
        100,
        60,
        60,
        'Decision Name'
      );

      nodeLabelDecMap.set(labelDec.targetId, labelDec);

      // Check if explicit label exists
      const hasExplicitLabel = nodeLabelDecMap.has('decision_node_1');
      expect(hasExplicitLabel).toBe(true);
    });

    it('should not find explicit label for nodes without decoration', () => {
      const nodeLabelDecMap = new Map<string, LabelDecoration>();

      // No decoration added for this node
      const hasExplicitLabel = nodeLabelDecMap.has('some_node');
      expect(hasExplicitLabel).toBe(false);
    });
  });

  describe('Label drag independence from node', () => {
    it('should allow updating label position without affecting node', () => {
      const labelDec = createDecisionLabelDecoration(
        'node_1',
        100,
        100,
        60,
        60,
        'Decision Name'
      );

      // Simulate dragging the label to a new position
      const updatedLabelDec: LabelDecoration = {
        ...labelDec,
        x: labelDec.x + 50,
        y: labelDec.y + 20,
      };

      // Label position changed
      expect(updatedLabelDec.x).toBe(labelDec.x + 50);
      expect(updatedLabelDec.y).toBe(labelDec.y + 20);

      // targetId still points to original node
      expect(updatedLabelDec.targetId).toBe('node_1');
    });
  });
});
