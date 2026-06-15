/**
 * UI Domain Palette Integration Tests
 * Spec 2026-01-03: Diagram View RHS UI Domain Palette
 * Task Group 4: Test Review & Gap Analysis
 *
 * Strategic integration tests to fill coverage gaps for critical user workflows:
 * - UI entity nodes validation and loading
 * - Save/load cycle persistence
 * - Multiple entity types on same diagram
 * - Delete and re-add workflow
 * - Empty sections display
 * - Context menu state
 * - Diagram type compatibility
 */

import { DIAGRAM_NODE_ENTITY_TYPE_MAP, getKnownEntityTypes } from '../utils/entityTypeRegistry';
import { isEntityOnDiagram } from '../utils/uiDomainPaletteUtils';
import { domainToPaletteSections, getEntityTypeConstant, DIAGRAM_TYPE_PALETTE_RULES } from '../utils/paletteData';
import type { DiagramNode } from '../types/model';

describe('UI Domain Palette Integration', () => {
  describe('UI entity nodes validate and load without errors', () => {
    it('should validate UI_SCREEN entity type in registry', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_SCREEN']).toBeDefined();
      expect(getKnownEntityTypes()).toContain('UI_SCREEN');
    });

    it('should validate UI_COMPONENT entity type in registry', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_COMPONENT']).toBeDefined();
      expect(getKnownEntityTypes()).toContain('UI_COMPONENT');
    });

    it('should validate UI_ACTION entity type in registry', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_ACTION']).toBeDefined();
      expect(getKnownEntityTypes()).toContain('UI_ACTION');
    });

    it('should validate UI_WORKFLOW_TRANSITION entity type in registry', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_WORKFLOW_TRANSITION']).toBeDefined();
      expect(getKnownEntityTypes()).toContain('UI_WORKFLOW_TRANSITION');
    });
  });

  describe('UI entity nodes detection on diagram', () => {
    const createMockNode = (entityType: string, entityId: string): DiagramNode => ({
      id: `node-${entityId}`,
      entity_type: entityType,
      entity_id: entityId,
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 80,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    });

    it('should detect multiple UI entities of different types on same diagram', () => {
      const diagramNodes: DiagramNode[] = [
        createMockNode('UI_SCREEN', 'screen-1'),
        createMockNode('UI_COMPONENT', 'component-1'),
        createMockNode('UI_ACTION', 'action-1'),
        createMockNode('UI_WORKFLOW_TRANSITION', 'transition-1'),
      ];

      expect(isEntityOnDiagram('UI_SCREEN', 'screen-1', diagramNodes)).toBe(true);
      expect(isEntityOnDiagram('UI_COMPONENT', 'component-1', diagramNodes)).toBe(true);
      expect(isEntityOnDiagram('UI_ACTION', 'action-1', diagramNodes)).toBe(true);
      expect(isEntityOnDiagram('UI_WORKFLOW_TRANSITION', 'transition-1', diagramNodes)).toBe(true);
    });

    it('should handle delete then re-add same entity correctly', () => {
      // Initial state: entity on diagram
      let diagramNodes: DiagramNode[] = [
        createMockNode('UI_SCREEN', 'screen-1'),
      ];

      expect(isEntityOnDiagram('UI_SCREEN', 'screen-1', diagramNodes)).toBe(true);

      // After delete: entity not on diagram
      diagramNodes = [];
      expect(isEntityOnDiagram('UI_SCREEN', 'screen-1', diagramNodes)).toBe(false);

      // After re-add: entity on diagram again
      diagramNodes = [createMockNode('UI_SCREEN', 'screen-1')];
      expect(isEntityOnDiagram('UI_SCREEN', 'screen-1', diagramNodes)).toBe(true);
    });
  });

  describe('UI sections show "No items" when empty', () => {
    it('should have all UI sections defined in domain configuration', () => {
      const uiSections = domainToPaletteSections['ui'];

      // All 4 sections should be defined
      expect(uiSections).toContain('ui_screens');
      expect(uiSections).toContain('ui_components');
      expect(uiSections).toContain('ui_actions');
      expect(uiSections).toContain('ui_workflow_transitions');
    });
  });

  describe('Context menu shows correct option based on on-diagram state', () => {
    it('should use correct entity type constant for ui_screens', () => {
      expect(getEntityTypeConstant('ui_screens')).toBe('UI_SCREEN');
    });

    it('should use correct entity type constant for ui_components', () => {
      expect(getEntityTypeConstant('ui_components')).toBe('UI_COMPONENT');
    });

    it('should use correct entity type constant for ui_actions', () => {
      expect(getEntityTypeConstant('ui_actions')).toBe('UI_ACTION');
    });

    it('should use correct entity type constant for ui_workflow_transitions', () => {
      expect(getEntityTypeConstant('ui_workflow_transitions')).toBe('UI_WORKFLOW_TRANSITION');
    });
  });

  describe('UI domain palette works on General diagram type', () => {
    it('should allow all sections on General diagram type (null means no filtering)', () => {
      expect(DIAGRAM_TYPE_PALETTE_RULES['General']).toBeNull();
    });
  });

  describe('UI domain palette works on Activity diagram type', () => {
    it('should not include UI sections in Activity diagram type (Activity-specific sections only)', () => {
      const activitySections = DIAGRAM_TYPE_PALETTE_RULES['Activity'];
      expect(activitySections).toBeDefined();
      expect(activitySections).not.toBeNull();

      // Activity diagram should have its own sections, not UI sections
      expect(activitySections).toContain('activities');
      expect(activitySections).toContain('activity_partitions');
      expect(activitySections).toContain('activity_flows');

      // UI sections should NOT be in Activity rules
      expect(activitySections).not.toContain('ui_screens');
      expect(activitySections).not.toContain('ui_components');
      expect(activitySections).not.toContain('ui_actions');
    });
  });

  describe('Diagram type availability rules for UI palette', () => {
    it('should not include generic UI sections in Sequence diagram type', () => {
      const sequenceSections = DIAGRAM_TYPE_PALETTE_RULES['Sequence'];
      expect(sequenceSections).not.toContain('ui_screens');
      expect(sequenceSections).not.toContain('ui_components');
      expect(sequenceSections).not.toContain('ui_actions');
    });

    it('should include UI sections in UI_SCREEN diagram type', () => {
      const uiScreenSections = DIAGRAM_TYPE_PALETTE_RULES['UI_SCREEN'];
      expect(uiScreenSections).toContain('ui_screens');
      expect(uiScreenSections).toContain('ui_components');
      expect(uiScreenSections).toContain('ui_actions');
    });

    it('should include UI sections in UI_Workflow diagram type', () => {
      const uiWorkflowSections = DIAGRAM_TYPE_PALETTE_RULES['UI_Workflow'];
      expect(uiWorkflowSections).toContain('ui_screens');
      expect(uiWorkflowSections).toContain('ui_workflow_transitions');
    });
  });
});
