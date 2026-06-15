/**
 * Endpoint Palette and Relationship Layer Tests
 * Task Group 3: Tests for palette data, relationship definitions, and ID generation
 */

import { getEntityTypeConstant } from '../utils/paletteData';
import { EXPANDABLE_RELATIONSHIPS, getExpandableRelationships } from '../utils/advancedAddRelationships';
import { getEntityPrefix, generateEntityId } from '../utils/idGenerator';
import { ENTITY_TYPES } from '../types/model';

describe('Endpoint Palette and Relationship Layer', () => {
  describe('paletteData.ts - getEntityTypeConstant', () => {
    it('should map endpoints to ENDPOINT constant', () => {
      expect(getEntityTypeConstant('endpoints')).toBe(ENTITY_TYPES.ENDPOINT);
    });
  });

  describe('advancedAddRelationships.ts - ENDPOINT child relationship', () => {
    it('should define ENDPOINT as a child relationship of INTERFACE', () => {
      const interfaceRelations = EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.INTERFACE];

      expect(interfaceRelations).toBeDefined();
      expect(Array.isArray(interfaceRelations)).toBe(true);

      const endpointRel = interfaceRelations?.find(
        r => r.targetEntityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointRel).toBeDefined();
    });

    it('should have actsAsContainment: true for ENDPOINT under INTERFACE', () => {
      const interfaceRelations = EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.INTERFACE];
      const endpointRel = interfaceRelations?.find(
        r => r.targetEntityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointRel?.actsAsContainment).toBe(true);
    });

    it('should have interface_id as the FK field for ENDPOINT', () => {
      const interfaceRelations = EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.INTERFACE];
      const endpointRel = interfaceRelations?.find(
        r => r.targetEntityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointRel?.foreignKeyField).toBe('interface_id');
    });

    it('should have PARENT_CHILD as the relationship kind', () => {
      const interfaceRelations = EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.INTERFACE];
      const endpointRel = interfaceRelations?.find(
        r => r.targetEntityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointRel?.relationshipKind).toBe('PARENT_CHILD');
    });

    it('should have CHILD as the direction', () => {
      const interfaceRelations = EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.INTERFACE];
      const endpointRel = interfaceRelations?.find(
        r => r.targetEntityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointRel?.direction).toBe('CHILD');
    });

    it('should find relationship using getExpandableRelationships helper', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERFACE);
      const endpointRel = relationships.find(r => r.targetEntityType === ENTITY_TYPES.ENDPOINT);

      expect(endpointRel).toBeDefined();
    });
  });

  describe('idGenerator.ts - Endpoint ID prefix', () => {
    it('should return ep prefix for endpoints', () => {
      const prefix = getEntityPrefix('endpoints');

      expect(prefix).toBe('ep');
    });

    it('should generate ID with ep prefix for endpoints', () => {
      const id = generateEntityId('endpoints');

      expect(id).toMatch(/^ep-/);
    });

    it('should generate unique IDs for endpoints', () => {
      const id1 = generateEntityId('endpoints');
      const id2 = generateEntityId('endpoints');

      expect(id1).not.toBe(id2);
    });
  });
});
