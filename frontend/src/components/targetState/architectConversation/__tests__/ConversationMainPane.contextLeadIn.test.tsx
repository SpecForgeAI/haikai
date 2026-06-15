/**
 * Tests for the per-question static context lead-in render in
 * `ConversationMainPane`.
 *
 * Spec: 2026-05-26 Architect Conversation Enrichments (Batched #11 + #12)
 *
 * Covers (2 tests):
 *   A. When a `question` turn carries a non-empty `staticContextLeadIn`, the
 *      lead-in renders inside a `<small>` block with the `.contextLeadIn`
 *      class, above the prompt text in DOM order.
 *   B. When the field is `undefined` (older persisted turns) the lead-in is
 *      silently absent -- no `<small>` block, no banner, no placeholder
 *      (Pitfall 4 backward-compat assertion).
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

describe('ConversationMainPane -- staticContextLeadIn render (Spec 2026-05-26, #11)', () => {
  it('renders the lead-in inside a <small className=contextLeadIn> block above the prompt', () => {
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

    // The lead-in block is rendered with the expected data-testid and copy.
    const leadInEl = screen.getByTestId(
      'architect-conversation-turn-question-leadin-db.engine',
    );
    expect(leadInEl).toBeInTheDocument();
    expect(leadInEl.textContent).toBe(leadIn);
    // Tag name is <small> per spec.
    expect(leadInEl.tagName.toLowerCase()).toBe('small');
    // Class includes the CSS-modules-hashed `contextLeadIn` token.
    expect(leadInEl.className).toMatch(/contextLeadIn/);

    // DOM order: lead-in comes before the prompt text inside the turn wrapper.
    const turnWrapper = screen.getByTestId(
      'architect-conversation-turn-question-db.engine',
    );
    const innerHtml = turnWrapper.innerHTML;
    const leadInIdx = innerHtml.indexOf(leadIn);
    const promptIdx = innerHtml.indexOf('Which database engine?');
    expect(leadInIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeGreaterThan(-1);
    expect(leadInIdx).toBeLessThan(promptIdx);
  });

  it('renders no muted block when staticContextLeadIn is undefined (backward-compat for older turns)', () => {
    const questionTurn: QuestionTurn = {
      kind: 'question',
      decisionCode: 'service.language',
      promptText: 'Which language?',
      roundIndex: 1,
      // Field deliberately omitted to model an older persisted turn from
      // before this spec ships.
    };

    renderPane([questionTurn]);

    // The turn itself renders (prompt + label still present).
    expect(
      screen.getByTestId(
        'architect-conversation-turn-question-service.language',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Which language?')).toBeInTheDocument();

    // The lead-in block MUST NOT be present. No banner, no placeholder.
    expect(
      screen.queryByTestId(
        'architect-conversation-turn-question-leadin-service.language',
      ),
    ).toBeNull();
    // Defence in depth: no element with the `.contextLeadIn` class anywhere
    // in the rendered tree.
    const turnWrapper = screen.getByTestId(
      'architect-conversation-turn-question-service.language',
    );
    expect(turnWrapper.querySelector('[class*="contextLeadIn"]')).toBeNull();
  });
});
