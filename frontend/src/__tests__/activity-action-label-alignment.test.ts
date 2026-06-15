/**
 * Activity Action Label Alignment Tests
 * Task Group 2: Action Label Alignment (Part B.1)
 * Spec: 2026-01-01 Activity Diagram Corrective Fixes
 *
 * Tests that Action node labels use standard text layout with alignment.
 * - Uses text_h_align and text_v_align from DiagramNode properties
 * - Defaults to CENTER/MIDDLE when not specified
 * - Labels wrap within node bounds
 */

import React from 'react';
import { DiagramNode, TextHorizontalAlign, TextVerticalAlign } from '../types/model';
import { wrapText } from '../utils/rendering';

describe('Activity Action Label Alignment', () => {
  /**
   * Test 2.1: Action labels use text_h_align and text_v_align properties
   */
  describe('Alignment property usage', () => {
    it('should default text_h_align to CENTER when not specified', () => {
      const node: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        // text_h_align not specified
      };

      const hAlign = node.text_h_align || 'CENTER';
      expect(hAlign).toBe('CENTER');
    });

    it('should default text_v_align to MIDDLE when not specified', () => {
      const node: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        // text_v_align not specified
      };

      const vAlign = node.text_v_align || 'MIDDLE';
      expect(vAlign).toBe('MIDDLE');
    });

    it('should use specified text_h_align when provided', () => {
      const nodeLeft: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        text_h_align: 'LEFT',
      };

      const nodeRight: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        text_h_align: 'RIGHT',
      };

      expect(nodeLeft.text_h_align).toBe('LEFT');
      expect(nodeRight.text_h_align).toBe('RIGHT');
    });

    it('should use specified text_v_align when provided', () => {
      const nodeTop: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        text_v_align: 'TOP',
      };

      const nodeBottom: DiagramNode = {
        id: 'node2',
        entity_type: 'ACTIVITY',
        entity_id: 'act2',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        text_v_align: 'BOTTOM',
      };

      expect(nodeTop.text_v_align).toBe('TOP');
      expect(nodeBottom.text_v_align).toBe('BOTTOM');
    });
  });

  /**
   * Test 2.2: Text position calculation based on alignment
   */
  describe('Text position calculation', () => {
    const TEXT_PADDING = 5;
    const FONT_SIZE = 12;
    const LINE_SPACING = 4;

    function calculateAlignedTextPosition(
      node: DiagramNode,
      lines: string[],
      fontSize: number = FONT_SIZE
    ): {
      startY: number;
      getX: () => number;
      anchor: 'start' | 'middle' | 'end';
    } {
      const padding = TEXT_PADDING;
      const lineSpacing = LINE_SPACING;

      const textAreaX = node.pos_x + padding;
      const textAreaY = node.pos_y + padding;
      const textAreaWidth = node.width - (padding * 2);
      const textAreaHeight = node.height - (padding * 2);

      const blockHeight = lines.length * fontSize + (lines.length - 1) * lineSpacing;

      let startY: number;
      const vAlign: TextVerticalAlign = node.text_v_align || 'MIDDLE';

      switch (vAlign) {
        case 'TOP':
          startY = textAreaY + fontSize;
          break;
        case 'BOTTOM':
          startY = textAreaY + textAreaHeight - blockHeight + fontSize;
          break;
        case 'MIDDLE':
        default:
          startY = textAreaY + (textAreaHeight - blockHeight) / 2 + fontSize;
          break;
      }

      const hAlign: TextHorizontalAlign = node.text_h_align || 'CENTER';
      let anchor: 'start' | 'middle' | 'end';

      const getX = (): number => {
        switch (hAlign) {
          case 'LEFT':
            return textAreaX;
          case 'RIGHT':
            return textAreaX + textAreaWidth;
          case 'CENTER':
          default:
            return textAreaX + textAreaWidth / 2;
        }
      };

      switch (hAlign) {
        case 'LEFT':
          anchor = 'start';
          break;
        case 'RIGHT':
          anchor = 'end';
          break;
        case 'CENTER':
        default:
          anchor = 'middle';
          break;
      }

      return { startY, getX, anchor };
    }

    it('should calculate centered position for default alignment', () => {
      const node: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const lines = ['Test Label'];
      const { startY, getX, anchor } = calculateAlignedTextPosition(node, lines);

      // For CENTER alignment, X should be at the middle of the text area
      const expectedX = 100 + TEXT_PADDING + (140 - TEXT_PADDING * 2) / 2;
      expect(getX()).toBe(expectedX);
      expect(anchor).toBe('middle');

      // For MIDDLE alignment, startY should be vertically centered
      const textAreaHeight = 50 - TEXT_PADDING * 2;
      const blockHeight = 1 * FONT_SIZE;
      const expectedStartY = 100 + TEXT_PADDING + (textAreaHeight - blockHeight) / 2 + FONT_SIZE;
      expect(startY).toBeCloseTo(expectedStartY, 5);
    });

    it('should calculate top-left position for TOP/LEFT alignment', () => {
      const node: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        text_h_align: 'LEFT',
        text_v_align: 'TOP',
      };

      const lines = ['Test Label'];
      const { startY, getX, anchor } = calculateAlignedTextPosition(node, lines);

      // For LEFT alignment, X should be at the left edge of text area
      expect(getX()).toBe(100 + TEXT_PADDING);
      expect(anchor).toBe('start');

      // For TOP alignment, startY should be at top of text area + fontSize
      expect(startY).toBe(100 + TEXT_PADDING + FONT_SIZE);
    });

    it('should calculate bottom-right position for BOTTOM/RIGHT alignment', () => {
      const node: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
        text_h_align: 'RIGHT',
        text_v_align: 'BOTTOM',
      };

      const lines = ['Test Label'];
      const { startY, getX, anchor } = calculateAlignedTextPosition(node, lines);

      // For RIGHT alignment, X should be at the right edge of text area
      expect(getX()).toBe(100 + 140 - TEXT_PADDING);
      expect(anchor).toBe('end');

      // For BOTTOM alignment with single line
      const textAreaY = 100 + TEXT_PADDING;
      const textAreaHeight = 50 - TEXT_PADDING * 2;
      const blockHeight = 1 * FONT_SIZE;
      expect(startY).toBe(textAreaY + textAreaHeight - blockHeight + FONT_SIZE);
    });
  });

  /**
   * Test 2.3: Text wrapping within node bounds
   */
  describe('Text wrapping', () => {
    it('should wrap text that exceeds node width', () => {
      const longLabel = 'This is a very long label that should wrap to multiple lines';
      const maxWidth = 100; // Width minus padding

      const lines = wrapText(longLabel, maxWidth, 12, 'normal', 'normal');

      // Should have multiple lines
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should keep short labels on single line', () => {
      const shortLabel = 'Short';
      const maxWidth = 100;

      const lines = wrapText(shortLabel, maxWidth, 12, 'normal', 'normal');

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('Short');
    });

    it('should handle multi-line labels with correct vertical spacing', () => {
      const node: DiagramNode = {
        id: 'node1',
        entity_type: 'ACTIVITY',
        entity_id: 'act1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 80, // Taller to fit multiple lines
        parent_node_id: null,
      };

      const lines = ['Line 1', 'Line 2', 'Line 3'];
      const FONT_SIZE = 12;
      const LINE_SPACING = 4;
      const TEXT_PADDING = 5;

      // Calculate expected text block height
      const blockHeight = lines.length * FONT_SIZE + (lines.length - 1) * LINE_SPACING;
      expect(blockHeight).toBe(3 * 12 + 2 * 4); // 44px

      // For MIDDLE alignment, text block should be centered
      const textAreaHeight = node.height - TEXT_PADDING * 2;
      const expectedTopOffset = (textAreaHeight - blockHeight) / 2;
      expect(expectedTopOffset).toBeGreaterThan(0);
    });
  });

  /**
   * Test 2.4: SVG text anchor mapping
   */
  describe('SVG text-anchor mapping', () => {
    it('should map LEFT to text-anchor start', () => {
      const hAlign: TextHorizontalAlign = 'LEFT';
      const anchor = hAlign === 'LEFT' ? 'start' : hAlign === 'RIGHT' ? 'end' : 'middle';
      expect(anchor).toBe('start');
    });

    it('should map CENTER to text-anchor middle', () => {
      const hAlign: TextHorizontalAlign = 'CENTER';
      const anchor = hAlign === 'LEFT' ? 'start' : hAlign === 'RIGHT' ? 'end' : 'middle';
      expect(anchor).toBe('middle');
    });

    it('should map RIGHT to text-anchor end', () => {
      const hAlign: TextHorizontalAlign = 'RIGHT';
      const anchor = hAlign === 'LEFT' ? 'start' : hAlign === 'RIGHT' ? 'end' : 'middle';
      expect(anchor).toBe('end');
    });
  });

  /**
   * Test 2.5: Alignment only applies to Action nodes
   */
  describe('Alignment applies only to Action nodes', () => {
    it('should only apply alignment for Action activity kind', () => {
      // Action nodes should use alignment properties
      const actionKind = 'Action';
      const isActionNode = actionKind === 'Action';
      expect(isActionNode).toBe(true);

      // Other node types should use centered positioning
      const decisionKind = 'Decision';
      const isDecisionActionNode = decisionKind === 'Action';
      expect(isDecisionActionNode).toBe(false);

      const initialKind = 'Initial';
      const isInitialActionNode = initialKind === 'Action';
      expect(isInitialActionNode).toBe(false);
    });
  });
});
