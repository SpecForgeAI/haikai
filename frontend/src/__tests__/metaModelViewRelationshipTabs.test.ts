/**
 * Tests for MetaModelView Relationship Tab Filtering
 *
 * Spec: Domain-Derived Relationship Visibility
 *
 * Task Group 2: Tests for MetaModelView relationship tab filtering
 *
 * These tests verify that MetaModelView correctly uses the centralized
 * derivation function to filter relationship tabs by domain.
 */

import { getOrderedRelationshipDisplayNamesForDomain } from '../config/relationshipDefinitions';

describe('MetaModelView Relationship Tab Filtering', () => {
  describe('APPLICATION domain relationship tabs', () => {
    it('should show correct relationship tabs for APPLICATION domain (LOCKED requirement)', () => {
      const appTabs = getOrderedRelationshipDisplayNamesForDomain('application');

      // LOCKED: APPLICATION must show these relationship tabs
      expect(appTabs).toContain('App Point <-> Business Point');
      expect(appTabs).toContain('Interactions');
      expect(appTabs).toContain('Interface <-> Entity');
      expect(appTabs).toContain('Data Movements');
      expect(appTabs).toContain('App Point <-> Business Logic');
    });

    it('should NOT show User <-> Business Point in APPLICATION domain', () => {
      const appTabs = getOrderedRelationshipDisplayNamesForDomain('application');
      expect(appTabs).not.toContain('User <-> Business Point');
    });
  });

  describe('DATA domain relationship tabs', () => {
    it('should show correct relationship tabs for DATA domain (LOCKED requirement)', () => {
      const dataTabs = getOrderedRelationshipDisplayNamesForDomain('data');

      // LOCKED: DATA must show these relationship tabs
      expect(dataTabs).toContain('Logical / Physical ER');
      expect(dataTabs).toContain('Logical <-> Physical Entities');
      expect(dataTabs).toContain('Logical <-> Physical Attributes');
      expect(dataTabs).toContain('Interface <-> Entity');
      expect(dataTabs).toContain('Data Movements');
    });

    it('should NOT show business-specific relationships in DATA domain', () => {
      const dataTabs = getOrderedRelationshipDisplayNamesForDomain('data');
      expect(dataTabs).not.toContain('User <-> Business Point');
      expect(dataTabs).not.toContain('Interactions');
    });
  });

  describe('BEHAVIOURAL domain relationship tabs', () => {
    it('should show correct relationship tabs for BEHAVIOURAL domain (LOCKED requirement)', () => {
      const behaviouralTabs = getOrderedRelationshipDisplayNamesForDomain('behavioural');

      // LOCKED: BEHAVIOURAL must show these relationship tabs
      expect(behaviouralTabs).toContain('Interactions');
      expect(behaviouralTabs).toContain('App Point <-> Business Logic');
    });

    it('should have exactly 2 relationship tabs for BEHAVIOURAL domain', () => {
      const behaviouralTabs = getOrderedRelationshipDisplayNamesForDomain('behavioural');
      expect(behaviouralTabs).toHaveLength(2);
    });
  });

  describe('UI domain relationship tabs', () => {
    it('should show no relationship tabs for UI domain (LOCKED requirement)', () => {
      const uiTabs = getOrderedRelationshipDisplayNamesForDomain('ui');

      // LOCKED: UI domain has no relationships from the canonical set
      expect(uiTabs).toHaveLength(0);
    });
  });

  describe('BUSINESS domain relationship tabs', () => {
    it('should show correct relationship tabs for BUSINESS domain (LOCKED requirement)', () => {
      const businessTabs = getOrderedRelationshipDisplayNamesForDomain('business');

      // LOCKED: BUSINESS must show these relationship tabs
      expect(businessTabs).toContain('User <-> Business Point');
      expect(businessTabs).toContain('App Point <-> Business Point');
      expect(businessTabs).toContain('Interactions');
    });

    it('should NOT show data-specific relationships in BUSINESS domain', () => {
      const businessTabs = getOrderedRelationshipDisplayNamesForDomain('business');
      expect(businessTabs).not.toContain('Logical / Physical ER');
      expect(businessTabs).not.toContain('Logical <-> Physical Entities');
    });
  });

  describe('Relationship tab ordering', () => {
    it('should maintain canonical order for APPLICATION domain tabs', () => {
      const appTabs = getOrderedRelationshipDisplayNamesForDomain('application');

      // Verify canonical order is maintained
      const appPointBpIndex = appTabs.indexOf('App Point <-> Business Point');
      const interactionsIndex = appTabs.indexOf('Interactions');
      const interfaceIndex = appTabs.indexOf('Interface <-> Entity');
      const dataMovementsIndex = appTabs.indexOf('Data Movements');
      const appBlIndex = appTabs.indexOf('App Point <-> Business Logic');

      expect(appPointBpIndex).toBeLessThan(interactionsIndex);
      expect(interactionsIndex).toBeLessThan(interfaceIndex);
      expect(interfaceIndex).toBeLessThan(dataMovementsIndex);
      expect(dataMovementsIndex).toBeLessThan(appBlIndex);
    });

    it('should maintain canonical order for DATA domain tabs', () => {
      const dataTabs = getOrderedRelationshipDisplayNamesForDomain('data');

      // Verify canonical order is maintained
      const logicalErIndex = dataTabs.indexOf('Logical / Physical ER');
      const logicalPhysicalEntitiesIndex = dataTabs.indexOf('Logical <-> Physical Entities');
      const logicalPhysicalAttrsIndex = dataTabs.indexOf('Logical <-> Physical Attributes');
      const interfaceIndex = dataTabs.indexOf('Interface <-> Entity');
      const dataMovementsIndex = dataTabs.indexOf('Data Movements');

      expect(logicalErIndex).toBeLessThan(logicalPhysicalEntitiesIndex);
      expect(logicalPhysicalEntitiesIndex).toBeLessThan(logicalPhysicalAttrsIndex);
      expect(logicalPhysicalAttrsIndex).toBeLessThan(interfaceIndex);
      expect(interfaceIndex).toBeLessThan(dataMovementsIndex);
    });
  });
});
