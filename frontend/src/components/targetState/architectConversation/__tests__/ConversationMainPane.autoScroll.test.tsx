/**
 * Tests -- ConversationMainPane auto-scroll-to-newest-turn.
 *
 * Spec 2026-06-27-target-conversation-right-panel-ux (Spec A, Task Group 3):
 * when a new turn is appended to the transcript, the transcript scrolls to the
 * bottom so the latest question / answer is visible. Implemented with a ref on
 * the `.transcript` container + an effect keyed on the turns length and the
 * pending-question code. jsdom has no real layout, so we stub the transcript
 * element's `scrollHeight` and capture `scrollTop` writes.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ConversationMainPane } from '../ConversationMainPane';
import type { ConversationTurn } from '../../../../api/architectConversationApi';

const noop = () => undefined;
afterEach(() => cleanup());

function turn(i: number): ConversationTurn {
  return {
    kind: 'answer',
    decisionCode: `service.code${i}`,
    answerText: `answer ${i}`,
  } as ConversationTurn;
}

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

describe('ConversationMainPane -- auto-scroll to newest turn (Task Group 3)', () => {
  it('scrolls the transcript to the bottom when a new turn arrives', () => {
    const { rerender } = renderPane([turn(1), turn(2)]);
    const transcript = screen.getByTestId('architect-conversation-transcript');

    // Stub the layout the effect reads/writes: a fixed scrollHeight and a
    // captured scrollTop setter (jsdom does not persist scrollTop otherwise).
    let scrollTop = 0;
    Object.defineProperty(transcript, 'scrollHeight', {
      configurable: true,
      get: () => 1234,
    });
    Object.defineProperty(transcript, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });

    // Appending a turn (length grows) must pin the transcript to the bottom.
    rerender(
      <ConversationMainPane
        turns={[turn(1), turn(2), turn(3)]}
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

    expect(scrollTop).toBe(1234);
  });

  it('does NOT auto-scroll to bottom while a targeted "view in conversation" scroll is in flight', () => {
    const onScrolledToDecision = vi.fn();
    const { rerender } = render(
      <ConversationMainPane
        turns={[turn(1)]}
        pendingQuestion={null}
        pendingCascadeSummary={null}
        cascadeBusy={false}
        cascadeError={null}
        answerBusy={false}
        answerError={null}
        onCaptureAnswer={noop}
        onAcceptCascadeAll={noop}
        onOverrideCascade={noop}
        scrollToDecisionId="some-missing-decision"
        onScrolledToDecision={onScrolledToDecision}
      />,
    );
    const transcript = screen.getByTestId('architect-conversation-transcript');
    let scrollTop = -1;
    Object.defineProperty(transcript, 'scrollHeight', {
      configurable: true,
      get: () => 999,
    });
    Object.defineProperty(transcript, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });

    rerender(
      <ConversationMainPane
        turns={[turn(1), turn(2)]}
        pendingQuestion={null}
        pendingCascadeSummary={null}
        cascadeBusy={false}
        cascadeError={null}
        answerBusy={false}
        answerError={null}
        onCaptureAnswer={noop}
        onAcceptCascadeAll={noop}
        onOverrideCascade={noop}
        scrollToDecisionId="some-missing-decision"
        onScrolledToDecision={onScrolledToDecision}
      />,
    );

    // The bottom-pin was suppressed (scrollTop untouched) while a deliberate
    // decision-scroll is pending.
    expect(scrollTop).toBe(-1);
  });
});
