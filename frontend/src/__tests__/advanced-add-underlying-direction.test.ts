/**
 * Tests for UNDERLYING Direction and Business Point Relationships
 *
 * Task Group 1: Tests for the UNDERLYING relationship direction and
 * Business Point -> Business Process/Process Activity relationships.
 */

import {
  getExpandableRelationships,
  EXPANDABLE_RELATIONSHIPS,
  RelationshipDirection,
} from '../utils/advancedAddRelationships';
import { ENTITY_TYPES } from '../types/model';

describe('UNDERLYING Direction and Business Point Relationships', () => {
  // Test 1: RelationshipDirection type includes 'UNDERLYING'
  describe('RelationshipDirection type', () => {
    it('should include UNDERLYING as a valid direction', () => {
      // Verify UNDERLYING is a valid direction by checking relationships that use it
      const businessPointRels = getExpandableRelationships(ENTITY_TYPES.BUSINESS_POINT);

      // Find relationships with UNDERLYING direction
      const underlyingRels = businessPointRels.filter(
        (r) => r.direction === 'UNDERLYING'
      );

      // There should be at least 2 UNDERLYING relationships (BP -> BUSINESS_PROCESS and BP -> PROCESS_ACTIVITY)
      expect(underlyingRels.length).toBeGreaterThanOrEqual(2);

      // Verify the direction value is exactly 'UNDERLYING'
      underlyingRels.forEach((rel) => {
        expect(rel.direction).toBe('UNDERLYING');
      });
    });
  });

  // Test 2: BUSINESS_POINT has expandable relationships to BUSINESS_PROCESS and PROCESS_ACTIVITY
  describe('BUSINESS_POINT expandable relationships', () => {
    it('should have relationship to BUSINESS_PROCESS with UNDERLYING direction', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.BUSINESS_POINT);

      const businessProcessRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS
      );

      expect(businessProcessRel).toBeDefined();
      expect(businessProcessRel?.direction).toBe('UNDERLYING');
      expect(businessProcessRel?.relationshipKind).toBe('PARENT_CHILD');
      expect(businessProcessRel?.relationshipTableName).toBe('business_points');
      expect(businessProcessRel?.foreignKeyField).toBe('business_process_id');
      expect(businessProcessRel?.displayLabel).toBe('Business Processes');
    });

    it('should have relationship to PROCESS_ACTIVITY with UNDERLYING direction', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.BUSINESS_POINT);

      const processActivityRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );

      expect(processActivityRel).toBeDefined();
      expect(processActivityRel?.direction).toBe('UNDERLYING');
      expect(processActivityRel?.relationshipKind).toBe('PARENT_CHILD');
      expect(processActivityRel?.relationshipTableName).toBe('business_points');
      expect(processActivityRel?.foreignKeyField).toBe('process_activity_id');
      expect(processActivityRel?.displayLabel).toBe('Process Activities');
    });
  });

  // Test 3: APPLICATION business associations target CONCRETE types
  // (super-class aware traversal: Business Point nodes never appear in the
  // tree, so APPLICATION targets BUSINESS_PROCESS / PROCESS_ACTIVITY directly
  // via the application_point_business_points table)
  describe('APPLICATION business association relationships', () => {
    it('should be correctly configured via application_point_business_points', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.APPLICATION);

      // BUSINESS_POINT is no longer a direct target
      const businessPointRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_POINT
      );
      expect(businessPointRel).toBeUndefined();

      const businessProcessRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS
      );
      expect(businessProcessRel).toBeDefined();
      expect(businessProcessRel?.relationshipKind).toBe('ASSOCIATION');
      expect(businessProcessRel?.direction).toBe('ASSOCIATION');
      expect(businessProcessRel?.relationshipTableName).toBe('application_point_business_points');
      expect(businessProcessRel?.foreignKeyField).toBe('application_point_id');
      expect(businessProcessRel?.displayLabel).toBe('Business Processes');

      const processActivityRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );
      expect(processActivityRel).toBeDefined();
      expect(processActivityRel?.relationshipTableName).toBe('application_point_business_points');
    });
  });

  // Test 4: getExpandableRelationships() returns correct relationships for BUSINESS_POINT
  describe('getExpandableRelationships for BUSINESS_POINT', () => {
    it('should return all expected relationships including UNDERLYING ones', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.BUSINESS_POINT);

      // Should have at least 4 relationships:
      // - APPLICATION (ASSOCIATION)
      // - BUSINESS_USER (ASSOCIATION)
      // - BUSINESS_PROCESS (UNDERLYING)
      // - PROCESS_ACTIVITY (UNDERLYING)
      expect(relationships.length).toBeGreaterThanOrEqual(4);

      // Check all expected target types are present
      const targetTypes = relationships.map((r) => r.targetEntityType);
      expect(targetTypes).toContain(ENTITY_TYPES.APPLICATION);
      expect(targetTypes).toContain(ENTITY_TYPES.BUSINESS_USER);
      expect(targetTypes).toContain(ENTITY_TYPES.BUSINESS_PROCESS);
      expect(targetTypes).toContain(ENTITY_TYPES.PROCESS_ACTIVITY);

      // Verify correct directions for each relationship type
      const applicationRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.APPLICATION
      );
      expect(applicationRel?.direction).toBe('ASSOCIATION');

      const businessUserRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_USER
      );
      expect(businessUserRel?.direction).toBe('ASSOCIATION');

      const businessProcessRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS
      );
      expect(businessProcessRel?.direction).toBe('UNDERLYING');

      const processActivityRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );
      expect(processActivityRel?.direction).toBe('UNDERLYING');
    });
  });
});
