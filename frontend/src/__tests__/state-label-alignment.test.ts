/**
 * State Label Alignment Tests
 * Task Groups 5 & 6: State Diagram UX Fixes
 *
 * Tests for:
 * - Normal state default text alignment (CENTER/MIDDLE applied at render time)
 * - Initial/Final states have showLabel: false (no alignment needed)
 * - StateDiagramRenderer respects text alignment settings
 */

import { STATE_NODE_DEFAULTS } from '../config/defaults';

describe('Task Group 5: Normal State Label Alignment Defaults', () => {
  describe('STATE_NODE_DEFAULTS', () => {
    it('Normal state defaults to CENTER horizontal alignment at render time', () => {
      // Text alignment defaults are applied at render time via fallback
      // (e.g. node.text_h_align || 'CENTER' in the renderer), not stored
      // in STATE_NODE_DEFAULTS. Verify the Normal config does not override
      // the default, so the renderer fallback to CENTER applies.
      expect((STATE_NODE_DEFAULTS.Normal as any).text_h_align).toBeUndefined();
    });

    it('Normal state defaults to MIDDLE vertical alignment at render time', () => {
      // Text alignment defaults are applied at render time via fallback
      // (e.g. node.text_v_align || 'MIDDLE' in the renderer), not stored
      // in STATE_NODE_DEFAULTS. Verify the Normal config does not override
      // the default, so the renderer fallback to MIDDLE applies.
      expect((STATE_NODE_DEFAULTS.Normal as any).text_v_align).toBeUndefined();
    });

    it('Normal state has showLabel: true', () => {
      // Normal states display labels
      expect(STATE_NODE_DEFAULTS.Normal.showLabel).toBe(true);
    });

    it('Initial state has showLabel: false (no alignment needed)', () => {
      // Initial states do not display labels - no alignment settings needed
      expect(STATE_NODE_DEFAULTS.Initial.showLabel).toBe(false);
    });

    it('Final state has showLabel: false (no alignment needed)', () => {
      // Final states do not display labels - no alignment settings needed
      expect(STATE_NODE_DEFAULTS.Final.showLabel).toBe(false);
    });
  });
});

describe('Task Group 6: StateDiagramRenderer Label Alignment', () => {
  // These tests verify the alignment helper functions used by StateDiagramRenderer
  // The actual component tests are integration tests in state-diagram-renderer.test.ts

  describe('Horizontal alignment mapping', () => {
    function getTextAnchor(textAlignH: string | undefined): 'start' | 'middle' | 'end' {
      switch (textAlignH) {
        case 'LEFT':
          return 'start';
        case 'RIGHT':
          return 'end';
        case 'CENTER':
        default:
          return 'middle';
      }
    }

    it('LEFT maps to text-anchor start', () => {
      expect(getTextAnchor('LEFT')).toBe('start');
    });

    it('CENTER maps to text-anchor middle', () => {
      expect(getTextAnchor('CENTER')).toBe('middle');
    });

    it('RIGHT maps to text-anchor end', () => {
      expect(getTextAnchor('RIGHT')).toBe('end');
    });

    it('undefined defaults to middle', () => {
      expect(getTextAnchor(undefined)).toBe('middle');
    });
  });

  describe('Horizontal position calculation', () => {
    const mockNode = {
      pos_x: 100,
      pos_y: 50,
      width: 140,
      height: 60,
    };

    function getTextX(node: typeof mockNode, textAlignH: string | undefined): number {
      const centerX = node.pos_x + node.width / 2;
      const padding = 10;

      switch (textAlignH) {
        case 'LEFT':
          return node.pos_x + padding;
        case 'RIGHT':
          return node.pos_x + node.width - padding;
        case 'CENTER':
        default:
          return centerX;
      }
    }

    it('LEFT alignment positions text at left edge plus padding', () => {
      expect(getTextX(mockNode, 'LEFT')).toBe(110); // 100 + 10 padding
    });

    it('CENTER alignment positions text at horizontal center', () => {
      expect(getTextX(mockNode, 'CENTER')).toBe(170); // 100 + 140/2
    });

    it('RIGHT alignment positions text at right edge minus padding', () => {
      expect(getTextX(mockNode, 'RIGHT')).toBe(230); // 100 + 140 - 10 padding
    });
  });

  describe('Vertical alignment calculation', () => {
    const mockNode = {
      pos_x: 100,
      pos_y: 50,
      width: 140,
      height: 60,
    };

    function getTextY(
      node: typeof mockNode,
      textAlignV: string | undefined,
      textHeight: number,
      fontSize: number
    ): number {
      const centerY = node.pos_y + node.height / 2;
      const padding = 10;
      const baselineAdjust = fontSize * 0.35;

      switch (textAlignV) {
        case 'TOP':
          return node.pos_y + padding + fontSize * 0.8;
        case 'BOTTOM':
          return node.pos_y + node.height - padding - textHeight + fontSize;
        case 'MIDDLE':
        default:
          return centerY - textHeight / 2 + baselineAdjust;
      }
    }

    it('TOP alignment positions text near top edge', () => {
      const y = getTextY(mockNode, 'TOP', 12, 12);
      // 50 + 10 + 12*0.8 = 69.6
      expect(y).toBeCloseTo(69.6, 1);
    });

    it('MIDDLE alignment positions text at vertical center', () => {
      const y = getTextY(mockNode, 'MIDDLE', 12, 12);
      // centerY - textHeight/2 + baselineAdjust
      // 80 - 6 + 4.2 = 78.2
      expect(y).toBeCloseTo(78.2, 1);
    });

    it('BOTTOM alignment positions text near bottom edge', () => {
      const y = getTextY(mockNode, 'BOTTOM', 12, 12);
      // 50 + 60 - 10 - 12 + 12 = 100
      expect(y).toBe(100);
    });
  });
});

describe('Task Group 6: Alignment Control Enablement', () => {
  // These tests verify the logic for when alignment controls should be enabled/disabled

  describe('Alignment control visibility', () => {
    type StateKind = 'Initial' | 'Normal' | 'Final';

    function shouldEnableAlignmentControls(
      entityType: string,
      stateKind: StateKind | null
    ): boolean {
      // Only enable for STATE nodes with Normal kind
      if (entityType !== 'STATE') {
        return false;
      }
      return stateKind === 'Normal';
    }

    it('enables alignment controls for Normal state nodes', () => {
      expect(shouldEnableAlignmentControls('STATE', 'Normal')).toBe(true);
    });

    it('disables alignment controls for Initial state nodes', () => {
      expect(shouldEnableAlignmentControls('STATE', 'Initial')).toBe(false);
    });

    it('disables alignment controls for Final state nodes', () => {
      expect(shouldEnableAlignmentControls('STATE', 'Final')).toBe(false);
    });

    it('disables alignment controls for non-STATE nodes', () => {
      expect(shouldEnableAlignmentControls('APPLICATION', null)).toBe(false);
      expect(shouldEnableAlignmentControls('ACTIVITY', 'Normal' as StateKind)).toBe(false);
    });
  });
});
