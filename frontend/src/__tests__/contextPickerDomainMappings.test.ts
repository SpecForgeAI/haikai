/**
 * contextPickerDomainMappings.test.ts
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 1: Tests for type definitions and domain mappings
 *
 * Tests:
 * 1. RelationshipPickOption interface has required fields
 * 2. RelationshipRef interface has required fields
 * 3. DOMAIN_TO_ENTITY_TYPES mapping returns correct entity types for each domain
 * 4. DOMAIN_TO_RELATIONSHIP_TYPES mapping returns correct relationship types for each domain
 */

import { describe, it, expect } from 'vitest';
import type { RelationshipPickOption } from '../utils/contextPickListBuilders';
import type { RelationshipRef, ContextState } from '../utils/contextStorage';
import {
  DOMAIN_TO_ENTITY_TYPES,
  DOMAIN_TO_RELATIONSHIP_TYPES,
} from '../utils/contextPickerDomainMappings';
import type { ArchitectureDomain } from '../types/architectureDomain';
import { ALL_DOMAINS } from '../types/architectureDomain';

describe('Task Group 1: Type Definitions and Domain Mappings', () => {
  describe('RelationshipPickOption interface', () => {
    it('has required fields: value, label, relationship_type', () => {
      // Create a valid RelationshipPickOption
      const option: RelationshipPickOption = {
        value: 'rel-123',
        label: 'Test Relationship',
        relationship_type: 'logical_data_entity_relationships',
      };

      // Verify required fields exist
      expect(option.value).toBe('rel-123');
      expect(option.label).toBe('Test Relationship');
      expect(option.relationship_type).toBe('logical_data_entity_relationships');
    });
  });

  describe('RelationshipRef interface', () => {
    it('has required fields: kind, relationship_type, relationship_id, label', () => {
      // Create a valid RelationshipRef
      const ref: RelationshipRef = {
        kind: 'RELATIONSHIP',
        relationship_type: 'data_movements',
        relationship_id: 'dm-456',
        label: 'Data Movement Example',
      };

      // Verify required fields exist
      expect(ref.kind).toBe('RELATIONSHIP');
      expect(ref.relationship_type).toBe('data_movements');
      expect(ref.relationship_id).toBe('dm-456');
      expect(ref.label).toBe('Data Movement Example');
    });

    it('can be included in ContextState relationship_refs array', () => {
      // Create a ContextState with relationship_refs
      const state: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
        relationship_refs: [
          {
            kind: 'RELATIONSHIP',
            relationship_type: 'state_transitions',
            relationship_id: 'st-789',
            label: 'State Transition',
          },
        ],
      };

      // Verify relationship_refs is optional and can be populated
      expect(state.relationship_refs).toBeDefined();
      expect(state.relationship_refs!.length).toBe(1);
      expect(state.relationship_refs![0].kind).toBe('RELATIONSHIP');
    });
  });

  describe('DOMAIN_TO_ENTITY_TYPES mapping', () => {
    it('returns correct entity types for each domain', () => {
      // Business domain
      expect(DOMAIN_TO_ENTITY_TYPES.business).toEqual([
        'business_users',
        'business_processes',
        'process_activities',
      ]);

      // Application domain (Spec 2026-05-06 added libraries)
      expect(DOMAIN_TO_ENTITY_TYPES.application).toEqual([
        'applications',
        'app_components',
        'services',
        'interfaces',
        'endpoints',
        'libraries',
      ]);

      // Data domain
      expect(DOMAIN_TO_ENTITY_TYPES.data).toEqual([
        'logical_data_entities',
        'physical_data_entities',
      ]);

      // Behavioural domain ('interactions' entity collection included)
      expect(DOMAIN_TO_ENTITY_TYPES.behavioural).toEqual([
        'events',
        'states',
        'activities',
        'interactions',
      ]);

      // UI domain
      expect(DOMAIN_TO_ENTITY_TYPES.ui).toEqual([
        'ui_screens',
        'ui_components',
        'ui_actions',
      ]);
    });

    it('has mappings for all architecture domains', () => {
      ALL_DOMAINS.forEach((domain: ArchitectureDomain) => {
        expect(DOMAIN_TO_ENTITY_TYPES[domain]).toBeDefined();
        expect(Array.isArray(DOMAIN_TO_ENTITY_TYPES[domain])).toBe(true);
        expect(DOMAIN_TO_ENTITY_TYPES[domain].length).toBeGreaterThan(0);
      });
    });
  });

  describe('DOMAIN_TO_RELATIONSHIP_TYPES mapping', () => {
    it('returns correct relationship types for each domain', () => {
      // Business domain
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.business).toEqual([
        'business_user_business_points',
      ]);

      // Application domain (Spec 2026-05-05 infra cross-domain + 2026-05-06 libraries)
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.application).toEqual([
        'application_point_business_points',
        'interface_logical_entities',
        'application_compute_deployments',
        'application_infrastructure_resource_uses',
        'application_load_balancer_exposures',
        'code_unit_dependencies',
      ]);

      // Data domain (Spec 2026-05-05 added data_entity_data_store_hostings)
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.data).toEqual([
        'logical_data_entity_relationships',
        'logical_data_entity_physical_data_entities',
        'logical_data_attribute_physical_data_attributes',
        'data_movements',
        'data_entity_data_store_hostings',
      ]);

      // Behavioural domain (Spec 2026-01-17 TG3: application_point_business_logics)
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.behavioural).toEqual([
        'application_point_business_logics',
      ]);

      // UI domain
      expect(DOMAIN_TO_RELATIONSHIP_TYPES.ui).toEqual([
        'ui_workflow_transitions',
      ]);
    });

    it('has mappings for all architecture domains', () => {
      ALL_DOMAINS.forEach((domain: ArchitectureDomain) => {
        expect(DOMAIN_TO_RELATIONSHIP_TYPES[domain]).toBeDefined();
        expect(Array.isArray(DOMAIN_TO_RELATIONSHIP_TYPES[domain])).toBe(true);
        expect(DOMAIN_TO_RELATIONSHIP_TYPES[domain].length).toBeGreaterThan(0);
      });
    });
  });
});
