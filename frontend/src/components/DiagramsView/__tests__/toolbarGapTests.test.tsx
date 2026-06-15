/**
 * Toolbar UX Refresh - Gap Analysis Tests
 *
 * Spec 2026-03-05: Diagrams Toolbar UX Refresh
 * Task Group 8: Test Review and Gap Analysis (Task 8.3)
 *
 * These tests fill critical coverage gaps identified during the review
 * of the 34 existing tests from Task Groups 1-7.
 *
 * Gap 1: Diagrams with missing/null diagram_type default to "General" group
 * Gap 2: Rename flow integration - clicking Rename dispatches UPDATE_DIAGRAM
 * Gap 3: Copy/Rename/Delete buttons re-enable after selecting a diagram
 * Gap 4: Buttons are enabled when diagrams exist and one is selected (positive case)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DiagramAutocomplete } from '../DiagramAutocomplete';
import { DiagramSelector } from '../DiagramSelector';
import type { Diagram } from '../../../types/model';
import type { AppState } from '../../../contexts/ArchitectureContext';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Mocks for DiagramSelector tests (Gaps 2, 3, 4)
// ============================================================================

const mockDispatch = vi.fn();
let mockState: AppState;

// Harness: DiagramSelector reads useProject() (2026-05 routing/multi-arch work);
// stub the hook so rendering does not require a ProjectProvider.
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => ({ id: 'proj-1', name: 'Test Project' })),
}));

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => mockState,
  useArchitectureDispatch: () => mockDispatch,
}));

vi.mock('../../../utils/idGenerator', () => ({
  generatePrefixedId: vi.fn(() => 'diag-gap-test-001'),
}));

// ============================================================================
// Test Data Factories
// ============================================================================

function createMockState(overrides?: Partial<AppState>): AppState {
  return {
    model: {
      diagrams: [
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
      ],
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      business_user_business_points: [],
      application_point_business_points: [],
      interface_logical_entities: [],
      data_movements: [],
      package_sets: [],
      packages: [],
    } as any,
    currentView: 'diagrams',
    selectedTab: 'Users',
    selectedDiagramId: 'diag-1',
    loadedFileName: null,
    validationErrors: [],
    isPalettePanelCollapsed: false,
    sectionExpandStates: {},
    paletteSearchQuery: '',
    isInspectorPanelCollapsed: false,
    selectedDomain: 'business',
    relationshipCellLabels: {},
    ...overrides,
  } as AppState;
}

// ============================================================================
// Gap 1: Diagrams with missing/null diagram_type default to "General" group
// ============================================================================

describe('Gap: Diagrams with missing/null diagram_type default to General group', () => {
  it('should group diagrams with undefined diagram_type under the "General" group header', () => {
    const diagrams: Diagram[] = [
      {
        id: 'diag-no-type',
        name: 'Legacy Diagram',
        description: '',
        // diagram_type intentionally omitted (undefined)
        settings: {},
        diagram_nodes: [],
        diagram_edges: [],
      },
      {
        id: 'diag-explicit-er',
        name: 'ER Diagram',
        description: '',
        diagram_type: 'ER',
        settings: {},
        diagram_nodes: [],
        diagram_edges: [],
      },
    ];

    const onSelect = vi.fn();

    renderWithRouter(
      <DiagramAutocomplete
        diagrams={diagrams}
        selectedDiagramId="diag-no-type"
        onSelect={onSelect}
      />
    );

    // Open the dropdown
    const input = screen.getByRole('textbox');
    fireEvent.click(input);

    // "General" group header should appear (from getDiagramType defaulting undefined to 'General')
    expect(screen.getByText('General')).toBeInTheDocument();
    // "Legacy Diagram" should be listed under General
    expect(screen.getByText('Legacy Diagram')).toBeInTheDocument();

    // "ER" group header should also appear
    expect(screen.getByText('ER')).toBeInTheDocument();
    expect(screen.getByText('ER Diagram')).toBeInTheDocument();
  });
});

// ============================================================================
// Gap 2: Rename flow integration - DiagramSelector dispatches UPDATE_DIAGRAM
// ============================================================================

describe('Gap: Rename flow dispatches UPDATE_DIAGRAM with the new name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = createMockState();
  });

  it('opens RenameDiagramModal on clicking "Rename"; submitting dispatches UPDATE_DIAGRAM with the selected diagram ID and new name', () => {
    renderWithRouter(<DiagramSelector />);

    // Click the "Rename" button
    fireEvent.click(screen.getByText('Rename'));

    // RenameDiagramModal should be visible with title "Rename Diagram"
    expect(screen.getByText('Rename Diagram')).toBeInTheDocument();

    // The name input should be pre-populated with the current diagram name
    const nameInput = screen.getByTestId('rename-diagram-name-input');
    expect(nameInput).toHaveValue('System Overview');

    // Change the name
    fireEvent.change(nameInput, { target: { value: 'System Overview v2' } });

    // Click the Rename button in the modal
    fireEvent.click(screen.getByTestId('modal-rename-button'));

    // Should dispatch UPDATE_DIAGRAM with the diagram ID and new name
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_DIAGRAM',
      diagramId: 'diag-1',
      updates: { name: 'System Overview v2' },
    });

    // Modal should be closed
    expect(screen.queryByText('Rename Diagram')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Gap 3: Copy/Rename/Delete buttons re-enable when a diagram is selected
// ============================================================================

describe('Gap: Copy/Rename/Delete buttons are enabled when a diagram is selected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have Copy, Rename, Delete buttons enabled when selectedDiagramId is set and diagrams exist', () => {
    // State with a selected diagram
    mockState = createMockState({ selectedDiagramId: 'diag-1' });

    renderWithRouter(<DiagramSelector />);

    // All four buttons should exist
    const newButton = screen.getByText('New').closest('button');
    const copyButton = screen.getByText('Copy').closest('button');
    const renameButton = screen.getByText('Rename').closest('button');
    const deleteButton = screen.getByText('Delete').closest('button');

    // All should be enabled
    expect(newButton).not.toBeDisabled();
    expect(copyButton).not.toBeDisabled();
    expect(renameButton).not.toBeDisabled();
    expect(deleteButton).not.toBeDisabled();
  });

  it('should have Copy, Rename, Delete buttons disabled when diagrams array is empty', () => {
    // State with empty diagrams (simulating after last diagram is deleted)
    mockState = createMockState({
      selectedDiagramId: null,
      model: {
        diagrams: [],
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        business_user_business_points: [],
        application_point_business_points: [],
        interface_logical_entities: [],
        data_movements: [],
        package_sets: [],
        packages: [],
      } as any,
    });

    renderWithRouter(<DiagramSelector />);

    // New should still be enabled
    const newButton = screen.getByText('New').closest('button');
    expect(newButton).not.toBeDisabled();

    // Copy, Rename, Delete should be disabled
    const copyButton = screen.getByText('Copy').closest('button');
    const renameButton = screen.getByText('Rename').closest('button');
    const deleteButton = screen.getByText('Delete').closest('button');

    expect(copyButton).toBeDisabled();
    expect(renameButton).toBeDisabled();
    expect(deleteButton).toBeDisabled();

    // Autocomplete should show "No diagrams defined" placeholder
    const input = screen.getByTestId('diagram-autocomplete-input') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.placeholder).toBe('No diagrams defined');
  });
});
