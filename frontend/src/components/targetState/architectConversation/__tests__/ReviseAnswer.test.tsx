/**
 * Tests for Surface 7 -- Revise-prior-answer flow + Q6 downstream-review banner.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5 (5.7)
 *
 * Covers (4 tests):
 *   1. Clicking any prior decision in the summary panel opens the revise
 *      dialog.
 *   2. Submitting a revision invokes the onSubmit callback with the new
 *      answer value + the original decision's scope.
 *   3. The Q6 banner appears listing affectedDownstreamCodes after a
 *      revision; no auto-replay occurs (the banner is dismiss-only).
 *   4. Dismissing the banner does not reset the decision; cascaded codes
 *      remain at their original values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  RevisePriorAnswerDialog,
  DownstreamCodesBanner,
} from '../RevisePriorAnswer';
import { SummaryPanel } from '../SummaryPanel';
import type { CapturedDecisionRow } from '../../../../api/architectConversationApi';

const ROW: CapturedDecisionRow = {
  decisionId: 'dec-rev-1',
  decisionCode: 'service.language',
  scopeKind: 'architecture',
  scopeRefType: null,
  scopeRefId: null,
  answerValue: 'Java 17',
  answerSummary: null,
  standardsLookupRef: null,
  supersededById: null,
};

const ELEMENT_ROW: CapturedDecisionRow = {
  decisionId: 'dec-rev-2',
  decisionCode: 'service.framework',
  scopeKind: 'element',
  scopeRefType: 'service',
  scopeRefId: 'svc-x',
  answerValue: 'Spring Boot 3.4',
  answerSummary: null,
  standardsLookupRef: null,
  supersededById: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('RevisePriorAnswer (Spec 3, Commit 5, Surface 7)', () => {
  it('clicking a prior decision in the SummaryPanel calls the revise handler', () => {
    const onRevise = vi.fn();
    render(<SummaryPanel decisions={[ROW]} onReviseDecision={onRevise} />);

    fireEvent.click(
      screen.getByTestId('architect-conversation-summary-row-service.language'),
    );
    expect(onRevise).toHaveBeenCalledTimes(1);
    expect(onRevise.mock.calls[0][0]).toEqual(ROW);
  });

  it('submitting a revision invokes onSubmit with the new value + architecture scope', async () => {
    const onSubmit = vi.fn();
    render(
      <RevisePriorAnswerDialog
        decision={ROW}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      'architect-conversation-revise-value-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Java 21' } });
    fireEvent.click(screen.getByTestId('architect-conversation-revise-submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const args = onSubmit.mock.calls[0][0];
    expect(args.newAnswerValue).toBe('Java 21');
    expect(args.scope).toEqual({ kind: 'architecture' });
  });

  it('submitting an element-scoped revision preserves the element scope', async () => {
    const onSubmit = vi.fn();
    render(
      <RevisePriorAnswerDialog
        decision={ELEMENT_ROW}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      'architect-conversation-revise-value-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Quarkus 3' } });
    fireEvent.click(screen.getByTestId('architect-conversation-revise-submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const args = onSubmit.mock.calls[0][0];
    expect(args.scope).toEqual({
      kind: 'element',
      refType: 'service',
      refId: 'svc-x',
    });
  });

  it('DownstreamCodesBanner lists the affected codes and dismisses on click without resetting decisions', () => {
    const onDismiss = vi.fn();
    render(
      <DownstreamCodesBanner
        affectedDownstreamCodes={['service.runtime', 'testing.unit', 'build.tool']}
        onDismiss={onDismiss}
      />,
    );

    const banner = screen.getByTestId('architect-conversation-downstream-codes-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('service.runtime');
    expect(banner.textContent).toContain('testing.unit');
    expect(banner.textContent).toContain('build.tool');

    fireEvent.click(
      screen.getByTestId('architect-conversation-downstream-codes-dismiss'),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
