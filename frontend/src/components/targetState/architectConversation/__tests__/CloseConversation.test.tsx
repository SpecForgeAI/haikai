/**
 * Tests for Surface 6 -- Close-conversation flow + retire-current per Q4.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5 (5.6)
 *
 * Covers (4 tests):
 *   1. Close-conversation CTA disabled until A.1 (`service.language`) +
 *      B.1 (`api.protocol`) + C.1 (`db.engine`) are all answered per Q8.
 *   2. Clicking close calls onClose with a self-contained `summaryMarkdown`
 *      built from the captured-decision rows per Q16.
 *   3. Second-user opening a draft with an open session sees a "retire current
 *      and start new" affordance; choosing retire invokes onRetireAndStartNew.
 *   4. Deferred rows are visually distinguishable from un-answered questions
 *      per Q8 in the SummaryPanel (`data-deferred="true"`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  CloseConversationFlow,
  buildCloseSummaryMarkdown,
  CLOSE_GATE_CODES,
} from '../CloseConversationFlow';
import { SummaryPanel } from '../SummaryPanel';
import type { CapturedDecisionRow } from '../../../../api/architectConversationApi';

function rowFor(code: string, value = 'Java 21'): CapturedDecisionRow {
  return {
    decisionId: `dec-${code}`,
    decisionCode: code,
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: value,
    answerSummary: null,
    standardsLookupRef: null,
    supersededById: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('CloseConversationFlow (Spec 3, Commit 5, Surface 6)', () => {
  it('keeps the Close CTA disabled until A.1 + B.1 + C.1 are all answered', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CloseConversationFlow
        decisions={[]}
        isOpen={true}
        isOwnedByCurrentUser={true}
        onClose={onClose}
        onRetireAndStartNew={vi.fn()}
      />,
    );

    const btn = screen.getByTestId('architect-conversation-close-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Hint copy lists all three missing codes.
    expect(
      screen.getByTestId('architect-conversation-close-gate-hint').textContent,
    ).toMatch(/service\.language/);

    // Add A.1 only -- still disabled.
    rerender(
      <CloseConversationFlow
        decisions={[rowFor('service.language')]}
        isOpen={true}
        isOwnedByCurrentUser={true}
        onClose={onClose}
        onRetireAndStartNew={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('architect-conversation-close-button') as HTMLButtonElement).disabled,
    ).toBe(true);

    // Add all three -- gate met.
    rerender(
      <CloseConversationFlow
        decisions={CLOSE_GATE_CODES.map((c) => rowFor(c))}
        isOpen={true}
        isOwnedByCurrentUser={true}
        onClose={onClose}
        onRetireAndStartNew={vi.fn()}
      />,
    );
    const enabledBtn = screen.getByTestId(
      'architect-conversation-close-button',
    ) as HTMLButtonElement;
    expect(enabledBtn.disabled).toBe(false);
  });

  it('clicking Close invokes onClose with a self-contained summaryMarkdown', () => {
    const onClose = vi.fn();
    const decisions = CLOSE_GATE_CODES.map((c) => rowFor(c, `${c}-value`));
    render(
      <CloseConversationFlow
        decisions={decisions}
        isOpen={true}
        isOwnedByCurrentUser={true}
        onClose={onClose}
        onRetireAndStartNew={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('architect-conversation-close-button'));

    expect(onClose).toHaveBeenCalledTimes(1);
    const md = onClose.mock.calls[0][0] as string;
    expect(md).toContain('# Architect conversation summary');
    expect(md).toContain('service.language');
    expect(md).toContain('api.protocol');
    expect(md).toContain('db.engine');
  });

  it('shows the retire-current affordance for a session owned by another user', () => {
    const onRetireAndStartNew = vi.fn();
    render(
      <CloseConversationFlow
        decisions={[]}
        isOpen={true}
        isOwnedByCurrentUser={false}
        onClose={vi.fn()}
        onRetireAndStartNew={onRetireAndStartNew}
      />,
    );

    expect(
      screen.getByTestId('architect-conversation-retire-current-affordance'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('architect-conversation-retire-current-button'));
    expect(onRetireAndStartNew).toHaveBeenCalledTimes(1);
  });

  it('SummaryPanel visually distinguishes deferred rows via data-deferred attribute', () => {
    const decisions: CapturedDecisionRow[] = [
      rowFor('service.language', 'Java 21'),
      rowFor('api.protocol', 'deferred'),
    ];
    render(<SummaryPanel decisions={decisions} />);

    const javaRow = screen.getByTestId(
      'architect-conversation-summary-row-service.language',
    );
    expect(javaRow.getAttribute('data-deferred')).toBe('false');

    const deferredRow = screen.getByTestId(
      'architect-conversation-summary-row-api.protocol',
    );
    expect(deferredRow.getAttribute('data-deferred')).toBe('true');
    expect(deferredRow.textContent).toContain('Deferred');
  });
});

describe('buildCloseSummaryMarkdown helper', () => {
  it('emits grouped-by-scope sections including element exceptions', () => {
    const md = buildCloseSummaryMarkdown([
      rowFor('service.language', 'Java 21'),
      {
        decisionId: 'dec-x',
        decisionCode: 'service.framework',
        scopeKind: 'element',
        scopeRefType: 'service',
        scopeRefId: 'svc-1',
        answerValue: 'Spring Classic 5',
        answerSummary: null,
        standardsLookupRef: null,
        supersededById: null,
      },
    ]);
    expect(md).toContain('## Architecture-wide decisions');
    expect(md).toContain('## Per-element exceptions');
    expect(md).toContain('service:svc-1');
    expect(md).toContain('Spring Classic 5');
  });
});
