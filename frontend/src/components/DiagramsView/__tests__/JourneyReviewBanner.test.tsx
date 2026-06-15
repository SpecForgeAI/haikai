/**
 * JourneyReviewBanner Tests
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 5, Task 5.1: 7 focused tests for the review mode banner
 *
 * Test 1: Renders "Preview" badge
 * Test 2: Renders journey name text from the selected journey
 * Test 3: "Previous" button is disabled when selectedIndex === 0
 * Test 4: "Next" button is disabled when selectedIndex === totalJourneys - 1
 * Test 5: Position indicator shows correct text (e.g., "2 of 5")
 * Test 6: "Back to List" button is hidden when only one journey exists
 * Test 7: "Close Review" button calls the close handler
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { JourneyReviewBanner } from '../JourneyReviewBanner';
import type { UserJourneyDiagramJourneyDto } from '../../../types/userJourneyDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestJourney(name: string = 'Test Journey'): UserJourneyDiagramJourneyDto {
  return {
    id: 'j-1',
    name,
    description: 'Test',
    user_role_id: 'ur-1',
    user_role_name: 'End User',
    parent_business_process_id: 'bp-1',
    parent_business_process_name: 'Order Flow',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('JourneyReviewBanner', () => {
  it('renders "Preview" badge', () => {
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
      />
    );

    const badge = getByTestId('journey-review-preview-badge');
    expect(badge.textContent).toBe('Preview');
  });

  it('renders journey name text from the selected journey', () => {
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney('Order Placement Flow')}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
      />
    );

    expect(getByTestId('journey-review-name').textContent).toBe('Order Placement Flow');
  });

  it('"Previous" button is disabled when selectedIndex === 0', () => {
    const onPrevious = vi.fn();
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={5}
        onPrevious={onPrevious}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
      />
    );

    const prevButton = getByTestId('journey-review-previous') as HTMLButtonElement;
    expect(prevButton.disabled).toBe(true);
  });

  it('"Next" button is disabled when selectedIndex === totalJourneys - 1', () => {
    const onNext = vi.fn();
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={4}
        totalJourneys={5}
        onPrevious={vi.fn()}
        onNext={onNext}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
      />
    );

    const nextButton = getByTestId('journey-review-next') as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);
  });

  it('position indicator shows correct text', () => {
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={1}
        totalJourneys={5}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
      />
    );

    expect(getByTestId('journey-review-position').textContent).toBe('2 of 5');
  });

  it('"Back to List" button is hidden when only one journey exists', () => {
    const { queryByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={1}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
      />
    );

    expect(queryByTestId('journey-review-back-to-list')).toBeNull();
  });

  it('"Close Review" button calls the close handler', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={onClose}
      />
    );

    fireEvent.click(getByTestId('journey-review-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
