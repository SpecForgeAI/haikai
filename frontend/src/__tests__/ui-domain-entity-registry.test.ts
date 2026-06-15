/**
 * UI Domain Entity Type Registry Tests
 * Spec 2026-01-03: Diagram View RHS UI Domain Palette
 * Task Group 1: Entity Type Registration
 *
 * Tests that all UI entity types are properly registered in the entity type registry.
 */

import { DIAGRAM_NODE_ENTITY_TYPE_MAP, getKnownEntityTypes } from '../utils/entityTypeRegistry';

describe('UI Domain Entity Type Registry', () => {
  describe('DIAGRAM_NODE_ENTITY_TYPE_MAP', () => {
    it('should map UI_SCREEN to ui_screens', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_SCREEN']).toBe('ui_screens');
    });

    it('should map UI_WORKFLOW_TRANSITION to ui_workflow_transitions', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_WORKFLOW_TRANSITION']).toBe('ui_workflow_transitions');
    });

    it('should map UI_COMPONENT to ui_components', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_COMPONENT']).toBe('ui_components');
    });

    it('should map UI_ACTION to ui_actions', () => {
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['UI_ACTION']).toBe('ui_actions');
    });
  });

  describe('getKnownEntityTypes', () => {
    it('should include all 4 UI entity types', () => {
      const knownTypes = getKnownEntityTypes();

      expect(knownTypes).toContain('UI_SCREEN');
      expect(knownTypes).toContain('UI_WORKFLOW_TRANSITION');
      expect(knownTypes).toContain('UI_COMPONENT');
      expect(knownTypes).toContain('UI_ACTION');
    });
  });
});
