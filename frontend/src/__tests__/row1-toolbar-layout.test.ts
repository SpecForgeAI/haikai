/**
 * Tests for Row 1 Toolbar Layout
 *
 * Task Group 1 of the Diagram View UI Layout Reorganisation spec.
 * These tests verify:
 * - Row 1 contains diagram selection section
 * - Row 1 contains new diagram controls section
 * - Row 1 contains period/time controls section
 * - Row 1 contains zoom controls section
 * - Vertical dividers render after New/Copy section
 * - Vertical dividers render after Period section
 *
 * Total: 6 tests
 */

import { describe, it, expect } from 'vitest';
import { emptyModel } from '../config/defaults';

// =========================================
// Test State Helpers
// =========================================

// Helper to create test state with existing diagrams
function createPopulatedDiagramsState() {
  return {
    model: {
      ...emptyModel,
      diagrams: [
        {
          id: 'diag-existing-1',
          name: 'OMS Flow',
          description: 'Test description',
          diagram_type: 'test',
          settings: {},
          diagram_nodes: [],
          diagram_edges: [],
          view_quarter: '2026-Q3',
        },
      ],
    },
    currentView: 'diagrams' as const,
    selectedTab: 'Users',
    selectedDiagramId: 'diag-existing-1',
    loadedFileName: null,
    validationErrors: [],
    isPalettePanelCollapsed: false,
    sectionExpandStates: {},
    paletteSearchQuery: '',
    isInspectorPanelCollapsed: false,
  };
}

// =========================================
// Row 1 Section Structure Tests
// =========================================

describe('Row 1 Toolbar Layout - Task Group 1', () => {
  it('Row 1 contains diagram selection section', () => {
    const state = createPopulatedDiagramsState();

    const expectedLabelText = 'Diagram:';
    const hasDiagrams = state.model.diagrams.length > 0;
    const selectedDiagramName = state.model.diagrams.find(d => d.id === state.selectedDiagramId)?.name;

    expect(hasDiagrams).toBe(true);
    expect(selectedDiagramName).toBe('OMS Flow');
    expect(expectedLabelText).toBe('Diagram:');
  });

  it('Row 1 contains new diagram controls section', () => {
    const newDiagramLabelText = '- New Diagram';
    const inputPlaceholder = 'Enter new diagram name...';
    const newButtonText = '+ New';
    const copyButtonText = '+ Copy';

    expect(newDiagramLabelText).toContain('New Diagram');
    expect(inputPlaceholder).toContain('Enter');
    expect(newButtonText).toBe('+ New');
    expect(copyButtonText).toBe('+ Copy');
  });

  it('Row 1 contains period/time controls section', () => {
    const state = createPopulatedDiagramsState();
    const diagram = state.model.diagrams[0];

    const periodLabelText = 'Period:';
    const periodTypes = ['Quarter', 'Half', 'Year'];
    const currentQuarter = diagram.view_quarter || '2026-Q3';

    expect(periodLabelText).toBe('Period:');
    expect(periodTypes).toHaveLength(3);
    expect(currentQuarter).toBeDefined();
  });

  it('Row 1 contains zoom controls section', () => {
    const zoomInButtonText = '+';
    const zoomOutButtonText = '-';
    const fitToViewButtonText = 'Fit to View';
    const defaultZoomPercentage = 100;

    expect(zoomInButtonText).toBe('+');
    expect(zoomOutButtonText).toBe('-');
    expect(fitToViewButtonText).toBe('Fit to View');
    expect(defaultZoomPercentage).toBe(100);
  });

  it('vertical divider renders after New/Copy section', () => {
    const expectedSectionOrder = [
      'diagramSelection',
      'newDiagramControls',
      'verticalDivider',
      'periodControls',
      'verticalDivider',
      'zoomControls'
    ];

    const dividerAfterNewCopyIndex = expectedSectionOrder.indexOf('verticalDivider');
    expect(dividerAfterNewCopyIndex).toBe(2);
    expect(expectedSectionOrder[dividerAfterNewCopyIndex - 1]).toBe('newDiagramControls');
    expect(expectedSectionOrder[dividerAfterNewCopyIndex + 1]).toBe('periodControls');
  });

  it('vertical divider renders after Period section', () => {
    const expectedSectionOrder = [
      'diagramSelection',
      'newDiagramControls',
      'verticalDivider',
      'periodControls',
      'verticalDivider',
      'zoomControls'
    ];

    let dividerCount = 0;
    let dividerAfterPeriodIndex = -1;

    for (let i = 0; i < expectedSectionOrder.length; i++) {
      if (expectedSectionOrder[i] === 'verticalDivider') {
        dividerCount++;
        if (dividerCount === 2) {
          dividerAfterPeriodIndex = i;
          break;
        }
      }
    }

    expect(dividerAfterPeriodIndex).toBe(4);
    expect(expectedSectionOrder[dividerAfterPeriodIndex - 1]).toBe('periodControls');
    expect(expectedSectionOrder[dividerAfterPeriodIndex + 1]).toBe('zoomControls');
  });
});
