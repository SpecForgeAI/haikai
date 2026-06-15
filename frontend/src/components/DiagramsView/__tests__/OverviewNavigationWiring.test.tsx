/**
 * OverviewNavigationWiring Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
 * Task Group 5, Task 5.1: 6 focused tests for navigation wiring behavior
 *
 * Test 1: Clicking a LINKED node in overview review mode calls closeOverviewReview()
 *         and dispatches SELECT_DIAGRAM with correct diagram ID
 * Test 2: Clicking an UNLINKED node in overview review mode triggers toast with
 *         message "No linked child diagram saved yet" and type "info"
 * Test 3: Clicking a LINKED node on a saved overview in Canvas dispatches
 *         SELECT_DIAGRAM with correct diagram ID
 * Test 4: Clicking an UNLINKED node on a saved overview in Canvas triggers
 *         the unlinked-node feedback callback
 * Test 5: Clicking a node with missing link field (backward compat) triggers
 *         unlinked behavior (toast/feedback)
 * Test 6: AMBIGUOUS_RESOLVED nodes navigate the same as LINKED nodes in both paths
 *
 * Uses a lightweight test harness approach: renders UserJourneyOverviewDiagramRenderer
 * directly and simulates the callback wiring that DiagramsView.tsx and Canvas.tsx
 * implement, verifying the callback logic without pulling in the entire dependency trees.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import UserJourneyOverviewDiagramRenderer from '../UserJourneyOverviewDiagramRenderer';
import type {
  UserJourneyOverviewDiagramDto,
  UserJourneyOverviewNodeDto,
  UserJourneyOverviewNodeLinkDto,
} from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createNodeWithLink(
  id: string,
  name: string,
  laneId: string,
  link?: UserJourneyOverviewNodeLinkDto
): UserJourneyOverviewNodeDto {
  return {
    id,
    lane_id: laneId,
    name,
    description: `Description for ${name}`,
    primary_business_user_id: 'bu-1',
    primary_business_user_name: 'Customer',
    parent_business_process_id: 'bp-1',
    parent_business_process_name: 'Sales',
    metadata: { step_count: 3, application_count: 2, relationship_in_count: 0, relationship_out_count: 1 },
    ...(link !== undefined ? { link } : {}),
  };
}

function createTestDto(
  nodes: UserJourneyOverviewNodeDto[]
): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'Customer',
      title: 'Customer Journey Overview',
    },
    lanes: [{ id: 'lane-1', name: 'Sales', order: 0 }],
    nodes,
    edges: [],
    render_hints: {
      lane_axis: 'VERTICAL',
      flow_direction: 'LEFT_TO_RIGHT',
      show_title: true,
      show_lane_headers: true,
      show_node_description: true,
      show_relationship_labels: true,
    },
  };
}

function renderInSvg(element: React.ReactElement) {
  return render(<svg>{element}</svg>);
}

/**
 * Simulates the onNodeClick callback logic as wired in DiagramsView.tsx
 * for overview review mode (Task 5.2).
 *
 * If LINKED or AMBIGUOUS_RESOLVED: calls closeOverviewReview then dispatches SELECT_DIAGRAM.
 * If UNLINKED or missing link: calls setToastState with info message.
 */
function createReviewModeCallback(
  closeOverviewReview: () => void,
  dispatch: (action: { type: string; payload?: string }) => void,
  setToastState: (state: { visible: boolean; message: string; type: string }) => void
) {
  return (node: UserJourneyOverviewNodeDto) => {
    const status = node.link?.link_status;
    if (status === 'LINKED' || status === 'AMBIGUOUS_RESOLVED') {
      closeOverviewReview();
      dispatch({ type: 'SELECT_DIAGRAM', payload: node.link!.linked_diagram_id! });
    } else {
      setToastState({ visible: true, message: 'No linked child diagram saved yet', type: 'info' });
    }
  };
}

/**
 * Simulates the onNodeClick callback logic as wired in Canvas.tsx
 * for saved overview diagram mode (Task 5.4).
 *
 * If LINKED or AMBIGUOUS_RESOLVED: dispatches SELECT_DIAGRAM and scrolls to top.
 * If UNLINKED or missing link: calls onUnlinkedNodeClick.
 */
function createCanvasModeCallback(
  dispatch: (action: { type: string; payload?: string }) => void,
  scrollToTop: () => void,
  onUnlinkedNodeClick?: () => void
) {
  return (node: UserJourneyOverviewNodeDto) => {
    const status = node.link?.link_status;
    if (status === 'LINKED' || status === 'AMBIGUOUS_RESOLVED') {
      dispatch({ type: 'SELECT_DIAGRAM', payload: node.link!.linked_diagram_id! });
      scrollToTop();
    } else {
      onUnlinkedNodeClick?.();
    }
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Overview Navigation Wiring (Task Group 5)', () => {
  it('Test 1: clicking a LINKED node in overview review mode calls closeOverviewReview() and dispatches SELECT_DIAGRAM with correct diagram ID', () => {
    const linkedNode = createNodeWithLink('node-linked', 'Linked Journey', 'lane-1', {
      linked_diagram_id: 'diag-child-123',
      linked_diagram_name: 'Detailed Journey A',
      link_status: 'LINKED',
    });
    const dto = createTestDto([linkedNode]);

    const closeOverviewReview = vi.fn();
    const dispatch = vi.fn();
    const setToastState = vi.fn();

    const onNodeClick = createReviewModeCallback(closeOverviewReview, dispatch, setToastState);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={onNodeClick} />
    );

    const nodeGroup = container.querySelector('[data-testid="overview-node-node-linked"]');
    expect(nodeGroup).not.toBeNull();
    fireEvent.click(nodeGroup!);

    // Should close review and dispatch navigation
    expect(closeOverviewReview).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_DIAGRAM', payload: 'diag-child-123' });
    // Should NOT show toast
    expect(setToastState).not.toHaveBeenCalled();
  });

  it('Test 2: clicking an UNLINKED node in overview review mode triggers toast with message "No linked child diagram saved yet" and type "info"', () => {
    const unlinkedNode = createNodeWithLink('node-unlinked', 'Unlinked Journey', 'lane-1', {
      linked_diagram_id: null,
      linked_diagram_name: null,
      link_status: 'UNLINKED',
    });
    const dto = createTestDto([unlinkedNode]);

    const closeOverviewReview = vi.fn();
    const dispatch = vi.fn();
    const setToastState = vi.fn();

    const onNodeClick = createReviewModeCallback(closeOverviewReview, dispatch, setToastState);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={onNodeClick} />
    );

    const nodeGroup = container.querySelector('[data-testid="overview-node-node-unlinked"]');
    expect(nodeGroup).not.toBeNull();
    fireEvent.click(nodeGroup!);

    // Should NOT close review or dispatch navigation
    expect(closeOverviewReview).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    // Should show toast with info type
    expect(setToastState).toHaveBeenCalledTimes(1);
    expect(setToastState).toHaveBeenCalledWith({
      visible: true,
      message: 'No linked child diagram saved yet',
      type: 'info',
    });
  });

  it('Test 3: clicking a LINKED node on a saved overview in Canvas dispatches SELECT_DIAGRAM with correct diagram ID', () => {
    const linkedNode = createNodeWithLink('node-saved-linked', 'Saved Linked Journey', 'lane-1', {
      linked_diagram_id: 'diag-saved-456',
      linked_diagram_name: 'Detailed Journey B',
      link_status: 'LINKED',
    });
    const dto = createTestDto([linkedNode]);

    const dispatch = vi.fn();
    const scrollToTop = vi.fn();
    const onUnlinkedNodeClick = vi.fn();

    const onNodeClick = createCanvasModeCallback(dispatch, scrollToTop, onUnlinkedNodeClick);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={onNodeClick} />
    );

    const nodeGroup = container.querySelector('[data-testid="overview-node-node-saved-linked"]');
    expect(nodeGroup).not.toBeNull();
    fireEvent.click(nodeGroup!);

    // Should dispatch navigation and scroll to top
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_DIAGRAM', payload: 'diag-saved-456' });
    expect(scrollToTop).toHaveBeenCalledTimes(1);
    // Should NOT call unlinked callback
    expect(onUnlinkedNodeClick).not.toHaveBeenCalled();
  });

  it('Test 4: clicking an UNLINKED node on a saved overview in Canvas triggers the unlinked-node feedback callback', () => {
    const unlinkedNode = createNodeWithLink('node-saved-unlinked', 'Saved Unlinked Journey', 'lane-1', {
      linked_diagram_id: null,
      linked_diagram_name: null,
      link_status: 'UNLINKED',
    });
    const dto = createTestDto([unlinkedNode]);

    const dispatch = vi.fn();
    const scrollToTop = vi.fn();
    const onUnlinkedNodeClick = vi.fn();

    const onNodeClick = createCanvasModeCallback(dispatch, scrollToTop, onUnlinkedNodeClick);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={onNodeClick} />
    );

    const nodeGroup = container.querySelector('[data-testid="overview-node-node-saved-unlinked"]');
    expect(nodeGroup).not.toBeNull();
    fireEvent.click(nodeGroup!);

    // Should NOT dispatch navigation or scroll
    expect(dispatch).not.toHaveBeenCalled();
    expect(scrollToTop).not.toHaveBeenCalled();
    // Should call unlinked callback
    expect(onUnlinkedNodeClick).toHaveBeenCalledTimes(1);
  });

  it('Test 5: clicking a node with missing link field (backward compat) triggers unlinked behavior', () => {
    // Node without link field at all (pre-increment-14 saved overview)
    const backwardCompatNode = createNodeWithLink('node-nolink', 'Legacy Journey', 'lane-1');
    expect(backwardCompatNode.link).toBeUndefined();

    const dto = createTestDto([backwardCompatNode]);

    // Test in review mode path
    const closeOverviewReview = vi.fn();
    const dispatch = vi.fn();
    const setToastState = vi.fn();

    const reviewCallback = createReviewModeCallback(closeOverviewReview, dispatch, setToastState);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={reviewCallback} />
    );

    const nodeGroup = container.querySelector('[data-testid="overview-node-node-nolink"]');
    expect(nodeGroup).not.toBeNull();
    fireEvent.click(nodeGroup!);

    // Should NOT close review or dispatch navigation
    expect(closeOverviewReview).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    // Should show toast (unlinked behavior)
    expect(setToastState).toHaveBeenCalledTimes(1);
    expect(setToastState).toHaveBeenCalledWith({
      visible: true,
      message: 'No linked child diagram saved yet',
      type: 'info',
    });

    // Also verify canvas mode callback path
    const canvasDispatch = vi.fn();
    const scrollToTop = vi.fn();
    const onUnlinkedNodeClick = vi.fn();
    const canvasCallback = createCanvasModeCallback(canvasDispatch, scrollToTop, onUnlinkedNodeClick);

    const { container: container2 } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={canvasCallback} />
    );

    const nodeGroup2 = container2.querySelector('[data-testid="overview-node-node-nolink"]');
    fireEvent.click(nodeGroup2!);

    expect(canvasDispatch).not.toHaveBeenCalled();
    expect(scrollToTop).not.toHaveBeenCalled();
    expect(onUnlinkedNodeClick).toHaveBeenCalledTimes(1);
  });

  it('Test 6: AMBIGUOUS_RESOLVED nodes navigate the same as LINKED nodes in both rendering paths', () => {
    const ambiguousNode = createNodeWithLink('node-ambiguous', 'Ambiguous Journey', 'lane-1', {
      linked_diagram_id: 'diag-resolved-789',
      linked_diagram_name: 'Resolved Detail Diagram',
      link_status: 'AMBIGUOUS_RESOLVED',
    });
    const dto = createTestDto([ambiguousNode]);

    // Test review mode path
    const closeOverviewReview = vi.fn();
    const reviewDispatch = vi.fn();
    const setToastState = vi.fn();

    const reviewCallback = createReviewModeCallback(closeOverviewReview, reviewDispatch, setToastState);

    const { container: reviewContainer } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={reviewCallback} />
    );

    const reviewNodeGroup = reviewContainer.querySelector('[data-testid="overview-node-node-ambiguous"]');
    expect(reviewNodeGroup).not.toBeNull();
    fireEvent.click(reviewNodeGroup!);

    // AMBIGUOUS_RESOLVED should close review and dispatch, same as LINKED
    expect(closeOverviewReview).toHaveBeenCalledTimes(1);
    expect(reviewDispatch).toHaveBeenCalledTimes(1);
    expect(reviewDispatch).toHaveBeenCalledWith({ type: 'SELECT_DIAGRAM', payload: 'diag-resolved-789' });
    expect(setToastState).not.toHaveBeenCalled();

    // Test canvas mode path
    const canvasDispatch = vi.fn();
    const scrollToTop = vi.fn();
    const onUnlinkedNodeClick = vi.fn();

    const canvasCallback = createCanvasModeCallback(canvasDispatch, scrollToTop, onUnlinkedNodeClick);

    const { container: canvasContainer } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={canvasCallback} />
    );

    const canvasNodeGroup = canvasContainer.querySelector('[data-testid="overview-node-node-ambiguous"]');
    expect(canvasNodeGroup).not.toBeNull();
    fireEvent.click(canvasNodeGroup!);

    // AMBIGUOUS_RESOLVED should dispatch and scroll, same as LINKED
    expect(canvasDispatch).toHaveBeenCalledTimes(1);
    expect(canvasDispatch).toHaveBeenCalledWith({ type: 'SELECT_DIAGRAM', payload: 'diag-resolved-789' });
    expect(scrollToTop).toHaveBeenCalledTimes(1);
    expect(onUnlinkedNodeClick).not.toHaveBeenCalled();
  });
});
