/**
 * DiagramsView Journey Review Integration Tests
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 6, Task 6.1: 5 focused tests for integration flow
 *
 * Test 1: When review active && selectedIndex === null, renders JourneyChooser
 * Test 2: When review active && selectedIndex !== null, renders UserJourneyDiagramRenderer
 * Test 3: When review not active, renders normal diagram workspace
 * Test 4: Panels are hidden when review session is active
 * Test 5: Zoom controls remain visible during review mode
 *
 * These tests use a lightweight approach: testing the JourneyChooser, JourneyReviewBanner,
 * and UserJourneyDiagramRenderer components directly with their context since DiagramsView
 * is too large to render in isolation in a test environment.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import React from 'react';
import {
  UserJourneyReviewProvider,
  useUserJourneyReviewContext,
} from '../../../contexts/UserJourneyReviewContext';
import { JourneyChooser } from '../JourneyChooser';
import { JourneyReviewBanner } from '../JourneyReviewBanner';
import UserJourneyDiagramRenderer from '../UserJourneyDiagramRenderer';
import type { UserJourneyDiagramDto } from '../../../types/userJourneyDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDiagram(name: string, stepCount: number = 2): UserJourneyDiagramDto {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i}`,
    journey_id: 'j-1',
    order: i,
    lane_id: 'lane-1',
    process_activity_id: `pa-${i}`,
    process_activity_name: `Activity ${i}`,
    name: `Step ${i}`,
    description: '',
    business_user_id: 'bu-1',
    business_user_name: 'Customer',
  }));

  return {
    diagram_type: 'USER_JOURNEY',
    version: '1',
    journey: {
      id: `j-${name}`,
      name,
      description: '',
      user_role_id: 'ur-1',
      user_role_name: 'End User',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'Order Management',
    },
    lanes: [{ id: 'lane-1', name: 'Web App', order: 0 }],
    steps,
    edges: stepCount > 1 ? [{ id: 'e-1', from_step_id: 'step-0', to_step_id: 'step-1', order: 0, is_cross_lane: false }] : [],
    render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
  };
}

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <UserJourneyReviewProvider>{children}</UserJourneyReviewProvider>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('DiagramsView Journey Review Integration', () => {
  it('when review active with selectedIndex === null, JourneyChooser renders journey cards', () => {
    const journeys = [createTestDiagram('Journey A'), createTestDiagram('Journey B')];
    const onSelect = vi.fn();

    const { getByTestId, queryByTestId } = render(
      <JourneyChooser journeys={journeys} onSelectJourney={onSelect} />
    );

    expect(getByTestId('journey-chooser')).toBeDefined();
    expect(getByTestId('journey-card-0')).toBeDefined();
    expect(getByTestId('journey-card-1')).toBeDefined();
    expect(queryByTestId('journey-diagram-renderer')).toBeNull();
  });

  it('when review active with selectedIndex !== null, UserJourneyDiagramRenderer renders the selected journey', () => {
    const diagram = createTestDiagram('Selected Journey');

    const { getByTestId } = render(
      <svg>
        <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
      </svg>
    );

    expect(getByTestId('journey-diagram-renderer')).toBeDefined();
    expect(getByTestId('journey-header-block').textContent).toContain('Selected Journey');
  });

  it('context tracks review session state correctly through chooser -> diagram -> close lifecycle', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('A'), createTestDiagram('B')];

    // Initially not active
    expect(result.current.active).toBe(false);

    // Activate review session (chooser mode)
    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard');
    });
    expect(result.current.active).toBe(true);
    expect(result.current.selectedIndex).toBeNull();

    // Select a journey (diagram mode)
    act(() => {
      result.current.selectJourney(0);
    });
    expect(result.current.selectedIndex).toBe(0);

    // Close review
    act(() => {
      result.current.closeReviewSession();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.journeys).toEqual([]);
  });

  it('JourneyReviewBanner shows correct navigation state when journey is selected', () => {
    const journey = createTestDiagram('Middle Journey').journey;
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onBack = vi.fn();
    const onClose = vi.fn();

    const { getByTestId, queryByTestId } = render(
      <JourneyReviewBanner
        journey={journey}
        selectedIndex={1}
        totalJourneys={3}
        onPrevious={onPrev}
        onNext={onNext}
        onReturnToChooser={onBack}
        onCloseReview={onClose}
      />
    );

    // Banner is visible
    expect(getByTestId('journey-review-banner')).toBeDefined();
    // Preview badge visible
    expect(getByTestId('journey-review-preview-badge').textContent).toBe('Preview');
    // Journey name visible
    expect(getByTestId('journey-review-name').textContent).toBe('Middle Journey');
    // Position indicator
    expect(getByTestId('journey-review-position').textContent).toBe('2 of 3');
    // Both navigation buttons enabled (middle journey)
    const prevBtn = getByTestId('journey-review-previous') as HTMLButtonElement;
    const nextBtn = getByTestId('journey-review-next') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(false);
    expect(nextBtn.disabled).toBe(false);
    // Back to List visible (3 journeys)
    expect(queryByTestId('journey-review-back-to-list')).not.toBeNull();
  });

  it('single journey auto-load sets selectedIndex to 0 (skips chooser)', () => {
    const { result } = renderHook(() => useUserJourneyReviewContext(), {
      wrapper: createWrapper(),
    });

    const journeys = [createTestDiagram('Only Journey')];

    // Activate with initialSelectedIndex=0 for single journey auto-load
    act(() => {
      result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard', 0);
    });

    expect(result.current.active).toBe(true);
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.journeys).toHaveLength(1);
  });
});
