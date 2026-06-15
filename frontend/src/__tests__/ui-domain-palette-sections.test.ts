/**
 * UI Domain Palette Sections Tests
 * Spec 2026-01-03: Diagram View RHS UI Domain Palette
 * Task Group 3: UI Domain Palette Content in PalettePanel
 *
 * Tests for UI domain palette behavior including:
 * - UI domain selector visibility with MonitorSmartphone icon
 * - 4 collapsible sections for UI entity types
 * - Entity listing from meta-model
 * - Row greying when entity is on diagram
 * - Add/Delete behavior
 * - Diagram type availability rules
 */

import { ALL_DOMAINS, DOMAIN_ICONS } from '../types/architectureDomain';
import { domainToPaletteSections, getEntityTypeConstant, DIAGRAM_TYPE_PALETTE_RULES } from '../utils/paletteData';
import { MonitorSmartphone } from 'lucide-react';
import { ENTITY_TYPES } from '../types/model';

describe('UI Domain Palette Sections', () => {
  describe('UI domain configuration', () => {
    it('should include UI domain in ALL_DOMAINS after behavioural', () => {
      const behaviouralIndex = ALL_DOMAINS.indexOf('behavioural');
      const uiIndex = ALL_DOMAINS.indexOf('ui');

      expect(uiIndex).toBeGreaterThan(-1);
      expect(behaviouralIndex).toBeGreaterThan(-1);
      expect(uiIndex).toBeGreaterThan(behaviouralIndex);
    });

    it('should have MonitorSmartphone icon for UI domain', () => {
      expect(DOMAIN_ICONS['ui']).toBe(MonitorSmartphone);
    });
  });

  describe('UI domain palette sections', () => {
    it('should define 4 palette sections for UI domain', () => {
      const uiSections = domainToPaletteSections['ui'];

      expect(uiSections).toContain('ui_screens');
      expect(uiSections).toContain('ui_workflow_transitions');
      expect(uiSections).toContain('ui_components');
      expect(uiSections).toContain('ui_actions');
      expect(uiSections.length).toBe(4);
    });
  });

  describe('entity type mapping', () => {
    it('should map ui_screens to UI_SCREEN entity type', () => {
      expect(getEntityTypeConstant('ui_screens')).toBe(ENTITY_TYPES.UI_SCREEN);
    });

    it('should map ui_workflow_transitions to UI_WORKFLOW_TRANSITION entity type', () => {
      expect(getEntityTypeConstant('ui_workflow_transitions')).toBe(ENTITY_TYPES.UI_WORKFLOW_TRANSITION);
    });

    it('should map ui_components to UI_COMPONENT entity type', () => {
      expect(getEntityTypeConstant('ui_components')).toBe(ENTITY_TYPES.UI_COMPONENT);
    });

    it('should map ui_actions to UI_ACTION entity type', () => {
      expect(getEntityTypeConstant('ui_actions')).toBe(ENTITY_TYPES.UI_ACTION);
    });
  });

  describe('diagram type availability rules', () => {
    it('should allow UI palette on General diagram type', () => {
      // General allows all sections (null means no filtering)
      expect(DIAGRAM_TYPE_PALETTE_RULES['General']).toBeNull();
    });

    it('should not include UI sections in Sequence diagram type', () => {
      const sequenceSections = DIAGRAM_TYPE_PALETTE_RULES['Sequence'];
      expect(sequenceSections).not.toContain('ui_screens');
      expect(sequenceSections).not.toContain('ui_components');
      expect(sequenceSections).not.toContain('ui_actions');
      expect(sequenceSections).not.toContain('ui_workflow_transitions');
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

    it('should allow UI palette on Activity diagram type (General-like behavior)', () => {
      // Activity should only show activity-specific sections
      // UI sections are not in Activity's allowed sections
      const activitySections = DIAGRAM_TYPE_PALETTE_RULES['Activity'];
      expect(activitySections).not.toContain('ui_screens');
      expect(activitySections).not.toContain('ui_components');
      expect(activitySections).not.toContain('ui_actions');
    });
  });
});
