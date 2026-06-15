/**
 * Tests for UserJourneyOverviewReviewContext
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 5, Task 5.1: 3 focused tests for the overview review context state management
 *
 * Test 1: activateOverviewReview sets active to true and stores the DTO, projectId, and previousView
 * Test 2: markOverviewSaved sets the saved flag to true
 * Test 3: closeOverviewReview resets state to initial (active = false, dto = null)
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  UserJourneyOverviewReviewProvider,
  useUserJourneyOverviewReviewContext,
} from '../UserJourneyOverviewReviewContext';
import type { UserJourneyOverviewDiagramDto } from '../../types/userJourneyOverviewDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <UserJourneyOverviewReviewProvider>{children}</UserJourneyOverviewReviewProvider>
  );
}

function createTestOverviewDto(businessUserName: string = 'Customer'): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: businessUserName,
      title: `${businessUserName} Journey Overview`,
    },
    lanes: [
      { id: 'lane-1', name: 'Order Management', order: 0 },
      { id: 'lane-2', name: 'Returns', order: 1 },
    ],
    nodes: [
      {
        id: 'node-1',
        lane_id: 'lane-1',
        name: 'Place Order',
        description: 'Customer places an order',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: businessUserName,
        parent_business_process_id: 'bp-1',
        parent_business_process_name: 'Order Management',
        metadata: { step_count: 5, application_count: 2, relationship_in_count: 0, relationship_out_count: 1 },
      },
      {
        id: 'node-2',
        lane_id: 'lane-1',
        name: 'Track Order',
        description: 'Customer tracks an order',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: businessUserName,
        parent_business_process_id: 'bp-1',
        parent_business_process_name: 'Order Management',
        metadata: { step_count: 3, application_count: 1, relationship_in_count: 1, relationship_out_count: 0 },
      },
      {
        id: 'node-3',
        lane_id: 'lane-2',
        name: 'Return Item',
        description: 'Customer returns an item',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: businessUserName,
        parent_business_process_id: 'bp-2',
        parent_business_process_name: 'Returns',
        metadata: { step_count: 4, application_count: 2, relationship_in_count: 0, relationship_out_count: 0 },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        relationship_type: 'LEADS_TO',
        label: 'After placement',
        description: 'Order placed leads to tracking',
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
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('UserJourneyOverviewReviewContext', () => {
  it('activateOverviewReview sets active to true and stores the DTO, projectId, and previousView', () => {
    const { result } = renderHook(() => useUserJourneyOverviewReviewContext(), {
      wrapper: createWrapper(),
    });

    // Verify initial state
    expect(result.current.active).toBe(false);
    expect(result.current.overviewDiagram).toBeNull();
    expect(result.current.projectId).toBe('');
    expect(result.current.previousView).toBe('');
    expect(result.current.saved).toBe(false);

    const dto = createTestOverviewDto('Shopper');

    act(() => {
      result.current.activateOverviewReview('proj-123', dto, 'dashboard');
    });

    expect(result.current.active).toBe(true);
    expect(result.current.projectId).toBe('proj-123');
    expect(result.current.overviewDiagram).toBe(dto);
    expect(result.current.overviewDiagram!.overview.business_user_name).toBe('Shopper');
    expect(result.current.overviewDiagram!.nodes).toHaveLength(3);
    expect(result.current.overviewDiagram!.lanes).toHaveLength(2);
    expect(result.current.overviewDiagram!.edges).toHaveLength(1);
    expect(result.current.previousView).toBe('dashboard');
    expect(result.current.saved).toBe(false);
  });

  it('markOverviewSaved sets the saved flag to true', () => {
    const { result } = renderHook(() => useUserJourneyOverviewReviewContext(), {
      wrapper: createWrapper(),
    });

    const dto = createTestOverviewDto();

    act(() => {
      result.current.activateOverviewReview('proj-1', dto, 'diagrams');
    });

    expect(result.current.saved).toBe(false);

    act(() => {
      result.current.markOverviewSaved();
    });

    expect(result.current.saved).toBe(true);
    // Other state should remain unchanged
    expect(result.current.active).toBe(true);
    expect(result.current.overviewDiagram).toBe(dto);
    expect(result.current.projectId).toBe('proj-1');
  });

  it('closeOverviewReview resets state to initial (active = false, dto = null)', () => {
    const { result } = renderHook(() => useUserJourneyOverviewReviewContext(), {
      wrapper: createWrapper(),
    });

    const dto = createTestOverviewDto();

    act(() => {
      result.current.activateOverviewReview('proj-1', dto, 'metamodel');
    });

    act(() => {
      result.current.markOverviewSaved();
    });

    // Verify non-initial state before close
    expect(result.current.active).toBe(true);
    expect(result.current.overviewDiagram).not.toBeNull();
    expect(result.current.saved).toBe(true);
    expect(result.current.previousView).toBe('metamodel');

    act(() => {
      result.current.closeOverviewReview();
    });

    // All state should be reset to initial
    expect(result.current.active).toBe(false);
    expect(result.current.overviewDiagram).toBeNull();
    expect(result.current.projectId).toBe('');
    expect(result.current.previousView).toBe('');
    expect(result.current.saved).toBe(false);
  });
});
