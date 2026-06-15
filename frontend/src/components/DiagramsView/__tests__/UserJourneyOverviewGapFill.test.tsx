/**
 * User Journey Overview Gap-Fill Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 8: Test Review and Gap Analysis
 *
 * Fills 8 critical gaps identified across TG1-7 existing tests:
 *
 * Gap 3: createDefaultTypedContent('USER_JOURNEY_OVERVIEW') returns correct envelope
 * Gap 4: createDefaultUserJourneyOverviewContent() returns empty arrays + default render hints
 * Gap 5: computeOverviewContentBounds returns minimum fallback for empty layout
 * Gap 6: computeOverviewContentBounds returns correct dimensions for populated layout
 * Gap 7: Banner summary with 0 journeys / 0 BPs edge case
 * Gap 8: API client throws Error on non-ok response
 * Gap 9: Edge labels are rendered in SVG when show_relationship_labels is true
 * Gap 10: Discard from review context resets all state without persisting diagram
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  createDefaultTypedContent,
  createDefaultUserJourneyOverviewContent,
} from '../../../types/typedContent';
import type { UserJourneyOverviewContent } from '../../../types/typedContent';
import { computeOverviewContentBounds } from '../UserJourneyOverviewDiagramRenderer';
import { OverviewReviewBanner } from '../OverviewReviewBanner';
import UserJourneyOverviewDiagramRenderer from '../UserJourneyOverviewDiagramRenderer';
import {
  UserJourneyOverviewReviewProvider,
  useUserJourneyOverviewReviewContext,
} from '../../../contexts/UserJourneyOverviewReviewContext';
import type { UserJourneyOverviewDiagramDto } from '../../../types/userJourneyOverviewDiagram';

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
      { id: 'lane-1', name: 'Sales', order: 0 },
      { id: 'lane-2', name: 'Support', order: 1 },
    ],
    nodes: [
      {
        id: 'node-1',
        lane_id: 'lane-1',
        name: 'Browse Products',
        description: 'Customer browses products',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-1',
        parent_business_process_name: 'Sales',
        metadata: { step_count: 5, application_count: 2, relationship_in_count: 0, relationship_out_count: 1 },
      },
      {
        id: 'node-2',
        lane_id: 'lane-2',
        name: 'Contact Support',
        description: 'Customer contacts support',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-2',
        parent_business_process_name: 'Support',
        metadata: { step_count: 3, application_count: 1, relationship_in_count: 1, relationship_out_count: 0 },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        relationship_type: 'TRIGGERS',
        label: 'triggers',
        description: 'Browse triggers support',
      },
    ],
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

function createReviewContextWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <UserJourneyOverviewReviewProvider>{children}</UserJourneyOverviewReviewProvider>
  );
}

// ============================================================================
// Gap 3: createDefaultTypedContent('USER_JOURNEY_OVERVIEW') envelope structure
// ============================================================================

describe('Gap 3: createDefaultTypedContent for USER_JOURNEY_OVERVIEW', () => {
  it('returns a TypedContentEnvelope with correct type, version, and content structure', () => {
    const envelope = createDefaultTypedContent('USER_JOURNEY_OVERVIEW');

    expect(envelope).toBeDefined();
    expect(envelope!.type).toBe('USER_JOURNEY_OVERVIEW');
    expect(envelope!.version).toBe(1);

    const content = envelope!.content as UserJourneyOverviewContent;
    expect(content.overview).toBeDefined();
    expect(content.overview.business_user_id).toBe('');
    expect(content.overview.business_user_name).toBe('');
    expect(content.overview.title).toBe('');
    expect(content.lanes).toEqual([]);
    expect(content.nodes).toEqual([]);
    expect(content.edges).toEqual([]);
    expect(content.diagram_type).toBe('USER_JOURNEY_OVERVIEW');
    expect(content.version).toBe('1.0');
    expect(content.render_hints.lane_axis).toBe('VERTICAL');
    expect(content.render_hints.flow_direction).toBe('LEFT_TO_RIGHT');
    expect(content.render_hints.show_title).toBe(true);
    expect(content.render_hints.show_lane_headers).toBe(true);
    expect(content.render_hints.show_node_description).toBe(true);
    expect(content.render_hints.show_relationship_labels).toBe(true);
  });
});

// ============================================================================
// Gap 4: createDefaultUserJourneyOverviewContent() factory function
// ============================================================================

describe('Gap 4: createDefaultUserJourneyOverviewContent', () => {
  it('returns empty arrays and default render hints', () => {
    const content = createDefaultUserJourneyOverviewContent();

    expect(content.overview.business_user_id).toBe('');
    expect(content.overview.business_user_name).toBe('');
    expect(content.overview.title).toBe('');
    expect(content.lanes).toEqual([]);
    expect(content.nodes).toEqual([]);
    expect(content.edges).toEqual([]);
    expect(content.diagram_type).toBe('USER_JOURNEY_OVERVIEW');
    expect(content.version).toBe('1.0');
    expect(content.render_hints.lane_axis).toBe('VERTICAL');
    expect(content.render_hints.show_title).toBe(true);
    expect(content.render_hints.show_lane_headers).toBe(true);
  });
});

// ============================================================================
// Gap 5: computeOverviewContentBounds minimum fallback for empty layout
// ============================================================================

describe('Gap 5: computeOverviewContentBounds - empty layout', () => {
  it('returns minimum fallback dimensions when laneRects and nodePositions are empty', () => {
    const bounds = computeOverviewContentBounds([], new Map());

    expect(bounds.width).toBe(200); // MIN_CONTENT_WIDTH
    expect(bounds.height).toBe(200); // MIN_CONTENT_HEIGHT
  });
});

// ============================================================================
// Gap 6: computeOverviewContentBounds correct dimensions for populated layout
// ============================================================================

describe('Gap 6: computeOverviewContentBounds - populated layout', () => {
  it('returns correct dimensions including padding for lanes and nodes', () => {
    const laneRects = [
      { lane: { id: 'l1', name: 'Lane1', order: 0 }, x: 40, y: 90, width: 500, height: 160, headerX: 40, headerY: 90, headerWidth: 40, headerHeight: 160 },
    ];
    const nodePositions = new Map([
      ['n1', { x: 80, y: 100, width: 260, height: 90 }],
      ['n2', { x: 390, y: 100, width: 260, height: 90 }],
    ]);

    const bounds = computeOverviewContentBounds(laneRects, nodePositions);

    // maxX = max(40+500, 80+260, 390+260) = max(540, 340, 650) = 650
    // maxY = max(90+160, 100+90, 100+90) = max(250, 190, 190) = 250
    // width = 650 + 40 (padding) = 690
    // height = 250 + 40 (padding) = 290
    expect(bounds.width).toBe(690);
    expect(bounds.height).toBe(290);
  });
});

// ============================================================================
// Gap 7: Banner summary with 0 journeys / 0 BPs edge case
// ============================================================================

describe('Gap 7: OverviewReviewBanner - zero journeys and BPs', () => {
  it('renders summary text with 0 journeys and 0 business processes', () => {
    const emptyDto = createTestOverviewDto({
      lanes: [],
      nodes: [],
      edges: [],
    });

    const { getByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={emptyDto}
        isSaved={false}
        onSaveAsDiagram={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    const summary = getByTestId('overview-review-summary');
    expect(summary.textContent).toBe('0 journeys across 0 business processes');
  });
});

// ============================================================================
// Gap 8: API client throws Error on non-ok response
// ============================================================================

describe('Gap 8: fetchTemporaryUserJourneyOverviewDiagram - error handling', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it('throws an Error when the HTTP response is not ok', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { fetchTemporaryUserJourneyOverviewDiagram } = await import(
      '../../../api/userJourneyOverviewDiagramApi'
    );

    await expect(
      fetchTemporaryUserJourneyOverviewDiagram('proj-err', 'bu-err')
    ).rejects.toThrow('Failed to fetch temporary user journey overview diagram');
  });
});

// ============================================================================
// Gap 9: Edge labels rendered when show_relationship_labels is true
// ============================================================================

describe('Gap 9: Edge labels in renderer', () => {
  it('renders edge label text elements when show_relationship_labels is true', () => {
    const dto = createTestOverviewDto();
    const { container } = render(
      <svg>
        <UserJourneyOverviewDiagramRenderer overviewData={dto} />
      </svg>
    );

    // Edge label should be present with the label text
    const edgeLabel = container.querySelector('[data-testid="overview-edge-label-edge-1"]');
    expect(edgeLabel).not.toBeNull();
    expect(edgeLabel!.textContent).toBe('triggers');
  });
});

// ============================================================================
// Gap 10: Discard from review context resets all state without persisting
// ============================================================================

describe('Gap 10: Discard flow resets state completely', () => {
  it('closeOverviewReview after activateOverviewReview resets all fields to initial values', () => {
    const { result } = renderHook(() => useUserJourneyOverviewReviewContext(), {
      wrapper: createReviewContextWrapper(),
    });

    const dto = createTestOverviewDto();

    // Activate review
    act(() => {
      result.current.activateOverviewReview('proj-1', dto, 'metamodel');
    });

    // Verify active state
    expect(result.current.active).toBe(true);
    expect(result.current.overviewDiagram).not.toBeNull();
    expect(result.current.projectId).toBe('proj-1');
    expect(result.current.previousView).toBe('metamodel');

    // Close/discard without saving
    act(() => {
      result.current.closeOverviewReview();
    });

    // Verify everything is reset -- no diagram persisted, all state initial
    expect(result.current.active).toBe(false);
    expect(result.current.overviewDiagram).toBeNull();
    expect(result.current.projectId).toBe('');
    expect(result.current.previousView).toBe('');
    expect(result.current.saved).toBe(false);
  });
});
