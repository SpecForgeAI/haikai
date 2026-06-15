/**
 * Tests for the redesigned answer controls in `ConversationMainPane`
 * (2026-06-01; opt-out made universal 2026-06-05): click-to-answer choices with
 * NO pre-selection, "Something else…" custom value, a "Not applicable to this
 * migration" opt-out on EVERY question, and multi-choice confirm. The old
 * "Accept default" / "No change" / free-text controls are gone.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { ConversationMainPane } from '../ConversationMainPane';
import {
  OPT_OUT_ANSWER_VALUE,
  type PendingQuestion,
} from '../../../../api/architectConversationApi';

afterEach(() => cleanup());

const baseProps = {
  turns: [],
  pendingCascadeSummary: null,
  cascadeBusy: false,
  cascadeError: null,
  answerBusy: false,
  answerError: null,
  onAcceptCascadeAll: vi.fn(),
  onOverrideCascade: vi.fn(),
} as const;

function question(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    decisionCode: 'build.tool',
    group: 'G',
    orderInGroup: 1,
    promptText: 'What build tool?',
    staticContextLeadIn: null,
    expectedAnswerShape: 'single-choice',
    choices: ['Gradle 8', 'Maven 3.9'],
    defaultsWhenUnchanged: 'current tool',
    optional: false,
    ...overrides,
  };
}

describe('ConversationMainPane answer controls (2026-06-01 redesign)', () => {
  it('answers a single-choice question on click and drops the old default/no-change controls', () => {
    const onCaptureAnswer = vi.fn();
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={question()}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );

    // The removed controls are gone (no LLM-driven "accept default" / "no change").
    expect(
      screen.queryByTestId('architect-conversation-chip-accept-default'),
    ).toBeNull();
    expect(
      screen.queryByTestId('architect-conversation-chip-no-change'),
    ).toBeNull();

    // No option is pre-selected; clicking a choice captures it verbatim.
    fireEvent.click(screen.getByTestId('architect-conversation-choice-Maven 3.9'));
    expect(onCaptureAnswer).toHaveBeenCalledWith('build.tool', 'Maven 3.9', 'Maven 3.9');
  });

  it('shows the "Not applicable" opt-out on EVERY question (optional or not) and captures the marker', () => {
    const onCaptureAnswer = vi.fn();
    const { rerender } = render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={question({ optional: false })}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );
    // Fundamental (non-optional) question -> opt-out STILL present (consistency).
    expect(screen.queryByTestId('architect-conversation-not-needed')).not.toBeNull();

    // Optional capability question -> opt-out present too, and captures the marker.
    rerender(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={question({ decisionCode: 'metrics.framework', optional: true })}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );
    expect(screen.queryByTestId('architect-conversation-not-needed')).not.toBeNull();
    fireEvent.click(screen.getByTestId('architect-conversation-not-needed'));
    expect(onCaptureAnswer).toHaveBeenCalledWith(
      'metrics.framework',
      OPT_OUT_ANSWER_VALUE,
      'N/A',
    );
  });

  it('captures a custom value via "Something else…"', () => {
    const onCaptureAnswer = vi.fn();
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={question()}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );
    fireEvent.click(screen.getByTestId('architect-conversation-something-else'));
    fireEvent.change(screen.getByTestId('architect-conversation-custom-input'), {
      target: { value: 'Bazel' },
    });
    fireEvent.click(screen.getByTestId('architect-conversation-custom-submit'));
    expect(onCaptureAnswer).toHaveBeenCalledWith('build.tool', 'Bazel', 'Bazel');
  });

  it('captures a multi-choice question as an array after confirming the selection', () => {
    const onCaptureAnswer = vi.fn();
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={question({
          decisionCode: 'api.protocol',
          expectedAnswerShape: 'multi-choice',
          choices: ['REST/JSON', 'gRPC', 'GraphQL'],
        })}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );
    // Toggle two, then confirm. A single click does NOT submit (multi-choice).
    fireEvent.click(screen.getByTestId('architect-conversation-choice-REST/JSON'));
    fireEvent.click(screen.getByTestId('architect-conversation-choice-gRPC'));
    expect(onCaptureAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('architect-conversation-choice-submit-multi'));
    expect(onCaptureAnswer).toHaveBeenCalledWith(
      'api.protocol',
      ['REST/JSON', 'gRPC'],
      'REST/JSON, gRPC',
    );
  });
});
