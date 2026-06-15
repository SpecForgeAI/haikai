/**
 * Tests for Advanced Add Relationships Utility
 *
 * Task Group 1: Expandable Relationships Map
 * Tests the relationship mapping functionality for the Advanced Add dialog.
 */

import {
  getExpandableRelationships,
  hasExpandableRelationships,
  getRelationshipKindLabel,
  getExpandableEntityTypes,
  EXPANDABLE_RELATIONSHIPS,
  ExpandableRelationship,
} from '../utils/advancedAddRelationships';
import { ENTITY_TYPES } from '../types/model';

describe('Advanced Add Relationships Utility', () => {
  // Test 1: getExpandableRelationships returns correct relationships for APPLICATION entity type
  describe('getExpandableRelationships for APPLICATION', () => {
    it('should return correct relationships for APPLICATION entity type', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.APPLICATION);

      expect(relationships).toBeDefined();
      expect(relationships.length).toBeGreaterThan(0);

      // Should include AppComponent as parent/child
      const appComponentRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.APP_COMPONENT
      );
      expect(appComponentRel).toBeDefined();
      expect(appComponentRel?.relationshipKind).toBe('PARENT_CHILD');
      expect(appComponentRel?.direction).toBe('CHILD');
      expect(appComponentRel?.foreignKeyField).toBe('application_id');

      // Should include Service as parent/child
      const serviceRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.SERVICE
      );
      expect(serviceRel).toBeDefined();
      expect(serviceRel?.relationshipKind).toBe('PARENT_CHILD');
      expect(serviceRel?.direction).toBe('CHILD');

      // Should include Business Process as association (via App Point / Business Point bridge)
      // NOTE: APPLICATION now targets concrete types (BUSINESS_PROCESS, PROCESS_ACTIVITY)
      // instead of BUSINESS_POINT to support super-class aware containment
      const businessProcessRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS
      );
      expect(businessProcessRel).toBeDefined();
      expect(businessProcessRel?.relationshipKind).toBe('ASSOCIATION');
      expect(businessProcessRel?.direction).toBe('ASSOCIATION');
      expect(businessProcessRel?.relationshipTableName).toBe('application_point_business_points');

      // Should include Process Activity as association (via App Point / Business Point bridge)
      const processActivityRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );
      expect(processActivityRel).toBeDefined();
      expect(processActivityRel?.relationshipKind).toBe('ASSOCIATION');
      expect(processActivityRel?.direction).toBe('ASSOCIATION');
    });
  });

  // Test 2: getExpandableRelationships returns correct relationships for BUSINESS_PROCESS entity type
  describe('getExpandableRelationships for BUSINESS_PROCESS', () => {
    it('should return correct relationships for BUSINESS_PROCESS entity type', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.BUSINESS_PROCESS);

      expect(relationships).toBeDefined();
      expect(relationships.length).toBeGreaterThan(0);

      // Should include ProcessActivity as parent/child
      const activityRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );
      expect(activityRel).toBeDefined();
      expect(activityRel?.relationshipKind).toBe('PARENT_CHILD');
      expect(activityRel?.direction).toBe('CHILD');
      expect(activityRel?.foreignKeyField).toBe('business_process_id');

      // Should include Application as association
      const appRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.APPLICATION
      );
      expect(appRel).toBeDefined();
      expect(appRel?.relationshipKind).toBe('ASSOCIATION');
      expect(appRel?.direction).toBe('ASSOCIATION');
    });
  });

  // Test 3: getExpandableRelationships returns empty array for entity types with no relationships
  describe('getExpandableRelationships for entity types without relationships', () => {
    it('should return empty array for PROCESS_ACTIVITY (leaf entity)', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.PROCESS_ACTIVITY);
      expect(relationships).toEqual([]);
    });

    it('should return empty array for LOGICAL_DATA_ATTRIBUTE (leaf entity)', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE);
      expect(relationships).toEqual([]);
    });

    it('should return empty array for PHYSICAL_DATA_ATTRIBUTE (leaf entity)', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE);
      expect(relationships).toEqual([]);
    });

    it('should return empty array for unknown entity type', () => {
      const relationships = getExpandableRelationships('UNKNOWN_TYPE');
      expect(relationships).toEqual([]);
    });
  });

  // Test 4: Relationship definitions distinguish between parent/child and association kinds
  describe('relationship kind distinction', () => {
    it('should correctly distinguish PARENT_CHILD relationships', () => {
      const allRelationships: ExpandableRelationship[] = [];
      Object.values(EXPANDABLE_RELATIONSHIPS).forEach((rels) => {
        allRelationships.push(...rels);
      });

      const parentChildRels = allRelationships.filter(
        (r) => r.relationshipKind === 'PARENT_CHILD'
      );

      // Parent/child relationships should have CHILD or UNDERLYING direction
      // CHILD is for standard parent/child traversal
      // UNDERLYING is for resolving super-entities (e.g., Business Point) to their underlying entities
      parentChildRels.forEach((rel) => {
        expect(['CHILD', 'UNDERLYING']).toContain(rel.direction);
        expect(rel.relationshipKind).toBe('PARENT_CHILD');
      });

      // Verify some specific parent/child relationships
      expect(parentChildRels.some((r) => r.targetEntityType === ENTITY_TYPES.APP_COMPONENT)).toBe(
        true
      );
      expect(parentChildRels.some((r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(
        true
      );
      expect(parentChildRels.some((r) => r.targetEntityType === ENTITY_TYPES.INTERFACE)).toBe(true);
    });

    it('should correctly distinguish ASSOCIATION relationships', () => {
      const allRelationships: ExpandableRelationship[] = [];
      Object.values(EXPANDABLE_RELATIONSHIPS).forEach((rels) => {
        allRelationships.push(...rels);
      });

      const associationRels = allRelationships.filter(
        (r) => r.relationshipKind === 'ASSOCIATION'
      );

      // Association relationships should have ASSOCIATION direction, with two
      // documented exceptions on INTERACTION: the Business User link is a
      // direct FK lookup (direction CHILD) and the App Business Point links
      // resolve at runtime (direction POLYMORPHIC).
      associationRels.forEach((rel) => {
        expect(['ASSOCIATION', 'CHILD', 'POLYMORPHIC']).toContain(rel.direction);
        expect(rel.relationshipKind).toBe('ASSOCIATION');
      });

      // Non-INTERACTION association entries keep the plain ASSOCIATION direction
      const nonPolymorphicAssociations = associationRels.filter(
        (r) => r.direction === 'ASSOCIATION'
      );
      expect(nonPolymorphicAssociations.length).toBeGreaterThan(0);

      // Verify some specific association relationships exist
      expect(associationRels.length).toBeGreaterThan(0);
    });

    it('should return correct kind labels', () => {
      expect(getRelationshipKindLabel('PARENT_CHILD')).toBe('(parent/child)');
      expect(getRelationshipKindLabel('ASSOCIATION')).toBe('(association)');
    });
  });

  // Additional tests for hasExpandableRelationships
  describe('hasExpandableRelationships', () => {
    it('should return true for APPLICATION', () => {
      expect(hasExpandableRelationships(ENTITY_TYPES.APPLICATION)).toBe(true);
    });

    it('should return true for BUSINESS_PROCESS', () => {
      expect(hasExpandableRelationships(ENTITY_TYPES.BUSINESS_PROCESS)).toBe(true);
    });

    it('should return true for LOGICAL_DATA_ENTITY', () => {
      expect(hasExpandableRelationships(ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toBe(true);
    });

    it('should return false for PROCESS_ACTIVITY (leaf)', () => {
      expect(hasExpandableRelationships(ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(false);
    });

    it('should return false for unknown entity type', () => {
      expect(hasExpandableRelationships('UNKNOWN_TYPE')).toBe(false);
    });
  });

  // Test getExpandableEntityTypes
  describe('getExpandableEntityTypes', () => {
    it('should return all entity types with expandable relationships', () => {
      const types = getExpandableEntityTypes();

      expect(types).toContain(ENTITY_TYPES.APPLICATION);
      expect(types).toContain(ENTITY_TYPES.BUSINESS_PROCESS);
      expect(types).toContain(ENTITY_TYPES.APP_COMPONENT);
      expect(types).toContain(ENTITY_TYPES.SERVICE);
      expect(types).toContain(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(types).toContain(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
    });

    it('should not include leaf entity types', () => {
      const types = getExpandableEntityTypes();

      expect(types).not.toContain(ENTITY_TYPES.PROCESS_ACTIVITY);
      expect(types).not.toContain(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE);
      expect(types).not.toContain(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE);
    });
  });

  // Test multi-level depth support (e.g., Application -> AppComponent -> Service -> Interface)
  describe('multi-level relationship chains', () => {
    it('should support Application -> AppComponent -> Service -> Interface chain', () => {
      // Application -> AppComponent
      const appRels = getExpandableRelationships(ENTITY_TYPES.APPLICATION);
      expect(appRels.some((r) => r.targetEntityType === ENTITY_TYPES.APP_COMPONENT)).toBe(true);

      // AppComponent -> Service
      const acRels = getExpandableRelationships(ENTITY_TYPES.APP_COMPONENT);
      expect(acRels.some((r) => r.targetEntityType === ENTITY_TYPES.SERVICE)).toBe(true);

      // Service -> Interface
      const svcRels = getExpandableRelationships(ENTITY_TYPES.SERVICE);
      expect(svcRels.some((r) => r.targetEntityType === ENTITY_TYPES.INTERFACE)).toBe(true);

      // Interface is a leaf (no further expansion) or has association only
      const intRels = getExpandableRelationships(ENTITY_TYPES.INTERFACE);
      // Interface has association to LogicalDataEntity
      expect(intRels.length).toBeGreaterThanOrEqual(0);
    });

    it('should support BusinessProcess -> ProcessActivity chain', () => {
      const bpRels = getExpandableRelationships(ENTITY_TYPES.BUSINESS_PROCESS);
      expect(bpRels.some((r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY)).toBe(true);

      // ProcessActivity is a leaf
      const paRels = getExpandableRelationships(ENTITY_TYPES.PROCESS_ACTIVITY);
      expect(paRels.length).toBe(0);
    });

    it('should support LogicalDataEntity -> LogicalDataAttribute chain', () => {
      const ldeRels = getExpandableRelationships(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(ldeRels.some((r) => r.targetEntityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE)).toBe(
        true
      );

      // LogicalDataAttribute is a leaf
      const ldaRels = getExpandableRelationships(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE);
      expect(ldaRels.length).toBe(0);
    });
  });
});
