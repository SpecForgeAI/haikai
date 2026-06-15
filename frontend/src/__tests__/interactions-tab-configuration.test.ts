/**
 * Task Group 2: Move Interactions Tab to Relationships Row
 *
 * These tests verify that the Interactions tab is correctly configured:
 * - NOT in domainGroupings.business (entity domain)
 * - NOT in entityTabNames (entity tab list)
 * - IN relationshipTabNames at correct position (after "App Point <-> Business Point")
 * - IN relationshipTabToType with mapping to "interactions"
 * - tabToEntityType["Interactions"] retained for grid config lookup
 * - Correct tab ordering: "App Point <-> Business Point" -> "Interactions" -> "Logical / Physical ER"
 */

import { describe, it, expect } from 'vitest';
import {
  tabToEntityType,
  relationshipTabToType,
  entityTabNames,
  relationshipTabNames,
  domainGroupings,
} from '../config/gridConfigs';

describe('Task Group 2: Interactions Tab Configuration', () => {
  describe('2.1.1: Interactions NOT in domainGroupings.business', () => {
    it('should NOT include "Interactions" in domainGroupings.business array', () => {
      // Interactions should be removed from the business domain grouping
      // because it belongs in the Relationships row, not the Entities row
      expect(domainGroupings.business).not.toContain('Interactions');

      // Verify business domain only contains entity types
      // (Spec 2026-04-01 added User Journeys and Activity Steps)
      expect(domainGroupings.business).toEqual(['Users', 'Processes', 'Activities', 'User Journeys', 'Activity Steps']);
    });
  });

  describe('2.1.2: Interactions NOT in entityTabNames', () => {
    it('should NOT include "Interactions" in entityTabNames array', () => {
      // Interactions should be removed from entity tab names
      // because it routes to RelationshipGrid, not Grid (EntityGrid)
      expect(entityTabNames).not.toContain('Interactions');
    });

    it('should have all other entity tabs in entityTabNames', () => {
      // Verify that removing Interactions didn't affect other entity tabs.
      // The registry has grown a lot since this spec; assert membership of the
      // original core tabs rather than pinning the full (growing) list.
      const expectedEntityTabs = [
        'Users',
        'Processes',
        'Activities',
        // 'Interactions' removed
        'Applications',
        'App Components',
        'Services',
        'Interfaces',
        'Endpoints',
        'Logical Entities',
        'Logical Attributes',
        'Physical Entities',
        'Physical Attributes',
      ];

      for (const tab of expectedEntityTabs) {
        expect(entityTabNames).toContain(tab);
      }
    });
  });

  describe('2.1.3: Interactions IN relationshipTabNames at correct position', () => {
    it('should include "Interactions" in relationshipTabNames array', () => {
      // Interactions should be in the relationship tab names
      expect(relationshipTabNames).toContain('Interactions');
    });

    it('should position "Interactions" after "App Point <-> Business Point"', () => {
      const appPointIndex = relationshipTabNames.indexOf('App Point <-> Business Point');
      const interactionsIndex = relationshipTabNames.indexOf('Interactions');

      // Interactions should come immediately after App Point <-> Business Point
      expect(interactionsIndex).toBe(appPointIndex + 1);
    });

    it('should position "Interactions" before "Logical / Physical ER"', () => {
      const interactionsIndex = relationshipTabNames.indexOf('Interactions');
      const logicalERIndex = relationshipTabNames.indexOf('Logical / Physical ER');

      // Interactions should come immediately before Logical ER
      expect(logicalERIndex).toBe(interactionsIndex + 1);
    });
  });

  describe('2.1.4: Interactions entry in relationshipTabToType maps to "interactions"', () => {
    it('should map "Interactions" to "interactions" in relationshipTabToType', () => {
      // This mapping is needed for RelationshipGrid to know which data type to access
      expect(relationshipTabToType['Interactions']).toBe('interactions');
    });

    it('should have all expected relationship tab mappings', () => {
      // Verify all relationship tabs are mapped correctly
      expect(relationshipTabToType['User <-> Business Point']).toBe('business_user_business_points');
      expect(relationshipTabToType['App Point <-> Business Point']).toBe('application_point_business_points');
      expect(relationshipTabToType['Interactions']).toBe('interactions');
      expect(relationshipTabToType['Logical / Physical ER']).toBe('logical_data_entity_relationships');
      expect(relationshipTabToType['Logical <-> Physical Entities']).toBe('logical_data_entity_physical_data_entities');
      expect(relationshipTabToType['Logical <-> Physical Attributes']).toBe('logical_data_attribute_physical_data_attributes');
      expect(relationshipTabToType['Interface <-> Entity']).toBe('interface_logical_entities');
      expect(relationshipTabToType['Data Movements']).toBe('data_movements');
    });
  });

  describe('2.1.5: tabToEntityType must NOT include Interactions (prevents double-rendering)', () => {
    it('should NOT have "Interactions" in tabToEntityType', () => {
      // IMPORTANT: tabToEntityType must NOT include 'Interactions'
      // Having it in both tabToEntityType and relationshipTabToType causes
      // BOTH isEntityTab and isRelationshipTab to be true, resulting in
      // double grid rendering (spec: 2025-12-09-fix-interactions-double-rendering)
      expect(tabToEntityType['Interactions']).toBeUndefined();
    });
  });

  describe('2.1.6: Tab ordering verification', () => {
    it('should have correct tab ordering in relationshipTabNames', () => {
      // Expected order: "User <-> Business Point", "App Point <-> Business Point",
      // "Interactions", "Logical / Physical ER", and remaining tabs
      const expectedOrder = [
        'User <-> Business Point',
        'App Point <-> Business Point',
        'Interactions',
        'Logical / Physical ER',
        'Logical <-> Physical Entities',
        'Logical <-> Physical Attributes',
        'Interface <-> Entity',
        'Data Movements',
      ];

      // The relationship registry has grown (infrastructure, libraries, ...);
      // assert the original tabs still appear in this relative order rather
      // than pinning the full list.
      const indices = expectedOrder.map((name) => relationshipTabNames.indexOf(name));
      for (const idx of indices) expect(idx).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1]);
      }
    });

    it('should position Interactions in the correct conceptual grouping', () => {
      // Tab ordering rationale:
      // 1. User relationships: "User <-> Business Point"
      // 2. App-business relationships: "App Point <-> Business Point"
      // 3. Interactions: "Interactions" (app-to-app or user-to-app interactions)
      // 4. Data relationships: "Logical / Physical ER", etc.

      const userRelIndex = relationshipTabNames.indexOf('User <-> Business Point');
      const appPointIndex = relationshipTabNames.indexOf('App Point <-> Business Point');
      const interactionsIndex = relationshipTabNames.indexOf('Interactions');
      const logicalERIndex = relationshipTabNames.indexOf('Logical / Physical ER');

      // Verify ordering: user relations -> app-business relations -> interactions -> data relations
      expect(userRelIndex).toBeLessThan(appPointIndex);
      expect(appPointIndex).toBeLessThan(interactionsIndex);
      expect(interactionsIndex).toBeLessThan(logicalERIndex);
    });
  });
});

describe('Task 2.4: Verify MetaModelView routing logic (configuration only)', () => {
  it('should route Interactions to RelationshipGrid via isRelationshipTab check', () => {
    // MetaModelView.tsx routing logic:
    // const isEntityTab = state.selectedTab in tabToEntityType;
    // const isRelationshipTab = state.selectedTab in relationshipTabToType;

    const selectedTab = 'Interactions';

    // After the configuration changes, isRelationshipTab should be true
    const isRelationshipTab = selectedTab in relationshipTabToType;
    expect(isRelationshipTab).toBe(true);

    // IMPORTANT: isEntityTab must be FALSE to prevent double-rendering
    // (spec: 2025-12-09-fix-interactions-double-rendering)
    // Interactions should ONLY be in relationshipTabToType, NOT tabToEntityType
    const isEntityTab = selectedTab in tabToEntityType;
    expect(isEntityTab).toBe(false); // Must be false to render only RelationshipGrid
  });

  it('should render Interactions in relationshipTabNames.map() output', () => {
    // MetaModelView.tsx renders relationship tabs via:
    // {relationshipTabNames.map((tabName) => ...)}

    // Verify Interactions is now included in this mapping
    const renderedTabs = relationshipTabNames.map((tabName) => tabName);
    expect(renderedTabs).toContain('Interactions');
  });
});
