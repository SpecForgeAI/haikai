/**
 * DiagramAutocomplete Component Tests
 *
 * Spec: Diagrams Toolbar UX Refresh
 * Task Group 2: DiagramAutocomplete Component (Task 2.1)
 *
 * Tests cover:
 * 1. Renders with the currently selected diagram name displayed in the input
 * 2. Clicking the input opens the dropdown showing all diagrams grouped by DiagramType
 * 3. Typing in the input filters diagrams by case-insensitive substring match; groups with zero matches are hidden
 * 4. Selecting a diagram from the dropdown calls the onSelect callback with the diagram ID
 * 5. When diagrams is empty, input is disabled and shows placeholder "No diagrams defined"
 * 6. Pressing Escape closes the dropdown without changing selection
 *
 * Note: Group headers render DIAGRAM_TYPE_LABELS values (e.g. "General", "ER", "UI Workflow").
 * The CSS text-transform: uppercase makes them appear uppercase visually, but the DOM text
 * content uses the original DIAGRAM_TYPE_LABELS values.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DiagramAutocomplete } from '../components/DiagramsView/DiagramAutocomplete';
import { Diagram } from '../types/model';

// ============================================================================
// Test Data Factory
// ============================================================================

function createTestDiagrams(): Diagram[] {
  return [
    {
      id: 'diag-1',
      name: 'System Overview',
      description: '',
      diagram_type: 'General',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-2',
      name: 'Data Model',
      description: '',
      diagram_type: 'ER',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-3',
      name: 'Login Flow',
      description: '',
      diagram_type: 'Sequence',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-4',
      name: 'Order Processing',
      description: '',
      diagram_type: 'Activity',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-5',
      name: 'Session States',
      description: '',
      diagram_type: 'State',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-6',
      name: 'Navigation Flow',
      description: '',
      diagram_type: 'UI_Workflow',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-7',
      name: 'Dashboard Screen',
      description: '',
      diagram_type: 'UI_SCREEN',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-8',
      name: 'Another General Diagram',
      description: '',
      diagram_type: 'General',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
  ];
}

// ============================================================================
// Tests
// ============================================================================

describe('DiagramAutocomplete', () => {
  describe('Test 1: Renders with the currently selected diagram name displayed in the input', () => {
    it('should display the selected diagram name in the input field', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-2"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('Data Model');
    });

    it('should show empty input when no diagram is selected', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId={null}
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  describe('Test 2: Clicking the input opens the dropdown showing all diagrams grouped by DiagramType', () => {
    it('should open dropdown with grouped diagrams on click', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // Check group headers are visible (DOM text uses DIAGRAM_TYPE_LABELS values;
      // CSS text-transform: uppercase only affects visual rendering)
      expect(screen.getByText('General')).toBeInTheDocument();
      expect(screen.getByText('ER')).toBeInTheDocument();
      expect(screen.getByText('Sequence')).toBeInTheDocument();
      expect(screen.getByText('Activity')).toBeInTheDocument();
      expect(screen.getByText('State')).toBeInTheDocument();
      expect(screen.getByText('UI Workflow')).toBeInTheDocument();
      expect(screen.getByText('UI Screen')).toBeInTheDocument();

      // Check diagram names are visible
      expect(screen.getByText('System Overview')).toBeInTheDocument();
      expect(screen.getByText('Data Model')).toBeInTheDocument();
      expect(screen.getByText('Login Flow')).toBeInTheDocument();
      expect(screen.getByText('Order Processing')).toBeInTheDocument();
      expect(screen.getByText('Session States')).toBeInTheDocument();
      expect(screen.getByText('Navigation Flow')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Screen')).toBeInTheDocument();
      expect(screen.getByText('Another General Diagram')).toBeInTheDocument();
    });
  });

  describe('Test 3: Typing in the input filters diagrams by case-insensitive substring match; groups with zero matches are hidden', () => {
    it('should filter diagrams and hide empty groups when typing', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // Type a search term that matches only "Data Model" (ER group)
      fireEvent.change(input, { target: { value: 'data' } });

      // ER group header should be visible since "Data Model" matches
      expect(screen.getByText('ER')).toBeInTheDocument();
      expect(screen.getByText('Data Model')).toBeInTheDocument();

      // Other group headers should NOT be visible (no matching diagrams)
      expect(screen.queryByText('General')).not.toBeInTheDocument();
      expect(screen.queryByText('Sequence')).not.toBeInTheDocument();
      expect(screen.queryByText('Activity')).not.toBeInTheDocument();
      expect(screen.queryByText('State')).not.toBeInTheDocument();
      expect(screen.queryByText('UI Workflow')).not.toBeInTheDocument();
      expect(screen.queryByText('UI Screen')).not.toBeInTheDocument();
    });

    it('should be case-insensitive when filtering', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // Type with mixed case
      fireEvent.change(input, { target: { value: 'LOGIN' } });

      // Should still find "Login Flow"
      expect(screen.getByText('Login Flow')).toBeInTheDocument();
      expect(screen.getByText('Sequence')).toBeInTheDocument();
    });

    it('should show no-results message when nothing matches', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      fireEvent.change(input, { target: { value: 'zzzznonexistent' } });

      expect(screen.getByText('No matching diagrams')).toBeInTheDocument();
    });
  });

  describe('Test 4: Selecting a diagram from the dropdown calls the onSelect callback with the diagram ID', () => {
    it('should call onSelect with the diagram ID when a diagram is clicked', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // Click on "Data Model" diagram
      fireEvent.click(screen.getByText('Data Model'));

      expect(onSelect).toHaveBeenCalledWith('diag-2');
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('should close the dropdown after selection', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // Click on "Data Model" diagram
      fireEvent.click(screen.getByText('Data Model'));

      // Dropdown should be closed - group headers should not be visible
      expect(screen.queryByTestId('diagram-autocomplete-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('Test 5: When diagrams is empty, input is disabled and shows placeholder "No diagrams defined"', () => {
    it('should disable input and show placeholder when diagrams array is empty', () => {
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={[]}
          selectedDiagramId={null}
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input).toBeDisabled();
      expect(input.placeholder).toBe('No diagrams defined');
    });

    it('should not open dropdown when disabled input is clicked', () => {
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={[]}
          selectedDiagramId={null}
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // No dropdown should appear
      expect(screen.queryByTestId('diagram-autocomplete-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('Test 6: Pressing Escape closes the dropdown without changing selection', () => {
    it('should close dropdown on Escape key without calling onSelect', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // Verify dropdown is open
      expect(screen.getByTestId('diagram-autocomplete-dropdown')).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(input, { key: 'Escape' });

      // Dropdown should be closed
      expect(screen.queryByTestId('diagram-autocomplete-dropdown')).not.toBeInTheDocument();

      // onSelect should NOT have been called
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('should select first visible result on Enter key', () => {
      const diagrams = createTestDiagrams();
      const onSelect = vi.fn();

      render(
        <DiagramAutocomplete
          diagrams={diagrams}
          selectedDiagramId="diag-1"
          onSelect={onSelect}
        />
      );

      const input = screen.getByRole('textbox');
      fireEvent.click(input);

      // Filter to show only "Data Model"
      fireEvent.change(input, { target: { value: 'Data' } });

      // Press Enter
      fireEvent.keyDown(input, { key: 'Enter' });

      // Should select the first (and only) visible result
      expect(onSelect).toHaveBeenCalledWith('diag-2');
    });
  });
});
