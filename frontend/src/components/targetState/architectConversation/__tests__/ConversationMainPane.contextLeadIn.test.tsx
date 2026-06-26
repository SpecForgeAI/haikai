/**
 * Tests for the per-question static context lead-in in `ConversationMainPane`.
 *
 * Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux (FR3): the
 * italic static context lead-in that repeated the question text is DROPPED from
 * the on-screen render. The `staticContextLeadIn` field stays on the turn shape
 * (and in the Markdown export) for backward-compat, but the pane no longer paints
 * it. These tests pin the removal so a regression that re-adds the on-screen
 * lead-in goes red.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ConversationMainPane } from '../ConversationMainPane';
import type {
  ConversationTurn,
  QuestionTurn,
} from '../../../../api/architectConversationApi';

const noop = () => undefined;

afterEach(() => {
  cleanup();
});

function renderPane(turns: ConversationTurn[]) {
  return render(
    <ConversationMainPane
      turns={turns}
      pendingQuestion={null}
      pendingCascadeSummary={null}
      cascadeBusy={false}
      cascadeError={null}
      answerBusy={false}
      answerError={null}
      onCaptureAnswer={noop}
      onAcceptCascadeAll={noop}
      onOverrideCascade={noop}
    />,
  );
}

describe('ConversationMainPane -- staticContextLeadIn is DROPPED (Spec 2026-06-26, FR3)', () => {
  it('does NOT render the lead-in even when a question turn carries one; the prompt still renders', () => {
    const leadIn =
      'Database engine. Common modern picks: PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, DynamoDB.';
    const questionTurn: QuestionTurn = {
      kind: 'question',
      decisionCode: 'db.engine',
      promptText: 'Which database engine?',
      roundIndex: 1,
      staticContextLeadIn: leadIn,
    };

    renderPane([questionTurn]);

    // The question turn + its prompt text still render.
    const turnWrapper = screen.getByTestId(
      'architect-conversation-turn-question-db.engine',
    );
    expect(turnWrapper).toBeInTheDocument();
    expect(screen.getByText('Which database engine?')).toBeInTheDocument();

    // The lead-in is GONE: no lead-in test id, no `.contextLeadIn` element, and the
    // lead-in copy is absent from the rendered turn.
    expect(
      screen.queryByTestId(
        'architect-conversation-turn-question-leadin-db.engine',
      ),
    ).toBeNull();
    expect(turnWrapper.querySelector('[class*="contextLeadIn"]')).toBeNull();
    expect(turnWrapper.textContent).not.toContain(leadIn);
  });

  it('renders cleanly when staticContextLeadIn is undefined (older persisted turns)', () => {
    const questionTurn: QuestionTurn = {
      kind: 'question',
      decisionCode: 'service.language',
      promptText: 'Which language?',
      roundIndex: 1,
      // Field deliberately omitted to model an older persisted turn.
    };

    renderPane([questionTurn]);

    expect(
      screen.getByTestId(
        'architect-conversation-turn-question-service.language',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Which language?')).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        'architect-conversation-turn-question-leadin-service.language',
      ),
    ).toBeNull();
  });
});
