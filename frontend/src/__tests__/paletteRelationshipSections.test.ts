/**
 * Tests for Palette Relationship Section Filtering
 *
 * Spec: Domain-Derived Relationship Visibility
 *
 * Task Group 3: Tests for palette relationship section filtering
 *
 * These tests verify that the palette correctly filters relationship sections
 * by domain using the centralized derivation logic.
 */

import { domainToPaletteSections, getPaletteSections } from '../utils/paletteData';
import { getRelationshipsForDomain, relationshipKeyToDisplayName } from '../config/relationshipDefinitions';

describe('Palette Relationship Section Filtering', () => {
  describe('domainToPaletteSections relationship derivation', () => {
    it('should include correct relationship sections for BUSINESS domain', () => {
      const businessSections = domainToPaletteSections.business;

      // LOCKED: BUSINESS must include these relationship sections
      expect(businessSections).toContain('business_user_business_points');
      expect(businessSections).toContain('application_point_business_points');
      expect(businessSections).toContain('interactions');
    });

    it('should include correct relationship sections for APPLICATION domain', () => {
      const appSections = domainToPaletteSections.application;

      // LOCKED: APPLICATION must include these relationship sections
      expect(appSections).toContain('application_point_business_points');
      expect(appSections).toContain('interactions');
      expect(appSections).toContain('interface_logical_entities');
      expect(appSections).toContain('data_movements');
      expect(appSections).toContain('application_point_business_logics');

      // Non-canonical relationship that should also be present
      expect(appSections).toContain('ui_workflow_transitions');
    });

    it('should include correct relationship sections for DATA domain', () => {
      const dataSections = domainToPaletteSections.data;

      // LOCKED: DATA must include these relationship sections
      expect(dataSections).toContain('logical_data_entity_relationships');
      expect(dataSections).toContain('logical_data_entity_physical_data_entities');
      expect(dataSections).toContain('logical_data_attribute_physical_data_attributes');
      expect(dataSections).toContain('interface_logical_entities');
      expect(dataSections).toContain('data_movements');
    });

    it('should include correct relationship sections for BEHAVIOURAL domain', () => {
      const behaviouralSections = domainToPaletteSections.behavioural;

      // LOCKED: BEHAVIOURAL must include these relationship sections
      expect(behaviouralSections).toContain('interactions');
      expect(behaviouralSections).toContain('application_point_business_logics');
    });

    it('should include no canonical relationship sections for UI domain', () => {
      const uiSections = domainToPaletteSections.ui;
      const canonicalRelationships = getRelationshipsForDomain('ui');

      // LOCKED: UI domain has no canonical relationships
      expect(canonicalRelationships).toHaveLength(0);

      // But ui_workflow_transitions (non-canonical) should still be present
      expect(uiSections).toContain('ui_workflow_transitions');
    });

    it('should NOT include business-only relationships in DATA domain', () => {
      const dataSections = domainToPaletteSections.data;

      expect(dataSections).not.toContain('business_user_business_points');
      expect(dataSections).not.toContain('interactions');
    });

    it('should NOT include data-only relationships in BUSINESS domain', () => {
      const businessSections = domainToPaletteSections.business;

      expect(businessSections).not.toContain('logical_data_entity_relationships');
      expect(businessSections).not.toContain('logical_data_entity_physical_data_entities');
    });
  });

  describe('Relationship section labels', () => {
    it('should use "Logical / Physical ER" as the display name for logical_data_entity_relationships', () => {
      expect(relationshipKeyToDisplayName['logical_data_entity_relationships']).toBe('Logical / Physical ER');
    });

    it('should use "Interactions" as the display name for interactions', () => {
      expect(relationshipKeyToDisplayName['interactions']).toBe('Interactions');
    });

    it('should use "App Point <-> Business Logic" as the display name for application_point_business_logics', () => {
      expect(relationshipKeyToDisplayName['application_point_business_logics']).toBe('App Point <-> Business Logic');
    });
  });

  describe('Entity sections remain unchanged', () => {
    it('should include entity sections for BUSINESS domain', () => {
      const businessSections = domainToPaletteSections.business;

      expect(businessSections).toContain('business_users');
      expect(businessSections).toContain('business_processes');
      expect(businessSections).toContain('process_activities');
    });

    it('should include entity sections for APPLICATION domain', () => {
      const appSections = domainToPaletteSections.application;

      expect(appSections).toContain('applications');
      expect(appSections).toContain('app_components');
      expect(appSections).toContain('services');
      expect(appSections).toContain('interfaces');
      expect(appSections).toContain('endpoints');
      expect(appSections).toContain('classes');
      expect(appSections).toContain('methods');
    });

    it('should include entity sections for DATA domain', () => {
      const dataSections = domainToPaletteSections.data;

      expect(dataSections).toContain('logical_data_entities');
      expect(dataSections).toContain('logical_data_attributes');
      expect(dataSections).toContain('physical_data_entities');
      expect(dataSections).toContain('physical_data_attributes');
    });

    it('should include entity sections for BEHAVIOURAL domain', () => {
      const behaviouralSections = domainToPaletteSections.behavioural;

      expect(behaviouralSections).toContain('events');
      expect(behaviouralSections).toContain('states');
      expect(behaviouralSections).toContain('state_transitions');
      expect(behaviouralSections).toContain('activities');
      expect(behaviouralSections).toContain('activity_flows');
      expect(behaviouralSections).toContain('activity_partitions');
    });

    it('should include entity sections for UI domain', () => {
      const uiSections = domainToPaletteSections.ui;

      expect(uiSections).toContain('ui_screens');
      expect(uiSections).toContain('ui_components');
      expect(uiSections).toContain('ui_actions');
    });
  });

  describe('getPaletteSections with domain filtering', () => {
    const mockMetaModel = {
      entities: {
        business_users: [{ id: 'bu1', name: 'User 1' }],
        business_processes: [],
        process_activities: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        classes: [],
        methods: [],
        ui_screens: [],
        ui_components: [],
        ui_actions: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        interactions: [{ id: 'int1', name: 'Interaction 1' }],
        business_logics: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        ui_workflow_transitions: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        interface_logical_entities: [],
        data_movements: [],
        application_point_business_logics: [],
      },
    } as any;

    it('should filter sections by BUSINESS domain', () => {
      const sections = getPaletteSections(mockMetaModel, '', 'business');
      const sectionIds = sections.map(s => s.id);

      // Should include business entities and relationships
      expect(sectionIds).toContain('business_users');
      expect(sectionIds).toContain('interactions');

      // Should NOT include data-specific sections
      expect(sectionIds).not.toContain('logical_data_entities');
      expect(sectionIds).not.toContain('logical_data_entity_relationships');
    });

    it('should filter sections by DATA domain', () => {
      const sections = getPaletteSections(mockMetaModel, '', 'data');
      const sectionIds = sections.map(s => s.id);

      // Should include data entities and relationships
      expect(sectionIds).toContain('logical_data_entities');
      expect(sectionIds).toContain('logical_data_entity_relationships');

      // Should NOT include business-specific sections
      expect(sectionIds).not.toContain('business_users');
      expect(sectionIds).not.toContain('interactions');
    });

    it('should include both entity and relationship sections for APPLICATION domain', () => {
      const sections = getPaletteSections(mockMetaModel, '', 'application');
      const sectionIds = sections.map(s => s.id);

      // Entities
      expect(sectionIds).toContain('applications');
      expect(sectionIds).toContain('services');

      // Relationships
      expect(sectionIds).toContain('application_point_business_points');
      expect(sectionIds).toContain('interactions');
      expect(sectionIds).toContain('data_movements');
    });
  });
});
