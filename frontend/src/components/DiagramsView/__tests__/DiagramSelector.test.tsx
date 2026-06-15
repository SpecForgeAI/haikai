/**
 * DiagramSelector Toolbar Tests
 *
 * Spec 2026-03-05: Diagrams Toolbar UX Refresh
 * Task Group 7, Task 7.1: Write 5 focused tests for the refactored DiagramSelector toolbar
 *
 * Tests verify:
 * - Test 1: Toolbar renders with "Search:" label, DiagramAutocomplete, and four buttons (New, Copy, Rename, Delete)
 * - Test 2: Copy, Rename, and Delete buttons are disabled when selectedDiagramId is null; New is always enabled
 * - Test 3: Clicking "New" opens NewDiagramModal; submitting dispatches ADD_DIAGRAM with generated ID and closes modal
 * - Test 4: Clicking "Copy" (when diagram selected) opens CopyDiagramModal; submitting deep-copies the selected diagram,
 *           assigns new ID, preserves diagram_type, and dispatches ADD_DIAGRAM
 * - Test 5: Clicking "Delete" (when diagram selected) opens DeleteDiagramConfirmModal; confirming dispatches DELETE_DIAGRAM
 *           with the selected diagram ID
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DiagramSelector } from '../DiagramSelector';
import type { Diagram } from '../../../types/model';
import type { AppState, AppAction } from '../../../contexts/ArchitectureContext';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

// ============================================================================
// Mocks
// ============================================================================

// Mock the ArchitectureContext hooks
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

// Mock generatePrefixedId to produce predictable IDs
vi.mock('../../../utils/idGenerator', () => ({
  generatePrefixedId: vi.fn(() => 'diag-test-12345'),
}));

// ============================================================================
// Test Data
// ============================================================================

function createTestDiagrams(): Diagram[] {
  return [
    {
      id: 'diag-1',
      name: 'System Overview',
      description: 'A general overview diagram',
      diagram_type: 'General',
      settings: {},
      diagram_nodes: [{ id: 'node-1', entity_id: 'app-1', entity_type: 'applications', pos_x: 100, pos_y: 200, width: 150, height: 80 }],
      diagram_edges: [],
    },
    {
      id: 'diag-2',
      name: 'Data Model',
      description: 'An ER diagram',
      diagram_type: 'ER',
      settings: { zoom: 1.5 },
      diagram_nodes: [],
      diagram_edges: [],
    },
    {
      id: 'diag-3',
      name: 'Login Flow',
      description: 'A sequence diagram',
      diagram_type: 'Sequence',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    },
  ];
}

function createMockState(overrides?: Partial<AppState>): AppState {
  const diagrams = createTestDiagrams();
  return {
    model: {
      diagrams,
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
// Tests
// ============================================================================

describe('DiagramSelector Toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = createMockState();
  });

  // --------------------------------------------------------------------------
  // Test 1: Toolbar renders with "Search:" label, DiagramAutocomplete, and four buttons
  // --------------------------------------------------------------------------
  it('renders with "Search:" label, DiagramAutocomplete, and four buttons (New, Copy, Rename, Delete)', () => {
    renderWithRouter(<DiagramSelector />);

    // "Search:" label should be visible
    expect(screen.getByText('Search:')).toBeInTheDocument();

    // DiagramAutocomplete input should be present
    expect(screen.getByTestId('diagram-autocomplete-input')).toBeInTheDocument();

    // Four action buttons should be visible
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: Copy, Rename, and Delete buttons are disabled when selectedDiagramId is null; New is always enabled
  // --------------------------------------------------------------------------
  it('disables Copy, Rename, and Delete when no diagram is selected; New is always enabled', () => {
    mockState = createMockState({ selectedDiagramId: null });

    renderWithRouter(<DiagramSelector />);

    // New should always be enabled
    const newButton = screen.getByText('New');
    expect(newButton.closest('button')).not.toBeDisabled();

    // Copy, Rename, Delete should be disabled
    const copyButton = screen.getByText('Copy');
    expect(copyButton.closest('button')).toBeDisabled();

    const renameButton = screen.getByText('Rename');
    expect(renameButton.closest('button')).toBeDisabled();

    const deleteButton = screen.getByText('Delete');
    expect(deleteButton.closest('button')).toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // Test 3: Clicking "New" opens NewDiagramModal; submitting dispatches ADD_DIAGRAM
  // --------------------------------------------------------------------------
  it('opens NewDiagramModal on clicking "New"; submitting dispatches ADD_DIAGRAM with generated ID and closes modal', () => {
    renderWithRouter(<DiagramSelector />);

    // Click "New" button
    fireEvent.click(screen.getByText('New'));

    // NewDiagramModal should be visible (title "Create New Diagram")
    expect(screen.getByText('Create New Diagram')).toBeInTheDocument();

    // Fill in a diagram name
    const nameInput = screen.getByTestId('new-diagram-name-input');
    fireEvent.change(nameInput, { target: { value: 'My New Diagram' } });

    // Select a diagram type
    const typeSelect = screen.getByTestId('new-diagram-type-select');
    fireEvent.change(typeSelect, { target: { value: 'Sequence' } });

    // Click Create
    fireEvent.click(screen.getByTestId('new-diagram-create-button'));

    // Should dispatch ADD_DIAGRAM with generated ID
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'ADD_DIAGRAM',
      payload: {
        id: 'diag-test-12345',
        name: 'My New Diagram',
        description: '',
        diagram_type: 'Sequence',
        settings: {},
        diagram_nodes: [],
        diagram_edges: [],
      },
    });

    // Modal should be closed (title "Create New Diagram" should not be visible)
    expect(screen.queryByText('Create New Diagram')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Clicking "Copy" opens CopyDiagramModal; submitting deep-copies the selected diagram
  // --------------------------------------------------------------------------
  it('opens CopyDiagramModal on clicking "Copy"; submitting deep-copies the selected diagram, assigns new ID, preserves diagram_type, and dispatches ADD_DIAGRAM', () => {
    renderWithRouter(<DiagramSelector />);

    // Click "Copy" button
    fireEvent.click(screen.getByText('Copy'));

    // CopyDiagramModal should be visible (title "Copy Diagram")
    expect(screen.getByText('Copy Diagram')).toBeInTheDocument();

    // Name input should be pre-populated with "[OriginalName] (Copy)"
    const nameInput = screen.getByTestId('copy-diagram-name-input');
    expect(nameInput).toHaveValue('System Overview (Copy)');

    // Change the name to something valid
    fireEvent.change(nameInput, { target: { value: 'System Overview Backup' } });

    // Click Create
    fireEvent.click(screen.getByTestId('modal-create-button'));

    // Should dispatch ADD_DIAGRAM with a deep-copied diagram
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'ADD_DIAGRAM',
      payload: expect.objectContaining({
        id: 'diag-test-12345',
        name: 'System Overview Backup',
        description: 'A general overview diagram',
        diagram_type: 'General',  // Preserved from source
        settings: {},
        diagram_nodes: [{ id: 'node-1', entity_id: 'app-1', entity_type: 'applications', pos_x: 100, pos_y: 200, width: 150, height: 80 }],
        diagram_edges: [],
      }),
    });

    // Modal should be closed
    expect(screen.queryByText('Copy Diagram')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 5: Clicking "Delete" opens DeleteDiagramConfirmModal; confirming dispatches DELETE_DIAGRAM
  // --------------------------------------------------------------------------
  it('opens DeleteDiagramConfirmModal on clicking "Delete"; confirming dispatches DELETE_DIAGRAM with the selected diagram ID', () => {
    renderWithRouter(<DiagramSelector />);

    // Click "Delete" button
    fireEvent.click(screen.getByText('Delete'));

    // DeleteDiagramConfirmModal should be visible
    expect(screen.getByText('Are you sure you want to permanently delete this diagram?')).toBeInTheDocument();

    // Click "Delete" (confirm) button in the modal
    fireEvent.click(screen.getByTestId('modal-delete-button'));

    // Should dispatch DELETE_DIAGRAM with the selected diagram ID
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'DELETE_DIAGRAM',
      payload: 'diag-1',
    });

    // Modal should be closed
    expect(screen.queryByText('Are you sure you want to permanently delete this diagram?')).not.toBeInTheDocument();
  });
});
