/**
 * Overview Enrichment Tests
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 3, Task 3.1: 5 focused tests for enrichment logic
 *
 * Test 1: Verify summary counts are correctly computed
 * Test 2: Verify related colleagues are computed from business_user_business_points relationships
 * Test 3: Verify has_overview is true for colleagues that have at least one user_journey with matching primary_business_user_id
 * Test 4: Verify when no related colleagues exist, the enriched data contains an empty related_colleagues array
 * Test 5: Verify enrichment is idempotent -- enriching already-enriched data does not duplicate or corrupt values
 */

import { describe, it, expect } from 'vitest';
import {
  computeSummaryCounts,
  computeRelatedColleagues,
  enrichOverviewFull,
} from '../overviewEnrichment';
import type {
  OverviewEnrichmentMetaData,
} from '../overviewEnrichment';
import type {
  UserJourneyOverviewDiagramDto,
} from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Helpers
// ============================================================================

function buildMinimalDto(
  overrides?: Partial<UserJourneyOverviewDiagramDto>,
): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'Customer',
      title: 'Customer Journey Overview',
    },
    lanes: [],
    nodes: [],
    edges: [],
    render_hints: {
      lane_axis: 'VERTICAL',
      flow_direction: 'LEFT_TO_RIGHT',
      show_title: true,
      show_lane_headers: true,
      show_node_description: true,
      show_relationship_labels: true,
    },
    ...overrides,
  };
}

function buildEmptyMeta(): OverviewEnrichmentMetaData {
  return {
    activitySteps: [],
    applications: [],
    businessUserBusinessPoints: [],
    businessUsers: [],
    userJourneys: [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Overview Enrichment Logic', () => {
  // Test 1: Summary counts are correctly computed
  it('computes summary counts correctly -- A=nodes.length, B=lanes excluding unassigned, C=sum of step_count, D=unique application IDs', () => {
    const dto = buildMinimalDto({
      lanes: [
        { id: 'bp-1', name: 'Sales Process', order: 0 },
        { id: 'bp-2', name: 'Support Process', order: 1 },
        { id: 'unassigned', name: 'Unassigned', order: 2 },
      ],
      nodes: [
        {
          id: 'uj-1',
          lane_id: 'bp-1',
          name: 'Journey 1',
          description: '',
          primary_business_user_id: 'bu-1',
          primary_business_user_name: 'Customer',
          parent_business_process_id: 'bp-1',
          parent_business_process_name: 'Sales Process',
          metadata: {
            step_count: 5,
            application_count: 2,
            relationship_in_count: 0,
            relationship_out_count: 1,
            applications: [
              { id: 'app-1', abbreviation: 'CRM' },
              { id: 'app-2', abbreviation: 'ERP' },
            ],
          },
        },
        {
          id: 'uj-2',
          lane_id: 'bp-2',
          name: 'Journey 2',
          description: '',
          primary_business_user_id: 'bu-1',
          primary_business_user_name: 'Customer',
          parent_business_process_id: 'bp-2',
          parent_business_process_name: 'Support Process',
          metadata: {
            step_count: 3,
            application_count: 1,
            relationship_in_count: 1,
            relationship_out_count: 0,
            applications: [
              { id: 'app-2', abbreviation: 'ERP' },
              { id: 'app-3', abbreviation: 'Portal' },
            ],
          },
        },
        {
          id: 'uj-3',
          lane_id: 'unassigned',
          name: 'Journey 3',
          description: '',
          primary_business_user_id: 'bu-1',
          primary_business_user_name: 'Customer',
          parent_business_process_id: 'unassigned',
          parent_business_process_name: 'Unassigned',
          metadata: {
            step_count: 2,
            application_count: 1,
            relationship_in_count: 0,
            relationship_out_count: 0,
            applications: [
              { id: 'app-1', abbreviation: 'CRM' },
            ],
          },
        },
      ],
    });

    const counts = computeSummaryCounts(dto);

    // A = 3 nodes (journeys)
    expect(counts.journey_count).toBe(3);
    // B = 2 lanes (bp-1, bp-2) excluding 'unassigned'
    expect(counts.business_process_count).toBe(2);
    // C = 5 + 3 + 2 = 10 steps
    expect(counts.activity_step_count).toBe(10);
    // D = 3 unique app IDs (app-1, app-2, app-3) -- app-1 and app-2 appear in multiple nodes
    expect(counts.application_count).toBe(3);
  });

  // Test 2: Related colleagues are computed from business_user_business_points
  it('computes related colleagues from business_user_business_points relationships', () => {
    const meta: OverviewEnrichmentMetaData = {
      activitySteps: [],
      applications: [],
      businessUserBusinessPoints: [
        // bu-1 (current user) is linked to bpt-1 and bpt-2
        { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bpt-1' },
        { id: 'bubp-2', business_user_id: 'bu-1', business_point_id: 'bpt-2' },
        // bu-2 (colleague) shares bpt-1
        { id: 'bubp-3', business_user_id: 'bu-2', business_point_id: 'bpt-1' },
        // bu-3 (colleague) shares bpt-2
        { id: 'bubp-4', business_user_id: 'bu-3', business_point_id: 'bpt-2' },
        // bu-4 linked to bpt-99 only (NOT shared with bu-1) -- should NOT be a colleague
        { id: 'bubp-5', business_user_id: 'bu-4', business_point_id: 'bpt-99' },
      ],
      businessUsers: [
        { id: 'bu-1', name: 'Customer' },
        { id: 'bu-2', name: 'Agent' },
        { id: 'bu-3', name: 'Manager' },
        { id: 'bu-4', name: 'External Partner' },
      ],
      userJourneys: [
        { id: 'uj-1', name: 'Journey 1', primary_business_user_id: 'bu-1' },
        { id: 'uj-2', name: 'Journey 2', primary_business_user_id: 'bu-2' },
      ],
    };

    const colleagues = computeRelatedColleagues('bu-1', meta);

    // Should find 2 colleagues: bu-2 (via bpt-1) and bu-3 (via bpt-2)
    expect(colleagues).toHaveLength(2);
    // Sorted alphabetically by name: Agent, Manager
    expect(colleagues[0].business_user_id).toBe('bu-2');
    expect(colleagues[0].business_user_name).toBe('Agent');
    expect(colleagues[1].business_user_id).toBe('bu-3');
    expect(colleagues[1].business_user_name).toBe('Manager');
    // bu-4 should NOT appear (no shared points)
    expect(colleagues.find(c => c.business_user_id === 'bu-4')).toBeUndefined();
  });

  // Test 3: has_overview is true for colleagues with user_journeys
  it('sets has_overview=true for colleagues that have at least one user_journey with matching primary_business_user_id', () => {
    const meta: OverviewEnrichmentMetaData = {
      activitySteps: [],
      applications: [],
      businessUserBusinessPoints: [
        { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bpt-1' },
        { id: 'bubp-2', business_user_id: 'bu-2', business_point_id: 'bpt-1' },
        { id: 'bubp-3', business_user_id: 'bu-3', business_point_id: 'bpt-1' },
      ],
      businessUsers: [
        { id: 'bu-1', name: 'Customer' },
        { id: 'bu-2', name: 'Agent' },
        { id: 'bu-3', name: 'Teller' },
      ],
      userJourneys: [
        // bu-2 (Agent) has a journey -> has_overview = true
        { id: 'uj-1', name: 'Agent Journey', primary_business_user_id: 'bu-2' },
        // bu-3 (Teller) has NO journeys -> has_overview = false
      ],
    };

    const colleagues = computeRelatedColleagues('bu-1', meta);

    expect(colleagues).toHaveLength(2);
    // Agent has a journey -> has_overview = true
    const agent = colleagues.find(c => c.business_user_id === 'bu-2')!;
    expect(agent.has_overview).toBe(true);
    // Teller has no journey -> has_overview = false
    const teller = colleagues.find(c => c.business_user_id === 'bu-3')!;
    expect(teller.has_overview).toBe(false);
  });

  // Test 4: No related colleagues returns empty array
  it('returns an empty related_colleagues array when no related colleagues exist', () => {
    const meta: OverviewEnrichmentMetaData = {
      activitySteps: [],
      applications: [],
      businessUserBusinessPoints: [
        // bu-1 is linked to bpt-1, but no other users share it
        { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bpt-1' },
      ],
      businessUsers: [
        { id: 'bu-1', name: 'Customer' },
      ],
      userJourneys: [],
    };

    const dto = buildMinimalDto();
    const enriched = enrichOverviewFull(dto, meta);

    expect(enriched.related_colleagues).toBeDefined();
    expect(enriched.related_colleagues).toEqual([]);
  });

  // Test 5: Enrichment is idempotent
  it('is idempotent -- enriching already-enriched data does not duplicate or corrupt values', () => {
    const meta: OverviewEnrichmentMetaData = {
      activitySteps: [
        { id: 'as-1', user_journey_id: 'uj-1', application_id: 'app-1' },
        { id: 'as-2', user_journey_id: 'uj-1', application_id: 'app-2' },
      ],
      applications: [
        { id: 'app-1', name: 'CRM', abbreviation: 'CRM' },
        { id: 'app-2', name: 'ERP', abbreviation: 'ERP' },
      ],
      businessUserBusinessPoints: [
        { id: 'bubp-1', business_user_id: 'bu-1', business_point_id: 'bpt-1' },
        { id: 'bubp-2', business_user_id: 'bu-2', business_point_id: 'bpt-1' },
      ],
      businessUsers: [
        { id: 'bu-1', name: 'Customer' },
        { id: 'bu-2', name: 'Agent' },
      ],
      userJourneys: [
        { id: 'uj-1', name: 'Journey 1', primary_business_user_id: 'bu-1' },
        { id: 'uj-2', name: 'Journey 2', primary_business_user_id: 'bu-2' },
      ],
    };

    const dto = buildMinimalDto({
      lanes: [
        { id: 'bp-1', name: 'Sales', order: 0 },
      ],
      nodes: [
        {
          id: 'uj-1',
          lane_id: 'bp-1',
          name: 'Journey 1',
          description: '',
          primary_business_user_id: 'bu-1',
          primary_business_user_name: 'Customer',
          parent_business_process_id: 'bp-1',
          parent_business_process_name: 'Sales',
          metadata: {
            step_count: 4,
            application_count: 2,
            relationship_in_count: 0,
            relationship_out_count: 0,
          },
        },
      ],
    });

    // First enrichment
    const firstPass = enrichOverviewFull(dto, meta);

    // Verify first enrichment populated data
    expect(firstPass.nodes[0].metadata.applications).toHaveLength(2);
    expect(firstPass.summary_counts).toBeDefined();
    expect(firstPass.summary_counts!.journey_count).toBe(1);
    expect(firstPass.summary_counts!.application_count).toBe(2);
    expect(firstPass.related_colleagues).toHaveLength(1);

    // Second enrichment (re-enriching already-enriched data)
    const secondPass = enrichOverviewFull(firstPass, meta);

    // Applications should NOT be duplicated (idempotency guard skips already-enriched nodes)
    expect(secondPass.nodes[0].metadata.applications).toHaveLength(2);
    expect(secondPass.nodes[0].metadata.applications![0].id).toBe('app-1');
    expect(secondPass.nodes[0].metadata.applications![1].id).toBe('app-2');

    // Summary counts should be identical
    expect(secondPass.summary_counts).toEqual(firstPass.summary_counts);

    // Related colleagues should be identical (not duplicated)
    expect(secondPass.related_colleagues).toHaveLength(1);
    expect(secondPass.related_colleagues).toEqual(firstPass.related_colleagues);
  });
});
