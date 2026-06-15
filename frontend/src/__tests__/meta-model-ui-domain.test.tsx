/**
 * Meta-Model UI Domain Tab Unit Tests
 *
 * Spec 2026-01-03: Meta-Model UI Domain Tab
 * Tests for the UI domain tab feature in the Meta-Model View.
 *
 * These tests verify:
 * 1. UI domain is present in ALL_DOMAINS
 * 2. UI domain tab names are correctly configured
 * 3. UIComponent and UIAction types exist in model.ts
 * 4. emptyModel contains ui_components and ui_actions arrays
 * 5. Relationships row is hidden when UI domain is selected
 */

import { describe, it, expect } from 'vitest';
import { ALL_DOMAINS, DOMAIN_LABELS, DOMAIN_ICONS } from '../types/architectureDomain';
import { domainGroupings, DOMAIN_ENTITY_TYPES, tabToEntityType, entityTabNames } from '../config/gridConfigs';
import { emptyModel, uiComponentTypeOptions, uiActionTriggerTypeOptions, uiActionOwnerTypeOptions, uiActionEffectTypeOptions, entityColors } from '../config/defaults';
// getRelationshipTabsForDomain is no longer exported from MetaModelView --
// domain-derived relationship visibility now lives in config/relationshipDefinitions.
import { getRelationshipsForDomain } from '../config/relationshipDefinitions';

describe('Meta-Model UI Domain Tab', () => {
  describe('1. UI domain is present in ALL_DOMAINS', () => {
    it('should include "ui" in ALL_DOMAINS array', () => {
      expect(ALL_DOMAINS).toContain('ui');
    });

    it('should have 6 domains total', () => {
      expect(ALL_DOMAINS).toHaveLength(6);
      expect(ALL_DOMAINS).toEqual(['business', 'application', 'data', 'behavioural', 'ui', 'infrastructure']);
    });

    it('should have UI label in DOMAIN_LABELS', () => {
      expect(DOMAIN_LABELS.ui).toBe('UI');
    });

    it('should have UI icon in DOMAIN_ICONS', () => {
      expect(DOMAIN_ICONS.ui).toBeDefined();
    });
  });

  describe('2. UI domain tab names are correctly configured', () => {
    it('should have UI domain groupings with 5 tabs', () => {
      // Spec 2026-01-20 added 'UI Characteristics' as the 5th tab
      expect(domainGroupings.ui).toBeDefined();
      expect(domainGroupings.ui).toHaveLength(5);
    });

    it('should have correct tab names for UI domain', () => {
      expect(domainGroupings.ui).toEqual([
        'UI Screens',
        'UI Workflow Transitions',
        'UI Components',
        'UI Actions',
        'UI Characteristics',
      ]);
    });

    it('should have UI tabs mapped in tabToEntityType', () => {
      expect(tabToEntityType['UI Screens']).toBe('ui_screens');
      expect(tabToEntityType['UI Workflow Transitions']).toBe('ui_workflow_transitions');
      expect(tabToEntityType['UI Components']).toBe('ui_components');
      expect(tabToEntityType['UI Actions']).toBe('ui_actions');
    });

    it('should have UI entity types in DOMAIN_ENTITY_TYPES', () => {
      expect(DOMAIN_ENTITY_TYPES.ui).toContain('ui_screens');
      expect(DOMAIN_ENTITY_TYPES.ui).toContain('ui_workflow_transitions');
      expect(DOMAIN_ENTITY_TYPES.ui).toContain('ui_components');
      expect(DOMAIN_ENTITY_TYPES.ui).toContain('ui_actions');
    });
  });

  describe('3. UIComponent and UIAction types exist', () => {
    it('should have ui_components in entityTabNames', () => {
      expect(entityTabNames).toContain('UI Components');
    });

    it('should have ui_actions in entityTabNames', () => {
      expect(entityTabNames).toContain('UI Actions');
    });

    it('should have UI_COMPONENT entity colors', () => {
      expect(entityColors.UI_COMPONENT).toBeDefined();
      expect(entityColors.UI_COMPONENT.background).toBe('#E8EAF6');
      expect(entityColors.UI_COMPONENT.border).toBe('#3F51B5');
    });

    it('should have UI_ACTION entity colors', () => {
      expect(entityColors.UI_ACTION).toBeDefined();
      expect(entityColors.UI_ACTION.background).toBe('#E3F2FD');
      expect(entityColors.UI_ACTION.border).toBe('#2196F3');
    });
  });

  describe('4. emptyModel contains ui_components and ui_actions arrays', () => {
    it('should have ui_components array in emptyModel', () => {
      expect(emptyModel.metaModel.entities.ui_components).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.ui_components)).toBe(true);
      expect(emptyModel.metaModel.entities.ui_components).toHaveLength(0);
    });

    it('should have ui_actions array in emptyModel', () => {
      expect(emptyModel.metaModel.entities.ui_actions).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.ui_actions)).toBe(true);
      expect(emptyModel.metaModel.entities.ui_actions).toHaveLength(0);
    });
  });

  describe('5. Relationships row is hidden when UI domain is selected', () => {
    it('should return empty array for UI domain relationships', () => {
      const uiRelationships = getRelationshipsForDomain('ui');
      expect(uiRelationships).toHaveLength(0);
    });

    it('should return relationships for other domains', () => {
      const businessRelationships = getRelationshipsForDomain('business');
      expect(businessRelationships.length).toBeGreaterThan(0);

      const dataRelationships = getRelationshipsForDomain('data');
      expect(dataRelationships.length).toBeGreaterThan(0);
    });
  });

  describe('UI option arrays are correctly configured', () => {
    it('should have uiComponentTypeOptions with correct values', () => {
      expect(uiComponentTypeOptions).toBeDefined();
      expect(uiComponentTypeOptions).toContain('Button');
      expect(uiComponentTypeOptions).toContain('Form');
      expect(uiComponentTypeOptions).toContain('Modal');
      expect(uiComponentTypeOptions).toContain('Table');
      expect(uiComponentTypeOptions).toContain('Card');
      expect(uiComponentTypeOptions).toContain('Navigation');
      expect(uiComponentTypeOptions).toContain('Input');
      expect(uiComponentTypeOptions).toContain('Other');
    });

    it('should have uiActionTriggerTypeOptions with correct values', () => {
      expect(uiActionTriggerTypeOptions).toBeDefined();
      expect(uiActionTriggerTypeOptions).toContain('Click');
      expect(uiActionTriggerTypeOptions).toContain('Submit');
      expect(uiActionTriggerTypeOptions).toContain('Change');
      expect(uiActionTriggerTypeOptions).toContain('Focus');
      expect(uiActionTriggerTypeOptions).toContain('Blur');
      expect(uiActionTriggerTypeOptions).toContain('Load');
      expect(uiActionTriggerTypeOptions).toContain('Unload');
      expect(uiActionTriggerTypeOptions).toContain('Other');
    });

    it('should have uiActionOwnerTypeOptions with correct values', () => {
      expect(uiActionOwnerTypeOptions).toBeDefined();
      expect(uiActionOwnerTypeOptions).toContain('Screen');
      expect(uiActionOwnerTypeOptions).toContain('Component');
      expect(uiActionOwnerTypeOptions).toContain('Other');
    });

    it('should have uiActionEffectTypeOptions with correct values', () => {
      expect(uiActionEffectTypeOptions).toBeDefined();
      expect(uiActionEffectTypeOptions).toContain('Navigate');
      expect(uiActionEffectTypeOptions).toContain('Submit');
      expect(uiActionEffectTypeOptions).toContain('Validate');
      expect(uiActionEffectTypeOptions).toContain('Update');
      expect(uiActionEffectTypeOptions).toContain('Delete');
      expect(uiActionEffectTypeOptions).toContain('Open');
      expect(uiActionEffectTypeOptions).toContain('Close');
      expect(uiActionEffectTypeOptions).toContain('Other');
    });
  });
});
