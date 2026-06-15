/**
 * Tests for Central Relationship Definitions
 *
 * Spec: Domain-Derived Relationship Visibility
 *
 * Task Group 1: Tests for relationship definitions and derivation logic
 *
 * These tests verify:
 * 1. Each relationship has correct relationshipKey, displayName, and endpointEntityTypes
 * 2. getRelationshipsForDomain returns correct relationships for each domain
 * 3. entityTypeToDomain mapping is correct for key entity types
 * 4. The LOCKED visibility requirements are met for all 5 domains
 */

import {
  RELATIONSHIP_DEFINITIONS,
  ENTITY_TYPE_TO_DOMAIN,
  getRelationshipsForDomain,
  getRelationshipDisplayNamesForDomain,
  relationshipKeyToDisplayName,
  getOrderedRelationshipDisplayNamesForDomain,
} from '../config/relationshipDefinitions';

describe('Relationship Definitions', () => {
  describe('RELATIONSHIP_DEFINITIONS structure', () => {
    it('should have exactly 19 canonical relationships', () => {
      // Spec 2026-05-05: Infrastructure Cross-Domain Integration adds 4 new cross-domain relationships
      // (application_compute_deployments, data_entity_data_store_hostings,
      // application_infrastructure_resource_uses, application_load_balancer_exposures) to the
      // 13 baseline (10 base + 3 spec-5 Infra-internal).
      // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness adds iac_resource_bindings (+1).
      // Spec 2026-05-06: Library Frontend Types & Tables adds code_unit_dependencies (+1).
      expect(RELATIONSHIP_DEFINITIONS).toHaveLength(19);
    });

    it('should have valid structure for each relationship', () => {
      RELATIONSHIP_DEFINITIONS.forEach(def => {
        expect(def).toHaveProperty('relationshipKey');
        expect(def).toHaveProperty('displayName');
        expect(def).toHaveProperty('endpointEntityTypes');
        expect(typeof def.relationshipKey).toBe('string');
        expect(typeof def.displayName).toBe('string');
        expect(Array.isArray(def.endpointEntityTypes)).toBe(true);
        expect(def.endpointEntityTypes.length).toBeGreaterThan(0);
      });
    });

    it('should include User-BusinessPoint relationship', () => {
      const userBp = RELATIONSHIP_DEFINITIONS.find(
        r => r.relationshipKey === 'business_user_business_points'
      );
      expect(userBp).toBeDefined();
      expect(userBp!.displayName).toBe('User <-> Business Point');
      expect(userBp!.endpointEntityTypes).toEqual(['business_users', 'business_points']);
    });

    it('should include AppPoint-BusinessPoint relationship', () => {
      const appBp = RELATIONSHIP_DEFINITIONS.find(
        r => r.relationshipKey === 'application_point_business_points'
      );
      expect(appBp).toBeDefined();
      expect(appBp!.displayName).toBe('App Point <-> Business Point');
      expect(appBp!.endpointEntityTypes).toEqual(['application_points', 'business_points']);
    });

    it('should include Interactions relationship with correct endpoints', () => {
      const interactions = RELATIONSHIP_DEFINITIONS.find(
        r => r.relationshipKey === 'interactions'
      );
      expect(interactions).toBeDefined();
      expect(interactions!.displayName).toBe('Interactions');
      expect(interactions!.endpointEntityTypes).toContain('business_users');
      expect(interactions!.endpointEntityTypes).toContain('app_business_points');
      expect(interactions!.endpointEntityTypes).toContain('application_points');
    });

    it('should have renamed Logical ER to Logical / Physical ER', () => {
      const logicalEr = RELATIONSHIP_DEFINITIONS.find(
        r => r.relationshipKey === 'logical_data_entity_relationships'
      );
      expect(logicalEr).toBeDefined();
      expect(logicalEr!.displayName).toBe('Logical / Physical ER');
      expect(logicalEr!.endpointEntityTypes).toContain('logical_data_entities');
      expect(logicalEr!.endpointEntityTypes).toContain('physical_data_entities');
      expect(logicalEr!.endpointEntityTypes).toContain('data_entity_points');
    });

    it('should include AppPoint-BusinessLogic relationship', () => {
      const appBl = RELATIONSHIP_DEFINITIONS.find(
        r => r.relationshipKey === 'application_point_business_logics'
      );
      expect(appBl).toBeDefined();
      expect(appBl!.displayName).toBe('App Point <-> Business Logic');
      expect(appBl!.endpointEntityTypes).toEqual(['application_points', 'business_logics']);
    });
  });

  describe('ENTITY_TYPE_TO_DOMAIN mapping', () => {
    it('should map interfaces to APPLICATION domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['interfaces']).toBe('application');
    });

    it('should map data_entity_points to DATA domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['data_entity_points']).toBe('data');
    });

    it('should map business_logics to BEHAVIOURAL domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['business_logics']).toBe('behavioural');
    });

    it('should map app_business_points to BUSINESS domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['app_business_points']).toBe('business');
    });

    it('should map business_users to BUSINESS domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['business_users']).toBe('business');
    });

    it('should map application_points to APPLICATION domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['application_points']).toBe('application');
    });

    it('should map logical_data_entities to DATA domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['logical_data_entities']).toBe('data');
    });

    it('should map physical_data_entities to DATA domain', () => {
      expect(ENTITY_TYPE_TO_DOMAIN['physical_data_entities']).toBe('data');
    });
  });

  describe('getRelationshipsForDomain - BUSINESS domain', () => {
    it('should return correct relationships for BUSINESS domain (LOCKED requirement)', () => {
      const businessRelationships = getRelationshipsForDomain('business');

      // LOCKED: BUSINESS must include User-BusinessPoint, AppPoint-BusinessPoint, Interactions
      expect(businessRelationships).toContain('business_user_business_points');
      expect(businessRelationships).toContain('application_point_business_points');
      expect(businessRelationships).toContain('interactions');
    });

    it('should include correct display names for BUSINESS domain', () => {
      const displayNames = getRelationshipDisplayNamesForDomain('business');

      expect(displayNames).toContain('User <-> Business Point');
      expect(displayNames).toContain('App Point <-> Business Point');
      expect(displayNames).toContain('Interactions');
    });
  });

  describe('getRelationshipsForDomain - APPLICATION domain', () => {
    it('should return correct relationships for APPLICATION domain (LOCKED requirement)', () => {
      const appRelationships = getRelationshipsForDomain('application');

      // LOCKED: APPLICATION must include these relationships
      expect(appRelationships).toContain('application_point_business_points');
      expect(appRelationships).toContain('interactions');
      expect(appRelationships).toContain('interface_logical_entities');
      expect(appRelationships).toContain('data_movements');
      expect(appRelationships).toContain('application_point_business_logics');
    });

    it('should include correct display names for APPLICATION domain', () => {
      const displayNames = getRelationshipDisplayNamesForDomain('application');

      expect(displayNames).toContain('App Point <-> Business Point');
      expect(displayNames).toContain('Interactions');
      expect(displayNames).toContain('Interface <-> Entity');
      expect(displayNames).toContain('Data Movements');
      expect(displayNames).toContain('App Point <-> Business Logic');
    });
  });

  describe('getRelationshipsForDomain - DATA domain', () => {
    it('should return correct relationships for DATA domain (LOCKED requirement)', () => {
      const dataRelationships = getRelationshipsForDomain('data');

      // LOCKED: DATA must include these relationships
      expect(dataRelationships).toContain('logical_data_entity_relationships');
      expect(dataRelationships).toContain('logical_data_entity_physical_data_entities');
      expect(dataRelationships).toContain('logical_data_attribute_physical_data_attributes');
      expect(dataRelationships).toContain('interface_logical_entities');
      expect(dataRelationships).toContain('data_movements');
    });

    it('should include correct display names for DATA domain', () => {
      const displayNames = getRelationshipDisplayNamesForDomain('data');

      expect(displayNames).toContain('Logical / Physical ER');
      expect(displayNames).toContain('Logical <-> Physical Entities');
      expect(displayNames).toContain('Logical <-> Physical Attributes');
      expect(displayNames).toContain('Interface <-> Entity');
      expect(displayNames).toContain('Data Movements');
    });
  });

  describe('getRelationshipsForDomain - BEHAVIOURAL domain', () => {
    it('should return correct relationships for BEHAVIOURAL domain (LOCKED requirement)', () => {
      const behaviouralRelationships = getRelationshipsForDomain('behavioural');

      // LOCKED: BEHAVIOURAL must include Interactions and AppPoint-BusinessLogic
      expect(behaviouralRelationships).toContain('interactions');
      expect(behaviouralRelationships).toContain('application_point_business_logics');
    });

    it('should include correct display names for BEHAVIOURAL domain', () => {
      const displayNames = getRelationshipDisplayNamesForDomain('behavioural');

      expect(displayNames).toContain('Interactions');
      expect(displayNames).toContain('App Point <-> Business Logic');
    });
  });

  describe('getRelationshipsForDomain - UI domain', () => {
    it('should return no relationships for UI domain (LOCKED requirement)', () => {
      const uiRelationships = getRelationshipsForDomain('ui');

      // LOCKED: UI domain has no relationships from the canonical set
      expect(uiRelationships).toHaveLength(0);
    });

    it('should return empty display names for UI domain', () => {
      const displayNames = getRelationshipDisplayNamesForDomain('ui');
      expect(displayNames).toHaveLength(0);
    });
  });

  describe('relationshipKeyToDisplayName map', () => {
    it('should have entries for all relationship keys', () => {
      RELATIONSHIP_DEFINITIONS.forEach(def => {
        expect(relationshipKeyToDisplayName[def.relationshipKey]).toBe(def.displayName);
      });
    });

    it('should return "Logical / Physical ER" for logical_data_entity_relationships', () => {
      expect(relationshipKeyToDisplayName['logical_data_entity_relationships']).toBe('Logical / Physical ER');
    });
  });

  describe('getOrderedRelationshipDisplayNamesForDomain', () => {
    it('should return display names in canonical tab order for APPLICATION domain', () => {
      const orderedNames = getOrderedRelationshipDisplayNamesForDomain('application');

      // Verify the order is maintained
      const appPointBpIndex = orderedNames.indexOf('App Point <-> Business Point');
      const interactionsIndex = orderedNames.indexOf('Interactions');
      const interfaceIndex = orderedNames.indexOf('Interface <-> Entity');
      const dataMovementsIndex = orderedNames.indexOf('Data Movements');
      const appBlIndex = orderedNames.indexOf('App Point <-> Business Logic');

      // All should be present
      expect(appPointBpIndex).toBeGreaterThanOrEqual(0);
      expect(interactionsIndex).toBeGreaterThanOrEqual(0);
      expect(interfaceIndex).toBeGreaterThanOrEqual(0);
      expect(dataMovementsIndex).toBeGreaterThanOrEqual(0);
      expect(appBlIndex).toBeGreaterThanOrEqual(0);

      // Verify canonical order
      expect(appPointBpIndex).toBeLessThan(interactionsIndex);
      expect(interactionsIndex).toBeLessThan(interfaceIndex);
      expect(interfaceIndex).toBeLessThan(dataMovementsIndex);
      expect(dataMovementsIndex).toBeLessThan(appBlIndex);
    });

    it('should return display names in canonical tab order for DATA domain', () => {
      const orderedNames = getOrderedRelationshipDisplayNamesForDomain('data');

      // Verify the order is maintained
      const logicalErIndex = orderedNames.indexOf('Logical / Physical ER');
      const logicalPhysicalEntitiesIndex = orderedNames.indexOf('Logical <-> Physical Entities');
      const logicalPhysicalAttrsIndex = orderedNames.indexOf('Logical <-> Physical Attributes');
      const interfaceIndex = orderedNames.indexOf('Interface <-> Entity');
      const dataMovementsIndex = orderedNames.indexOf('Data Movements');

      // All should be present
      expect(logicalErIndex).toBeGreaterThanOrEqual(0);
      expect(logicalPhysicalEntitiesIndex).toBeGreaterThanOrEqual(0);
      expect(logicalPhysicalAttrsIndex).toBeGreaterThanOrEqual(0);
      expect(interfaceIndex).toBeGreaterThanOrEqual(0);
      expect(dataMovementsIndex).toBeGreaterThanOrEqual(0);

      // Verify canonical order
      expect(logicalErIndex).toBeLessThan(logicalPhysicalEntitiesIndex);
      expect(logicalPhysicalEntitiesIndex).toBeLessThan(logicalPhysicalAttrsIndex);
      expect(logicalPhysicalAttrsIndex).toBeLessThan(interfaceIndex);
      expect(interfaceIndex).toBeLessThan(dataMovementsIndex);
    });
  });
});
