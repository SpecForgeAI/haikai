/**
 * Tests for UserJourneyReviewContext
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 2, Task 2.1: 8 focused tests for context state management
 *
 * Test 1: Initial state is inactive with empty defaults
 * Test 2: activateReviewSession sets active: true, stores projectId, sourceTaskId, journeys, previousView
 * Test 3: selectJourney(index) updates selectedIndex to the given index
 * Test 4: selectNext advances index by 1; is a no-op at the last index
 * Test 5: selectPrevious decrements index by 1; is a no-op at index 0
 * Test 6: returnToChooser sets selectedIndex back to null
 * Test 7: closeReviewSession clears all state to initial defaults
 * Test 8: previousView is stored on activation and available for restoration
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  UserJourneyReviewProvider,
  useUserJourneyReviewContext,
  useActivateJourneyReview,
} from '../UserJourneyReviewContext';
import type { UserJourneyDiagramDto } from '../../types/userJourneyDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <UserJourneyReviewProvider>{children}</UserJourneyReviewProvider>
  );
}

function createTestDiagram(name: string): UserJourneyDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY',
    version: '1',
    journey: {
      id: `j-${name}`,
      name,
      description: `Description for ${name}`,
      user_role_id: 'ur-1',
      user_role_name: 'End User',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'Order Flow',
    },
    lanes: [{ id: 'lane-1', name: 'Web App', order: 0 }],
    steps: [
      {
        id: 'step-1',
        journey_id: `j-${name}`,
        order: 0,
        lane_id: 'lane-1',
        process_activity_id: 'pa-1',
        process_activity_name: 'Browse',
        name: 'Browse Products',
        description: 'User browses',
        business_user_id: 'bu-1',
        business_user_name: 'Customer',
      },
    ],
    edges: [],
    render_hints: { lane_axis: 'VERTICAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('UserJourneyReviewContext', () => {
  it('initial state is inactive with empty defaults', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    expect(result.current.active).toBe(false);
    expect(result.current.projectId).toBe('');
    expect(result.current.sourceTaskId).toBe('');
    expect(result.current.journeys).toEqual([]);
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.previousView).toBe('');
  });

  it('activateReviewSession sets active: true and stores all session data', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('Journey A'), createTestDiagram('Journey B')];

    act(() => {
      result.current.activateReviewSession('proj-1', 'ux-designer--users-interactions', journeys, 'dashboard');
    });

    expect(result.current.active).toBe(true);
    expect(result.current.projectId).toBe('proj-1');
    expect(result.current.sourceTaskId).toBe('ux-designer--users-interactions');
    expect(result.current.journeys).toHaveLength(2);
    expect(result.current.journeys[0].journey.name).toBe('Journey A');
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.previousView).toBe('dashboard');
  });

  it('selectJourney(index) updates selectedIndex to the given index', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('A'), createTestDiagram('B'), createTestDiagram('C')];

    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard');
    });
    act(() => {
      result.current.selectJourney(1);
    });

    expect(result.current.selectedIndex).toBe(1);
  });

  it('selectNext advances index by 1; is a no-op at the last index', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('A'), createTestDiagram('B'), createTestDiagram('C')];

    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard');
    });
    act(() => {
      result.current.selectJourney(0);
    });
    act(() => {
      result.current.selectNext();
    });
    expect(result.current.selectedIndex).toBe(1);

    act(() => {
      result.current.selectNext();
    });
    expect(result.current.selectedIndex).toBe(2);

    // At last index, selectNext should be a no-op
    act(() => {
      result.current.selectNext();
    });
    expect(result.current.selectedIndex).toBe(2);
  });

  it('selectPrevious decrements index by 1; is a no-op at index 0', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('A'), createTestDiagram('B'), createTestDiagram('C')];

    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard');
    });
    act(() => {
      result.current.selectJourney(2);
    });
    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedIndex).toBe(1);

    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedIndex).toBe(0);

    // At first index, selectPrevious should be a no-op
    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('returnToChooser sets selectedIndex back to null', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('A'), createTestDiagram('B')];

    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard');
    });
    act(() => {
      result.current.selectJourney(1);
    });
    expect(result.current.selectedIndex).toBe(1);

    act(() => {
      result.current.returnToChooser();
    });
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.active).toBe(true); // session is still active
  });

  it('closeReviewSession clears all state to initial defaults', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('A'), createTestDiagram('B')];

    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard');
    });
    act(() => {
      result.current.selectJourney(1);
    });
    act(() => {
      result.current.closeReviewSession();
    });

    expect(result.current.active).toBe(false);
    expect(result.current.projectId).toBe('');
    expect(result.current.sourceTaskId).toBe('');
    expect(result.current.journeys).toEqual([]);
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.previousView).toBe('');
  });

  it('previousView is stored on activation and available for restoration', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('A')];

    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'metamodel');
    });

    expect(result.current.previousView).toBe('metamodel');

    // After close, previousView is cleared
    act(() => {
      result.current.closeReviewSession();
    });
    expect(result.current.previousView).toBe('');
  });
});

describe('useActivateJourneyReview', () => {
  it('returns just the activation function', () => {
    const { result } = renderHook(() => useActivateJourneyReview(), {
      wrapper: createWrapper(),
    });

    expect(typeof result.current).toBe('function');
  });
});
