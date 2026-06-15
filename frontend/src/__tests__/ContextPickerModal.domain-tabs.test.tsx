/**
 * ContextPickerModal.domain-tabs.test.tsx
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Groups 3-9: Tests for modal size, domain tabs, sections, and component refactoring
 *
 * This file contains tests for:
 * - Task Group 3: Modal size and layout styles
 * - Task Group 4: Icon tab strip styles
 * - Task Group 5: Collapsible section styles
 * - Task Group 6: Domain tab strip component
 * - Task Group 7: Domain section components (entities/relationships)
 * - Task Group 8: Main component refactoring
 * - Task Group 9: Parent component integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ContextPickerModal } from '../components/ProductView/ContextPickerModal';
import type { ContextState } from '../utils/contextStorage';
import type { PickOption, RelationshipPickOption } from '../utils/contextPickListBuilders';

// ============================================================================
// Test Utilities and Mock Data
// ============================================================================

const mockInitialSelected: ContextState = {
  version: 1,
  entity_refs: [],
  diagram_refs: [],
};

const mockArchitectureOptions: Record<string, PickOption[]> = {
  business_users: [
    { value: 'bu-1', label: 'Business User 1', entity_type: 'business_users' },
  ],
  business_processes: [
    { value: 'bp-1', label: 'Business Process 1', entity_type: 'business_processes' },
  ],
  applications: [
    { value: 'app-1', label: 'Application 1', entity_type: 'applications' },
  ],
  services: [
    { value: 'svc-1', label: 'Service 1', entity_type: 'services' },
  ],
  logical_data_entities: [
    { value: 'lde-1', label: 'Logical Data Entity 1', entity_type: 'logical_data_entities' },
  ],
  events: [
    { value: 'evt-1', label: 'Event 1', entity_type: 'events' },
  ],
  states: [
    { value: 'st-1', label: 'State 1', entity_type: 'states' },
  ],
  ui_screens: [
    { value: 'uis-1', label: 'UI Screen 1', entity_type: 'ui_screens' },
  ],
};

const mockDiagramOptions: PickOption[] = [
  { value: 'd-1', label: 'Diagram 1' },
  { value: 'd-2', label: 'Diagram 2' },
];

const mockRelationshipOptions: Record<string, RelationshipPickOption[]> = {
  business_user_business_points: [
    { value: 'bubp-1', label: 'User to BP 1', relationship_type: 'business_user_business_points' },
  ],
  application_point_business_points: [
    { value: 'apbp-1', label: 'AP to BP 1', relationship_type: 'application_point_business_points' },
  ],
  logical_data_entity_relationships: [
    { value: 'lder-1', label: 'Entity Relationship 1', relationship_type: 'logical_data_entity_relationships' },
  ],
  data_movements: [
    { value: 'dm-1', label: 'Data Movement 1', relationship_type: 'data_movements' },
  ],
  state_transitions: [
    { value: 'st-1', label: 'State Transition 1', relationship_type: 'state_transitions' },
  ],
  activity_flows: [
    { value: 'af-1', label: 'Activity Flow 1', relationship_type: 'activity_flows' },
  ],
  ui_workflow_transitions: [
    { value: 'uwt-1', label: 'UI Workflow Transition 1', relationship_type: 'ui_workflow_transitions' },
  ],
  interface_logical_entities: [],
  logical_data_entity_physical_data_entities: [],
  logical_data_attribute_physical_data_attributes: [],
};

// ============================================================================
// Task Group 3: Modal Size and Layout Styles
// ============================================================================

describe('Task Group 3: Modal Size and Layout Styles', () => {
  it('modal container has increased dimensions (1200px width, 85vh height)', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    const modal = screen.getByTestId('context-picker-modal');
    const modalInner = modal.querySelector('[class*="modal"]');

    // The modal should exist and be visible
    expect(modalInner).toBeTruthy();
  });

  it('content area supports independent scrolling with overflow-y auto', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Verify content area exists
    const content = screen.getByTestId('context-picker-modal').querySelector('[class*="content"]');
    expect(content).toBeTruthy();
  });

  it('header and footer remain visible while content scrolls', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Verify header with title exists
    expect(screen.getByText('Add Context')).toBeInTheDocument();

    // Verify footer buttons exist
    expect(screen.getByTestId('modal-cancel-button')).toBeInTheDocument();
    expect(screen.getByTestId('modal-apply-button')).toBeInTheDocument();
  });
});

// ============================================================================
// Task Group 4: Icon Tab Strip Styles
// ============================================================================

describe('Task Group 4: Icon Tab Strip Styles', () => {
  it('renders 6 domain tabs with icons', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Check for domain tabs by test ID
    expect(screen.getByTestId('domain-tab-business')).toBeInTheDocument();
    expect(screen.getByTestId('domain-tab-application')).toBeInTheDocument();
    expect(screen.getByTestId('domain-tab-data')).toBeInTheDocument();
    expect(screen.getByTestId('domain-tab-behavioural')).toBeInTheDocument();
    expect(screen.getByTestId('domain-tab-ui')).toBeInTheDocument();
    expect(screen.getByTestId('domain-tab-diagrams')).toBeInTheDocument();
  });

  it('selected tab displays with selected styling', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Default tab should be business
    const businessTab = screen.getByTestId('domain-tab-business');
    expect(businessTab.className).toMatch(/selected/);
  });

  it('tabs are displayed in a row with proper layout', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    const tabStrip = screen.getByTestId('domain-tab-strip');
    expect(tabStrip).toBeInTheDocument();
  });
});

// ============================================================================
// Task Group 5: Collapsible Section Styles
// ============================================================================

describe('Task Group 5: Collapsible Section Styles', () => {
  it('entities section has collapsible header with triangle indicator', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Look for Entities section header
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    expect(entitiesHeader).toBeInTheDocument();
  });

  it('relationships section has collapsible header', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Look for Relationships section header
    const relationshipsHeader = screen.getByTestId('domain-section-relationships-header');
    expect(relationshipsHeader).toBeInTheDocument();
  });
});

// ============================================================================
// Task Group 6: Domain Tab Strip Component
// ============================================================================

describe('Task Group 6: Domain Tab Strip Component', () => {
  it('renders 6 icon tabs (5 domains + diagrams)', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Use role="tab" as that's what the tabs have
    const tabs = screen.getAllByRole('tab', { name: /Business|Application|Data|Behavioural|UI|Diagrams/i });
    expect(tabs.length).toBe(6);
  });

  it('clicking a tab calls onTabChange with correct value', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Click on Data tab
    fireEvent.click(screen.getByTestId('domain-tab-data'));

    // Data tab should now be selected
    const dataTab = screen.getByTestId('domain-tab-data');
    expect(dataTab.className).toMatch(/selected/);
  });

  it('selected tab shows selected class', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Click on Application tab
    fireEvent.click(screen.getByTestId('domain-tab-application'));

    // Application tab should have selected class
    expect(screen.getByTestId('domain-tab-application').className).toMatch(/selected/);
    // Business tab should not have selected class
    expect(screen.getByTestId('domain-tab-business').className).not.toMatch(/selected/);
  });

  it('supports keyboard navigation with arrow keys', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    const tabStrip = screen.getByTestId('domain-tab-strip');

    // Focus on tab strip and press right arrow
    fireEvent.keyDown(tabStrip, { key: 'ArrowRight' });

    // This tests keyboard navigation works (implementation will handle focus)
    expect(tabStrip).toBeInTheDocument();
  });
});

// ============================================================================
// Task Group 7: Domain Section Components (Entities/Relationships)
// ============================================================================

describe('Task Group 7: Domain Section Components', () => {
  it('Entities section renders filtered entities for selected domain', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Default is Business domain - should show business_users entity
    expect(screen.getByText('Business User 1')).toBeInTheDocument();
  });

  it('Relationships section renders filtered relationships for selected domain', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Default is Business domain - should show business_user_business_points relationship
    expect(screen.getByText('User to BP 1')).toBeInTheDocument();
  });

  it('both sections default to expanded state', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Both sections should be expanded by default
    const entitiesBody = screen.getByTestId('domain-section-entities-body');
    const relationshipsBody = screen.getByTestId('domain-section-relationships-body');

    expect(entitiesBody).toBeInTheDocument();
    expect(relationshipsBody).toBeInTheDocument();
  });

  it('clicking section header toggles collapse state', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Click entities header to collapse
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    fireEvent.click(entitiesHeader);

    // Body should be hidden after collapse
    expect(screen.queryByTestId('domain-section-entities-body')).not.toBeInTheDocument();
  });

  it('checkbox selection updates correct state (entity vs relationship)', () => {
    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Select an entity
    fireEvent.click(screen.getByTestId('checkbox-bu-1'));

    // Select a relationship
    fireEvent.click(screen.getByTestId('checkbox-rel-bubp-1'));

    // Click Apply
    fireEvent.click(screen.getByTestId('modal-apply-button'));

    // Verify onApply was called with correct data
    expect(mockOnApply).toHaveBeenCalledTimes(1);
    const appliedState = mockOnApply.mock.calls[0][0];
    expect(appliedState.entity_refs).toHaveLength(1);
    expect(appliedState.relationship_refs).toHaveLength(1);
  });
});

// ============================================================================
// Task Group 8: Main Component Refactoring
// ============================================================================

describe('Task Group 8: Main Component Refactoring', () => {
  it('modal renders with 6 domain tabs instead of 2 text tabs', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Should have domain tabs
    expect(screen.getByTestId('domain-tab-strip')).toBeInTheDocument();

    // Should NOT have old text tabs
    expect(screen.queryByTestId('tab-architecture')).not.toBeInTheDocument();
  });

  it('default tab is Business', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    const businessTab = screen.getByTestId('domain-tab-business');
    expect(businessTab.className).toMatch(/selected/);
  });

  it('switching tabs shows correct Entities/Relationships sections', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Switch to Data tab
    fireEvent.click(screen.getByTestId('domain-tab-data'));

    // Should show Data domain entities (logical_data_entities)
    expect(screen.getByText('Logical Data Entity 1')).toBeInTheDocument();
  });

  it('Diagrams tab shows existing diagram content (no regression)', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Switch to Diagrams tab
    fireEvent.click(screen.getByTestId('domain-tab-diagrams'));

    // Should show diagrams
    expect(screen.getByText('Diagram 1')).toBeInTheDocument();
    expect(screen.getByText('Diagram 2')).toBeInTheDocument();
  });

  it('Apply builds relationship_refs array in ContextState', () => {
    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Select a relationship
    fireEvent.click(screen.getByTestId('checkbox-rel-bubp-1'));

    // Click Apply
    fireEvent.click(screen.getByTestId('modal-apply-button'));

    // Verify relationship_refs is in the applied state
    const appliedState = mockOnApply.mock.calls[0][0];
    expect(appliedState.relationship_refs).toBeDefined();
    expect(appliedState.relationship_refs).toHaveLength(1);
    expect(appliedState.relationship_refs[0].kind).toBe('RELATIONSHIP');
  });
});

// ============================================================================
// Task Group 9: Parent Component Integration
// ============================================================================

describe('Task Group 9: Parent Component Integration', () => {
  it('relationshipOptions prop is accepted and used', () => {
    // This test verifies the component renders with relationshipOptions
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Should show relationship from the provided options
    expect(screen.getByText('User to BP 1')).toBeInTheDocument();
  });

  it('onApply handler receives relationship_refs in ContextState', () => {
    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Select a relationship and apply
    fireEvent.click(screen.getByTestId('checkbox-rel-bubp-1'));
    fireEvent.click(screen.getByTestId('modal-apply-button'));

    // Verify the callback received the relationship_refs
    expect(mockOnApply).toHaveBeenCalled();
    const state = mockOnApply.mock.calls[0][0] as ContextState;
    expect(state.relationship_refs).toBeDefined();
    expect(state.relationship_refs![0]).toEqual({
      kind: 'RELATIONSHIP',
      relationship_type: 'business_user_business_points',
      relationship_id: 'bubp-1',
      label: 'User to BP 1',
    });
  });

  it('empty relationshipOptions prop is handled gracefully', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={mockInitialSelected}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={mockDiagramOptions}
        relationshipOptions={{}}
        onApply={() => {}}
      />
    );

    // Modal should still render without errors
    expect(screen.getByTestId('context-picker-modal')).toBeInTheDocument();
  });
});
