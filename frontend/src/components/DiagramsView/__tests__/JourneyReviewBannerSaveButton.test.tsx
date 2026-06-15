/**
 * JourneyReviewBanner "Save as Diagram" Button Tests
 *
 * Spec 2026-04-03: User Journey Diagram Edit and Save Flow
 * Task Group 4, Task 4.1: 3 focused tests for the new banner button
 *
 * Test 1: The "Save as Diagram" button renders and is visible
 * Test 2: Clicking "Save as Diagram" calls the onSaveAsDiagram callback
 * Test 3: The button is styled consistently with existing banner buttons
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

describe('JourneyReviewBanner - Save as Diagram button', () => {
  it('renders "Save as Diagram" button when onSaveAsDiagram callback is provided', () => {
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAsDiagram={vi.fn()}
      />
    );

    const saveButton = getByTestId('journey-review-save-as-diagram');
    expect(saveButton).toBeDefined();
    expect(saveButton.textContent).toBe('Save as Diagram');
  });

  it('clicking "Save as Diagram" calls the onSaveAsDiagram callback', () => {
    const onSaveAsDiagram = vi.fn();
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAsDiagram={onSaveAsDiagram}
      />
    );

    fireEvent.click(getByTestId('journey-review-save-as-diagram'));
    expect(onSaveAsDiagram).toHaveBeenCalledTimes(1);
  });

  it('button is styled consistently with existing banner buttons (border-radius, font-size, cursor)', () => {
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAsDiagram={vi.fn()}
      />
    );

    const saveButton = getByTestId('journey-review-save-as-diagram') as HTMLButtonElement;
    const closeButton = getByTestId('journey-review-close') as HTMLButtonElement;

    // Both buttons should share consistent styling attributes
    expect(saveButton.style.borderRadius).toBe('4px');
    expect(saveButton.style.fontSize).toBe('12px');
    expect(saveButton.style.cursor).toBe('pointer');
    expect(closeButton.style.borderRadius).toBe('4px');
    expect(closeButton.style.fontSize).toBe('12px');
    expect(closeButton.style.cursor).toBe('pointer');

    // Save button should have distinctive color styling as primary action
    // Note: jsdom normalizes hex colors to rgb format
    expect(saveButton.style.color).toBe('white');
    // Verify it has a background set (not the default white of other buttons)
    expect(saveButton.style.background).toBeTruthy();
    expect(saveButton.style.background).not.toBe('white');
  });
});
