/**
 * JourneyReviewBanner "Save All as PDF" Button Tests
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 3, Task 3.1: 5 focused tests for the new PDF button
 *
 * Test 1: "Save All as PDF" button is NOT rendered when onSaveAllAsPdf prop is not provided
 * Test 2: "Save All as PDF" button IS rendered when onSaveAllAsPdf prop is provided
 * Test 3: Clicking "Save All as PDF" button calls the onSaveAllAsPdf callback
 * Test 4: Button is disabled and progress text is shown when pdfProgress prop has generating: true
 * Test 5: Button is re-enabled and progress text is hidden when pdfProgress prop has generating: false
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

describe('JourneyReviewBanner - Save All as PDF button', () => {
  it('"Save All as PDF" button is NOT rendered when onSaveAllAsPdf prop is not provided', () => {
    const { queryByTestId } = render(
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

    expect(queryByTestId('journey-review-save-all-pdf')).toBeNull();
  });

  it('"Save All as PDF" button IS rendered when onSaveAllAsPdf prop is provided', () => {
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAllAsPdf={vi.fn()}
      />
    );

    const pdfButton = getByTestId('journey-review-save-all-pdf');
    expect(pdfButton).toBeDefined();
    expect(pdfButton.textContent).toBe('Save All as Diagrams & PDF');
  });

  it('clicking "Save All as PDF" button calls the onSaveAllAsPdf callback', () => {
    const onSaveAllAsPdf = vi.fn();
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAllAsPdf={onSaveAllAsPdf}
      />
    );

    fireEvent.click(getByTestId('journey-review-save-all-pdf'));
    expect(onSaveAllAsPdf).toHaveBeenCalledTimes(1);
  });

  it('button is disabled and progress text is shown when pdfProgress has generating: true', () => {
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAllAsPdf={vi.fn()}
        pdfProgress={{ generating: true, current: 3, total: 12 }}
      />
    );

    const pdfButton = getByTestId('journey-review-save-all-pdf') as HTMLButtonElement;
    expect(pdfButton.disabled).toBe(true);

    const progressText = getByTestId('pdf-progress-text');
    expect(progressText).toBeDefined();
    expect(progressText.textContent).toBe('Generating PDF... 3 of 12');
  });

  it('button is re-enabled and progress text is hidden when pdfProgress has generating: false', () => {
    const { getByTestId, queryByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAllAsPdf={vi.fn()}
        pdfProgress={{ generating: false, current: 0, total: 0 }}
      />
    );

    const pdfButton = getByTestId('journey-review-save-all-pdf') as HTMLButtonElement;
    expect(pdfButton.disabled).toBe(false);

    expect(queryByTestId('pdf-progress-text')).toBeNull();
  });
});
