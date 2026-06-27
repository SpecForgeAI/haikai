/**
 * Tests -- ConversationMainPane pending-first versioned question
 * Spec 2026-06-27-target-manifest-version-unknown-pending-questions, Task Group 4
 * (task 4.1, test 3). A PENDING versioned question (a version-unknown manifest
 * coordinate asked FIRST) carries `prechosenFramework` on the next-question DTO.
 * The pane threads it into <VersionedAnswerControl>, which then renders the
 * framework PRE-SELECTED with only the version field active. When
 * `prechosenFramework` is null the control behaves exactly as before.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { ConversationMainPane } from '../ConversationMainPane';
import type { PendingQuestion } from '../../../../api/architectConversationApi';

const AUTO_SELECT_KEY = 'architect-conversation.autoSelectRecommendedVersion';

beforeEach(() => {
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
};

function versionedQuestion(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    decisionCode: 'service.framework',
    group: 'A',
    orderInGroup: 1,
    promptText: 'Which service framework + version?',
    staticContextLeadIn: null,
    expectedAnswerShape: 'single-choice',
    choices: ['Spring Boot 3.4', 'Quarkus 3'],
    defaultsWhenUnchanged: 'current framework',
    optional: false,
    ...overrides,
  };
}

describe('ConversationMainPane pending-first versioned question (Spec 2026-06-27, TG4)', () => {
  it('(3) with prechosenFramework set, pre-selects the framework and activates only the version field', () => {
    const onCaptureAnswer = vi.fn();
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={versionedQuestion({ prechosenFramework: 'Spring Boot' })}
        onCaptureAnswer={onCaptureAnswer}
      />,
    );

    // The pre-chosen framework chip is selected + locked (no framework switching).
    const chip = screen.getByTestId('versioned-framework-Spring Boot') as HTMLButtonElement;
    expect(chip.getAttribute('aria-checked')).toBe('true');
    expect(chip.disabled).toBe(true);
    expect(
      (screen.getByTestId('versioned-framework-Quarkus') as HTMLButtonElement).disabled,
    ).toBe(true);

    // The version field is active from the start (only the version to fill).
    const versionInput = screen.getByTestId('versioned-version-input') as HTMLInputElement;
    expect(versionInput).toBeTruthy();

    // Supplying the version captures the structured { framework, version } value
    // with the framework fixed to the pre-chosen stem.
    fireEvent.change(versionInput, { target: { value: '3.4.5' } });
    fireEvent.click(screen.getByTestId('versioned-submit'));
    expect(onCaptureAnswer).toHaveBeenCalledTimes(1);
    const [code, value, summary] = onCaptureAnswer.mock.calls[0];
    expect(code).toBe('service.framework');
    expect(summary).toBe('Spring Boot 3.4.5');
    expect(JSON.parse(value)).toEqual({
      value: { framework: 'Spring Boot', version: '3.4.5' },
      sourceQuote: null,
      sourceFile: null,
    });
  });

  it('(3b) with prechosenFramework null, behaviour is unchanged (no framework pre-selected, chips active)', () => {
    // Toggle OFF so a chip click would reveal (not auto-commit) the version editor,
    // proving nothing is pre-selected until the user picks.
    localStorage.setItem(AUTO_SELECT_KEY, 'false');
    render(
      <ConversationMainPane
        {...baseProps}
        pendingQuestion={versionedQuestion({ prechosenFramework: null })}
        onCaptureAnswer={vi.fn()}
      />,
    );

    const chip = screen.getByTestId('versioned-framework-Spring Boot') as HTMLButtonElement;
    expect(chip.getAttribute('aria-checked')).toBe('false');
    expect(chip.disabled).toBe(false);
    // No version side / input until the user actively picks a framework.
    expect(screen.queryByTestId('versioned-version-input')).toBeNull();
  });
});
