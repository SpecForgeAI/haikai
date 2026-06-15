/**
 * Tests for Surface 4 -- Cascade-summary accept-batch UX.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5 (5.4)
 *
 * Covers (4 tests):
 *   1. Cascade-summary turn renders the proposed `cascadedDecisions[]` with
 *      per-cascade controls (accept / override).
 *   2. "Accept all" calls the gateway batch endpoint and renders the
 *      `cascade-accepted` turn with `wasOverridden: false` for each entry.
 *   3. Per-cascade override opens an inline reason input; submission records
 *      `wasOverridden: true` + `overrideReason` for that cascade only.
 *   4. While the batch is in flight, "Thinking..." spinner shows; the 60s
 *      frontend timeout per Q18 surfaces an error toast and lets the user retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CascadeSummaryControls } from '../CascadeSummaryControls';
import type {
  CascadeSummaryEntry,
  CascadeSummaryTurn,
} from '../../../../api/architectConversationApi';

const TURN: CascadeSummaryTurn = {
  kind: 'cascade-summary',
  cascadedDecisions: [
    {
      decisionCode: 'service.runtime',
      proposedValue: 'Eclipse Temurin 21',
      sourceStandardId: 'std.runtime.v1',
    },
    {
      decisionCode: 'testing.unit',
      proposedValue: 'JUnit 5',
      sourceStandardId: 'std.testing.unit.v1',
    },
    {
      decisionCode: 'build.tool',
      proposedValue: 'Gradle 8',
      sourceStandardId: 'std.build.v1',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('CascadeSummaryControls (Spec 3, Commit 5, Surface 4)', () => {
  it('renders proposed cascadedDecisions[] with per-cascade controls', () => {
    render(
      <CascadeSummaryControls
        turn={TURN}
        parentDecisionId="parent-1"
        busy={false}
        error={null}
        onAcceptAll={vi.fn()}
        onOverrideOne={vi.fn()}
      />,
    );

    // The cascade-summary container is present.
    expect(screen.getByTestId('architect-conversation-cascade-summary')).toBeInTheDocument();
    // Each proposal has a row with its own override control.
    for (const entry of TURN.cascadedDecisions) {
      expect(
        screen.getByTestId(`architect-conversation-cascade-row-${entry.decisionCode}`),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(`architect-conversation-cascade-override-button-${entry.decisionCode}`),
      ).toBeInTheDocument();
    }
    // The "Accept all" CTA reflects the count.
    expect(screen.getByTestId('architect-conversation-cascade-accept-all').textContent).toContain('Accept all (3)');
  });

  it('"Accept all" invokes the onAcceptAll callback with the full proposal array', () => {
    const onAcceptAll = vi.fn();
    render(
      <CascadeSummaryControls
        turn={TURN}
        parentDecisionId="parent-2"
        busy={false}
        error={null}
        onAcceptAll={onAcceptAll}
        onOverrideOne={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('architect-conversation-cascade-accept-all'));

    expect(onAcceptAll).toHaveBeenCalledTimes(1);
    const passedProposals = onAcceptAll.mock.calls[0][0] as CascadeSummaryEntry[];
    expect(passedProposals).toEqual(TURN.cascadedDecisions);
  });

  it('per-cascade override opens an inline reason input and submits with the override value + reason', () => {
    const onOverrideOne = vi.fn();
    render(
      <CascadeSummaryControls
        turn={TURN}
        parentDecisionId="parent-3"
        busy={false}
        error={null}
        onAcceptAll={vi.fn()}
        onOverrideOne={onOverrideOne}
      />,
    );

    fireEvent.click(
      screen.getByTestId('architect-conversation-cascade-override-button-testing.unit'),
    );

    // Inline override row appears.
    const valueInput = screen.getByTestId(
      'architect-conversation-cascade-override-value-testing.unit',
    ) as HTMLInputElement;
    const reasonInput = screen.getByTestId(
      'architect-conversation-cascade-override-reason-testing.unit',
    ) as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: 'TestNG' } });
    fireEvent.change(reasonInput, {
      target: { value: 'Legacy compatibility' },
    });

    fireEvent.click(
      screen.getByTestId('architect-conversation-cascade-override-submit-testing.unit'),
    );

    expect(onOverrideOne).toHaveBeenCalledTimes(1);
    const [proposal, overrideValue, reason] = onOverrideOne.mock.calls[0];
    expect(proposal.decisionCode).toBe('testing.unit');
    expect(overrideValue).toBe('TestNG');
    expect(reason).toBe('Legacy compatibility');
  });

  it('shows "Thinking..." spinner while busy and surfaces an error toast + Retry on failure', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <CascadeSummaryControls
        turn={TURN}
        parentDecisionId="parent-4"
        busy={true}
        error={null}
        onAcceptAll={vi.fn()}
        onOverrideOne={vi.fn()}
        onRetry={onRetry}
      />,
    );

    // Busy state -> "Thinking..."
    const acceptAllBtn = screen.getByTestId('architect-conversation-cascade-accept-all');
    expect(acceptAllBtn.textContent).toContain('Thinking');
    expect((acceptAllBtn as HTMLButtonElement).disabled).toBe(true);

    // Now simulate the 60s timeout error surfacing.
    rerender(
      <CascadeSummaryControls
        turn={TURN}
        parentDecisionId="parent-4"
        busy={false}
        error="Request timed out after 60 seconds"
        onAcceptAll={vi.fn()}
        onOverrideOne={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByTestId('architect-conversation-cascade-error'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('architect-conversation-cascade-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
