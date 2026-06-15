/**
 * Gap-fill tests for User Journey Links Frontend Configuration
 *
 * Spec: User Journey Links Meta-Model Foundation
 * Task Group 4: Test Review and Gap Analysis
 * Task 4.3: Additional strategic tests
 *
 * These tests cover gaps not addressed by the original 5 tests in userJourneyLinksConfig.test.ts:
 *
 * Gap 4: getRelationshipsForDomain('business') returns 'user_journey_links'
 * Gap 5: userJourneyLinkTypeOptions contains exactly the 5 expected values
 * Gap 6: Grid config fk_typeahead columns reference 'user_journeys' as fkTarget
 */

import { describe, it, expect } from 'vitest';
import { gridConfigs } from '../gridConfigs';
import { getRelationshipsForDomain } from '../relationshipDefinitions';
import { userJourneyLinkTypeOptions } from '../defaults';

describe('User Journey Links Gap-Fill Tests', () => {
  /**
   * Gap 4: getRelationshipsForDomain('business') returns 'user_journey_links'
   *
   * The original test (Test 5 in userJourneyLinksConfig.test.ts) only checks
   * that ENTITY_TYPE_TO_DOMAIN['user_journeys'] === 'business' -- a static map entry.
   * This test verifies the actual derivation function produces the expected result,
   * confirming the full pipeline from ENTITY_TYPE_TO_DOMAIN through RELATIONSHIP_DEFINITIONS
   * to the final list of relationship keys for the business domain.
   */
  it("getRelationshipsForDomain('business') includes 'user_journey_links'", () => {
    const businessRelationships = getRelationshipsForDomain('business');
    expect(businessRelationships).toContain('user_journey_links');
  });

  /**
   * Gap 5: userJourneyLinkTypeOptions contains exactly the 5 expected values
   *
   * The grid config test verifies the dropdown options reference matches,
   * but this test asserts the defaults array itself has the correct contents
   * and count, which is the source of truth for the dropdown.
   */
  it('userJourneyLinkTypeOptions contains exactly the 5 expected relationship types', () => {
    expect(userJourneyLinkTypeOptions).toHaveLength(5);
    expect(userJourneyLinkTypeOptions).toEqual([
      'RELATES_TO',
      'PRECEDES',
      'DEPENDS_ON',
      'OPTIONALLY_LEADS_TO',
      'TRIGGERS',
    ]);
  });

  /**
   * Gap 6: Grid config fk_typeahead columns for source and target both reference user_journeys
   *
   * The original test checks individual fields exist, but this test specifically
   * validates that both FK columns (source_user_journey_id and target_user_journey_id)
   * use fk_typeahead cellType AND have fkTarget set to 'user_journeys', confirming
   * the frontend will resolve display names from the user_journeys entity collection.
   */
  it("user_journey_links grid config FK columns both use fk_typeahead targeting 'user_journeys'", () => {
    const config = gridConfigs['user_journey_links'];
    expect(config).toBeDefined();

    // Find all fk_typeahead columns
    const fkColumns = config.filter((col: any) => col.cellType === 'fk_typeahead');

    // There should be exactly 2 FK columns (source and target)
    expect(fkColumns).toHaveLength(2);

    // Both should target user_journeys
    const fkTargets = fkColumns.map((col: any) => col.fkTarget);
    expect(fkTargets).toEqual(['user_journeys', 'user_journeys']);

    // Verify the field names match source/target convention
    const fkFieldNames = fkColumns.map((col: any) => col.field);
    expect(fkFieldNames).toContain('source_user_journey_id');
    expect(fkFieldNames).toContain('target_user_journey_id');
  });
});
