/**
 * Tests for actsAsContainment field behavior in Advanced Add Relationships
 *
 * Task Group 1: Tests for the actsAsContainment classification flag
 * This flag distinguishes CONTAINMENT relationships (nested boxes) from
 * EDGE_ONLY relationships (edge lines between nodes).
 */

import {
  getExpandableRelationships,
  EXPANDABLE_RELATIONSHIPS,
  ExpandableRelationship,
} from '../utils/advancedAddRelationships';
import { ENTITY_TYPES } from '../types/model';

describe('actsAsContainment Field Behavior', () => {
  // Test 1: Verify actsAsContainment field exists on all ExpandableRelationship entries
  describe('actsAsContainment field existence', () => {
    it('should have actsAsContainment field defined on all relationships', () => {
      const allRelationships: ExpandableRelationship[] = [];
      Object.values(EXPANDABLE_RELATIONSHIPS).forEach((rels) => {
        allRelationships.push(...rels);
      });

      // Every relationship should have actsAsContainment defined as a boolean
      allRelationships.forEach((rel) => {
        expect(rel.actsAsContainment).toBeDefined();
        expect(typeof rel.actsAsContainment).toBe('boolean');
      });
    });
  });

  // Test 2: Verify PARENT_CHILD relationships have actsAsContainment: true
  describe('PARENT_CHILD relationships containment', () => {
    it('should have actsAsContainment: true for all PARENT_CHILD relationships with CHILD direction', () => {
      const allRelationships: ExpandableRelationship[] = [];
      Object.values(EXPANDABLE_RELATIONSHIPS).forEach((rels) => {
        allRelationships.push(...rels);
      });

      const parentChildRels = allRelationships.filter(
        (r) => r.relationshipKind === 'PARENT_CHILD' && r.direction === 'CHILD'
      );

      // All direct parent/child relationships should be containment
      expect(parentChildRels.length).toBeGreaterThan(0);
      parentChildRels.forEach((rel) => {
        expect(rel.actsAsContainment).toBe(true);
      });
    });

    it('should mark Application -> App Component as containment', () => {
      const appRels = getExpandableRelationships(ENTITY_TYPES.APPLICATION);
      const appComponentRel = appRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.APP_COMPONENT
      );
      expect(appComponentRel?.actsAsContainment).toBe(true);
    });

    it('should mark Business Process -> Process Activity as containment', () => {
      const bpRels = getExpandableRelationships(ENTITY_TYPES.BUSINESS_PROCESS);
      const activityRel = bpRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );
      expect(activityRel?.actsAsContainment).toBe(true);
    });
  });

  // Test 3: Verify App Point / Business Point relationships have actsAsContainment: true
  describe('App Point / Business Point containment relationships', () => {
    it('should have Application -> Business Process with actsAsContainment: true', () => {
      const appRels = getExpandableRelationships(ENTITY_TYPES.APPLICATION);
      const bpRel = appRels.find(
        (r) =>
          r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS &&
          r.relationshipTableName === 'application_point_business_points'
      );
      expect(bpRel).toBeDefined();
      expect(bpRel?.actsAsContainment).toBe(true);
    });

    it('should have Application -> Process Activity with actsAsContainment: true', () => {
      const appRels = getExpandableRelationships(ENTITY_TYPES.APPLICATION);
      const paRel = appRels.find(
        (r) =>
          r.targetEntityType === ENTITY_TYPES.PROCESS_ACTIVITY &&
          r.relationshipTableName === 'application_point_business_points'
      );
      expect(paRel).toBeDefined();
      expect(paRel?.actsAsContainment).toBe(true);
    });

    it('should have App Component -> Business Process with actsAsContainment: true', () => {
      const acRels = getExpandableRelationships(ENTITY_TYPES.APP_COMPONENT);
      const bpRel = acRels.find(
        (r) =>
          r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS &&
          r.relationshipTableName === 'application_point_business_points'
      );
      expect(bpRel).toBeDefined();
      expect(bpRel?.actsAsContainment).toBe(true);
    });

    it('should have Service -> Business Process with actsAsContainment: true', () => {
      const svcRels = getExpandableRelationships(ENTITY_TYPES.SERVICE);
      const bpRel = svcRels.find(
        (r) =>
          r.targetEntityType === ENTITY_TYPES.BUSINESS_PROCESS &&
          r.relationshipTableName === 'application_point_business_points'
      );
      expect(bpRel).toBeDefined();
      expect(bpRel?.actsAsContainment).toBe(true);
    });
  });

  // Test 4: Verify Interface / Logical Entity relationship has actsAsContainment: true
  describe('Interface / Logical Entity containment', () => {
    it('should have Interface -> Logical Data Entity with actsAsContainment: true', () => {
      const intRels = getExpandableRelationships(ENTITY_TYPES.INTERFACE);
      const ldeRel = intRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );
      expect(ldeRel).toBeDefined();
      expect(ldeRel?.actsAsContainment).toBe(true);
    });
  });

  // Test 5: Verify edge-only relationships have actsAsContainment: false
  describe('Edge-only relationships', () => {
    it('should have User -> Business Point with actsAsContainment: false', () => {
      const userRels = getExpandableRelationships(ENTITY_TYPES.BUSINESS_USER);
      const bpRel = userRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_POINT
      );
      expect(bpRel).toBeDefined();
      expect(bpRel?.actsAsContainment).toBe(false);
    });

    it('should have Logical Data Entity -> Physical Data Entity (Logical ER) with actsAsContainment: false', () => {
      const ldeRels = getExpandableRelationships(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      const pdeRel = ldeRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );
      expect(pdeRel).toBeDefined();
      expect(pdeRel?.actsAsContainment).toBe(false);
    });

    it('should have Business Process -> Application with actsAsContainment: false (reverse direction)', () => {
      const bpRels = getExpandableRelationships(ENTITY_TYPES.BUSINESS_PROCESS);
      const appRel = bpRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.APPLICATION
      );
      expect(appRel).toBeDefined();
      expect(appRel?.actsAsContainment).toBe(false);
    });
  });

  // Test 6: Verify BUSINESS_POINT never appears as targetEntityType for Application/Component/Service
  describe('No BUSINESS_POINT as direct target for App entities', () => {
    it('should NOT have BUSINESS_POINT as targetEntityType for APPLICATION', () => {
      const appRels = getExpandableRelationships(ENTITY_TYPES.APPLICATION);
      const bpTargetRel = appRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_POINT
      );
      expect(bpTargetRel).toBeUndefined();
    });

    it('should NOT have BUSINESS_POINT as targetEntityType for APP_COMPONENT', () => {
      const acRels = getExpandableRelationships(ENTITY_TYPES.APP_COMPONENT);
      const bpTargetRel = acRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_POINT
      );
      expect(bpTargetRel).toBeUndefined();
    });

    it('should NOT have BUSINESS_POINT as targetEntityType for SERVICE', () => {
      const svcRels = getExpandableRelationships(ENTITY_TYPES.SERVICE);
      const bpTargetRel = svcRels.find(
        (r) => r.targetEntityType === ENTITY_TYPES.BUSINESS_POINT
      );
      expect(bpTargetRel).toBeUndefined();
    });
  });
});
