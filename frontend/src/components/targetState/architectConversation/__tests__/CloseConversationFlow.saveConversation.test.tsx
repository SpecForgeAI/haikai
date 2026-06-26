/**
 * CloseConversationFlow -- "Save Conversation" relabel + non-blocking
 * completeness summary.
 *
 * Spec: 2026-06-26-target-conversation-save-resume-plan-sourcing (FR3 / Q9),
 * Task Group 4.1 / 4.2.
 *
 * Covers (4 tests):
 *   1. The close CTA reads "Save Conversation" once the gate is met.
 *   2. Gate met but the walk is incomplete -> a NON-BLOCKING completeness
 *      summary + warning renders, and Save STAYS enabled.
 *   3. The close gate is unchanged: `CLOSE_GATE_CODES` = service.language +
 *      api.protocol + db.engine is the minimum; missing db.engine disables Save.
 *   4. `db.migrations` stays OUT of the gate: with the three gate codes
 *      answered (and db.migrations absent) the gate is satisfied.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import {
  CloseConversationFlow,
  CLOSE_GATE_CODES,
  evaluateCloseGate,
} from '../CloseConversationFlow';
import type { CapturedDecisionRow } from '../../../../api/architectConversationApi';

function row(decisionCode: string): CapturedDecisionRow {
  return {
    decisionId: `dec-${decisionCode}`,
    decisionCode,
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: 'something',
    answerSummary: 'something',
    standardsLookupRef: null,
    supersededById: null,
  };
}

const gateMetDecisions = CLOSE_GATE_CODES.map((c) => row(c));

afterEach(() => cleanup());

describe('CloseConversationFlow -- Save Conversation relabel + completeness summary', () => {
  it('relabels the close CTA to "Save Conversation" when the gate is met', () => {
    render(
      <CloseConversationFlow
        decisions={gateMetDecisions}
        isOpen
        isOwnedByCurrentUser
        onClose={vi.fn()}
        onRetireAndStartNew={vi.fn()}
      />,
    );

    const btn = screen.getByTestId('architect-conversation-close-button');
    expect(btn).toHaveTextContent('Save Conversation');
    expect(btn).not.toBeDisabled();
  });

  it('shows a NON-BLOCKING completeness warning but keeps Save enabled when incomplete', () => {
    render(
      <CloseConversationFlow
        decisions={gateMetDecisions}
        isOpen
        isOwnedByCurrentUser
        onClose={vi.fn()}
        onRetireAndStartNew={vi.fn()}
        incompleteSummary={{ answeredCount: 3, nextDecisionCode: 'db.migrations' }}
      />,
    );

    const warning = screen.getByTestId('architect-conversation-incomplete-warning');
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toMatch(/not complete yet/i);
    expect(warning.textContent).toMatch(/db\.migrations/);

    // The warning is purely advisory -- Save is STILL enabled.
    expect(
      screen.getByTestId('architect-conversation-close-button'),
    ).not.toBeDisabled();
  });

  it('keeps the gate unchanged: missing db.engine disables Save and shows the hint', () => {
    render(
      <CloseConversationFlow
        decisions={[row('service.language'), row('api.protocol')]}
        isOpen
        isOwnedByCurrentUser
        onClose={vi.fn()}
        onRetireAndStartNew={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId('architect-conversation-close-button'),
    ).toBeDisabled();
    const hint = screen.getByTestId('architect-conversation-close-gate-hint');
    expect(hint.textContent).toMatch(/db\.engine/);
    // No incomplete-warning when the gate is not even met.
    expect(
      screen.queryByTestId('architect-conversation-incomplete-warning'),
    ).toBeNull();
  });

  it('keeps db.migrations OUT of the gate (the three gate codes are sufficient)', () => {
    // The three gate codes answered, db.migrations deliberately absent.
    expect(evaluateCloseGate(gateMetDecisions)).toEqual([]);
    expect(CLOSE_GATE_CODES).not.toContain('db.migrations');
    expect([...CLOSE_GATE_CODES]).toEqual([
      'service.language',
      'api.protocol',
      'db.engine',
    ]);
  });
});
