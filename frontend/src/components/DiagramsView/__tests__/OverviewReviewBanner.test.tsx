/**
 * OverviewReviewBanner Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 5, Task 5.1 (Test 4): OverviewReviewBanner renders Preview badge,
 * business user name in title, summary text (journey count and BP count),
 * Save as Diagram button, and Close/Discard button.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { OverviewReviewBanner } from '../OverviewReviewBanner';
import type { UserJourneyOverviewDiagramDto } from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestOverviewDto(
  businessUserName: string = 'Customer',
  journeyCount: number = 3,
  laneCount: number = 2
): UserJourneyOverviewDiagramDto {
  const lanes = Array.from({ length: laneCount }, (_, i) => ({
    id: `lane-${i}`,
    name: `BP ${i + 1}`,
    order: i,
  }));

  const nodes = Array.from({ length: journeyCount }, (_, i) => ({
    id: `node-${i}`,
    lane_id: `lane-${i % laneCount}`,
    name: `Journey ${i + 1}`,
    description: `Description ${i + 1}`,
    primary_business_user_id: 'bu-1',
    primary_business_user_name: businessUserName,
    parent_business_process_id: `bp-${i % laneCount}`,
    parent_business_process_name: `BP ${(i % laneCount) + 1}`,
    metadata: { step_count: 5, application_count: 2, relationship_in_count: 0, relationship_out_count: 0 },
  }));

  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: businessUserName,
      title: `${businessUserName} Journey Overview`,
    },
    lanes,
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

// ============================================================================
// Tests
// ============================================================================

describe('OverviewReviewBanner', () => {
  it('renders Preview badge', () => {
    const dto = createTestOverviewDto();
    const { getByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={dto}
        isSaved={false}
        onSaveAsDiagram={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    const badge = getByTestId('overview-review-preview-badge');
    expect(badge.textContent).toBe('Preview');
  });

  it('renders business user name in title', () => {
    const dto = createTestOverviewDto('Enterprise Buyer');
    const { getByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={dto}
        isSaved={false}
        onSaveAsDiagram={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    const title = getByTestId('overview-review-title');
    expect(title.textContent).toBe('Enterprise Buyer Journey Overview');
  });

  it('renders summary text with correct journey count and BP count', () => {
    const dto = createTestOverviewDto('Customer', 12, 4);
    const { getByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={dto}
        isSaved={false}
        onSaveAsDiagram={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    const summary = getByTestId('overview-review-summary');
    expect(summary.textContent).toBe('12 journeys across 4 business processes');
  });

  it('renders summary text with correct singular forms for 1 journey and 1 BP', () => {
    const dto = createTestOverviewDto('Customer', 1, 1);
    const { getByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={dto}
        isSaved={false}
        onSaveAsDiagram={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    const summary = getByTestId('overview-review-summary');
    expect(summary.textContent).toBe('1 journey across 1 business process');
  });

  it('renders Save as Diagram button when not saved', () => {
    const onSave = vi.fn();
    const dto = createTestOverviewDto();
    const { getByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={dto}
        isSaved={false}
        onSaveAsDiagram={onSave}
        onDiscard={vi.fn()}
      />
    );

    const saveButton = getByTestId('overview-review-save-as-diagram');
    expect(saveButton.textContent).toBe('Save as Diagram');
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows Saved badge instead of Save button when isSaved is true', () => {
    const dto = createTestOverviewDto();
    const { getByTestId, queryByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={dto}
        isSaved={true}
        onSaveAsDiagram={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    expect(queryByTestId('overview-review-save-as-diagram')).toBeNull();
    const savedBadge = getByTestId('overview-review-saved-badge');
    expect(savedBadge.textContent).toBe('Saved');
  });

  it('renders Discard button and calls onDiscard when clicked', () => {
    const onDiscard = vi.fn();
    const dto = createTestOverviewDto();
    const { getByTestId } = render(
      <OverviewReviewBanner
        overviewDiagram={dto}
        isSaved={false}
        onSaveAsDiagram={vi.fn()}
        onDiscard={onDiscard}
      />
    );

    const discardButton = getByTestId('overview-review-discard');
    expect(discardButton.textContent).toBe('Discard');
    fireEvent.click(discardButton);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
