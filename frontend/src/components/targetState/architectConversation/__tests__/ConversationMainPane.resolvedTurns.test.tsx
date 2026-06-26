/**
 * Tests -- ConversationMainPane resolved-label turn renders.
 * Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux, Task Group 5
 * (FR4): the decision-captured / cascade-accepted / cascade-overridden /
 * exception-pinned turns carry `answerValue` but NOT `answerSummary`, so the pane
 * resolves the chip CLIENT-SIDE from the capture envelope via
 * `resolveCapturedAnswerLabel` -- an object `value` -> `resolveFrameworkVersionChip`
 * ("Spring Boot 4.0"), a plain-string `value` -> the string verbatim -- rather than
 * dumping the raw JSON.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ConversationMainPane } from '../ConversationMainPane';
import type { ConversationTurn } from '../../../../api/architectConversationApi';

const noop = () => undefined;
afterEach(() => cleanup());

const envelope = (framework: string, version: string) =>
  JSON.stringify({ value: { framework, version }, sourceQuote: null, sourceFile: null });

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

describe('ConversationMainPane -- resolved-label turn renders (Spec 2026-06-26, FR4)', () => {
  it('decision-captured: resolves an object envelope to its chip, and a plain string verbatim', () => {
    renderPane([
      {
        kind: 'decision-captured',
        decisionId: 'd-v',
        decisionCode: 'service.framework',
        scope: { kind: 'architecture' },
        answerValue: envelope('Spring Boot', '4.0'),
        standardsLookupRef: null,
      },
      {
        kind: 'decision-captured',
        decisionId: 'd-s',
        decisionCode: 'service.processModel',
        scope: { kind: 'architecture' },
        answerValue: 'Reactive',
        standardsLookupRef: null,
      },
    ]);

    const versioned = screen.getByTestId(
      'architect-conversation-turn-decision-captured-service.framework',
    );
    expect(versioned.textContent).toContain('Spring Boot 4.0');
    expect(versioned.textContent).not.toContain('{'); // no raw JSON envelope

    const single = screen.getByTestId(
      'architect-conversation-turn-decision-captured-service.processModel',
    );
    expect(single.textContent).toContain('Reactive');
  });

  it('cascade-accepted and cascade-overridden resolve their object envelopes to chips', () => {
    renderPane([
      {
        kind: 'cascade-accepted',
        cascadedDecisions: [
          { decisionCode: 'service.runtime', answerValue: envelope('Eclipse Temurin', '21.0.5'), wasOverridden: false },
        ],
      },
      {
        kind: 'cascade-overridden',
        cascadedDecisions: [
          {
            decisionCode: 'build.tool',
            answerValue: envelope('Gradle', '8'),
            wasOverridden: true,
            overrideReason: 'monorepo standard',
          },
        ],
      },
    ]);

    const accepted = screen.getByTestId('architect-conversation-turn-cascade-accepted');
    expect(accepted.textContent).toContain('Eclipse Temurin 21.0.5');
    expect(accepted.textContent).not.toContain('{');

    const overridden = screen.getByTestId('architect-conversation-turn-cascade-overridden');
    expect(overridden.textContent).toContain('Gradle 8');
    expect(overridden.textContent).toContain('monorepo standard');
  });

  it('exception-pinned resolves its object envelope to a chip', () => {
    renderPane([
      {
        kind: 'exception-pinned',
        decisionCode: 'service.framework',
        scope: { kind: 'element', refType: 'service', refId: 'svc-legacy' },
        answerValue: envelope('Spring Boot', '3.4'),
      },
    ]);

    const pinned = screen.getByTestId(
      'architect-conversation-turn-exception-pinned-service.framework',
    );
    expect(pinned.textContent).toContain('Spring Boot 3.4');
    expect(pinned.textContent).not.toContain('{');
  });
});
