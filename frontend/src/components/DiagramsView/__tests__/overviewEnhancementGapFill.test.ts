/**
 * Overview Enhancement Gap-Fill Tests
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 5, Task 5.3: Strategic gap-fill tests for enrichment logic edge cases
 *
 * These tests cover edge cases not addressed by the 5 core enrichment tests in
 * overviewEnrichment.test.ts (Task Group 3).
 *
 * Gap 1: computeSummaryCounts with empty DTO (no nodes, no lanes) -- zero-value summary
 * Gap 2: computeSummaryCounts when node metadata.applications is missing (optional field)
 * Gap 3: computeRelatedColleagues with undefined/empty relationship arrays
 * Gap 4: enrichOverviewFull for a business user with no activity steps (empty journey)
 * Gap 5: computeSummaryCounts with only an 'unassigned' lane (business_process_count = 0)
 */

import { describe, it, expect } from 'vitest';
import {
  computeSummaryCounts,
  computeRelatedColleagues,
  enrichOverviewFull,
} from '../overviewEnrichment';
import type { OverviewEnrichmentMetaData } from '../overviewEnrichment';
import type { UserJourneyOverviewDiagramDto } from '../../../types/userJourneyOverviewDiagram';

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
      business_user_name: 'TestUser',
      title: 'TestUser Journey Overview',
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

describe('Overview Enrichment Gap-Fill (Task Group 5)', () => {
  // Gap 1: computeSummaryCounts with empty DTO
  it('Gap 1: computeSummaryCounts returns all zeros for an empty DTO (no nodes, no lanes)', () => {
    const dto = buildMinimalDto();
    const counts = computeSummaryCounts(dto);

    expect(counts.journey_count).toBe(0);
    expect(counts.business_process_count).toBe(0);
    expect(counts.activity_step_count).toBe(0);
    expect(counts.application_count).toBe(0);
  });

  // Gap 2: computeSummaryCounts when metadata.applications is undefined/missing
  it('Gap 2: computeSummaryCounts handles nodes where metadata.applications is undefined', () => {
    const dto = buildMinimalDto({
      lanes: [
        { id: 'bp-1', name: 'Process 1', order: 0 },
      ],
      nodes: [
        {
          id: 'uj-1',
          lane_id: 'bp-1',
          name: 'Journey 1',
          description: '',
          primary_business_user_id: 'bu-1',
          primary_business_user_name: 'TestUser',
          parent_business_process_id: 'bp-1',
          parent_business_process_name: 'Process 1',
          metadata: {
            step_count: 3,
            application_count: 0,
            relationship_in_count: 0,
            relationship_out_count: 0,
            // applications is intentionally omitted (undefined)
          },
        },
      ],
    });

    const counts = computeSummaryCounts(dto);

    expect(counts.journey_count).toBe(1);
    expect(counts.business_process_count).toBe(1);
    expect(counts.activity_step_count).toBe(3);
    // No applications array -> 0 unique apps
    expect(counts.application_count).toBe(0);
  });

  // Gap 3: computeRelatedColleagues with undefined/empty relationship arrays
  it('Gap 3: computeRelatedColleagues returns empty array when businessUserBusinessPoints is empty', () => {
    const meta: OverviewEnrichmentMetaData = {
      activitySteps: [],
      applications: [],
      businessUserBusinessPoints: [],
      businessUsers: [
        { id: 'bu-1', name: 'TestUser' },
        { id: 'bu-2', name: 'Colleague' },
      ],
      userJourneys: [
        { id: 'uj-1', name: 'Journey', primary_business_user_id: 'bu-1' },
        { id: 'uj-2', name: 'Journey 2', primary_business_user_id: 'bu-2' },
      ],
    };

    const colleagues = computeRelatedColleagues('bu-1', meta);
    expect(colleagues).toEqual([]);
  });

  // Gap 4: enrichOverviewFull for a business user with no activity steps (empty journey)
  it('Gap 4: enrichOverviewFull handles a business user with journeys but zero activity steps gracefully', () => {
    const dto = buildMinimalDto({
      lanes: [
        { id: 'bp-1', name: 'Sales', order: 0 },
      ],
      nodes: [
        {
          id: 'uj-1',
          lane_id: 'bp-1',
          name: 'Empty Journey',
          description: 'A journey with no steps',
          primary_business_user_id: 'bu-1',
          primary_business_user_name: 'TestUser',
          parent_business_process_id: 'bp-1',
          parent_business_process_name: 'Sales',
          metadata: {
            step_count: 0,
            application_count: 0,
            relationship_in_count: 0,
            relationship_out_count: 0,
          },
        },
      ],
    });

    const meta: OverviewEnrichmentMetaData = {
      activitySteps: [],  // No activity steps at all
      applications: [],
      businessUserBusinessPoints: [],
      businessUsers: [{ id: 'bu-1', name: 'TestUser' }],
      userJourneys: [{ id: 'uj-1', name: 'Empty Journey', primary_business_user_id: 'bu-1' }],
    };

    const enriched = enrichOverviewFull(dto, meta);

    // Should not throw and should produce valid enriched data
    expect(enriched.summary_counts).toBeDefined();
    expect(enriched.summary_counts!.journey_count).toBe(1);
    expect(enriched.summary_counts!.business_process_count).toBe(1);
    expect(enriched.summary_counts!.activity_step_count).toBe(0);
    expect(enriched.summary_counts!.application_count).toBe(0);
    expect(enriched.related_colleagues).toEqual([]);
    // Node should not crash -- applications should remain undefined or empty
    expect(enriched.nodes).toHaveLength(1);
  });

  // Gap 5: computeSummaryCounts with only an 'unassigned' lane
  it('Gap 5: computeSummaryCounts counts business_process_count as 0 when only unassigned lane exists', () => {
    const dto = buildMinimalDto({
      lanes: [
        { id: 'unassigned', name: 'Unassigned', order: 0 },
      ],
      nodes: [
        {
          id: 'uj-1',
          lane_id: 'unassigned',
          name: 'Unassigned Journey',
          description: '',
          primary_business_user_id: 'bu-1',
          primary_business_user_name: 'TestUser',
          parent_business_process_id: 'unassigned',
          parent_business_process_name: 'Unassigned',
          metadata: {
            step_count: 2,
            application_count: 1,
            relationship_in_count: 0,
            relationship_out_count: 0,
            applications: [{ id: 'app-1', abbreviation: 'App1' }],
          },
        },
      ],
    });

    const counts = computeSummaryCounts(dto);

    expect(counts.journey_count).toBe(1);
    // 'unassigned' lane is excluded from business process count
    expect(counts.business_process_count).toBe(0);
    expect(counts.activity_step_count).toBe(2);
    expect(counts.application_count).toBe(1);
  });
});
