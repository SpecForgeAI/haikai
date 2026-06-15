/**
 * contextPickerSelectAll.integration.test.tsx
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 4: Test Review and Gap Analysis
 * Task 4.3: Strategic integration tests filling critical gaps
 *
 * Integration tests for:
 * - DEP labels rendered correctly in relationship rows in actual modal
 * - Apply payload correctness after bulk entity selection (bundle/depth)
 * - Apply payload correctness after bulk relationship selection (metadata)
 * - Section and group checkbox state synchronization
 * - Empty groups/sections handle Select All gracefully
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ContextPickerModal } from '../components/ProductView/ContextPickerModal';
import type { ContextState } from '../utils/contextStorage';
import type { PickOption, RelationshipPickOption } from '../utils/contextPickListBuilders';

// ============================================================================
// Test Fixtures
// ============================================================================

const emptyContextState: ContextState = {
  version: 1,
  entity_refs: [],
  diagram_refs: [],
  relationship_refs: [],
};

// Entity options for testing - includes entity types that support bundles
// Note: Only interfaces, services, and physical_data_entities have bundle support
const mockArchitectureOptions: Record<string, PickOption[]> = {
  applications: [
    { value: 'app-1', label: 'Application 1', entity_type: 'applications' },
    { value: 'app-2', label: 'Application 2', entity_type: 'applications' },
  ],
  services: [
    { value: 'svc-1', label: 'Service 1', entity_type: 'services' },
  ],
  logical_data_entities: [
    { value: 'lde-1', label: 'Customer', entity_type: 'logical_data_entities' },
    { value: 'lde-2', label: 'Order', entity_type: 'logical_data_entities' },
  ],
  physical_data_entities: [
    { value: 'pde-1', label: 'customers_table', entity_type: 'physical_data_entities' },
    { value: 'pde-2', label: 'orders_table', entity_type: 'physical_data_entities' },
  ],
};

// Relationship options including DEP-based relationships
const mockRelationshipOptions: Record<string, RelationshipPickOption[]> = {
  application_point_business_points: [
    { value: 'rel-1', label: 'App1 [APPLICATION_POINT] | Process1 [BUSINESS_POINT]', relationship_type: 'application_point_business_points' },
    { value: 'rel-2', label: 'App2 [APPLICATION_POINT] | Process2 [BUSINESS_POINT]', relationship_type: 'application_point_business_points' },
  ],
  logical_data_entity_relationships: [
    // These would have DEP-resolved labels in real usage
    { value: 'lde-rel-1', label: 'Customer [LOGICAL_DATA_ENTITY] | Order [LOGICAL_DATA_ENTITY]', relationship_type: 'logical_data_entity_relationships' },
  ],
  interface_logical_entities: [
    { value: 'ile-1', label: 'ProductAPI [INTERFACE] | Product [LOGICAL_DATA_ENTITY]', relationship_type: 'interface_logical_entities' },
  ],
};

// Options with some entity types having entities but others empty
// This tests the case where a domain has entity types but specific groups are empty
const partialArchitectureOptions: Record<string, PickOption[]> = {
  applications: [
    { value: 'app-1', label: 'Application 1', entity_type: 'applications' },
  ],
  services: [], // Empty group
  interfaces: [], // Empty group
  endpoints: [], // Empty group
};

const emptyRelationshipOptions: Record<string, RelationshipPickOption[]> = {
  application_point_business_points: [],
  interface_logical_entities: [],
};

// ============================================================================
// Test 4.3.1: DEP labels displayed in relationship rows in actual modal
// ============================================================================

describe('Task 4.3.1: DEP labels rendered in relationship rows in actual modal', () => {
  it('should render resolved DEP labels (not DATA_ENTITY_POINT) in logical_data_entity_relationships', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Navigate to Data domain tab (where logical_data_entity_relationships are shown)
    const dataTab = screen.getByTestId('domain-tab-data');
    fireEvent.click(dataTab);

    // The relationship row should show resolved labels with concrete type badges
    // The mock label already contains resolved format: "Customer [LOGICAL_DATA_ENTITY] | Order [LOGICAL_DATA_ENTITY]"
    const relationshipLabel = screen.getByText(/Customer \[LOGICAL_DATA_ENTITY\].*Order \[LOGICAL_DATA_ENTITY\]/);
    expect(relationshipLabel).toBeInTheDocument();

    // Should NOT contain DATA_ENTITY_POINT badge
    expect(screen.queryByText(/\[DATA_ENTITY_POINT\]/)).not.toBeInTheDocument();
  });

  it('should render resolved DEP labels in interface_logical_entities relationships', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={mockRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Navigate to Application domain tab (where interface_logical_entities are shown)
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // The relationship row should show resolved labels with concrete type badges
    const relationshipLabel = screen.getByText(/ProductAPI \[INTERFACE\].*Product \[LOGICAL_DATA_ENTITY\]/);
    expect(relationshipLabel).toBeInTheDocument();
  });
});

// ============================================================================
// Test 4.3.2: Apply payload includes correct metadata after bulk entity selection
// ============================================================================

describe('Task 4.3.2: Apply payload includes correct metadata after bulk entity selection', () => {
  it('should include default bundle types in Apply payload after bulk selecting physical_data_entities', () => {
    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Navigate to Data domain tab to select physical_data_entities (which have bundle support)
    const dataTab = screen.getByTestId('domain-tab-data');
    fireEvent.click(dataTab);

    // Find and click the physical_data_entities group Select All checkbox
    const pdeGroupCheckbox = screen.getByTestId('group-select-all-physical_data_entities');
    fireEvent.click(pdeGroupCheckbox);

    // Click Apply button
    const applyButton = screen.getByTestId('modal-apply-button');
    fireEvent.click(applyButton);

    // Verify onApply was called
    expect(mockOnApply).toHaveBeenCalledTimes(1);

    // Get the payload
    const payload = mockOnApply.mock.calls[0][0] as ContextState;

    // Verify entity_refs contains correct bundle types
    expect(payload.entity_refs).toHaveLength(2);

    // physical_data_entities should have entity_with_attributes_and_relationships bundle by default
    const pde1Ref = payload.entity_refs.find((ref) => ref.entity_id === 'pde-1');
    const pde2Ref = payload.entity_refs.find((ref) => ref.entity_id === 'pde-2');

    expect(pde1Ref).toBeDefined();
    expect(pde1Ref?.bundle_type).toBe('entity_with_attributes_and_relationships');
    expect(pde1Ref?.label).toBe('customers_table');

    expect(pde2Ref).toBeDefined();
    expect(pde2Ref?.bundle_type).toBe('entity_with_attributes_and_relationships');
    expect(pde2Ref?.label).toBe('orders_table');
  });

  it('should include default bundle types in Apply payload after bulk selecting services', () => {
    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Select all services via group checkbox (services have bundle support)
    const svcsGroupCheckbox = screen.getByTestId('group-select-all-services');
    fireEvent.click(svcsGroupCheckbox);

    // Click Apply
    const applyButton = screen.getByTestId('modal-apply-button');
    fireEvent.click(applyButton);

    const payload = mockOnApply.mock.calls[0][0] as ContextState;

    // Verify bundle type is set for services
    const svc1Ref = payload.entity_refs.find((ref) => ref.entity_id === 'svc-1');
    expect(svc1Ref).toBeDefined();
    expect(svc1Ref?.bundle_type).toBe('service_with_parents_and_children');
  });

  it('should include entity labels in Apply payload after bulk selection', () => {
    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Select all applications via group checkbox
    const appsGroupCheckbox = screen.getByTestId('group-select-all-applications');
    fireEvent.click(appsGroupCheckbox);

    // Click Apply
    const applyButton = screen.getByTestId('modal-apply-button');
    fireEvent.click(applyButton);

    const payload = mockOnApply.mock.calls[0][0] as ContextState;

    // Verify labels are included
    const app1Ref = payload.entity_refs.find((ref) => ref.entity_id === 'app-1');
    const app2Ref = payload.entity_refs.find((ref) => ref.entity_id === 'app-2');

    expect(app1Ref?.label).toBe('Application 1');
    expect(app2Ref?.label).toBe('Application 2');
  });
});

// ============================================================================
// Test 4.3.3: Apply payload includes correct metadata after bulk relationship selection
// ============================================================================

describe('Task 4.3.3: Apply payload includes correct metadata after bulk relationship selection', () => {
  it('should include relationship_type and label in Apply payload after bulk selecting relationships', () => {
    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Select all application_point_business_points via group checkbox
    const relGroupCheckbox = screen.getByTestId('group-select-all-application_point_business_points');
    fireEvent.click(relGroupCheckbox);

    // Click Apply
    const applyButton = screen.getByTestId('modal-apply-button');
    fireEvent.click(applyButton);

    const payload = mockOnApply.mock.calls[0][0] as ContextState;

    // Verify relationship_refs contains correct metadata
    expect(payload.relationship_refs).toHaveLength(2);

    const rel1 = payload.relationship_refs?.find((ref) => ref.relationship_id === 'rel-1');
    const rel2 = payload.relationship_refs?.find((ref) => ref.relationship_id === 'rel-2');

    expect(rel1).toBeDefined();
    expect(rel1?.relationship_type).toBe('application_point_business_points');
    expect(rel1?.label).toBe('App1 [APPLICATION_POINT] | Process1 [BUSINESS_POINT]');

    expect(rel2).toBeDefined();
    expect(rel2?.relationship_type).toBe('application_point_business_points');
    expect(rel2?.label).toBe('App2 [APPLICATION_POINT] | Process2 [BUSINESS_POINT]');
  });

  it('should remove relationship metadata from Apply payload after bulk deselecting relationships', () => {
    // Start with relationships selected
    const initialContextState: ContextState = {
      version: 1,
      entity_refs: [],
      diagram_refs: [],
      relationship_refs: [
        { kind: 'RELATIONSHIP', relationship_type: 'application_point_business_points', relationship_id: 'rel-1', label: 'App1 -> Process1' },
        { kind: 'RELATIONSHIP', relationship_type: 'application_point_business_points', relationship_id: 'rel-2', label: 'App2 -> Process2' },
      ],
    };

    const mockOnApply = vi.fn();

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={initialContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={mockRelationshipOptions}
        onApply={mockOnApply}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Deselect all application_point_business_points via group checkbox (currently checked)
    const relGroupCheckbox = screen.getByTestId('group-select-all-application_point_business_points');
    expect(relGroupCheckbox).toBeChecked();
    fireEvent.click(relGroupCheckbox);

    // Click Apply
    const applyButton = screen.getByTestId('modal-apply-button');
    fireEvent.click(applyButton);

    const payload = mockOnApply.mock.calls[0][0] as ContextState;

    // Verify relationship_refs is empty or undefined
    expect(payload.relationship_refs?.length ?? 0).toBe(0);
  });
});

// ============================================================================
// Test 4.3.4: Section checkbox state updates correctly after group changes
// ============================================================================

describe('Task 4.3.4: Section checkbox state updates when deselecting via group', () => {
  it('should update section checkbox from checked to indeterminate when one group is deselected', () => {
    // Start with all entities selected
    const selectedContextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-2', label: 'Application 2' },
        { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Service 1' },
      ],
      diagram_refs: [],
      relationship_refs: [],
    };

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={selectedContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={{}}
        onApply={() => {}}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Section checkbox should be checked initially (all entities selected)
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    const sectionCheckbox = within(entitiesHeader).getByRole('checkbox') as HTMLInputElement;
    expect(sectionCheckbox.checked).toBe(true);

    // Deselect all applications via group checkbox
    const appsGroupCheckbox = screen.getByTestId('group-select-all-applications');
    fireEvent.click(appsGroupCheckbox);

    // Section checkbox should now be indeterminate (only services selected)
    expect(sectionCheckbox.indeterminate).toBe(true);
    expect(sectionCheckbox.checked).toBe(false);
  });

  it('should update section checkbox from indeterminate to unchecked when last group is deselected', () => {
    // Start with only applications selected
    const partialContextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-2', label: 'Application 2' },
      ],
      diagram_refs: [],
      relationship_refs: [],
    };

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={partialContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={{}}
        onApply={() => {}}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Section checkbox should be indeterminate initially (some but not all)
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    const sectionCheckbox = within(entitiesHeader).getByRole('checkbox') as HTMLInputElement;
    expect(sectionCheckbox.indeterminate).toBe(true);

    // Deselect all applications via group checkbox
    const appsGroupCheckbox = screen.getByTestId('group-select-all-applications');
    fireEvent.click(appsGroupCheckbox);

    // Section checkbox should now be unchecked (nothing selected)
    expect(sectionCheckbox.checked).toBe(false);
    expect(sectionCheckbox.indeterminate).toBe(false);
  });
});

// ============================================================================
// Test 4.3.5: Group checkbox state updates correctly after section changes
// ============================================================================

describe('Task 4.3.5: Group checkbox state updates when selecting/deselecting via section', () => {
  it('should update all group checkboxes to checked when section Select All is clicked', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={{}}
        onApply={() => {}}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Click section Select All
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    const sectionCheckbox = within(entitiesHeader).getByRole('checkbox');
    fireEvent.click(sectionCheckbox);

    // All group checkboxes should be checked
    const appsGroupCheckbox = screen.getByTestId('group-select-all-applications') as HTMLInputElement;
    const svcsGroupCheckbox = screen.getByTestId('group-select-all-services') as HTMLInputElement;

    expect(appsGroupCheckbox.checked).toBe(true);
    expect(svcsGroupCheckbox.checked).toBe(true);
  });

  it('should update all group checkboxes to unchecked when section Select All is clicked from checked state', () => {
    // Start with all entities selected
    const selectedContextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-2', label: 'Application 2' },
        { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Service 1' },
      ],
      diagram_refs: [],
      relationship_refs: [],
    };

    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={selectedContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={{}}
        onApply={() => {}}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Click section Select All to deselect all
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    const sectionCheckbox = within(entitiesHeader).getByRole('checkbox');
    fireEvent.click(sectionCheckbox);

    // All group checkboxes should be unchecked
    const appsGroupCheckbox = screen.getByTestId('group-select-all-applications') as HTMLInputElement;
    const svcsGroupCheckbox = screen.getByTestId('group-select-all-services') as HTMLInputElement;

    expect(appsGroupCheckbox.checked).toBe(false);
    expect(svcsGroupCheckbox.checked).toBe(false);
  });
});

// ============================================================================
// Test 4.3.6: Empty groups/sections handle Select All gracefully
// ============================================================================

describe('Task 4.3.6: Empty groups/sections handle Select All gracefully', () => {
  it('should render section Select All checkbox as unchecked when domain has some entity types with entries', () => {
    // Use partialArchitectureOptions which has applications but empty services
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={partialArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={{}}
        onApply={() => {}}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Find the Entities section Select All checkbox
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    const sectionCheckbox = within(entitiesHeader).getByRole('checkbox') as HTMLInputElement;

    // Should be unchecked (not indeterminate) since nothing is selected
    expect(sectionCheckbox.checked).toBe(false);
    expect(sectionCheckbox.indeterminate).toBe(false);
  });

  it('should not error when clicking section Select All on section with some empty groups', () => {
    const mockOnApply = vi.fn();

    // Use partialArchitectureOptions which has applications but empty services
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={partialArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={{}}
        onApply={mockOnApply}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Click section Select All - should not throw
    const entitiesHeader = screen.getByTestId('domain-section-entities-header');
    const sectionCheckbox = within(entitiesHeader).getByRole('checkbox');

    expect(() => {
      fireEvent.click(sectionCheckbox);
    }).not.toThrow();

    // Click Apply to verify state is still valid
    const applyButton = screen.getByTestId('modal-apply-button');
    fireEvent.click(applyButton);

    const payload = mockOnApply.mock.calls[0][0] as ContextState;

    // Should have selected the one application that exists
    expect(payload.entity_refs).toHaveLength(1);
    expect(payload.entity_refs[0].entity_id).toBe('app-1');
  });

  it('should render relationships section Select All checkbox as unchecked when section has no relationships', () => {
    render(
      <ContextPickerModal
        isOpen={true}
        onClose={() => {}}
        initialSelected={emptyContextState}
        architectureOptions={mockArchitectureOptions}
        diagramOptions={[]}
        relationshipOptions={emptyRelationshipOptions}
        onApply={() => {}}
      />
    );

    // Navigate to Application domain tab
    const appTab = screen.getByTestId('domain-tab-application');
    fireEvent.click(appTab);

    // Find the Relationships section Select All checkbox
    const relationshipsHeader = screen.getByTestId('domain-section-relationships-header');
    const sectionCheckbox = within(relationshipsHeader).getByRole('checkbox') as HTMLInputElement;

    // Should be unchecked (not indeterminate) since there are no items
    expect(sectionCheckbox.checked).toBe(false);
    expect(sectionCheckbox.indeterminate).toBe(false);
  });
});
