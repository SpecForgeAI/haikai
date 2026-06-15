/**
 * Tests for CherryPickMergeModal Component
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 5: Cherry-Pick Merge Modal (Domain-Tab UI)
 *
 * 8 focused tests covering:
 * 1. Modal renders 6 domain tabs matching ALL_DOMAINS plus Diagrams tab
 * 2. Each entity category shows "Select All" checkbox with entity count
 * 3. Empty categories (zero items in import) are hidden
 * 4. Three-state checkbox logic uses deriveCheckboxState for indeterminate states
 * 5. "Merge Selected" button is disabled when zero items are checked
 * 6. Diagram checkbox auto-selects referenced entities from diagram_nodes[].entity_id
 * 7. Unchecking a diagram un-selects auto-selected entities not referenced by any other checked diagram
 * 8. "Merge Selected" triggers resolveIdConflicts then calls onMergeComplete with summary
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CherryPickMergeModal } from '../components/Import/CherryPickMergeModal';
import type { CherryPickData, MergeableData } from '../utils/importMergeUtils';
import type { ArchitectureModel } from '../types/model';
import { emptyModel } from '../config/defaults';

// Mock resolveIdConflicts and buildMergeSummary
vi.mock('../utils/importMergeUtils', async () => {
  const actual = await vi.importActual('../utils/importMergeUtils');
  return {
    ...actual,
    resolveIdConflicts: vi.fn((data: MergeableData) => data), // pass through
    buildMergeSummary: vi.fn(() => 'Merged 2 Applications, 1 Services'),
  };
});

// ============================================================================
// Test Data
// ============================================================================

const sampleCherryPickData: CherryPickData = {
  entities: {
    applications: [
      { id: 'app-1', name: 'App One' },
      { id: 'app-2', name: 'App Two' },
    ],
    services: [
      { id: 'svc-1', name: 'Service One' },
    ],
    // Note: no 'business_users', 'interfaces', etc. -- those empty categories should be hidden
  },
  relationships: {
    application_point_business_points: [
      { id: 'rel-1', name: 'Rel One' },
    ],
  },
  diagrams: [
    {
      id: 'diag-1',
      name: 'Diagram One',
      diagram_nodes: [
        { id: 'node-1', entity_id: 'app-1', entity_type: 'Application' },
        { id: 'node-2', entity_id: 'svc-1', entity_type: 'Service' },
      ],
      diagram_edges: [],
      diagram_type: 'Custom',
      description: '',
      settings: {},
    } as unknown as import('../utils/importMergeUtils').NamedItem,
  ],
};

const sampleCurrentModel: ArchitectureModel = JSON.parse(JSON.stringify(emptyModel));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  cherryPickData: sampleCherryPickData,
  currentModel: sampleCurrentModel,
  onMergeComplete: vi.fn(),
  includeDatabase: false,
};

describe('CherryPickMergeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Modal renders 6 domain tabs matching ALL_DOMAINS plus Diagrams tab
  // ---------------------------------------------------------------------------
  it('renders 6 domain tabs matching ALL_DOMAINS plus Diagrams tab', () => {
    render(<CherryPickMergeModal {...defaultProps} />);

    // Modal should be visible
    expect(screen.getByTestId('cherry-pick-merge-modal')).toBeTruthy();

    // 6 domain tabs
    expect(screen.getByTestId('domain-tab-business')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-application')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-data')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-behavioural')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-ui')).toBeTruthy();
    expect(screen.getByTestId('domain-tab-infrastructure')).toBeTruthy();

    // Diagrams tab (present because sampleCherryPickData has diagrams)
    expect(screen.getByTestId('domain-tab-diagrams')).toBeTruthy();

    // Total: 7 tabs
    const tabStrip = screen.getByTestId('domain-tab-strip');
    const tabs = tabStrip.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(7);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Each entity category shows "Select All" checkbox with entity count
  // ---------------------------------------------------------------------------
  it('shows Select All checkbox with entity count for each category', () => {
    render(<CherryPickMergeModal {...defaultProps} />);

    // Switch to Application tab (has applications and services)
    fireEvent.click(screen.getByTestId('domain-tab-application'));

    // Applications category should show with count badge "(2)"
    const applicationsGroup = screen.getByTestId('category-group-applications');
    expect(applicationsGroup).toBeTruthy();
    expect(applicationsGroup.textContent).toContain('Applications');
    expect(applicationsGroup.textContent).toContain('(2)');

    // Should have a Select All checkbox
    const selectAllCheckbox = screen.getByTestId('select-all-applications');
    expect(selectAllCheckbox).toBeTruthy();

    // Services category should show with count badge "(1)"
    const servicesGroup = screen.getByTestId('category-group-services');
    expect(servicesGroup).toBeTruthy();
    expect(servicesGroup.textContent).toContain('Services');
    expect(servicesGroup.textContent).toContain('(1)');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Empty categories (zero items in import) are hidden
  // ---------------------------------------------------------------------------
  it('hides empty categories that have zero items in import', () => {
    render(<CherryPickMergeModal {...defaultProps} />);

    // Switch to Application tab
    fireEvent.click(screen.getByTestId('domain-tab-application'));

    // 'interfaces' is in the Application domain but has zero items in our test data
    expect(screen.queryByTestId('category-group-interfaces')).toBeNull();

    // 'endpoints' is also in Application domain but has no items
    expect(screen.queryByTestId('category-group-endpoints')).toBeNull();

    // 'app_components' is in Application domain but has no items
    expect(screen.queryByTestId('category-group-app_components')).toBeNull();

    // Switch to Business tab - should have no entity groups since we have no business data
    fireEvent.click(screen.getByTestId('domain-tab-business'));
    expect(screen.queryByTestId('category-group-business_users')).toBeNull();
    expect(screen.queryByTestId('category-group-business_processes')).toBeNull();
    expect(screen.queryByTestId('category-group-process_activities')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 4: Three-state checkbox logic uses deriveCheckboxState for indeterminate
  // ---------------------------------------------------------------------------
  it('uses three-state checkbox logic with indeterminate state', () => {
    render(<CherryPickMergeModal {...defaultProps} />);

    // Switch to Application tab
    fireEvent.click(screen.getByTestId('domain-tab-application'));

    const selectAllCheckbox = screen.getByTestId('select-all-applications') as HTMLInputElement;

    // Initially unchecked
    expect(selectAllCheckbox.checked).toBe(false);
    expect(selectAllCheckbox.indeterminate).toBe(false);

    // Check only one of the two applications -> indeterminate
    fireEvent.click(screen.getByTestId('checkbox-app-1'));

    // Re-query the select all checkbox after state change
    const selectAllAfterPartial = screen.getByTestId('select-all-applications') as HTMLInputElement;
    expect(selectAllAfterPartial.indeterminate).toBe(true);
    expect(selectAllAfterPartial.checked).toBe(false);

    // Check the second application -> fully checked
    fireEvent.click(screen.getByTestId('checkbox-app-2'));

    const selectAllAfterAll = screen.getByTestId('select-all-applications') as HTMLInputElement;
    expect(selectAllAfterAll.checked).toBe(true);
    expect(selectAllAfterAll.indeterminate).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 5: "Merge Selected" button is disabled when zero items are checked
  // ---------------------------------------------------------------------------
  it('disables Merge Selected button when zero items are checked', () => {
    render(<CherryPickMergeModal {...defaultProps} />);

    const mergeButton = screen.getByTestId('merge-selected-button') as HTMLButtonElement;

    // Initially, no items are selected, so button should be disabled
    expect(mergeButton.disabled).toBe(true);

    // Select an entity
    fireEvent.click(screen.getByTestId('domain-tab-application'));
    fireEvent.click(screen.getByTestId('checkbox-app-1'));

    // Button should now be enabled
    const mergeButtonAfter = screen.getByTestId('merge-selected-button') as HTMLButtonElement;
    expect(mergeButtonAfter.disabled).toBe(false);

    // Uncheck the entity
    fireEvent.click(screen.getByTestId('checkbox-app-1'));

    // Button should be disabled again
    const mergeButtonFinal = screen.getByTestId('merge-selected-button') as HTMLButtonElement;
    expect(mergeButtonFinal.disabled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Diagram checkbox auto-selects referenced entities from diagram_nodes
  // ---------------------------------------------------------------------------
  it('auto-selects referenced entities when a diagram is checked', () => {
    render(<CherryPickMergeModal {...defaultProps} />);

    // Switch to Diagrams tab and check the diagram
    fireEvent.click(screen.getByTestId('domain-tab-diagrams'));
    fireEvent.click(screen.getByTestId('checkbox-diagram-diag-1'));

    // Diagram should be checked
    const diagramCheckbox = screen.getByTestId('checkbox-diagram-diag-1') as HTMLInputElement;
    expect(diagramCheckbox.checked).toBe(true);

    // Switch to Application tab to verify auto-selected entities
    fireEvent.click(screen.getByTestId('domain-tab-application'));

    // app-1 should be auto-selected (referenced by diagram_nodes)
    const appCheckbox = screen.getByTestId('checkbox-app-1') as HTMLInputElement;
    expect(appCheckbox.checked).toBe(true);

    // svc-1 should also be auto-selected
    const svcCheckbox = screen.getByTestId('checkbox-svc-1') as HTMLInputElement;
    expect(svcCheckbox.checked).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Unchecking a diagram un-selects auto-selected entities not
  //         referenced by any other checked diagram
  // ---------------------------------------------------------------------------
  it('un-selects auto-selected entities when diagram is unchecked and no other diagram references them', () => {
    render(<CherryPickMergeModal {...defaultProps} />);

    // Check the diagram
    fireEvent.click(screen.getByTestId('domain-tab-diagrams'));
    fireEvent.click(screen.getByTestId('checkbox-diagram-diag-1'));

    // Verify entities are auto-selected
    fireEvent.click(screen.getByTestId('domain-tab-application'));
    expect((screen.getByTestId('checkbox-app-1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('checkbox-svc-1') as HTMLInputElement).checked).toBe(true);

    // Now uncheck the diagram
    fireEvent.click(screen.getByTestId('domain-tab-diagrams'));
    fireEvent.click(screen.getByTestId('checkbox-diagram-diag-1'));

    // Diagram should be unchecked
    expect((screen.getByTestId('checkbox-diagram-diag-1') as HTMLInputElement).checked).toBe(false);

    // Auto-selected entities should be unchecked since no other diagram references them
    fireEvent.click(screen.getByTestId('domain-tab-application'));
    expect((screen.getByTestId('checkbox-app-1') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('checkbox-svc-1') as HTMLInputElement).checked).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 8: "Merge Selected" triggers resolveIdConflicts then calls
  //         onMergeComplete with resolved data and summary
  // ---------------------------------------------------------------------------
  it('triggers resolveIdConflicts then calls onMergeComplete on merge', async () => {
    const { resolveIdConflicts: mockResolve, buildMergeSummary: mockSummary } =
      await import('../utils/importMergeUtils');

    const onMergeComplete = vi.fn();
    const onClose = vi.fn();

    render(
      <CherryPickMergeModal
        {...defaultProps}
        onMergeComplete={onMergeComplete}
        onClose={onClose}
      />
    );

    // Select an entity so merge button is enabled
    fireEvent.click(screen.getByTestId('domain-tab-application'));
    fireEvent.click(screen.getByTestId('checkbox-app-1'));

    // Click Merge Selected
    fireEvent.click(screen.getByTestId('merge-selected-button'));

    // resolveIdConflicts should have been called
    expect(mockResolve).toHaveBeenCalledTimes(1);
    // It should have been called with MergeableData containing app-1 and the currentModel
    const callArgs = (mockResolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0].entities).toHaveProperty('applications');
    expect(callArgs[1]).toBe(sampleCurrentModel);

    // buildMergeSummary should have been called
    expect(mockSummary).toHaveBeenCalledTimes(1);

    // onMergeComplete should have been called with the resolved data and summary string
    expect(onMergeComplete).toHaveBeenCalledTimes(1);
    const [resolvedData, summary] = onMergeComplete.mock.calls[0];
    expect(resolvedData.entities).toHaveProperty('applications');
    expect(summary).toBe('Merged 2 Applications, 1 Services');

    // Modal should be closed
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
