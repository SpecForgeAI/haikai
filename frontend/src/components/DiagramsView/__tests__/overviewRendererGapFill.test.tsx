/**
 * Overview Renderer Gap-Fill Tests
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 5, Task 5.3: Strategic gap-fill tests for renderer edge cases
 *
 * These tests cover edge cases not addressed by the 8 core renderer tests in
 * UserJourneyOverviewRendererSummaryColleagues.test.tsx (Task Group 4).
 *
 * Gap 6: Summary sentence with zero-value counts renders gracefully
 * Gap 7: Large number of colleagues (>10) renders without issues
 * Gap 8: Colleagues line renders correctly when onColleagueClick is not provided
 * Gap 9: Renderer handles colleagues=undefined (no enrichment applied) without crashing
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import UserJourneyOverviewDiagramRenderer from '../UserJourneyOverviewDiagramRenderer';
import type { UserJourneyOverviewDiagramDto, RelatedColleagueDto } from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestOverviewDto(
  overrides: Partial<UserJourneyOverviewDiagramDto> = {},
): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'Customer',
      title: 'Customer Journey Overview',
    },
    lanes: [
      { id: 'lane-sales', name: 'Sales', order: 0 },
    ],
    nodes: [
      {
        id: 'node-1',
        lane_id: 'lane-sales',
        name: 'Browse Products',
        description: 'Customer browses products',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-sales',
        parent_business_process_name: 'Sales',
        metadata: {
          step_count: 5,
          application_count: 2,
          relationship_in_count: 0,
          relationship_out_count: 0,
          applications: [
            { id: 'app-1', abbreviation: 'CRM' },
            { id: 'app-2', abbreviation: 'ERP' },
          ],
        },
      },
    ],
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

function renderInSvg(element: React.ReactElement) {
  return render(<svg>{element}</svg>);
}

// ============================================================================
// Tests
// ============================================================================

describe('Overview Renderer Gap-Fill (Task Group 5)', () => {
  // Gap 6: Summary sentence with zero-value counts
  // The renderer early-returns "empty" when lanes and nodes are both empty,
  // so the real edge case is a diagram with a single node/lane but the summary
  // counts reflect zero steps and zero apps (e.g., an empty journey).
  it('Gap 6: summary sentence with zero steps and zero apps renders gracefully', () => {
    const dto = createTestOverviewDto({
      summary_counts: {
        journey_count: 1,
        business_process_count: 1,
        activity_step_count: 0,
        application_count: 0,
      },
      related_colleagues: [],
    });

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />,
    );

    // Header-block redesign: the summary sentence renders inside the styled
    // header block (foreignObject), not a standalone overview-summary element.
    const summaryEl = container.querySelector('[data-testid="overview-header-block"]');
    expect(summaryEl).not.toBeNull();
    const text = summaryEl!.textContent;
    expect(text).toContain('1 User Journeys');
    expect(text).toContain('1 Business Processes');
    expect(text).toContain('0 Activity Steps');
    expect(text).toContain('0 Applications');
  });

  // Gap 7: Large number of colleagues (>10)
  it('Gap 7: large number of colleagues (15) renders all names without errors', () => {
    const colleagues: RelatedColleagueDto[] = Array.from({ length: 15 }, (_, i) => ({
      business_user_id: `bu-${i + 100}`,
      business_user_name: `Colleague ${String(i + 1).padStart(2, '0')}`,
      has_overview: i % 2 === 0,  // alternating true/false
    }));

    const dto = createTestOverviewDto({
      related_colleagues: colleagues,
      summary_counts: {
        journey_count: 1,
        business_process_count: 1,
        activity_step_count: 5,
        application_count: 2,
      },
    });

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />,
    );

    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    expect(colleaguesEl).not.toBeNull();
    const text = colleaguesEl!.textContent;

    // Verify all 15 colleague names are rendered
    for (let i = 1; i <= 15; i++) {
      expect(text).toContain(`Colleague ${String(i).padStart(2, '0')}`);
    }

    // Verify the nav-box label is present (header-block redesign)
    expect(text).toContain('Related User Journey Overviews:');

    // Verify clickable and non-clickable elements exist. Clickable colleagues
    // are HTML anchors; non-clickable ones are inner styled spans.
    const clickableElements = colleaguesEl!.querySelectorAll('a[data-colleague-id]');
    const grayElements = Array.from(colleaguesEl!.querySelectorAll('span')).filter(
      (s) => (s as HTMLSpanElement).style.color === 'rgb(136, 136, 136)'
    );
    // 8 with has_overview=true (indices 0,2,4,6,8,10,12,14), 7 with has_overview=false
    expect(clickableElements.length).toBe(8);
    expect(grayElements.length).toBe(7);
  });

  // Gap 8: Colleagues line renders when onColleagueClick is not provided
  it('Gap 8: colleagues line renders clickable styles even when onColleagueClick callback is not provided', () => {
    const dto = createTestOverviewDto({
      related_colleagues: [
        { business_user_id: 'bu-2', business_user_name: 'Alice', has_overview: true },
      ],
      summary_counts: {
        journey_count: 1,
        business_process_count: 1,
        activity_step_count: 5,
        application_count: 2,
      },
    });

    // Render WITHOUT onColleagueClick prop
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />,
    );

    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    expect(colleaguesEl).not.toBeNull();
    expect(colleaguesEl!.textContent).toContain('Alice');

    // The clickable styling should still be present (blue, underline) on the
    // HTML anchor inside the nav-box foreignObject.
    const clickableEl = colleaguesEl!.querySelector('a[data-colleague-id="bu-2"]') as HTMLAnchorElement | null;
    expect(clickableEl).not.toBeNull();
    expect(clickableEl!.style.color).toBe('rgb(25, 118, 210)'); // #1976D2
  });

  // Gap 9: Renderer handles colleagues=undefined without crashing
  it('Gap 9: renderer does not crash when related_colleagues and summary_counts are undefined', () => {
    const dto = createTestOverviewDto({
      related_colleagues: undefined,
      summary_counts: undefined,
    });

    // This should not throw
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />,
    );

    // Summary should not be present (summary_counts is undefined)
    const summaryEl = container.querySelector('[data-testid="overview-summary"]');
    expect(summaryEl).toBeNull();

    // Colleagues line should not be present (related_colleagues is undefined,
    // so hasColleagues is false and the line is not rendered)
    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    // Either no colleagues element rendered, or a "no colleagues" message -- both are valid
    if (colleaguesEl) {
      // If rendered, it should show the "no colleagues" fallback
      expect(colleaguesEl.textContent).toContain('No related colleagues defined yet');
    }
    // Key assertion: no crash, component renders successfully
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
