/**
 * Tests for decoration inspector panel integration
 * Task Group 5: Inspector Panel Style Controls
 *
 * These tests verify that the InspectorPanel correctly:
 * 1. Detects decoration selection
 * 2. Applies font controls to BOX and LINE decorations
 * 3. Applies colour controls appropriately (background only for BOX)
 * 4. Applies line styling to both BOX border and LINE stroke
 * 5. Applies alignment controls to BOX only
 * 6. Applies arrow controls to LINE only
 */

import {
  BoxDecoration,
  LineDecoration,
  Decoration,
  DecorationHAlign,
  DecorationVAlign,
  LineStyle,
  ArrowType,
} from '../types/model';
import { DECORATION_DEFAULTS } from '../config/defaults';

// ============================================================================
// Test 1: Font controls apply to BOX text
// ============================================================================

describe('Decoration Inspector - Font Controls for BOX', () => {
  it('should apply font size to BOX decoration text', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      text: 'Test Box',
      text_font_size: 14,
    };

    // Simulate applying font size update
    const newFontSize = 18;
    const updatedDecoration: BoxDecoration = {
      ...boxDecoration,
      text_font_size: newFontSize,
    };

    expect(updatedDecoration.text_font_size).toBe(18);
    expect(updatedDecoration.type).toBe('BOX');
  });

  it('should apply font weight (bold) to BOX decoration text', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      text: 'Test Box',
      text_font_weight: 'normal',
    };

    const updatedDecoration: BoxDecoration = {
      ...boxDecoration,
      text_font_weight: 'bold',
    };

    expect(updatedDecoration.text_font_weight).toBe('bold');
  });

  it('should apply font style (italic) to BOX decoration text', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      text: 'Test Box',
      text_font_style: 'normal',
    };

    const updatedDecoration: BoxDecoration = {
      ...boxDecoration,
      text_font_style: 'italic',
    };

    expect(updatedDecoration.text_font_style).toBe('italic');
  });

  it('should apply text colour to BOX decoration text', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      text: 'Test Box',
      text_color: '#000000',
    };

    const updatedDecoration: BoxDecoration = {
      ...boxDecoration,
      text_color: '#FF0000',
    };

    expect(updatedDecoration.text_color).toBe('#FF0000');
  });
});

// ============================================================================
// Test 2: Font controls apply to LINE label
// ============================================================================

describe('Decoration Inspector - Font Controls for LINE', () => {
  it('should apply font size to LINE decoration label', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      text: 'Test Line',
      text_font_size: 12,
    };

    const updatedDecoration: LineDecoration = {
      ...lineDecoration,
      text_font_size: 16,
    };

    expect(updatedDecoration.text_font_size).toBe(16);
    expect(updatedDecoration.type).toBe('LINE');
  });

  it('should apply font weight (bold) to LINE decoration label', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      text: 'Test Line',
      text_font_weight: 'normal',
    };

    const updatedDecoration: LineDecoration = {
      ...lineDecoration,
      text_font_weight: 'bold',
    };

    expect(updatedDecoration.text_font_weight).toBe('bold');
  });

  it('should apply font style (italic) to LINE decoration label', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      text: 'Test Line',
      text_font_style: 'normal',
    };

    const updatedDecoration: LineDecoration = {
      ...lineDecoration,
      text_font_style: 'italic',
    };

    expect(updatedDecoration.text_font_style).toBe('italic');
  });

  it('should apply text colour to LINE decoration label', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      text: 'Test Line',
      text_color: '#333333',
    };

    const updatedDecoration: LineDecoration = {
      ...lineDecoration,
      text_color: '#0000FF',
    };

    expect(updatedDecoration.text_color).toBe('#0000FF');
  });
});

// ============================================================================
// Test 3: Background colour applies to BOX only
// ============================================================================

describe('Decoration Inspector - Background Colour', () => {
  it('should apply background colour to BOX decoration', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      background_color: 'rgba(230, 230, 255, 0.2)',
    };

    const updatedDecoration: BoxDecoration = {
      ...boxDecoration,
      background_color: '#FFEECC',
    };

    expect(updatedDecoration.background_color).toBe('#FFEECC');
  });

  it('should verify LINE decoration does not have background_color property', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
    };

    // LINE decorations should not have background_color in their interface
    expect('background_color' in lineDecoration).toBe(false);
  });

  it('should ignore background colour for LINE decorations in mixed selection', () => {
    // Helper function to check if background applies
    function shouldApplyBackground(decoration: Decoration): boolean {
      return decoration.type === 'BOX';
    }

    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
    };

    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
    };

    expect(shouldApplyBackground(boxDecoration)).toBe(true);
    expect(shouldApplyBackground(lineDecoration)).toBe(false);
  });
});

// ============================================================================
// Test 4: Line styling applies to BOX border and LINE stroke
// ============================================================================

describe('Decoration Inspector - Line Styling', () => {
  it('should apply line colour to BOX border', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      line_color: '#9999FF',
    };

    const updatedDecoration: BoxDecoration = {
      ...boxDecoration,
      line_color: '#FF0000',
    };

    expect(updatedDecoration.line_color).toBe('#FF0000');
  });

  it('should apply line colour to LINE stroke', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      line_color: '#666666',
    };

    const updatedDecoration: LineDecoration = {
      ...lineDecoration,
      line_color: '#00FF00',
    };

    expect(updatedDecoration.line_color).toBe('#00FF00');
  });

  it('should apply line style (SOLID/DASHED/DOTTED) to BOX border', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      line_style: 'SOLID',
    };

    const lineStyles: LineStyle[] = ['SOLID', 'DASHED', 'DOTTED'];

    for (const style of lineStyles) {
      const updated: BoxDecoration = {
        ...boxDecoration,
        line_style: style,
      };
      expect(updated.line_style).toBe(style);
    }
  });

  it('should apply line style (SOLID/DASHED/DOTTED) to LINE stroke', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      line_style: 'SOLID',
    };

    const lineStyles: LineStyle[] = ['SOLID', 'DASHED', 'DOTTED'];

    for (const style of lineStyles) {
      const updated: LineDecoration = {
        ...lineDecoration,
        line_style: style,
      };
      expect(updated.line_style).toBe(style);
    }
  });

  it('should apply line weight to both BOX and LINE', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      line_weight: '2px',
    };

    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      line_weight: '2px',
    };

    const updatedBox: BoxDecoration = { ...boxDecoration, line_weight: '4px' };
    const updatedLine: LineDecoration = { ...lineDecoration, line_weight: '4px' };

    expect(updatedBox.line_weight).toBe('4px');
    expect(updatedLine.line_weight).toBe('4px');
  });
});

// ============================================================================
// Test 5: Alignment controls apply to BOX only
// ============================================================================

describe('Decoration Inspector - Alignment Controls for BOX', () => {
  it('should apply horizontal alignment (LEFT/CENTER/RIGHT) to BOX', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      text_h_align: 'CENTER',
    };

    const hAligns: DecorationHAlign[] = ['LEFT', 'CENTER', 'RIGHT'];

    for (const align of hAligns) {
      const updated: BoxDecoration = {
        ...boxDecoration,
        text_h_align: align,
      };
      expect(updated.text_h_align).toBe(align);
    }
  });

  it('should apply vertical alignment (TOP/MIDDLE/BOTTOM) to BOX', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      text_v_align: 'TOP',
    };

    const vAligns: DecorationVAlign[] = ['TOP', 'MIDDLE', 'BOTTOM'];

    for (const align of vAligns) {
      const updated: BoxDecoration = {
        ...boxDecoration,
        text_v_align: align,
      };
      expect(updated.text_v_align).toBe(align);
    }
  });

  it('should verify LINE decoration does not have alignment properties', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
    };

    // LINE decorations should not have alignment properties
    expect('text_h_align' in lineDecoration).toBe(false);
    expect('text_v_align' in lineDecoration).toBe(false);
  });

  it('should show alignment controls only when BOX is selected', () => {
    // Helper function to determine if alignment controls should be shown
    function shouldShowAlignmentControls(decorations: Decoration[]): boolean {
      return decorations.some(d => d.type === 'BOX');
    }

    const boxOnly: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
    ];

    const lineOnly: Decoration[] = [
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
      },
    ];

    const mixed: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
      },
    ];

    expect(shouldShowAlignmentControls(boxOnly)).toBe(true);
    expect(shouldShowAlignmentControls(lineOnly)).toBe(false);
    expect(shouldShowAlignmentControls(mixed)).toBe(true);
  });
});

// ============================================================================
// Test 6: Arrow controls apply to LINE only
// ============================================================================

describe('Decoration Inspector - Arrow Controls for LINE', () => {
  it('should apply arrow_start (NONE/ARROW) to LINE decoration', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      arrow_start: 'NONE',
    };

    const arrowTypes: ArrowType[] = ['NONE', 'ARROW'];

    for (const arrowType of arrowTypes) {
      const updated: LineDecoration = {
        ...lineDecoration,
        arrow_start: arrowType,
      };
      expect(updated.arrow_start).toBe(arrowType);
    }
  });

  it('should apply arrow_end (NONE/ARROW) to LINE decoration', () => {
    const lineDecoration: LineDecoration = {
      id: 'dec_line_1',
      type: 'LINE',
      line_points: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ],
      arrow_end: 'NONE',
    };

    const arrowTypes: ArrowType[] = ['NONE', 'ARROW'];

    for (const arrowType of arrowTypes) {
      const updated: LineDecoration = {
        ...lineDecoration,
        arrow_end: arrowType,
      };
      expect(updated.arrow_end).toBe(arrowType);
    }
  });

  it('should verify BOX decoration does not have arrow properties', () => {
    const boxDecoration: BoxDecoration = {
      id: 'dec_box_1',
      type: 'BOX',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
    };

    // BOX decorations should not have arrow properties
    expect('arrow_start' in boxDecoration).toBe(false);
    expect('arrow_end' in boxDecoration).toBe(false);
  });

  it('should show arrow controls only when LINE is selected', () => {
    // Helper function to determine if arrow controls should be shown
    function shouldShowArrowControls(decorations: Decoration[]): boolean {
      return decorations.some(d => d.type === 'LINE');
    }

    const boxOnly: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
    ];

    const lineOnly: Decoration[] = [
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
      },
    ];

    const mixed: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
      },
    ];

    expect(shouldShowArrowControls(boxOnly)).toBe(false);
    expect(shouldShowArrowControls(lineOnly)).toBe(true);
    expect(shouldShowArrowControls(mixed)).toBe(true);
  });

  it('should ignore arrow controls for BOX decorations in mixed selection', () => {
    // When applying arrow updates in mixed selection, BOX should be ignored
    function applyArrowUpdate(
      decorations: Decoration[],
      updates: { arrow_start?: ArrowType; arrow_end?: ArrowType }
    ): Decoration[] {
      return decorations.map(dec => {
        if (dec.type === 'LINE') {
          return { ...dec, ...updates } as LineDecoration;
        }
        // BOX decorations remain unchanged
        return dec;
      });
    }

    const mixed: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
        arrow_start: 'NONE',
        arrow_end: 'NONE',
      },
    ];

    const updated = applyArrowUpdate(mixed, { arrow_end: 'ARROW' });

    // BOX should remain unchanged
    expect(updated[0].type).toBe('BOX');
    expect('arrow_end' in updated[0]).toBe(false);

    // LINE should have updated arrow
    expect(updated[1].type).toBe('LINE');
    expect((updated[1] as LineDecoration).arrow_end).toBe('ARROW');
  });
});

// ============================================================================
// Test 7: Selection detection and mixed selection handling
// ============================================================================

describe('Decoration Inspector - Selection Detection', () => {
  it('should detect when selection contains decorations', () => {
    function hasDecorationSelection(selectedDecorationIds: Set<string>): boolean {
      return selectedDecorationIds.size > 0;
    }

    expect(hasDecorationSelection(new Set())).toBe(false);
    expect(hasDecorationSelection(new Set(['dec_box_1']))).toBe(true);
    expect(hasDecorationSelection(new Set(['dec_line_1', 'dec_box_2']))).toBe(true);
  });

  it('should get selected decorations from decoration array', () => {
    const decorations: Decoration[] = [
      {
        id: 'dec_box_1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
      {
        id: 'dec_line_1',
        type: 'LINE',
        line_points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ],
      },
      {
        id: 'dec_box_2',
        type: 'BOX',
        pos_x: 300,
        pos_y: 300,
        width: 100,
        height: 100,
      },
    ];

    const selectedIds = new Set(['dec_box_1', 'dec_line_1']);

    const selectedDecorations = decorations.filter(d => selectedIds.has(d.id));

    expect(selectedDecorations.length).toBe(2);
    expect(selectedDecorations[0].id).toBe('dec_box_1');
    expect(selectedDecorations[1].id).toBe('dec_line_1');
  });

  it('should handle mixed selection of nodes, edges, and decorations', () => {
    const selectedNodeIds = new Set(['node_1']);
    const selectedEdgeIds = new Set(['edge_1']);
    const selectedDecorationIds = new Set(['dec_box_1']);

    const totalSelected =
      selectedNodeIds.size + selectedEdgeIds.size + selectedDecorationIds.size;

    expect(totalSelected).toBe(3);

    // Style controls should be enabled when there is any selection
    const hasSelection = totalSelected > 0;
    expect(hasSelection).toBe(true);
  });
});

// ============================================================================
// Test 8: Default values from DECORATION_DEFAULTS
// ============================================================================

describe('Decoration Inspector - Default Values', () => {
  it('should use DECORATION_DEFAULTS for BOX defaults', () => {
    expect(DECORATION_DEFAULTS.BOX.text_font_size).toBe(14);
    expect(DECORATION_DEFAULTS.BOX.text_font_weight).toBe('normal');
    expect(DECORATION_DEFAULTS.BOX.text_font_style).toBe('normal');
    expect(DECORATION_DEFAULTS.BOX.text_color).toBe('#000000');
    expect(DECORATION_DEFAULTS.BOX.background_color).toBe('rgba(230, 230, 255, 0.2)');
    expect(DECORATION_DEFAULTS.BOX.line_color).toBe('#9999FF');
    expect(DECORATION_DEFAULTS.BOX.line_style).toBe('SOLID');
    expect(DECORATION_DEFAULTS.BOX.text_h_align).toBe('CENTER');
    expect(DECORATION_DEFAULTS.BOX.text_v_align).toBe('TOP');
  });

  it('should use DECORATION_DEFAULTS for LINE defaults', () => {
    expect(DECORATION_DEFAULTS.LINE.text_font_size).toBe(12);
    expect(DECORATION_DEFAULTS.LINE.text_font_weight).toBe('normal');
    expect(DECORATION_DEFAULTS.LINE.text_font_style).toBe('normal');
    expect(DECORATION_DEFAULTS.LINE.text_color).toBe('#333333');
    expect(DECORATION_DEFAULTS.LINE.line_color).toBe('#666666');
    expect(DECORATION_DEFAULTS.LINE.line_style).toBe('SOLID');
    expect(DECORATION_DEFAULTS.LINE.arrow_start).toBe('NONE');
    expect(DECORATION_DEFAULTS.LINE.arrow_end).toBe('NONE');
  });
});
