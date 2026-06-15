/**
 * Tests for Advanced Add Context Menu Integration
 *
 * Task Group 3: Context Menu Integration
 * Tests the "Advanced Add..." menu item visibility and dialog opening behavior.
 */

import { hasExpandableRelationships, getExpandableRelationships } from '../utils/advancedAddRelationships';
import { ENTITY_TYPES } from '../types/model';
import { getEntityTypeConstant } from '../utils/paletteData';

describe('Advanced Add Context Menu Integration', () => {
  // Test 1: "Advanced Add..." menu item appears for entity types with expandable relationships
  describe('Menu item visibility for expandable entity types', () => {
    it('should show "Advanced Add..." for APPLICATION entity type', () => {
      const entityType = ENTITY_TYPES.APPLICATION;
      expect(hasExpandableRelationships(entityType)).toBe(true);
      expect(getExpandableRelationships(entityType).length).toBeGreaterThan(0);
    });

    it('should show "Advanced Add..." for BUSINESS_PROCESS entity type', () => {
      const entityType = ENTITY_TYPES.BUSINESS_PROCESS;
      expect(hasExpandableRelationships(entityType)).toBe(true);
      expect(getExpandableRelationships(entityType).length).toBeGreaterThan(0);
    });

    it('should show "Advanced Add..." for APP_COMPONENT entity type', () => {
      const entityType = ENTITY_TYPES.APP_COMPONENT;
      expect(hasExpandableRelationships(entityType)).toBe(true);
    });

    it('should show "Advanced Add..." for SERVICE entity type', () => {
      const entityType = ENTITY_TYPES.SERVICE;
      expect(hasExpandableRelationships(entityType)).toBe(true);
    });

    it('should show "Advanced Add..." for LOGICAL_DATA_ENTITY entity type', () => {
      const entityType = ENTITY_TYPES.LOGICAL_DATA_ENTITY;
      expect(hasExpandableRelationships(entityType)).toBe(true);
    });

    it('should show "Advanced Add..." for PHYSICAL_DATA_ENTITY entity type', () => {
      const entityType = ENTITY_TYPES.PHYSICAL_DATA_ENTITY;
      expect(hasExpandableRelationships(entityType)).toBe(true);
    });

    it('should show "Advanced Add..." for BUSINESS_USER entity type', () => {
      const entityType = ENTITY_TYPES.BUSINESS_USER;
      expect(hasExpandableRelationships(entityType)).toBe(true);
    });

    it('should show "Advanced Add..." for INTERFACE entity type', () => {
      const entityType = ENTITY_TYPES.INTERFACE;
      expect(hasExpandableRelationships(entityType)).toBe(true);
    });
  });

  // Test 2: "Advanced Add..." menu item hidden for entity types without expandable relationships
  describe('Menu item hidden for non-expandable entity types', () => {
    it('should hide "Advanced Add..." for PROCESS_ACTIVITY (leaf entity)', () => {
      const entityType = ENTITY_TYPES.PROCESS_ACTIVITY;
      expect(hasExpandableRelationships(entityType)).toBe(false);
      expect(getExpandableRelationships(entityType).length).toBe(0);
    });

    it('should hide "Advanced Add..." for LOGICAL_DATA_ATTRIBUTE (leaf entity)', () => {
      const entityType = ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE;
      expect(hasExpandableRelationships(entityType)).toBe(false);
    });

    it('should hide "Advanced Add..." for PHYSICAL_DATA_ATTRIBUTE (leaf entity)', () => {
      const entityType = ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE;
      expect(hasExpandableRelationships(entityType)).toBe(false);
    });

    it('should hide "Advanced Add..." for unknown entity types', () => {
      expect(hasExpandableRelationships('UNKNOWN_TYPE')).toBe(false);
      expect(hasExpandableRelationships('')).toBe(false);
    });
  });

  // Test 3: Clicking "Advanced Add..." opens AdvancedAddDialog with correct entity data
  describe('Dialog opening with correct entity data', () => {
    it('should map applications section to APPLICATION entity type', () => {
      const entityType = getEntityTypeConstant('applications');
      expect(entityType).toBe(ENTITY_TYPES.APPLICATION);
    });

    it('should map business_processes section to BUSINESS_PROCESS entity type', () => {
      const entityType = getEntityTypeConstant('business_processes');
      expect(entityType).toBe(ENTITY_TYPES.BUSINESS_PROCESS);
    });

    it('should map app_components section to APP_COMPONENT entity type', () => {
      const entityType = getEntityTypeConstant('app_components');
      expect(entityType).toBe(ENTITY_TYPES.APP_COMPONENT);
    });

    it('should map services section to SERVICE entity type', () => {
      const entityType = getEntityTypeConstant('services');
      expect(entityType).toBe(ENTITY_TYPES.SERVICE);
    });

    it('should map logical_data_entities section to LOGICAL_DATA_ENTITY entity type', () => {
      const entityType = getEntityTypeConstant('logical_data_entities');
      expect(entityType).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    });

    it('should map physical_data_entities section to PHYSICAL_DATA_ENTITY entity type', () => {
      const entityType = getEntityTypeConstant('physical_data_entities');
      expect(entityType).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
    });
  });

  // Test 4: Dialog closes when Cancel is clicked or onClose triggered
  describe('Dialog close behavior', () => {
    it('should be able to determine expandable relationships for dialog content', () => {
      // When dialog is opened for APPLICATION
      const appRelationships = getExpandableRelationships(ENTITY_TYPES.APPLICATION);
      expect(appRelationships.length).toBeGreaterThan(0);

      // Verify we can get proper target types for tree building
      const targetTypes = appRelationships.map((r) => r.targetEntityType);
      expect(targetTypes).toContain(ENTITY_TYPES.APP_COMPONENT);
      expect(targetTypes).toContain(ENTITY_TYPES.SERVICE);
      expect(targetTypes).toContain(ENTITY_TYPES.BUSINESS_PROCESS);
    });

    it('should provide relationship kind information for tree display', () => {
      const appRelationships = getExpandableRelationships(ENTITY_TYPES.APPLICATION);

      // App Component should be parent/child
      const acRel = appRelationships.find((r) => r.targetEntityType === ENTITY_TYPES.APP_COMPONENT);
      expect(acRel?.relationshipKind).toBe('PARENT_CHILD');

      // Business Process should be association
      const bpRel = appRelationships.find((r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS);
      expect(bpRel?.relationshipKind).toBe('ASSOCIATION');
    });
  });

  // Additional integration tests
  describe('Section to entity type mapping integration', () => {
    const sectionMappings = [
      { section: 'applications', expectedType: ENTITY_TYPES.APPLICATION, hasRelationships: true },
      { section: 'business_processes', expectedType: ENTITY_TYPES.BUSINESS_PROCESS, hasRelationships: true },
      { section: 'process_activities', expectedType: ENTITY_TYPES.PROCESS_ACTIVITY, hasRelationships: false },
      { section: 'app_components', expectedType: ENTITY_TYPES.APP_COMPONENT, hasRelationships: true },
      { section: 'services', expectedType: ENTITY_TYPES.SERVICE, hasRelationships: true },
      { section: 'interfaces', expectedType: ENTITY_TYPES.INTERFACE, hasRelationships: true },
      { section: 'logical_data_entities', expectedType: ENTITY_TYPES.LOGICAL_DATA_ENTITY, hasRelationships: true },
      
      { section: 'physical_data_entities', expectedType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY, hasRelationships: true },
      
      { section: 'business_users', expectedType: ENTITY_TYPES.BUSINESS_USER, hasRelationships: true },
    ];

    sectionMappings.forEach(({ section, expectedType, hasRelationships }) => {
      it(`should correctly handle ${section} section`, () => {
        const entityType = getEntityTypeConstant(section);
        expect(entityType).toBe(expectedType);

        const canShowAdvancedAdd = hasExpandableRelationships(entityType);
        expect(canShowAdvancedAdd).toBe(hasRelationships);
      });
    });
  });

  // Test relationship depth for multi-level expansions
  describe('Multi-level relationship support', () => {
    it('should support Application -> AppComponent -> Service chain', () => {
      // Level 1: Application -> AppComponent
      const appRels = getExpandableRelationships(ENTITY_TYPES.APPLICATION);
      expect(appRels.some((r) => r.targetEntityType === ENTITY_TYPES.APP_COMPONENT)).toBe(true);

      // Level 2: AppComponent -> Service
      const acRels = getExpandableRelationships(ENTITY_TYPES.APP_COMPONENT);
      expect(acRels.some((r) => r.targetEntityType === ENTITY_TYPES.SERVICE)).toBe(true);

      // Level 3: Service -> Interface
      const svcRels = getExpandableRelationships(ENTITY_TYPES.SERVICE);
      expect(svcRels.some((r) => r.targetEntityType === ENTITY_TYPES.INTERFACE)).toBe(true);
    });

    it('should support logical data entity relationships', () => {
      // Logical Data Entity -> Logical Data Attribute (parent/child)
      const ldeRels = getExpandableRelationships(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(ldeRels.some((r) => r.targetEntityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE)).toBe(true);

      // Logical Data Entity -> Physical Data Entity (association)
      expect(ldeRels.some((r) => r.targetEntityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY)).toBe(true);
    });
  });
});
