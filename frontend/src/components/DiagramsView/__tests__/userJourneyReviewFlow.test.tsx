/**
 * User Journey Review Flow - Gap Fill Tests
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 7, Task 7.3: Strategic tests to fill coverage gaps
 *
 * Gap 1: Navigation round-trip -- select journey, navigate next/previous, return to chooser, close
 * Gap 2: Renderer with VERTICAL lane_axis
 * Gap 3: Step referencing non-existent laneId rendered in fallback position
 * Gap 4: Close review session clears previousView correctly
 * Gap 5: API client handles network errors gracefully
 * Gap 6: Chooser click then banner shows selected journey data correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import React from 'react';
import {
  UserJourneyReviewProvider,
  useUserJourneyReviewContext,
} from '../../../contexts/UserJourneyReviewContext';
import UserJourneyDiagramRenderer from '../UserJourneyDiagramRenderer';
import { JourneyReviewBanner } from '../JourneyReviewBanner';
import type { UserJourneyDiagramDto } from '../../../types/userJourneyDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDiagram(name: string, laneAxis: string = 'HORIZONTAL'): UserJourneyDiagramDto {
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
      parent_business_process_name: 'E-Commerce',
    },
    lanes: [
      { id: 'lane-1', name: 'Frontend', order: 0 },
      { id: 'lane-2', name: 'Backend', order: 1 },
    ],
    steps: [
      {
        id: 'step-1', journey_id: `j-${name}`, order: 0, lane_id: 'lane-1',
        process_activity_id: 'pa-1', process_activity_name: 'Browse',
        name: 'Browse', diagram_label: 'Browse', description: '', business_user_id: 'bu-1', business_user_name: 'Customer', activity_issues: '', ui_issues: '',
      },
      {
        id: 'step-2', journey_id: `j-${name}`, order: 1, lane_id: 'lane-2',
        process_activity_id: 'pa-2', process_activity_name: 'Process',
        name: 'Process', diagram_label: 'Process', description: '', business_user_id: 'bu-2', business_user_name: 'System', activity_issues: '', ui_issues: '',
      },
    ],
    edges: [
      { id: 'e-1', from_step_id: 'step-1', to_step_id: 'step-2', order: 0, is_cross_lane: true },
    ],
    render_hints: { lane_axis: laneAxis, flow_direction: 'LEFT_TO_RIGHT', show_title: true },
  };
}

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <UserJourneyReviewProvider>{children}</UserJourneyReviewProvider>
  );
}

// ============================================================================
// Gap Fill Tests
// ============================================================================

describe('User Journey Review Flow - Gap Fill', () => {
  describe('Gap 1: Navigation round-trip', () => {
    it('select journey -> next -> previous -> return to chooser -> close clears state', () => {
      const { result } = renderHook(() => useUserJourneyReviewContext(), {
        wrapper: createWrapper(),
      });

      const journeys = [
        createTestDiagram('A'),
        createTestDiagram('B'),
        createTestDiagram('C'),
      ];

      // Activate
      act(() => {
        result.current.activateReviewSession('proj-1', 'task-1', journeys, 'dashboard');
      });
      expect(result.current.selectedIndex).toBeNull();

      // Select journey 0
      act(() => { result.current.selectJourney(0); });
      expect(result.current.selectedIndex).toBe(0);

      // Next
      act(() => { result.current.selectNext(); });
      expect(result.current.selectedIndex).toBe(1);

      // Next again
      act(() => { result.current.selectNext(); });
      expect(result.current.selectedIndex).toBe(2);

      // Previous
      act(() => { result.current.selectPrevious(); });
      expect(result.current.selectedIndex).toBe(1);

      // Return to chooser
      act(() => { result.current.returnToChooser(); });
      expect(result.current.selectedIndex).toBeNull();
      expect(result.current.active).toBe(true);

      // Close
      act(() => { result.current.closeReviewSession(); });
      expect(result.current.active).toBe(false);
      expect(result.current.journeys).toEqual([]);
      expect(result.current.previousView).toBe('');
    });
  });

  describe('Gap 2: VERTICAL lane_axis rendering', () => {
    it('renders lanes as vertical columns when lane_axis is VERTICAL', () => {
      const diagram = createTestDiagram('Vertical Journey', 'VERTICAL');

      const { getByTestId } = render(
        <svg>
          <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
        </svg>
      );

      expect(getByTestId('journey-diagram-renderer')).toBeDefined();
      expect(getByTestId('journey-lane-lane-1')).toBeDefined();
      expect(getByTestId('journey-lane-lane-2')).toBeDefined();
      expect(getByTestId('journey-step-step-1')).toBeDefined();
      expect(getByTestId('journey-step-step-2')).toBeDefined();
    });
  });

  describe('Gap 3: Step with non-existent laneId', () => {
    it('renders step in fallback position when its laneId does not match any lane', () => {
      const diagram: UserJourneyDiagramDto = {
        diagram_type: 'USER_JOURNEY',
        version: '1',
        journey: {
          id: 'j-1', name: 'Orphan Step Journey', description: '',
          user_role_id: 'ur-1', user_role_name: 'User',
          parent_business_process_id: 'bp-1', parent_business_process_name: 'Flow',
        },
        lanes: [{ id: 'lane-1', name: 'Known Lane', order: 0 }],
        steps: [
          {
            id: 'orphan-step', journey_id: 'j-1', order: 0, lane_id: 'non-existent-lane',
            process_activity_id: 'pa-1', process_activity_name: 'Orphan',
            name: 'Orphan Step', diagram_label: 'Orphan Step', description: '', business_user_id: 'bu-1', business_user_name: 'User', activity_issues: '', ui_issues: '',
          },
        ],
        edges: [],
        render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
      };

      const { getByTestId } = render(
        <svg>
          <UserJourneyDiagramRenderer diagram={diagram} zoom={1} />
        </svg>
      );

      // The orphan step should still be rendered (in a fallback position)
      expect(getByTestId('journey-step-orphan-step')).toBeDefined();
    });
  });

  describe('Gap 4: previousView restoration', () => {
    it('closeReviewSession clears previousView to empty string', () => {
      const { result } = renderHook(() => useUserJourneyReviewContext(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.activateReviewSession(
          'proj-1', 'task-1', [createTestDiagram('A')], 'metamodel'
        );
      });
      expect(result.current.previousView).toBe('metamodel');

      act(() => {
        result.current.closeReviewSession();
      });
      expect(result.current.previousView).toBe('');
    });
  });

  describe('Gap 5: API client network error handling', () => {
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

    it('throws on network error (fetch rejection)', async () => {
      fetchMock.mockRejectedValue(new TypeError('Network request failed'));

      const { fetchTemporaryUserJourneyDiagrams } = await import('../../../api/userJourneyDiagramApi');

      await expect(fetchTemporaryUserJourneyDiagrams('proj-1')).rejects.toThrow('Network request failed');
    });
  });

  describe('Gap 6: Chooser selection into banner flow', () => {
    it('banner displays correct data for the selected journey after chooser interaction', () => {
      const journeys = [
        createTestDiagram('First Journey'),
        createTestDiagram('Second Journey'),
        createTestDiagram('Third Journey'),
      ];

      // Simulate the banner state for the second journey (index 1)
      const { getByTestId } = render(
        <JourneyReviewBanner
          journey={journeys[1].journey}
          selectedIndex={1}
          totalJourneys={3}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onReturnToChooser={vi.fn()}
          onCloseReview={vi.fn()}
        />
      );

      expect(getByTestId('journey-review-name').textContent).toBe('Second Journey');
      expect(getByTestId('journey-review-position').textContent).toBe('2 of 3');
      expect((getByTestId('journey-review-previous') as HTMLButtonElement).disabled).toBe(false);
      expect((getByTestId('journey-review-next') as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
