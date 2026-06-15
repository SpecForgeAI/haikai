/**
 * UserJourneyOverviewRendererSummaryColleagues Tests
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 4, Task 4.1: 8 focused tests for renderer summary and colleagues enhancements
 *
 * Updated 2026-06-12 for the styled header-block redesign: the title+summary
 * now render inside an HTML foreignObject header block
 * (data-testid="overview-header-block"), and the colleagues line is an HTML
 * nav box (data-testid="overview-colleagues-line") with the label
 * "Related User Journey Overviews:" and <a>/<span> colleague entries
 * (inline styles), not SVG tspan/text elements.
 *
 * Test 1: Summary sentence is rendered in the header block when showTitle=true
 * Test 2: Header block (and summary) is NOT rendered when showTitle=false
 * Test 3: Related colleagues nav box renders with the new label + names
 * Test 4: Colleague names with has_overview=true are rendered clickable (blue, underline, pointer)
 * Test 5: Colleague names with has_overview=false are rendered as plain gray text
 * Test 6: Clicking a clickable colleague invokes onColleagueClick with correct business_user_id
 * Test 7: "No related colleagues defined yet" message when no colleagues exist
 * Test 8: Layout computation shifts lanes down by NAV_BOX_HEIGHT when colleagues exist
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import UserJourneyOverviewDiagramRenderer from '../UserJourneyOverviewDiagramRenderer';
import type {
  UserJourneyOverviewDiagramDto,
  RelatedColleagueDto,
  OverviewSummaryCountsDto,
} from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestOverviewDto(
  overrides: Partial<UserJourneyOverviewDiagramDto> = {}
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
      { id: 'lane-support', name: 'Support', order: 1 },
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
          relationship_out_count: 1,
          applications: [
            { id: 'app-1', abbreviation: 'CRM' },
            { id: 'app-2', abbreviation: 'ERP' },
          ],
        },
      },
      {
        id: 'node-2',
        lane_id: 'lane-support',
        name: 'Contact Support',
        description: 'Customer contacts support',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-support',
        parent_business_process_name: 'Support',
        metadata: {
          step_count: 3,
          application_count: 1,
          relationship_in_count: 1,
          relationship_out_count: 0,
          applications: [
            { id: 'app-1', abbreviation: 'CRM' },
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
    summary_counts: {
      journey_count: 2,
      business_process_count: 2,
      activity_step_count: 8,
      application_count: 2,
    },
    related_colleagues: [
      { business_user_id: 'bu-2', business_user_name: 'Alice Manager', has_overview: true },
      { business_user_id: 'bu-3', business_user_name: 'Bob Analyst', has_overview: false },
    ],
    ...overrides,
  };
}

function renderInSvg(element: React.ReactElement) {
  return render(<svg>{element}</svg>);
}

// ============================================================================
// Tests
// ============================================================================

describe('UserJourneyOverviewDiagramRenderer - Summary and Colleagues (Task Group 4)', () => {
  it('Test 1: summary sentence is rendered in the header block when showTitle=true with expected counts format', () => {
    const dto = createTestOverviewDto();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const headerEl = container.querySelector('[data-testid="overview-header-block"]');
    expect(headerEl).not.toBeNull();
    const summaryText = headerEl!.textContent;
    expect(summaryText).toContain('Customer');
    expect(summaryText).toContain('2 User Journeys');
    expect(summaryText).toContain('2 Business Processes');
    expect(summaryText).toContain('8 Activity Steps');
    expect(summaryText).toContain('2 Applications');
  });

  it('Test 2: header block (and summary) is NOT rendered when showTitle=false', () => {
    const dto = createTestOverviewDto({
      render_hints: {
        lane_axis: 'VERTICAL',
        flow_direction: 'LEFT_TO_RIGHT',
        show_title: false,
        show_lane_headers: true,
        show_node_description: true,
        show_relationship_labels: true,
      },
    });
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    expect(container.querySelector('[data-testid="overview-header-block"]')).toBeNull();
  });

  it('Test 3: related colleagues nav box renders the "Related User Journey Overviews:" label and names', () => {
    const dto = createTestOverviewDto();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    expect(colleaguesEl).not.toBeNull();
    const text = colleaguesEl!.textContent;
    expect(text).toContain('Related User Journey Overviews:');
    expect(text).toContain('Alice Manager');
    expect(text).toContain('Bob Analyst');
  });

  it('Test 4: colleague names with has_overview=true are rendered clickable (blue, underline, pointer)', () => {
    const dto = createTestOverviewDto();
    const onColleagueClick = vi.fn();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onColleagueClick={onColleagueClick} />
    );

    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    expect(colleaguesEl).not.toBeNull();

    // Clickable colleagues are HTML anchors inside the nav-box foreignObject.
    const clickableElements = colleaguesEl!.querySelectorAll('a[data-colleague-id="bu-2"]');
    expect(clickableElements.length).toBeGreaterThanOrEqual(1);
    const clickableEl = clickableElements[0] as HTMLAnchorElement;
    expect(clickableEl.style.color).toBe('rgb(25, 118, 210)'); // #1976D2
    expect(clickableEl.style.textDecoration).toBe('underline');
    expect(clickableEl.style.cursor).toBe('pointer');
  });

  it('Test 5: colleague names with has_overview=false are rendered as plain gray text', () => {
    const dto = createTestOverviewDto();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    expect(colleaguesEl).not.toBeNull();

    // Non-clickable colleagues are plain spans (no anchor, no data attribute).
    expect(colleaguesEl!.querySelectorAll('a[data-colleague-id="bu-3"]').length).toBe(0);
    // Filter to the inner styled span (the outer keyed wrapper span has no
    // inline colour of its own).
    const spans = Array.from(colleaguesEl!.querySelectorAll('span')).filter(
      (s) => s.textContent === 'Bob Analyst' && (s as HTMLSpanElement).style.color !== ''
    );
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const grayEl = spans[0] as HTMLSpanElement;
    expect(grayEl.style.color).toBe('rgb(136, 136, 136)'); // #888
    // Should NOT have underline or pointer
    expect(grayEl.style.textDecoration === '' || grayEl.style.textDecoration === 'none').toBe(true);
    expect(grayEl.style.cursor === '' || grayEl.style.cursor === 'default').toBe(true);
  });

  it('Test 6: clicking a clickable colleague invokes onColleagueClick with correct business_user_id', () => {
    const dto = createTestOverviewDto();
    const onColleagueClick = vi.fn();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onColleagueClick={onColleagueClick} />
    );

    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    expect(colleaguesEl).not.toBeNull();

    // Click the clickable colleague anchor
    const clickableElements = colleaguesEl!.querySelectorAll('a[data-colleague-id="bu-2"]');
    expect(clickableElements.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(clickableElements[0]);
    expect(onColleagueClick).toHaveBeenCalledTimes(1);
    expect(onColleagueClick).toHaveBeenCalledWith('bu-2');

    // Clicking the non-clickable colleague should NOT invoke the callback
    const grayElements = Array.from(colleaguesEl!.querySelectorAll('span')).filter(
      (s) => s.textContent === 'Bob Analyst'
    );
    expect(grayElements.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(grayElements[0]);
    // Should still be 1 call (the gray one should not fire)
    expect(onColleagueClick).toHaveBeenCalledTimes(1);
  });

  it('Test 7: "No related colleagues defined yet" message when no colleagues exist', () => {
    const dto = createTestOverviewDto({
      related_colleagues: [],
    });
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const colleaguesEl = container.querySelector('[data-testid="overview-colleagues-line"]');
    expect(colleaguesEl).not.toBeNull();
    expect(colleaguesEl!.textContent).toContain('No related colleagues defined yet');
  });

  it('Test 8: layout computation shifts baseY downward for SUMMARY_HEIGHT and COLLEAGUES_HEIGHT', () => {
    // Create a DTO with title + summary + colleagues (all vertical space consumers)
    const dtoWithAll = createTestOverviewDto();
    const { container: containerWithAll } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dtoWithAll} />
    );

    // Create a DTO without summary/colleagues (no optional fields)
    const dtoPlain = createTestOverviewDto({
      summary_counts: undefined,
      related_colleagues: undefined,
    });
    const { container: containerPlain } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dtoPlain} />
    );

    // Lane headers should be pushed further down when summary and colleagues are present
    const lanesWithAll = containerWithAll.querySelector('[data-testid="overview-lane-lane-sales"]');
    const lanesPlain = containerPlain.querySelector('[data-testid="overview-lane-lane-sales"]');

    expect(lanesWithAll).not.toBeNull();
    expect(lanesPlain).not.toBeNull();

    // Get the y attribute of the lane rect (first child rect in the lane group)
    const laneRectWithAll = lanesWithAll!.querySelector('rect');
    const laneRectPlain = lanesPlain!.querySelector('rect');

    expect(laneRectWithAll).not.toBeNull();
    expect(laneRectPlain).not.toBeNull();

    const yWithAll = parseFloat(laneRectWithAll!.getAttribute('y')!);
    const yPlain = parseFloat(laneRectPlain!.getAttribute('y')!);

    // The lanes with summary+colleagues should have a higher Y value (further down).
    expect(yWithAll).toBeGreaterThan(yPlain);
    // Header-block redesign: the header block (title+summary) renders whenever
    // showTitle=true regardless of summary_counts, so the only extra vertical
    // space reserved when colleagues are present is the nav box:
    // NAV_BOX_HEIGHT (36) + HEADER_NAV_GAP (0) = 36.
    expect(yWithAll - yPlain).toBe(36);
  });
});
