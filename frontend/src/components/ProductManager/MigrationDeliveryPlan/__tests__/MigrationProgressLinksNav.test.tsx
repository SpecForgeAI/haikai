/**
 * Progress report links on the Execution rail (2026-08-16).
 *
 * The review screen carries two navigation links in the Execution area,
 * right-aligned above the stage cards (so above the "Stage 2 · Service"
 * box): "Progress Detail →" (the delivery dashboard) and
 * "Progress Summary →" (the one-screen stakeholder progress report).
 * Rendered only when the caller wires the callbacks.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import {
  MigrationExecutionRail,
  type RailPlane,
} from '../MigrationExecutionRail';

function planesFixture(): RailPlane[] {
  return [
    {
      plane: 'db',
      totalStories: 2,
      satisfiedStories: 2,
      blockers: [],
      runDone: 0,
      runTotal: 0,
    },
    {
      plane: 'service',
      totalStories: 3,
      satisfiedStories: 3,
      blockers: [],
      runDone: 0,
      runTotal: 0,
    },
  ];
}

function renderRail(overrides: {
  onOpenDelivery?: () => void;
  onOpenProgress?: () => void;
}) {
  render(
    <MigrationExecutionRail
      planes={planesFixture()}
      runStatus={null}
      scopeReady
      busy={false}
      error={null}
      pausedBlockers={null}
      onStart={() => undefined}
      onApprove={() => undefined}
      onBreakGlass={() => undefined}
      onSelectStory={() => undefined}
      {...overrides}
    />,
  );
}

describe('Execution rail progress links', () => {
  it('renders both links above the stage cards and fires their callbacks', () => {
    const onOpenDelivery = vi.fn();
    const onOpenProgress = vi.fn();
    renderRail({ onOpenDelivery, onOpenProgress });

    const links = screen.getByTestId('execution-rail-progress-links');
    expect(links).toHaveTextContent('Progress Detail');
    expect(links).toHaveTextContent('Progress Summary');
    // The links sit BEFORE the stage cards in document order (above the
    // "Stage 2 · Service" box).
    const serviceCard = screen.getByTestId('execution-rail-card-service');
    expect(
      links.compareDocumentPosition(serviceCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('execution-rail-progress-detail-link'));
    expect(onOpenDelivery).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('execution-rail-progress-summary-link'));
    expect(onOpenProgress).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when neither callback is wired', () => {
    renderRail({});
    expect(
      screen.queryByTestId('execution-rail-progress-links'),
    ).not.toBeInTheDocument();
  });
});
