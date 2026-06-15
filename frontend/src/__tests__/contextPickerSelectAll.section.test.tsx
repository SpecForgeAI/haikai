/**
 * contextPickerSelectAll.section.test.tsx
 *
 * Spec 2026-01-25: Fix Context Picker DEP Labels and Add Select All
 * Task Group 2: Section-Level Select All
 * Task 2.1: Focused tests for section-level Select All
 *
 * Tests for:
 * - Entities section Select All selects all entity rows when clicked (unchecked state)
 * - Entities section Select All deselects all entity rows when clicked (checked state)
 * - Relationships section Select All selects all relationship rows when clicked
 * - Relationships section Select All deselects all relationship rows when clicked
 * - Indeterminate state is shown when some but not all items are selected
 * - Checkbox click does not trigger section expand/collapse
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ContextPickerModal } from '../components/ProductView/ContextPickerModal';
import { deriveCheckboxState } from '../utils/selectionUtils';
import type { ContextState } from '../utils/contextStorage';
import type { PickOption, RelationshipPickOption } from '../utils/contextPickListBuilders';

// Mock initial empty context state
const emptyContextState: ContextState = {
  version: 1,
  entity_refs: [],
  diagram_refs: [],
  relationship_refs: [],
};

// Mock entity options for testing
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

// Mock relationship options for testing
const mockRelationshipOptions: Record<string, RelationshipPickOption[]> = {
  application_point_business_points: [
    { value: 'rel-1', label: 'App1 -> Process1', relationship_type: 'application_point_business_points' },
    { value: 'rel-2', label: 'App2 -> Process2', relationship_type: 'application_point_business_points' },
  ],
  interface_logical_entities: [
    { value: 'rel-3', label: 'Interface1 -> Entity1', relationship_type: 'interface_logical_entities' },
  ],
};

describe('Task Group 2: Section-Level Select All', () => {
  describe('Task 2.1: deriveCheckboxState utility function', () => {
    it('should return "checked" when all items are selected', () => {
      expect(deriveCheckboxState(5, 5)).toBe('checked');
      expect(deriveCheckboxState(1, 1)).toBe('checked');
    });

    it('should return "unchecked" when no items are selected', () => {
      expect(deriveCheckboxState(0, 5)).toBe('unchecked');
      expect(deriveCheckboxState(0, 0)).toBe('unchecked');
    });

    it('should return "indeterminate" when some but not all items are selected', () => {
      expect(deriveCheckboxState(2, 5)).toBe('indeterminate');
      expect(deriveCheckboxState(1, 3)).toBe('indeterminate');
      expect(deriveCheckboxState(4, 5)).toBe('indeterminate');
    });
  });

  describe('Test 2.1.1: Entities section Select All selects all entity rows when clicked (unchecked state)', () => {
    it('should select all entities in the current domain when Select All is clicked from unchecked state', async () => {
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

      // Click on the application tab (domain that has our mock entities)
      const appTab = screen.getByTestId('domain-tab-application');
      fireEvent.click(appTab);

      // Find and click the Entities section Select All checkbox
      const entitiesHeader = screen.getByTestId('domain-section-entities-header');
      const selectAllCheckbox = within(entitiesHeader).getByRole('checkbox');

      // Initially unchecked
      expect(selectAllCheckbox).not.toBeChecked();

      // Click to select all
      fireEvent.click(selectAllCheckbox);

      // Verify all entity checkboxes are now checked
      const app1Checkbox = screen.getByTestId('checkbox-app-1');
      const app2Checkbox = screen.getByTestId('checkbox-app-2');
      const app3Checkbox = screen.getByTestId('checkbox-app-3');
      const svc1Checkbox = screen.getByTestId('checkbox-svc-1');
      const svc2Checkbox = screen.getByTestId('checkbox-svc-2');

      expect(app1Checkbox).toBeChecked();
      expect(app2Checkbox).toBeChecked();
      expect(app3Checkbox).toBeChecked();
      expect(svc1Checkbox).toBeChecked();
      expect(svc2Checkbox).toBeChecked();
    });
  });

  describe('Test 2.1.2: Entities section Select All deselects all entity rows when clicked (checked state)', () => {
    it('should deselect all entities when Select All is clicked from checked state', async () => {
      // Start with all entities selected
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

      // Find the Entities section Select All checkbox
      const entitiesHeader = screen.getByTestId('domain-section-entities-header');
      const selectAllCheckbox = within(entitiesHeader).getByRole('checkbox');

      // Should be checked initially (all entities selected)
      expect(selectAllCheckbox).toBeChecked();

      // Click to deselect all
      fireEvent.click(selectAllCheckbox);

      // Verify all entity checkboxes are now unchecked
      const app1Checkbox = screen.getByTestId('checkbox-app-1');
      const app2Checkbox = screen.getByTestId('checkbox-app-2');

      expect(app1Checkbox).not.toBeChecked();
      expect(app2Checkbox).not.toBeChecked();
    });
  });

  describe('Test 2.1.3: Relationships section Select All selects all relationship rows when clicked', () => {
    it('should select all relationships in the current domain when Select All is clicked', async () => {
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

      // Find and click the Relationships section Select All checkbox
      const relationshipsHeader = screen.getByTestId('domain-section-relationships-header');
      const selectAllCheckbox = within(relationshipsHeader).getByRole('checkbox');

      // Initially unchecked
      expect(selectAllCheckbox).not.toBeChecked();

      // Click to select all
      fireEvent.click(selectAllCheckbox);

      // Verify all relationship checkboxes are now checked
      const rel1Checkbox = screen.getByTestId('checkbox-rel-rel-1');
      const rel2Checkbox = screen.getByTestId('checkbox-rel-rel-2');
      const rel3Checkbox = screen.getByTestId('checkbox-rel-rel-3');

      expect(rel1Checkbox).toBeChecked();
      expect(rel2Checkbox).toBeChecked();
      expect(rel3Checkbox).toBeChecked();
    });
  });

  describe('Test 2.1.4: Relationships section Select All deselects all relationship rows when clicked', () => {
    it('should deselect all relationships when Select All is clicked from checked state', async () => {
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

      // Find the Relationships section Select All checkbox
      const relationshipsHeader = screen.getByTestId('domain-section-relationships-header');
      const selectAllCheckbox = within(relationshipsHeader).getByRole('checkbox');

      // Should be checked initially
      expect(selectAllCheckbox).toBeChecked();

      // Click to deselect all
      fireEvent.click(selectAllCheckbox);

      // Verify all relationship checkboxes are now unchecked
      const rel1Checkbox = screen.getByTestId('checkbox-rel-rel-1');
      const rel2Checkbox = screen.getByTestId('checkbox-rel-rel-2');

      expect(rel1Checkbox).not.toBeChecked();
      expect(rel2Checkbox).not.toBeChecked();
    });
  });

  describe('Test 2.1.5: Indeterminate state is shown when some but not all items are selected', () => {
    it('should show indeterminate state on Entities Select All when some entities are selected', async () => {
      // Start with partial selection
      const partialContextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Application 1' },
          // app-2, app-3, svc-1, svc-2 are NOT selected
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

      // Find the Entities section Select All checkbox
      const entitiesHeader = screen.getByTestId('domain-section-entities-header');
      const selectAllCheckbox = within(entitiesHeader).getByRole('checkbox') as HTMLInputElement;

      // Should be in indeterminate state
      expect(selectAllCheckbox.indeterminate).toBe(true);
    });

    it('should select all when clicking indeterminate checkbox (same as unchecked behavior)', async () => {
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

      // Find and click the Entities section Select All checkbox (in indeterminate state)
      const entitiesHeader = screen.getByTestId('domain-section-entities-header');
      const selectAllCheckbox = within(entitiesHeader).getByRole('checkbox') as HTMLInputElement;

      // Confirm indeterminate state
      expect(selectAllCheckbox.indeterminate).toBe(true);

      // Click should select all (indeterminate -> all selected)
      fireEvent.click(selectAllCheckbox);

      // Verify all entity checkboxes are now checked
      const app1Checkbox = screen.getByTestId('checkbox-app-1');
      const app2Checkbox = screen.getByTestId('checkbox-app-2');
      const app3Checkbox = screen.getByTestId('checkbox-app-3');

      expect(app1Checkbox).toBeChecked();
      expect(app2Checkbox).toBeChecked();
      expect(app3Checkbox).toBeChecked();
    });
  });

  describe('Test 2.1.6: Checkbox click does not trigger section expand/collapse', () => {
    it('should not toggle section expand/collapse when clicking the Select All checkbox', async () => {
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

      // Section should be expanded by default
      const entitiesBody = screen.getByTestId('domain-section-entities-body');
      expect(entitiesBody).toBeInTheDocument();

      // Find and click the Select All checkbox
      const entitiesHeader = screen.getByTestId('domain-section-entities-header');
      const selectAllCheckbox = within(entitiesHeader).getByRole('checkbox');

      // Click the checkbox (not the header)
      fireEvent.click(selectAllCheckbox);

      // Section should still be expanded (not collapsed)
      const entitiesBodyAfter = screen.getByTestId('domain-section-entities-body');
      expect(entitiesBodyAfter).toBeInTheDocument();
    });

    it('should toggle section expand/collapse only when clicking header outside checkbox', async () => {
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

      // Section should be expanded by default
      expect(screen.getByTestId('domain-section-entities-body')).toBeInTheDocument();

      // Click the header (outside the checkbox) to collapse
      const entitiesHeader = screen.getByTestId('domain-section-entities-header');
      fireEvent.click(entitiesHeader);

      // Section should now be collapsed
      expect(screen.queryByTestId('domain-section-entities-body')).not.toBeInTheDocument();
    });
  });
});
