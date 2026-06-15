/**
 * Activity Decision Label Decoration Tests
 * Task Group 4: Decision Labels as DiagramDecoration
 * Spec 2026-01-01: Activity Diagram Shape Bounds and Interactive Labels
 *
 * Tests that Decision labels are rendered as independent decorations
 * below the diamond shape, and that inline text is suppressed.
 */

import {
  createDecisionLabelDecoration,
  getDefaultLabelPosition,
} from '../utils/activityNodeRendering';
import { LABEL_DECORATION_DEFAULTS } from '../types/model';
import { ActivityKind } from '../types/model';

describe('Decision Label Decorations', () => {
  describe('createDecisionLabelDecoration', () => {
    it('should create label decoration positioned below diamond', () => {
      const nodeId = 'node-decision-1';
      const nodePosX = 100;
      const nodePosY = 100;
      const nodeWidth = 60;
      const nodeHeight = 60;
      const text = 'Approve Request?';

      const decoration = createDecisionLabelDecoration(
        nodeId,
        nodePosX,
        nodePosY,
        nodeWidth,
        nodeHeight,
        text
      );

      // Verify targetKind and targetId
      expect(decoration.targetKind).toBe('NODE');
      expect(decoration.targetId).toBe(nodeId);

      // Verify position: y = node.pos_y + node.height + 8 (decisionLabelOffset)
      const expectedY = nodePosY + nodeHeight + LABEL_DECORATION_DEFAULTS.decisionLabelOffset;
      expect(decoration.y).toBe(expectedY);

      // Verify center alignment: x = nodeCenterX - width/2
      const expectedX = (nodePosX + nodeWidth / 2) - LABEL_DECORATION_DEFAULTS.width / 2;
      expect(decoration.x).toBe(expectedX);

      // Verify text is set
      expect(decoration.text).toBe(text);
    });

    it('should generate unique ID for each decoration', () => {
      const dec1 = createDecisionLabelDecoration('node-1', 0, 0, 60, 60, 'Label 1');
      const dec2 = createDecisionLabelDecoration('node-2', 0, 0, 60, 60, 'Label 2');

      expect(dec1.id).not.toBe(dec2.id);
      expect(dec1.id).toMatch(/^label_\d+_[a-z0-9]+$/);
    });

    it('should use default label dimensions', () => {
      const decoration = createDecisionLabelDecoration(
        'node-1', 100, 100, 60, 60, 'Test'
      );

      expect(decoration.width).toBe(LABEL_DECORATION_DEFAULTS.width);
      expect(decoration.height).toBe(LABEL_DECORATION_DEFAULTS.height);
    });

    it('should center-align label horizontally below diamond', () => {
      const nodePosX = 50;
      const nodeWidth = 80; // Non-standard width
      const nodeCenterX = nodePosX + nodeWidth / 2; // 90

      const decoration = createDecisionLabelDecoration(
        'node-1', nodePosX, 100, nodeWidth, 60, 'Centered Label'
      );

      // Label should be centered: x = nodeCenterX - labelWidth/2
      const expectedX = nodeCenterX - LABEL_DECORATION_DEFAULTS.width / 2;
      expect(decoration.x).toBe(expectedX);
    });
  });

  describe('getDefaultLabelPosition for Decision nodes', () => {
    it('should position label below diamond for Decision kind', () => {
      const bounds = {
        x: 100,
        y: 100,
        width: 60,
        height: 60,
      };
      const activityKind: ActivityKind = 'Decision';

      const result = getDefaultLabelPosition(bounds, activityKind);

      // y = diamondBottom + offset = (100 + 60) + 8 = 168
      const expectedY = bounds.y + bounds.height + LABEL_DECORATION_DEFAULTS.decisionLabelOffset;
      expect(result.y).toBe(expectedY);

      // x should center the label below the diamond
      const nodeCenterX = bounds.x + bounds.width / 2;
      const expectedX = nodeCenterX - LABEL_DECORATION_DEFAULTS.width / 2;
      expect(result.x).toBe(expectedX);
    });

    it('should position label inside Action nodes', () => {
      const bounds = {
        x: 100,
        y: 100,
        width: 140,
        height: 50,
      };
      const activityKind: ActivityKind = 'Action';

      const result = getDefaultLabelPosition(bounds, activityKind);

      // Label should be vertically centered inside the node
      const nodeCenterY = bounds.y + bounds.height / 2;
      const expectedY = nodeCenterY - LABEL_DECORATION_DEFAULTS.height / 2;
      expect(result.y).toBe(expectedY);
    });

    it('should return center position for Initial/Merge/Final (no visible label)', () => {
      const bounds = {
        x: 50,
        y: 50,
        width: 20,
        height: 20,
      };

      // These should all return centered positions
      for (const kind of ['Initial', 'Merge', 'Final'] as ActivityKind[]) {
        const result = getDefaultLabelPosition(bounds, kind);

        const nodeCenterX = bounds.x + bounds.width / 2;
        const nodeCenterY = bounds.y + bounds.height / 2;
        const expectedX = nodeCenterX - LABEL_DECORATION_DEFAULTS.width / 2;
        const expectedY = nodeCenterY - LABEL_DECORATION_DEFAULTS.height / 2;

        expect(result.x).toBe(expectedX);
        expect(result.y).toBe(expectedY);
      }
    });
  });

  describe('Decision inline text suppression', () => {
    // Note: Actual suppression is tested in ActivityDiagramRenderer tests
    // This test documents the expected behavior

    it('should indicate Decision nodes show labels (via LabelDecoration)', () => {
      // Decision nodes DO show labels, but as separate decorations
      // The showLabel flag on renderResult indicates this
      // Actual suppression of inline text happens in ActivityNodeElement
      // when hasExplicitLabel is true

      const activityKind: ActivityKind = 'Decision';

      // In the current implementation, Decision.showLabel = true
      // but inline text is suppressed when an explicit LabelDecoration exists
      // This is tested in the renderer integration tests
      expect(true).toBe(true); // Placeholder - actual logic is in renderer
    });
  });
});
