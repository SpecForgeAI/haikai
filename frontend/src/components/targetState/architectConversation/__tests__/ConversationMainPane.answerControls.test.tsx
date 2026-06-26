/**
 * Tests for the answer controls in `ConversationMainPane`.
 *
 * (2026-06-01 redesign; opt-out made universal 2026-06-05.) Click-to-answer
 * choices with NO pre-selection, "Something else…" custom value, a "Not
 * applicable to this migration" opt-out on EVERY question, and multi-choice
 * confirm. The old "Accept default" / "No change" controls are gone.
 *
 * Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux (FR3) adds
 * the conversation-header "Auto-select recommended version" toggle (default ON,
 * sticky in localStorage) and, with it ON, the commit-on-chip path through the
 * versioned framework+version control.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { ConversationMainPane } from '../ConversationMainPane';
import {
  OPT_OUT_ANSWER_VALUE,
  type PendingQuestion,
} from '../../../../api/architectConversationApi';

const AUTO_SELECT_KEY = 'architect-conversation.autoSelectRecommendedVersion';

beforeEach(() => {
  // Each test starts with the auto-select preference at its first-load default.
  localStorage.clear();
});
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
    // A genuinely NON-versioned single-choice code. (Several former fixtures --
    // `db.migrations`, `metrics.framework`, `build.tool` -- are now `versioned`
    // codes and render the dedicated framework+version control; see
    // VersionedAnswerControl.test.tsx for that surface.)
    decisionCode: 'service.processModel',
    group: 'A',
    orderInGroup: 1,
    promptText: 'What service process model?',
    staticContextLeadIn: null,
    expectedAnswerShape: 'single-choice',
    choices: ['Thread-per-request', 'Reactive'],
    defaultsWhenUnchanged: 'current model',
    optional: false,
    ...overrides,
  };
}

describe('ConversationMainPane answer controls (generic single/multi/custom/opt-out)', () => {
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
    fireEvent.click(screen.getByTestId('architect-conversation-choice-Reactive'));
    expect(onCaptureAnswer).toHaveBeenCalledWith(
      'service.processModel',
      'Reactive',
      'Reactive',
    );
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

    // Optional (non-versioned) capability question -> opt-out present + captures marker.
    rerender(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={question({ decisionCode: 'db.readReplicaUsage', optional: true })}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );
    expect(screen.queryByTestId('architect-conversation-not-needed')).not.toBeNull();
    fireEvent.click(screen.getByTestId('architect-conversation-not-needed'));
    expect(onCaptureAnswer).toHaveBeenCalledWith(
      'db.readReplicaUsage',
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
      target: { value: 'Actor model' },
    });
    fireEvent.click(screen.getByTestId('architect-conversation-custom-submit'));
    expect(onCaptureAnswer).toHaveBeenCalledWith(
      'service.processModel',
      'Actor model',
      'Actor model',
    );
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

describe('ConversationMainPane -- auto-select recommended version toggle (Spec 2026-06-26, FR3)', () => {
  it('defaults ON in the header on first load and persists OFF to localStorage on toggle', () => {
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={null}
        onCaptureAnswer={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(
      'architect-conversation-auto-select-toggle-input',
    ) as HTMLInputElement;
    // Default ON the first time (no stored value).
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    // Sticky per machine in localStorage.
    expect(localStorage.getItem(AUTO_SELECT_KEY)).toBe('false');
  });

  it('reads the persisted OFF preference on mount', () => {
    localStorage.setItem(AUTO_SELECT_KEY, 'false');
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={null}
        onCaptureAnswer={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('architect-conversation-auto-select-toggle-input') as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it('with the toggle ON, a versioned question commits stem + curated default on chip click (one action)', () => {
    const onCaptureAnswer = vi.fn();
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={question({
          decisionCode: 'service.framework',
          choices: ['Spring Boot 3.4', 'Quarkus 3'],
        })}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );

    // The versioned control renders BARE-STEM chips; with the toggle ON, clicking
    // one commits the stem + its curated default version in ONE action.
    fireEvent.click(screen.getByTestId('versioned-framework-Spring Boot'));

    expect(onCaptureAnswer).toHaveBeenCalledTimes(1);
    const [code, value, summary] = onCaptureAnswer.mock.calls[0];
    expect(code).toBe('service.framework');
    // Resolved chip label (== answer_summary) — Spring Boot default raised to 4.0.
    expect(summary).toBe('Spring Boot 4.0');
    // The unchanged capture envelope rides the existing /capture path.
    expect(JSON.parse(value)).toEqual({
      value: { framework: 'Spring Boot', version: '4.0' },
      sourceQuote: null,
      sourceFile: null,
    });
  });
});
