/**
 * Task Group 1 Tests: Interactions Tab Configuration
 *
 * Tests to verify that 'Interactions' is only in relationshipTabToType (not tabToEntityType)
 * to prevent double-rendering in MetaModelView.
 *
 * Created as part of spec: 2025-12-09-fix-interactions-double-rendering-and-abp-mapping
 */

import {
  tabToEntityType,
  relationshipTabToType,
  entityTabNames,
  domainGroupings,
  relationshipTabNames,
  gridConfigs,
} from '../config/gridConfigs';

describe('Task Group 1: Interactions Tab Configuration (Fix Double-Rendering)', () => {
  describe('1.1.1 tabToEntityType must NOT contain Interactions', () => {
    it('should NOT have "Interactions" key in tabToEntityType', () => {
      // The root cause of double-rendering: Interactions was in BOTH mappings
      // After fix: Interactions should ONLY be in relationshipTabToType
      expect(tabToEntityType['Interactions']).toBeUndefined();
    });

    it('should have all other entity tabs in tabToEntityType', () => {
      // Verify other entity tabs are still present
      expect(tabToEntityType['Users']).toBe('business_users');
      expect(tabToEntityType['Processes']).toBe('business_processes');
      expect(tabToEntityType['Activities']).toBe('process_activities');
      expect(tabToEntityType['Applications']).toBe('applications');
      expect(tabToEntityType['App Components']).toBe('app_components');
      expect(tabToEntityType['Services']).toBe('services');
      expect(tabToEntityType['Interfaces']).toBe('interfaces');
      expect(tabToEntityType['Endpoints']).toBe('endpoints');
      expect(tabToEntityType['Logical Entities']).toBe('logical_data_entities');
      expect(tabToEntityType['Logical Attributes']).toBe('logical_data_attributes');
      expect(tabToEntityType['Physical Entities']).toBe('physical_data_entities');
      expect(tabToEntityType['Physical Attributes']).toBe('physical_data_attributes');
    });
  });

  describe('1.1.2 relationshipTabToType must contain Interactions', () => {
    it('should have "Interactions" key in relationshipTabToType', () => {
      expect(relationshipTabToType['Interactions']).toBe('interactions');
    });

    it('should have Interactions at the correct position in relationshipTabToType', () => {
      const keys = Object.keys(relationshipTabToType);
      const interactionsIndex = keys.indexOf('Interactions');
      const appPointIndex = keys.indexOf('App Point <-> Business Point');
      const logicalERIndex = keys.indexOf('Logical / Physical ER');

      // Interactions should be after 'App Point <-> Business Point' and before 'Logical ER'
      expect(interactionsIndex).toBeGreaterThan(appPointIndex);
      expect(interactionsIndex).toBeLessThan(logicalERIndex);
    });
  });

  describe('1.1.3 isEntityTab vs isRelationshipTab for Interactions', () => {
    it('should return isEntityTab = false for Interactions', () => {
      const selectedTab = 'Interactions';
      const isEntityTab = selectedTab in tabToEntityType;

      expect(isEntityTab).toBe(false);
    });

    it('should return isRelationshipTab = true for Interactions', () => {
      const selectedTab = 'Interactions';
      const isRelationshipTab = selectedTab in relationshipTabToType;

      expect(isRelationshipTab).toBe(true);
    });

    it('should result in ONLY RelationshipGrid being rendered (not both)', () => {
      // Simulating MetaModelView's render logic
      const selectedTab = 'Interactions';
      const isEntityTab = selectedTab in tabToEntityType;
      const isRelationshipTab = selectedTab in relationshipTabToType;

      // With the fix:
      // - isEntityTab should be false (so Grid is NOT rendered)
      // - isRelationshipTab should be true (so RelationshipGrid IS rendered)
      expect(isEntityTab).toBe(false);
      expect(isRelationshipTab).toBe(true);

      // This ensures only ONE grid (RelationshipGrid) is rendered
      const renderEntityGrid = isEntityTab;
      const renderRelationshipGrid = isRelationshipTab;

      expect(renderEntityGrid).toBe(false);
      expect(renderRelationshipGrid).toBe(true);
    });
  });

  describe('1.1.4 entityTabNames and domainGroupings', () => {
    it('should NOT have Interactions in entityTabNames', () => {
      expect(entityTabNames).not.toContain('Interactions');
    });

    it('should NOT have Interactions in domainGroupings.business', () => {
      expect(domainGroupings.business).not.toContain('Interactions');
    });

    it('should have Interactions in relationshipTabNames', () => {
      expect(relationshipTabNames).toContain('Interactions');
    });
  });

  describe('1.1.5 gridConfigs.interactions still exists', () => {
    it('should still have gridConfigs.interactions for column configuration', () => {
      // The grid config is still needed for RelationshipGrid to render columns
      // Removing from tabToEntityType does NOT affect gridConfigs
      expect(gridConfigs['interactions']).toBeDefined();
      expect(Array.isArray(gridConfigs['interactions'])).toBe(true);
    });

    it('should have correct columns in gridConfigs.interactions', () => {
      const columns = gridConfigs['interactions'];
      const fieldNames = columns.map((c) => c.field);

      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('user_id');
      expect(fieldNames).toContain('primary_app_business_point_id');
      expect(fieldNames).toContain('secondary_app_business_point_id');
    });
  });
});
