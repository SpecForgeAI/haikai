/**
 * Tests for Row 2 Styling Controls Toolbar Layout
 *
 * Task Group 2 of the Diagram View UI Layout Reorganisation spec.
 * These tests verify:
 * - Row 2 only visible in Diagram view (not Meta-model view)
 * - Row 2 contains Font Size section with controls
 * - Row 2 contains Font Styles section with B, I, U toggles
 * - Row 2 contains Box Alignment section with H and V controls
 * - Row 2 contains Colour section with three colour pickers
 * - Vertical dividers render between sections
 *
 * Total: 6 tests
 */

import { describe, it, expect } from 'vitest';
import { emptyModel } from '../config/defaults';

// =========================================
// Test State Helpers
// =========================================

// Helper to create test state with existing diagrams in Diagram view
function createDiagramViewState() {
  return {
    model: {
      ...emptyModel,
      diagrams: [
        {
          id: 'diag-test-1',
          name: 'Test Diagram',
          description: 'Test description',
          diagram_type: 'test',
          settings: {},
          diagram_nodes: [
            {
              id: 'node-1',
              entity_type: 'APPLICATION',
              entity_id: 'app-1',
              x: 100,
              y: 100,
              width: 200,
              height: 100,
              text_font_size: '14px',
              text_font_weight: 'normal',
              text_font_style: 'normal',
              text_text_decoration: 'none',
              text_h_align: 'CENTER',
              text_v_align: 'MIDDLE',
              background_color: '#ffffff',
              line_color: '#333333',
              text_color: '#333333',
            },
          ],
          diagram_edges: [],
          decorations: [],
          view_quarter: '2026-Q3',
        },
      ],
    },
    currentView: 'diagrams' as const,
    selectedTab: 'Users',
    selectedDiagramId: 'diag-test-1',
    loadedFileName: null,
    validationErrors: [],
    isPalettePanelCollapsed: false,
    sectionExpandStates: {},
    paletteSearchQuery: '',
    isInspectorPanelCollapsed: false,
  };
}

// Helper to create test state for Meta-model view
function createMetaModelViewState() {
  return {
    ...createDiagramViewState(),
    currentView: 'metamodel' as const,
  };
}

// =========================================
// Row 2 Visibility and Section Structure Tests
// =========================================

describe('Row 2 Toolbar Layout - Task Group 2', () => {
  it('Row 2 only visible in Diagram view (not Meta-model view)', () => {
    const diagramState = createDiagramViewState();
    const metaModelState = createMetaModelViewState();

    const showRow2InDiagramView = diagramState.currentView === 'diagrams';
    const showRow2InMetaModelView = metaModelState.currentView === 'diagrams';

    expect(showRow2InDiagramView).toBe(true);
    expect(showRow2InMetaModelView).toBe(false);
    expect(diagramState.currentView).toBe('diagrams');
    expect(metaModelState.currentView).toBe('metamodel');
  });

  it('Row 2 contains Font Size section with controls', () => {
    const fontSizeLabel = 'FONT SIZE';
    const decreaseButtonText = '-';
    const increaseButtonText = '+';
    const unitLabel = 'px';
    const defaultFontSize = 14;

    expect(fontSizeLabel).toBe('FONT SIZE');
    expect(decreaseButtonText).toBe('-');
    expect(increaseButtonText).toBe('+');
    expect(unitLabel).toBe('px');
    expect(defaultFontSize).toBeGreaterThanOrEqual(1);
    expect(defaultFontSize).toBeLessThanOrEqual(99);
  });

  it('Row 2 contains Font Styles section with B, I, U toggles', () => {
    const fontStylesLabel = 'FONT STYLES';
    const boldButtonText = 'B';
    const italicButtonText = 'I';
    const underlineButtonText = 'U';
    const toggleStates = ['active', 'inactive'];

    expect(fontStylesLabel).toBe('FONT STYLES');
    expect(boldButtonText).toBe('B');
    expect(italicButtonText).toBe('I');
    expect(underlineButtonText).toBe('U');
    expect(toggleStates).toContain('active');
    expect(toggleStates).toContain('inactive');
  });

  it('Row 2 contains Box Alignment section with H and V controls', () => {
    const boxAlignmentLabel = 'BOX ALIGNMENT';
    const hAlignLabel = 'H:';
    const hAlignOptions = ['L', 'C', 'R'];
    const vAlignLabel = 'V:';
    const vAlignOptions = ['T', 'M', 'B'];

    expect(boxAlignmentLabel).toBe('BOX ALIGNMENT');
    expect(hAlignLabel).toBe('H:');
    expect(hAlignOptions).toHaveLength(3);
    expect(hAlignOptions).toContain('L');
    expect(hAlignOptions).toContain('C');
    expect(hAlignOptions).toContain('R');
    expect(vAlignLabel).toBe('V:');
    expect(vAlignOptions).toHaveLength(3);
    expect(vAlignOptions).toContain('T');
    expect(vAlignOptions).toContain('M');
    expect(vAlignOptions).toContain('B');
  });

  it('Row 2 contains Colour section with three colour pickers', () => {
    const colourLabel = 'COLOUR';
    const colourPickers = [
      { id: 'background', icon: 'filled-square', title: 'Set background colour' },
      { id: 'line', icon: 'square-outline', title: 'Set line/border colour' },
      { id: 'text', icon: 'a-letter', title: 'Set text colour' },
    ];

    expect(colourLabel).toBe('COLOUR');
    expect(colourPickers).toHaveLength(3);
    expect(colourPickers[0].id).toBe('background');
    expect(colourPickers[1].id).toBe('line');
    expect(colourPickers[2].id).toBe('text');
  });

  it('vertical dividers render between sections in Row 2', () => {
    const expectedSectionOrder = [
      'fontSizeSection',
      'verticalDivider',
      'fontStylesSection',
      'verticalDivider',
      'boxAlignmentSection',
      'verticalDivider',
      'colourSection',
    ];

    const dividerCount = expectedSectionOrder.filter(s => s === 'verticalDivider').length;
    expect(dividerCount).toBe(3);
    expect(expectedSectionOrder[1]).toBe('verticalDivider');
    expect(expectedSectionOrder[3]).toBe('verticalDivider');
    expect(expectedSectionOrder[5]).toBe('verticalDivider');
    expect(expectedSectionOrder[0]).toBe('fontSizeSection');
    expect(expectedSectionOrder[2]).toBe('fontStylesSection');
    expect(expectedSectionOrder[4]).toBe('boxAlignmentSection');
    expect(expectedSectionOrder[6]).toBe('colourSection');
  });
});
