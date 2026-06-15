/**
 * Tests for User Journey Links Frontend Configuration
 *
 * Spec: User Journey Links Meta-Model Foundation
 * Task Group 3: TypeScript Types, Grid Config, Relationship Definitions, and Defaults
 * Task 3.1: Write 5 focused tests for frontend configuration
 *
 * Tests cover:
 * - Test 1: UserJourneyLink type conforms to expected shape (runtime shape check)
 * - Test 2: user_journey_links grid config exists with correct columns
 * - Test 3: 'User Journey Links' appears in relationshipTabNames and maps correctly in relationshipTabToType
 * - Test 4: RELATIONSHIP_DEFINITIONS includes entry with correct relationshipKey and endpointEntityTypes
 * - Test 5: ENTITY_TYPE_TO_DOMAIN maps user_journeys to 'business' (gap fix verification)
 */

import { describe, it, expect } from 'vitest';
import type { UserJourneyLink, UserJourneyLinkRelationshipType } from '../../types/model';
import { gridConfigs, relationshipTabToType, relationshipTabNames } from '../gridConfigs';
import { RELATIONSHIP_DEFINITIONS, ENTITY_TYPE_TO_DOMAIN, RELATIONSHIP_TAB_ORDER } from '../relationshipDefinitions';
import { userJourneyLinkTypeOptions } from '../defaults';

describe('User Journey Links Frontend Configuration', () => {
  /**
   * Test 1: UserJourneyLink type conforms to expected shape
   *
   * Validates that the UserJourneyLink interface has the correct fields
   * and that UserJourneyLinkRelationshipType accepts all expected enum values.
   */
  it('UserJourneyLink type conforms to expected shape', () => {
    // Create a valid UserJourneyLink object conforming to the interface
    const link: UserJourneyLink = {
      id: 'ujl-001',
      source_user_journey_id: 'uj-001',
      target_user_journey_id: 'uj-002',
      relationship_type: 'PRECEDES',
    };

    // Verify required fields are present
    expect(link.id).toBe('ujl-001');
    expect(link.source_user_journey_id).toBe('uj-001');
    expect(link.target_user_journey_id).toBe('uj-002');
    expect(link.relationship_type).toBe('PRECEDES');

    // Verify optional fields can be set
    const linkWithOptionals: UserJourneyLink = {
      ...link,
      label: 'Test Label',
      description: 'Test Description',
      tags: 'tag1,tag2',
    };
    expect(linkWithOptionals.label).toBe('Test Label');
    expect(linkWithOptionals.description).toBe('Test Description');
    expect(linkWithOptionals.tags).toBe('tag1,tag2');

    // Verify all relationship type enum values are valid
    const validTypes: UserJourneyLinkRelationshipType[] = [
      'RELATES_TO',
      'PRECEDES',
      'DEPENDS_ON',
      'OPTIONALLY_LEADS_TO',
      'TRIGGERS',
    ];
    validTypes.forEach(type => {
      const testLink: UserJourneyLink = { ...link, relationship_type: type };
      expect(testLink.relationship_type).toBe(type);
    });
  });

  /**
   * Test 2: user_journey_links grid config exists with correct columns
   *
   * Validates that gridConfigs contains user_journey_links with all 7 expected columns:
   * id (text, autoGenerate), source FK (fk_typeahead), target FK (fk_typeahead),
   * relationship_type (dropdown), label (text), description (text), tags (tags)
   */
  it('user_journey_links grid config exists with correct columns', () => {
    const config = gridConfigs['user_journey_links'];
    expect(config).toBeDefined();
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBe(7);

    // Column 0: id
    const idCol = config[0];
    expect(idCol.field).toBe('id');
    expect(idCol.cellType).toBe('text');
    expect(idCol.autoGenerate).toBe(true);

    // Column 1: source_user_journey_id
    const sourceCol = config[1];
    expect(sourceCol.field).toBe('source_user_journey_id');
    expect(sourceCol.cellType).toBe('fk_typeahead');
    expect(sourceCol.fkTarget).toBe('user_journeys');
    expect(sourceCol.width).toBe(220);

    // Column 2: target_user_journey_id
    const targetCol = config[2];
    expect(targetCol.field).toBe('target_user_journey_id');
    expect(targetCol.cellType).toBe('fk_typeahead');
    expect(targetCol.fkTarget).toBe('user_journeys');
    expect(targetCol.width).toBe(220);

    // Column 3: relationship_type
    const typeCol = config[3];
    expect(typeCol.field).toBe('relationship_type');
    expect(typeCol.cellType).toBe('dropdown');
    expect(typeCol.options).toEqual(userJourneyLinkTypeOptions);
    expect(typeCol.formatOptionLabel).toBeDefined();
    expect(typeCol.width).toBe(180);

    // Column 4: label
    const labelCol = config[4];
    expect(labelCol.field).toBe('label');
    expect(labelCol.cellType).toBe('text');
    expect(labelCol.required).toBe(false);
    expect(labelCol.width).toBe(150);

    // Column 5: description
    const descCol = config[5];
    expect(descCol.field).toBe('description');
    expect(descCol.cellType).toBe('text');
    expect(descCol.required).toBe(false);
    expect(descCol.width).toBe(200);

    // Column 6: tags
    const tagsCol = config[6];
    expect(tagsCol.field).toBe('tags');
    expect(tagsCol.cellType).toBe('tags');
    expect(tagsCol.required).toBe(false);
    expect(tagsCol.width).toBe(130);
  });

  /**
   * Test 3: 'User Journey Links' appears in relationshipTabNames and maps correctly
   *
   * Validates that the relationship tab configuration includes User Journey Links
   * and that the tab name maps to the correct type key in relationshipTabToType.
   */
  it("'User Journey Links' appears in relationshipTabNames and maps to 'user_journey_links' in relationshipTabToType", () => {
    // Verify it appears in relationshipTabNames
    expect(relationshipTabNames).toContain('User Journey Links');

    // Verify it maps correctly in relationshipTabToType
    expect(relationshipTabToType['User Journey Links']).toBe('user_journey_links');
  });

  /**
   * Test 4: RELATIONSHIP_DEFINITIONS includes user_journey_links entry
   *
   * Validates that the relationship definitions array contains the correct entry
   * for user_journey_links with the expected properties.
   */
  it("RELATIONSHIP_DEFINITIONS includes entry with relationshipKey: 'user_journey_links' and endpointEntityTypes: ['user_journeys']", () => {
    const definition = RELATIONSHIP_DEFINITIONS.find(
      def => def.relationshipKey === 'user_journey_links'
    );

    expect(definition).toBeDefined();
    expect(definition!.displayName).toBe('User Journey Links');
    expect(definition!.endpointEntityTypes).toEqual(['user_journeys']);

    // Also verify it appears in RELATIONSHIP_TAB_ORDER
    expect(RELATIONSHIP_TAB_ORDER).toContain('User Journey Links');
  });

  /**
   * Test 5: ENTITY_TYPE_TO_DOMAIN maps user_journeys to 'business'
   *
   * Validates the gap fix that ensures user_journeys is correctly recognized
   * under the Business domain in the entity-to-domain mapping.
   */
  it("ENTITY_TYPE_TO_DOMAIN maps user_journeys to 'business' (gap fix verification)", () => {
    expect(ENTITY_TYPE_TO_DOMAIN['user_journeys']).toBe('business');
  });
});
