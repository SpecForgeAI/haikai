/**
 * CapturedDecisionChip tests
 *
 * Spec: 2026-05-26 Compare View Decoration with Decision Codes -- Task Group 2 (2.1).
 *
 * Three focused chip-level tests:
 *   1. Chip click opens the popover with answerSummary + answerValue +
 *      standardsLookupRef + "View in conversation" button when conversation
 *      refs are non-null.
 *   2. Popover hides "View in conversation" link when conversationThreadId is
 *      null.
 *   3. "View in conversation" click fires the onOpenInConversation callback
 *      with the decision id.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { CapturedDecisionChip } from './CapturedDecisionChip';
import type { CapturedDecisionDto } from '../../api/architectConversationApi';

afterEach(() => {
  cleanup();
});

function buildDecision(overrides: Partial<CapturedDecisionDto> = {}): CapturedDecisionDto {
  return {
    decisionId: 'decision-uuid-1',
    projectId: 'project-uuid-1',
    targetArchitectureId: 'target-arch-uuid-1',
    decisionCode: 'db.engine',
    scopeKind: 'element',
    scopeRefType: 'physical_data_entity',
    scopeRefId: 'entity-uuid-1',
    answerValue: 'PostgreSQL 15',
    answerSummary: 'Use PostgreSQL 15 for OLTP workloads',
    standardsLookupRef: 'org-standards.md#db-postgres',
    conversationThreadId: 'thread-uuid-1',
    conversationTurnRef: 'turn-ref-1',
    createdAt: '2026-05-26T10:00:00Z',
    createdByTask: 'architect-persona-conversation',
    supersededById: null,
    ...overrides,
  };
}

describe('CapturedDecisionChip', () => {
  it('opens the popover with full payload on chip click when conversation refs exist', () => {
    const decision = buildDecision();
    render(<CapturedDecisionChip decision={decision} onOpenInConversation={vi.fn()} />);

    // Chip is visible with the decisionCode label; popover is closed.
    const chip = screen.getByTestId(`captured-decision-chip-${decision.decisionId}`);
    expect(chip).toHaveTextContent('db.engine');
    expect(
      screen.queryByTestId(`captured-decision-popover-${decision.decisionId}`),
    ).not.toBeInTheDocument();

    fireEvent.click(chip);

    const popover = screen.getByTestId(`captured-decision-popover-${decision.decisionId}`);
    expect(popover).toBeInTheDocument();
    expect(
      screen.getByTestId(`captured-decision-popover-summary-${decision.decisionId}`),
    ).toHaveTextContent('Use PostgreSQL 15 for OLTP workloads');
    expect(
      screen.getByTestId(`captured-decision-popover-value-${decision.decisionId}`),
    ).toHaveTextContent('PostgreSQL 15');
    expect(
      screen.getByTestId(`captured-decision-popover-standards-${decision.decisionId}`),
    ).toHaveTextContent('org-standards.md#db-postgres');
    expect(
      screen.getByTestId(
        `captured-decision-popover-open-in-conversation-${decision.decisionId}`,
      ),
    ).toBeInTheDocument();
  });

  it('hides the "View in conversation" link when conversationThreadId is null', () => {
    const decision = buildDecision({
      conversationThreadId: null,
      conversationTurnRef: null,
    });
    render(<CapturedDecisionChip decision={decision} onOpenInConversation={vi.fn()} />);

    fireEvent.click(
      screen.getByTestId(`captured-decision-chip-${decision.decisionId}`),
    );

    // Popover content is rendered...
    expect(
      screen.getByTestId(`captured-decision-popover-value-${decision.decisionId}`),
    ).toHaveTextContent('PostgreSQL 15');

    // ...but the conversation link is hidden.
    expect(
      screen.queryByTestId(
        `captured-decision-popover-open-in-conversation-${decision.decisionId}`,
      ),
    ).not.toBeInTheDocument();
  });

  it('fires onOpenInConversation with the decision id when the link is clicked', () => {
    const decision = buildDecision();
    const onOpenInConversation = vi.fn();
    render(
      <CapturedDecisionChip
        decision={decision}
        onOpenInConversation={onOpenInConversation}
      />,
    );

    fireEvent.click(
      screen.getByTestId(`captured-decision-chip-${decision.decisionId}`),
    );
    fireEvent.click(
      screen.getByTestId(
        `captured-decision-popover-open-in-conversation-${decision.decisionId}`,
      ),
    );

    expect(onOpenInConversation).toHaveBeenCalledTimes(1);
    expect(onOpenInConversation).toHaveBeenCalledWith(decision.decisionId);
  });
});
