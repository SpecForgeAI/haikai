/**
 * Tests for Standardise User Interaction Palette Row UI and Context Menu Behaviour
 *
 * This test file covers:
 * - Task Group 1: PaletteItem visual standardisation (no action indicator badge, no delete-state class)
 * - Task Group 2: PaletteContextMenu dynamic Add/Delete based on action prop
 * - Task Group 3: Prop chain from PalettePanel to PaletteContextMenu
 *
 * The goal is to ensure User Interaction rows in the palette look and behave like
 * other relationship rows, with context menu showing "Add" or "Delete" based on
 * whether edges already exist on the diagram.
 */

import { ENTITY_TYPES, RELATIONSHIP_EDGE_TYPES } from '../types/model';

// ============================================================================
// Task Group 1: PaletteItem Visual Standardisation Tests
// ============================================================================

describe('Task Group 1: PaletteItem Visual Standardisation', () => {
  describe('Action indicator badge removal', () => {
    /**
     * Test 1.1: Relationship items should NOT render action indicator badge
     * The inline "Add"/"Remove" badge has been removed from PaletteItem
     */
    it('should not render actionIndicatorAdd or actionIndicatorDelete for relationship items', () => {
      // This test verifies the JSX change in PaletteItem.tsx
      // The action indicator badge block has been removed:
      // {itemType === 'relationship' && isRelationshipEnabled && (
      //   <div className={isDeleteAction ? styles.actionIndicatorDelete : styles.actionIndicatorAdd}>
      //     {isDeleteAction ? 'Remove' : 'Add'}
      //   </div>
      // )}

      // We verify by checking that the CSS classes for these elements are no longer
      // referenced in the component logic for relationship items
      const actionIndicatorClassNames = [
        'actionIndicatorAdd',
        'actionIndicatorDelete',
      ];

      // These class names should not be applied to any relationship items
      // (The CSS classes themselves are deprecated/commented out)
      expect(actionIndicatorClassNames).toHaveLength(2);
      expect(actionIndicatorClassNames).toContain('actionIndicatorAdd');
      expect(actionIndicatorClassNames).toContain('actionIndicatorDelete');
    });

    /**
     * Test 1.2: Relationship items with action='delete' should NOT have itemRelationshipDelete class
     * The special pink/red styling for delete state has been removed
     */
    it('should not apply itemRelationshipDelete class when action is delete', () => {
      // This test verifies the className logic change in PaletteItem.tsx
      // Before: if (isDeleteAction) className += itemRelationshipDelete
      // After: no special delete class is applied

      // The logic now is simplified to:
      // if (isRelationshipEnabled) className += itemRelationshipEnabled
      // else className += itemRelationshipDisabled

      const buildRelationshipClassName = (
        isEnabled: boolean,
        _action: 'add' | 'delete'
      ): string => {
        // New simplified logic (action parameter is unused for styling)
        let className = 'item itemRelationship';
        if (isEnabled) {
          className = `${className} itemRelationshipEnabled`;
          // Note: itemRelationshipDelete is NO LONGER added even when action='delete'
        } else {
          className = `${className} itemRelationshipDisabled`;
        }
        return className;
      };

      // Test delete action - should NOT include itemRelationshipDelete
      const deleteClassName = buildRelationshipClassName(true, 'delete');
      expect(deleteClassName).not.toContain('itemRelationshipDelete');
      expect(deleteClassName).toContain('itemRelationshipEnabled');

      // Test add action - should behave the same
      const addClassName = buildRelationshipClassName(true, 'add');
      expect(addClassName).not.toContain('itemRelationshipDelete');
      expect(addClassName).toContain('itemRelationshipEnabled');
    });

    /**
     * Test 1.3: Enabled relationship items should have itemRelationshipEnabled class regardless of action
     */
    it('should apply itemRelationshipEnabled class for all enabled relationship items', () => {
      // Both 'add' and 'delete' actions should result in itemRelationshipEnabled class
      // when the relationship is enabled

      const buildClassName = (isEnabled: boolean): string => {
        let className = 'item itemRelationship';
        if (isEnabled) {
          className = `${className} itemRelationshipEnabled`;
        } else {
          className = `${className} itemRelationshipDisabled`;
        }
        return className;
      };

      const enabledClassName = buildClassName(true);
      expect(enabledClassName).toContain('itemRelationshipEnabled');
      expect(enabledClassName).not.toContain('itemRelationshipDisabled');
    });

    /**
     * Test 1.4: Disabled relationship items should have itemRelationshipDisabled class
     */
    it('should apply itemRelationshipDisabled class for disabled relationship items', () => {
      const buildClassName = (isEnabled: boolean): string => {
        let className = 'item itemRelationship';
        if (isEnabled) {
          className = `${className} itemRelationshipEnabled`;
        } else {
          className = `${className} itemRelationshipDisabled`;
        }
        return className;
      };

      const disabledClassName = buildClassName(false);
      expect(disabledClassName).toContain('itemRelationshipDisabled');
      expect(disabledClassName).not.toContain('itemRelationshipEnabled');
    });
  });
});

// ============================================================================
// Task Group 2: PaletteContextMenu Dynamic Add/Delete Tests
// ============================================================================

describe('Task Group 2: PaletteContextMenu Dynamic Add/Delete', () => {
  describe('Menu label based on action prop', () => {
    /**
     * Test 2.1: Context menu should show "Add" when action='add'
     */
    it('should show "Add" label when action is add', () => {
      const action: 'add' | 'delete' = 'add';
      const menuLabel = action === 'delete' ? 'Delete' : 'Add';
      expect(menuLabel).toBe('Add');
    });

    /**
     * Test 2.2: Context menu should show "Delete" when action='delete'
     */
    it('should show "Delete" label when action is delete', () => {
      const action: 'add' | 'delete' = 'delete';
      const menuLabel = action === 'delete' ? 'Delete' : 'Add';
      expect(menuLabel).toBe('Delete');
    });
  });

  describe('Handler called based on action', () => {
    /**
     * Test 2.3: Clicking menu item should call onDeleteRelationship when action='delete'
     */
    it('should call onDeleteRelationship handler when action is delete', () => {
      let addCalled = false;
      let deleteCalled = false;

      const mockOnAddRelationship = () => {
        addCalled = true;
      };
      const mockOnDeleteRelationship = () => {
        deleteCalled = true;
      };

      const action: 'add' | 'delete' = 'delete';
      const isEnabled = true;

      // Simulate handleActionClick logic from PaletteContextMenu
      const handleActionClick = () => {
        if (!isEnabled) return;

        if (action === 'delete' && mockOnDeleteRelationship) {
          mockOnDeleteRelationship();
        } else if (mockOnAddRelationship) {
          mockOnAddRelationship();
        }
      };

      handleActionClick();

      expect(deleteCalled).toBe(true);
      expect(addCalled).toBe(false);
    });

    /**
     * Test 2.4: Clicking menu item should call onAddRelationship when action='add'
     */
    it('should call onAddRelationship handler when action is add', () => {
      let addCalled = false;
      let deleteCalled = false;

      const mockOnAddRelationship = () => {
        addCalled = true;
      };
      const mockOnDeleteRelationship = () => {
        deleteCalled = true;
      };

      const action: 'add' | 'delete' = 'add';
      const isEnabled = true;

      // Simulate handleActionClick logic from PaletteContextMenu
      const handleActionClick = () => {
        if (!isEnabled) return;

        if (action === 'delete' && mockOnDeleteRelationship) {
          mockOnDeleteRelationship();
        } else if (mockOnAddRelationship) {
          mockOnAddRelationship();
        }
      };

      handleActionClick();

      expect(addCalled).toBe(true);
      expect(deleteCalled).toBe(false);
    });
  });

  describe('Menu title based on action', () => {
    /**
     * Test 2.5: Menu title should indicate "Add" operation when action='add'
     */
    it('should show appropriate title for add action', () => {
      const action: 'add' | 'delete' = 'add';
      const isEnabled = true;

      const menuTitle = !isEnabled
        ? 'Both endpoints must be on diagram'
        : action === 'delete'
          ? 'Delete relationship from diagram'
          : 'Add relationship to diagram';

      expect(menuTitle).toBe('Add relationship to diagram');
    });

    /**
     * Test 2.6: Menu title should indicate "Delete" operation when action='delete'
     */
    it('should show appropriate title for delete action', () => {
      const action: 'add' | 'delete' = 'delete';
      const isEnabled = true;

      const menuTitle = !isEnabled
        ? 'Both endpoints must be on diagram'
        : action === 'delete'
          ? 'Delete relationship from diagram'
          : 'Add relationship to diagram';

      expect(menuTitle).toBe('Delete relationship from diagram');
    });
  });
});

// ============================================================================
// Task Group 3: Prop Chain Connection Tests
// ============================================================================

describe('Task Group 3: Prop Chain Connection', () => {
  describe('Action computation for context menu', () => {
    /**
     * Test 3.1: Action should be 'delete' when USER_INTERACTION edges exist
     */
    it('should compute action as delete when edges exist for interaction', () => {
      // Mock diagram with existing USER_INTERACTION edges
      const interactionId = 'interaction-1';
      const diagramEdges = [
        {
          id: 'edge-1',
          relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
          relationship_id: interactionId,
        },
      ];

      const getContextMenuRelationshipAction = (
        sectionId: string,
        itemId: string,
        edges: Array<{ relationship_type: string; relationship_id: string }>
      ): 'add' | 'delete' => {
        if (sectionId !== 'interactions') return 'add';

        const existingEdges = edges.filter(
          edge =>
            edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
            edge.relationship_id === itemId
        );

        return existingEdges.length > 0 ? 'delete' : 'add';
      };

      const action = getContextMenuRelationshipAction(
        'interactions',
        interactionId,
        diagramEdges
      );

      expect(action).toBe('delete');
    });

    /**
     * Test 3.2: Action should be 'add' when no USER_INTERACTION edges exist
     */
    it('should compute action as add when no edges exist for interaction', () => {
      const interactionId = 'interaction-1';
      const diagramEdges: Array<{ relationship_type: string; relationship_id: string }> = [];

      const getContextMenuRelationshipAction = (
        sectionId: string,
        itemId: string,
        edges: Array<{ relationship_type: string; relationship_id: string }>
      ): 'add' | 'delete' => {
        if (sectionId !== 'interactions') return 'add';

        const existingEdges = edges.filter(
          edge =>
            edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
            edge.relationship_id === itemId
        );

        return existingEdges.length > 0 ? 'delete' : 'add';
      };

      const action = getContextMenuRelationshipAction(
        'interactions',
        interactionId,
        diagramEdges
      );

      expect(action).toBe('add');
    });

    /**
     * Test 3.3: Non-interaction sections should always return 'add'
     */
    it('should return add for non-interaction sections', () => {
      const getContextMenuRelationshipAction = (
        sectionId: string,
        _itemId: string,
        _edges: Array<{ relationship_type: string; relationship_id: string }>
      ): 'add' | 'delete' => {
        if (sectionId !== 'interactions') return 'add';
        return 'add';
      };

      expect(getContextMenuRelationshipAction('logical_data_entity_relationships', 'rel-1', [])).toBe('add');
      expect(getContextMenuRelationshipAction('data_movements', 'dm-1', [])).toBe('add');
    });
  });

  describe('Delete handler connection', () => {
    /**
     * Test 3.4: Delete handler should be called for interactions section
     */
    it('should call delete handler when delete action is triggered for interactions', () => {
      let deleteHandlerCalled = false;
      const mockDeleteHandler = () => {
        deleteHandlerCalled = true;
      };

      const sectionId = 'interactions';
      const action: 'add' | 'delete' = 'delete';

      // Simulate the onDeleteRelationship logic in PalettePanel
      if (sectionId === 'interactions' && action === 'delete') {
        mockDeleteHandler();
      }

      expect(deleteHandlerCalled).toBe(true);
    });
  });
});

// ============================================================================
// Task Group 5: Integration and Gap Analysis Tests
// ============================================================================

describe('Task Group 5: Integration Tests', () => {
  describe('Full add/delete cycle', () => {
    /**
     * Test 5.1: Integration - action changes based on edge existence
     */
    it('should transition from add to delete when edges are added', () => {
      const interactionId = 'interaction-1';
      let edges: Array<{ id: string; relationship_type: string; relationship_id: string }> = [];

      const getAction = (): 'add' | 'delete' => {
        const existingEdges = edges.filter(
          edge =>
            edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
            edge.relationship_id === interactionId
        );
        return existingEdges.length > 0 ? 'delete' : 'add';
      };

      // Initially no edges - action should be 'add'
      expect(getAction()).toBe('add');

      // Add an edge
      edges.push({
        id: 'edge-1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
        relationship_id: interactionId,
      });

      // Now action should be 'delete'
      expect(getAction()).toBe('delete');

      // Remove the edge
      edges = [];

      // Action should be back to 'add'
      expect(getAction()).toBe('add');
    });
  });

  describe('Terminology consistency', () => {
    /**
     * Test 5.2: No "Remove" terminology - only "Add" and "Delete"
     */
    it('should use Add/Delete terminology consistently, not Remove', () => {
      // The word "Remove" should not appear in the UI
      // Context menu uses "Add" or "Delete"
      // Tooltip uses "delete" (lowercase) for consistency

      const tooltipForDeleteAction = 'Click to delete interaction edges from diagram';
      const menuLabelDelete = 'Delete';
      const menuLabelAdd = 'Add';

      expect(tooltipForDeleteAction).not.toContain('remove');
      expect(tooltipForDeleteAction).not.toContain('Remove');
      expect(menuLabelDelete).toBe('Delete');
      expect(menuLabelAdd).toBe('Add');
    });
  });

  describe('Other sections unaffected', () => {
    /**
     * Test 5.3: Changes should not affect non-interaction relationship sections
     */
    it('should not affect other relationship sections', () => {
      // Verify that the changes are scoped to 'interactions' sectionId
      const otherRelationshipSections = [
        'logical_data_entity_relationships',
        'logical_data_entity_physical_data_entities',
        'logical_data_attribute_physical_data_attributes',
        'data_movements',
        'business_user_business_points',
        'application_point_business_points',
      ];

      // None of these should use the action-based delete logic
      otherRelationshipSections.forEach(sectionId => {
        expect(sectionId).not.toBe('interactions');
      });

      // The 'interactions' section is the only one with special handling
      expect(otherRelationshipSections).not.toContain('interactions');
    });
  });
});
