/**
 * contextPickerSelectAll.group.test.tsx
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 3: Group-Level Select All
 * Task 3.1: Focused tests for group-level Select All
 *
 * Tests for:
 * - Entity type group Select All selects only entities of that type
 * - Entity type group Select All deselects only entities of that type
 * - Relationship type group Select All selects only relationships of that type
 * - Relationship type group Select All deselects only relationships of that type
 * - Group checkbox reflects correct state (checked/unchecked/indeterminate) based on group members
 * - Group checkbox click does not trigger group expand/collapse
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ContextPickerModal } from '../components/ProductView/ContextPickerModal';
import type { ContextState } from '../utils/contextStorage';
import type { PickOption, RelationshipPickOption } from '../utils/contextPickListBuilders';

// Mock initial empty context state
const emptyContextState: ContextState = {
  version: 1,
  entity_refs: [],
  diagram_refs: [],
  relationship_refs: [],
};

// Mock entity options for testing - using entity types that map to the 'application' domain
const mockArchitectureOptions: Record<string, PickOption[]> = {
  applications: [
    { value: 'app-1', label: 'Application 1', entity_type: 'applications' },
    { value: 'app-2', label: 'Application 2', entity_type: 'applications' },
    { value: 'app-3', label: 'Application 3', entity_type: 'applications' },
  ],
  services: [
    { value: 'svc-1', label: 'Service 1', entity_type: 'services' },
    { value: 'svc-2', label: 'Service 2', entity_type: 'services' },
  ],
};

// Mock relationship options for testing - types that map to the 'application' domain
const mockRelationshipOptions: Record<string, RelationshipPickOption[]> = {
  application_point_business_points: [
    { value: 'rel-1', label: 'App1 -> Process1', relationship_type: 'application_point_business_points' },
    { value: 'rel-2', label: 'App2 -> Process2', relationship_type: 'application_point_business_points' },
  ],
  interface_logical_entities: [
    { value: 'rel-3', label: 'Interface1 -> Entity1', relationship_type: 'interface_logical_entities' },
  ],
};

describe('Task Group 3: Group-Level Select All', () => {
  describe('Test 3.1.1: Entity type group Select All selects only entities of that type', () => {
    it('should select only applications when applications group Select All is clicked', async () => {
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

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the applications group and its Select All checkbox
      const applicationsGroupCheckbox = screen.getByTestId('group-select-all-applications');

      // Initially unchecked
      expect(applicationsGroupCheckbox).not.toBeChecked();

      // Click to select all applications
      fireEvent.click(applicationsGroupCheckbox);

      // Verify all application checkboxes are checked
      const app1Checkbox = screen.getByTestId('checkbox-app-1');
      const app2Checkbox = screen.getByTestId('checkbox-app-2');
      const app3Checkbox = screen.getByTestId('checkbox-app-3');

      expect(app1Checkbox).toBeChecked();
      expect(app2Checkbox).toBeChecked();
      expect(app3Checkbox).toBeChecked();

      // Verify service checkboxes are NOT checked (different group)
      const svc1Checkbox = screen.getByTestId('checkbox-svc-1');
      const svc2Checkbox = screen.getByTestId('checkbox-svc-2');

      expect(svc1Checkbox).not.toBeChecked();
      expect(svc2Checkbox).not.toBeChecked();
    });
  });

  describe('Test 3.1.2: Entity type group Select All deselects only entities of that type', () => {
    it('should deselect only applications when applications group Select All is clicked from checked state', async () => {
      // Start with all applications and services selected
      const selectedContextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-2', label: 'Application 2' },
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-3', label: 'Application 3' },
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: 'Service 1' },
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-2', label: 'Service 2' },
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
          relationshipOptions={mockRelationshipOptions}
          onApply={() => {}}
        />
      );

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the applications group Select All checkbox
      const applicationsGroupCheckbox = screen.getByTestId('group-select-all-applications');

      // Should be checked initially (all applications selected)
      expect(applicationsGroupCheckbox).toBeChecked();

      // Click to deselect all applications
      fireEvent.click(applicationsGroupCheckbox);

      // Verify all application checkboxes are now unchecked
      const app1Checkbox = screen.getByTestId('checkbox-app-1');
      const app2Checkbox = screen.getByTestId('checkbox-app-2');
      const app3Checkbox = screen.getByTestId('checkbox-app-3');

      expect(app1Checkbox).not.toBeChecked();
      expect(app2Checkbox).not.toBeChecked();
      expect(app3Checkbox).not.toBeChecked();

      // Verify service checkboxes are STILL checked (different group, not affected)
      const svc1Checkbox = screen.getByTestId('checkbox-svc-1');
      const svc2Checkbox = screen.getByTestId('checkbox-svc-2');

      expect(svc1Checkbox).toBeChecked();
      expect(svc2Checkbox).toBeChecked();
    });
  });

  describe('Test 3.1.3: Relationship type group Select All selects only relationships of that type', () => {
    it('should select only application_point_business_points when that group Select All is clicked', async () => {
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

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the application_point_business_points group Select All checkbox
      const relGroupCheckbox = screen.getByTestId('group-select-all-application_point_business_points');

      // Initially unchecked
      expect(relGroupCheckbox).not.toBeChecked();

      // Click to select all relationships of that type
      fireEvent.click(relGroupCheckbox);

      // Verify application_point_business_points relationship checkboxes are checked
      const rel1Checkbox = screen.getByTestId('checkbox-rel-rel-1');
      const rel2Checkbox = screen.getByTestId('checkbox-rel-rel-2');

      expect(rel1Checkbox).toBeChecked();
      expect(rel2Checkbox).toBeChecked();

      // Verify interface_logical_entities relationship is NOT checked (different group)
      const rel3Checkbox = screen.getByTestId('checkbox-rel-rel-3');
      expect(rel3Checkbox).not.toBeChecked();
    });
  });

  describe('Test 3.1.4: Relationship type group Select All deselects only relationships of that type', () => {
    it('should deselect only application_point_business_points when that group Select All is clicked from checked state', async () => {
      // Start with all relationships selected
      const selectedContextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
        relationship_refs: [
          { kind: 'RELATIONSHIP', relationship_type: 'application_point_business_points', relationship_id: 'rel-1', label: 'App1 -> Process1' },
          { kind: 'RELATIONSHIP', relationship_type: 'application_point_business_points', relationship_id: 'rel-2', label: 'App2 -> Process2' },
          { kind: 'RELATIONSHIP', relationship_type: 'interface_logical_entities', relationship_id: 'rel-3', label: 'Interface1 -> Entity1' },
        ],
      };

      render(
        <ContextPickerModal
          isOpen={true}
          onClose={() => {}}
          initialSelected={selectedContextState}
          architectureOptions={mockArchitectureOptions}
          diagramOptions={[]}
          relationshipOptions={mockRelationshipOptions}
          onApply={() => {}}
        />
      );

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the application_point_business_points group Select All checkbox
      const relGroupCheckbox = screen.getByTestId('group-select-all-application_point_business_points');

      // Should be checked initially (all of that type selected)
      expect(relGroupCheckbox).toBeChecked();

      // Click to deselect all relationships of that type
      fireEvent.click(relGroupCheckbox);

      // Verify application_point_business_points relationship checkboxes are now unchecked
      const rel1Checkbox = screen.getByTestId('checkbox-rel-rel-1');
      const rel2Checkbox = screen.getByTestId('checkbox-rel-rel-2');

      expect(rel1Checkbox).not.toBeChecked();
      expect(rel2Checkbox).not.toBeChecked();

      // Verify interface_logical_entities relationship is STILL checked (different group)
      const rel3Checkbox = screen.getByTestId('checkbox-rel-rel-3');
      expect(rel3Checkbox).toBeChecked();
    });
  });

  describe('Test 3.1.5: Group checkbox reflects correct state based on group members', () => {
    it('should show indeterminate state on entity group checkbox when some entities in group are selected', async () => {
      // Start with partial selection - only 1 of 3 applications selected
      const partialContextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
          // app-2, app-3 are NOT selected
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
          relationshipOptions={mockRelationshipOptions}
          onApply={() => {}}
        />
      );

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the applications group Select All checkbox
      const applicationsGroupCheckbox = screen.getByTestId('group-select-all-applications') as HTMLInputElement;

      // Should be in indeterminate state (some but not all selected)
      expect(applicationsGroupCheckbox.indeterminate).toBe(true);
      expect(applicationsGroupCheckbox.checked).toBe(false);
    });

    it('should show checked state on entity group checkbox when all entities in group are selected', async () => {
      // Start with all applications selected (but not services)
      const selectedContextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-2', label: 'Application 2' },
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-3', label: 'Application 3' },
          // services not selected
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
          relationshipOptions={mockRelationshipOptions}
          onApply={() => {}}
        />
      );

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the applications group Select All checkbox
      const applicationsGroupCheckbox = screen.getByTestId('group-select-all-applications') as HTMLInputElement;

      // Should be checked (all applications selected)
      expect(applicationsGroupCheckbox.checked).toBe(true);
      expect(applicationsGroupCheckbox.indeterminate).toBe(false);

      // Services group should be unchecked (none selected)
      const servicesGroupCheckbox = screen.getByTestId('group-select-all-services') as HTMLInputElement;
      expect(servicesGroupCheckbox.checked).toBe(false);
      expect(servicesGroupCheckbox.indeterminate).toBe(false);
    });

    it('should select all in group when clicking indeterminate group checkbox', async () => {
      // Start with partial selection
      const partialContextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
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
          relationshipOptions={mockRelationshipOptions}
          onApply={() => {}}
        />
      );

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the applications group Select All checkbox (in indeterminate state)
      const applicationsGroupCheckbox = screen.getByTestId('group-select-all-applications') as HTMLInputElement;
      expect(applicationsGroupCheckbox.indeterminate).toBe(true);

      // Click should select all applications
      fireEvent.click(applicationsGroupCheckbox);

      // Verify all application checkboxes are now checked
      const app1Checkbox = screen.getByTestId('checkbox-app-1');
      const app2Checkbox = screen.getByTestId('checkbox-app-2');
      const app3Checkbox = screen.getByTestId('checkbox-app-3');

      expect(app1Checkbox).toBeChecked();
      expect(app2Checkbox).toBeChecked();
      expect(app3Checkbox).toBeChecked();
    });

    it('should show correct state on relationship group checkbox', async () => {
      // Start with partial relationship selection
      const partialContextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
        relationship_refs: [
          { kind: 'RELATIONSHIP', relationship_type: 'application_point_business_points', relationship_id: 'rel-1', label: 'App1 -> Process1' },
          // rel-2 is NOT selected
        ],
      };

      render(
        <ContextPickerModal
          isOpen={true}
          onClose={() => {}}
          initialSelected={partialContextState}
          architectureOptions={mockArchitectureOptions}
          diagramOptions={[]}
          relationshipOptions={mockRelationshipOptions}
          onApply={() => {}}
        />
      );

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the relationship group Select All checkbox
      const relGroupCheckbox = screen.getByTestId('group-select-all-application_point_business_points') as HTMLInputElement;

      // Should be in indeterminate state (1 of 2 selected)
      expect(relGroupCheckbox.indeterminate).toBe(true);
    });
  });

  describe('Test 3.1.6: Group checkbox click does not trigger group expand/collapse', () => {
    it('should not toggle group expand/collapse when clicking the group Select All checkbox', async () => {
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

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find the applications group content (should be visible)
      const groupContent = screen.getByTestId('group-content-applications');
      expect(groupContent).toBeInTheDocument();

      // Find and click the group Select All checkbox
      const applicationsGroupCheckbox = screen.getByTestId('group-select-all-applications');
      fireEvent.click(applicationsGroupCheckbox);

      // Group content should still be visible (not collapsed)
      const groupContentAfter = screen.getByTestId('group-content-applications');
      expect(groupContentAfter).toBeInTheDocument();
    });
  });

  describe('Test 3.1.7: Section-level state updates when group selections change', () => {
    it('should update section checkbox state when group selection changes', async () => {
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

      // Click on the application tab
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Section checkbox should be unchecked initially
      const entitiesHeader = screen.getByTestId('domain-section-entities-header');
      const sectionCheckbox = within(entitiesHeader).getByRole('checkbox') as HTMLInputElement;
      expect(sectionCheckbox.checked).toBe(false);
      expect(sectionCheckbox.indeterminate).toBe(false);

      // Select all applications via group checkbox
      const applicationsGroupCheckbox = screen.getByTestId('group-select-all-applications');
      fireEvent.click(applicationsGroupCheckbox);

      // Section checkbox should now be indeterminate (some but not all entities selected)
      // (3 applications selected, but 2 services not selected - total 5 entities)
      expect(sectionCheckbox.indeterminate).toBe(true);

      // Now select all services too
      const servicesGroupCheckbox = screen.getByTestId('group-select-all-services');
      fireEvent.click(servicesGroupCheckbox);

      // Section checkbox should now be checked (all entities selected)
      expect(sectionCheckbox.checked).toBe(true);
      expect(sectionCheckbox.indeterminate).toBe(false);
    });
  });
});
