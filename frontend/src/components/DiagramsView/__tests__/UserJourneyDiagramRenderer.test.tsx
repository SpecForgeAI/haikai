/**
 * UserJourneyDiagramRenderer Tests
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 3, Task 3.1: 7 focused tests for SVG swim-lane rendering
 *
 * Test 1: Renders journey title text from journey.name when render_hints.show_title is true
 * Test 2: Renders correct number of lane bands based on lanes array
 * Test 3: Renders step nodes within their correct lanes (grouped by laneId)
 * Test 4: Renders edges connecting sequential steps (from edges array)
 * Test 5: Visually distinguishes cross-lane edges (is_cross_lane: true vs false)
 * Test 6: Handles empty steps array gracefully (no crash, shows empty state)
 * Test 7: Handles empty lanes array gracefully (no crash)
 *
 * Spec 2026-04-03: User Journey Native Diagram Type and Renderer
 * Task Group 2, Task 2.1: 4 focused tests for renderer adaptation and content bounds
 *
 * Test 8: computeContentBounds returns correct { width, height } for a 2-lane, 3-step diagram
 * Test 9: computeContentBounds returns minimum fallback size for empty diagram
 * Test 10: Renderer calls onContentBounds callback with computed dimensions after layout
 * Test 11: Renderer renders without errors when onContentBounds is not provided
 *
 * Task Group 4, Task 4.3: Gap-filling test
 * Test 12: Renderer with missing render_hints fields uses correct defaults and renders without errors
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import UserJourneyDiagramRenderer, { computeContentBounds } from '../UserJourneyDiagramRenderer';
import type { UserJourneyDiagramDto } from '../../../types/userJourneyDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDiagram(
  overrides: Partial<UserJourneyDiagramDto> = {}
): UserJourneyDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY',
    version: '1',
    journey: {
      id: 'j-1',
      name: 'Order Placement Journey',
      description: 'User places an order',
      user_role_id: 'ur-1',
      user_role_name: 'Customer',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'E-Commerce',
    },
    lanes: [
      { id: 'lane-1', name: 'Web App', order: 0 },
      { id: 'lane-2', name: 'API Gateway', order: 1 },
    ],
    steps: [
      {
        id: 'step-1',
        journey_id: 'j-1',
        order: 0,
        lane_id: 'lane-1',
        process_activity_id: 'pa-1',
        process_activity_name: 'Browse',
        name: 'Browse Products',
        diagram_label: 'Browse Products',
        description: 'User browses product catalog',
        business_user_id: 'bu-1',
        business_user_name: 'Customer',
        activity_issues: '', ui_issues: '',
      },
      {
        id: 'step-2',
        journey_id: 'j-1',
        order: 1,
        lane_id: 'lane-1',
        process_activity_id: 'pa-2',
        process_activity_name: 'Select',
        name: 'Select Product',
        diagram_label: 'Select Product',
        description: 'User selects a product',
        business_user_id: 'bu-1',
        business_user_name: 'Customer',
        activity_issues: '', ui_issues: '',
      },
      {
        id: 'step-3',
        journey_id: 'j-1',
        order: 2,
        lane_id: 'lane-2',
        process_activity_id: 'pa-3',
        process_activity_name: 'Process Order',
        name: 'Submit Order',
        diagram_label: 'Submit Order',
        description: 'Order is submitted to backend',
        business_user_id: 'bu-2',
        business_user_name: 'System',
        activity_issues: '', ui_issues: '',
      },
    ],
    edges: [
      { id: 'e-1', from_step_id: 'step-1', to_step_id: 'step-2', order: 0, is_cross_lane: false },
      { id: 'e-2', from_step_id: 'step-2', to_step_id: 'step-3', order: 1, is_cross_lane: true },
    ],
    render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
    ...overrides,
  };
}

function renderInSvg(element: React.ReactElement) {
  return render(<svg>{element}</svg>);
}

// ============================================================================
// Tests - Original 7 (Increment 6)
// ============================================================================

describe('UserJourneyDiagramRenderer', () => {
  it('renders journey title text when show_title is true', () => {
    const diagram = createTestDiagram();
    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // The title now renders inside the styled header block (which may also
    // contain a summary sentence), so assert containment, not equality.
    const title = getByTestId('journey-header-block');
    expect(title.textContent).toContain('Order Placement Journey');
  });

  it('renders correct number of lane bands based on lanes array', () => {
    const diagram = createTestDiagram();
    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // Should have 2 lanes
    expect(getByTestId('journey-lane-lane-1')).toBeDefined();
    expect(getByTestId('journey-lane-lane-2')).toBeDefined();
  });

  it('renders step nodes within their correct lanes', () => {
    const diagram = createTestDiagram();
    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // All 3 steps should be rendered
    expect(getByTestId('journey-step-step-1')).toBeDefined();
    expect(getByTestId('journey-step-step-2')).toBeDefined();
    expect(getByTestId('journey-step-step-3')).toBeDefined();

    // Verify step names are present
    const step1 = getByTestId('journey-step-step-1');
    expect(step1.textContent).toContain('Browse Products');

    const step3 = getByTestId('journey-step-step-3');
    expect(step3.textContent).toContain('Submit Order');
  });

  it('renders edges connecting sequential steps', () => {
    const diagram = createTestDiagram();
    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // Both edges should be rendered
    const edge1 = getByTestId('journey-edge-e-1');
    expect(edge1).toBeDefined();
    expect(edge1.tagName.toLowerCase()).toBe('line');

    const edge2 = getByTestId('journey-edge-e-2');
    expect(edge2).toBeDefined();
  });

  it('visually distinguishes cross-lane edges from within-lane edges', () => {
    const diagram = createTestDiagram();
    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // Within-lane edge (e-1): no dash, normal color
    const edge1 = getByTestId('journey-edge-e-1');
    expect(edge1.getAttribute('data-cross-lane')).toBe('false');
    expect(edge1.getAttribute('stroke-dasharray')).toBeNull();

    // Cross-lane edge (e-2): dashed, different color
    const edge2 = getByTestId('journey-edge-e-2');
    expect(edge2.getAttribute('data-cross-lane')).toBe('true');
    expect(edge2.getAttribute('stroke-dasharray')).toBe('6,3');
  });

  it('handles empty steps array gracefully without crash', () => {
    const diagram = createTestDiagram({
      steps: [],
      edges: [],
    });

    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // Should render the renderer group without crashing
    expect(getByTestId('journey-diagram-renderer')).toBeDefined();
    // Lanes should still be rendered
    expect(getByTestId('journey-lane-lane-1')).toBeDefined();
  });

  it('handles empty lanes and empty steps array gracefully', () => {
    const diagram = createTestDiagram({
      lanes: [],
      steps: [],
      edges: [],
    });

    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // Should render a message instead of crashing
    const renderer = getByTestId('journey-diagram-renderer');
    expect(renderer.textContent).toContain('no lanes or steps');
  });
});

// ============================================================================
// Tests - Content Bounds and onContentBounds (Increment 7, Task Group 2)
// ============================================================================

describe('UserJourneyDiagramRenderer - Content Bounds', () => {
  it('computeContentBounds returns correct dimensions for a 2-lane, 3-step diagram', () => {
    // For HORIZONTAL layout with show_title=true:
    // CANVAS_PADDING_TOP=40, TITLE_HEIGHT=50, so baseY = 90
    // 2 lanes, each LANE_HEIGHT=160, so lane bottom = 90 + 2*160 = 410
    // maxStepsInLane = 2 (lane-1 has 2 steps), so laneContentWidth = max(1,2) * (160+40) + 20 = 420
    // lane width = LANE_HEADER_HEIGHT(40) + 420 = 460
    // lane x starts at CANVAS_PADDING_LEFT=40, so lane right = 40 + 460 = 500
    //
    // Steps in lane-1: step-1 at x=100, step-2 at x=300; both y = 90 + (160-60)/2 = 140
    // Step right edge: 300 + 160 = 460
    // Steps in lane-2: step-3 at x=100; y = 250 + (160-60)/2 = 300
    // Step right edge: 100 + 160 = 260
    //
    // Max X from lanes: 500; from steps: 460 => max = 500
    // Max Y from lanes: 410; from steps: 140+60=200 or 300+60=360 => lane is larger at 410
    // With padding of 40: width = 540, height = 450

    const laneRects = [
      { lane: { id: 'l1', name: 'A', order: 0 }, x: 40, y: 90, width: 460, height: 160, headerX: 40, headerY: 90, headerWidth: 40, headerHeight: 160 },
      { lane: { id: 'l2', name: 'B', order: 1 }, x: 40, y: 250, width: 460, height: 160, headerX: 40, headerY: 250, headerWidth: 40, headerHeight: 160 },
    ];
    const stepPositions = new Map([
      ['s1', { x: 100, y: 140, width: 160, height: 60 }],
      ['s2', { x: 300, y: 140, width: 160, height: 60 }],
      ['s3', { x: 100, y: 300, width: 160, height: 60 }],
    ]);

    const bounds = computeContentBounds(laneRects, stepPositions);

    // max x+width: lane 40+460=500, step 300+160=460 => 500
    // max y+height: lane 250+160=410, step 300+60=360 => 410
    // + padding 40 each
    expect(bounds.width).toBe(540);
    expect(bounds.height).toBe(450);
  });

  it('computeContentBounds returns minimum fallback size for an empty diagram', () => {
    const bounds = computeContentBounds([], new Map());
    expect(bounds.width).toBe(200);
    expect(bounds.height).toBe(200);
  });

  it('calls onContentBounds callback with computed dimensions after layout', () => {
    const onContentBounds = vi.fn();
    const diagram = createTestDiagram();

    renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} onContentBounds={onContentBounds} />
    );

    // onContentBounds should have been called with the computed bounds
    expect(onContentBounds).toHaveBeenCalledTimes(1);
    const calledBounds = onContentBounds.mock.calls[0][0];
    expect(calledBounds).toHaveProperty('width');
    expect(calledBounds).toHaveProperty('height');
    expect(calledBounds.width).toBeGreaterThan(0);
    expect(calledBounds.height).toBeGreaterThan(0);
  });

  it('renders without errors when onContentBounds is not provided (backward compatibility)', () => {
    const diagram = createTestDiagram();

    // Rendering without onContentBounds should not throw
    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // Verify normal rendering still works
    expect(getByTestId('journey-diagram-renderer')).toBeDefined();
    expect(getByTestId('journey-header-block')).toBeDefined();
    expect(getByTestId('journey-lane-lane-1')).toBeDefined();
  });
});

// ============================================================================
// Tests - Task Group 4 Gap-Filling
// ============================================================================

describe('UserJourneyDiagramRenderer - render_hints defaults', () => {
  it('renders with correct defaults when render_hints fields are missing or malformed', () => {
    // Create a diagram with missing render_hints fields (cast to bypass TS)
    const diagram = createTestDiagram({
      render_hints: {} as any,
    });

    const { getByTestId } = renderInSvg(
      <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
    );

    // Should render without errors
    const renderer = getByTestId('journey-diagram-renderer');
    expect(renderer).toBeDefined();

    // Default show_title=true means title should be rendered
    expect(getByTestId('journey-header-block')).toBeDefined();

    // Lanes should be rendered (default lane_axis='HORIZONTAL')
    expect(getByTestId('journey-lane-lane-1')).toBeDefined();
    expect(getByTestId('journey-lane-lane-2')).toBeDefined();

    // Steps should be rendered
    expect(getByTestId('journey-step-step-1')).toBeDefined();
  });
});
