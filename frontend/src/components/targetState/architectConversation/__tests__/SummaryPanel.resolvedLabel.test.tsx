/**
 * Tests -- SummaryPanel SummaryRow resolved-label rendering.
 * Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux, Task Group 5
 * (FR4): the "Decisions captured" panel renders the RESOLVED chip
 * (`row.answerSummary`) rather than dumping the raw `{ value, ... }` JSON
 * envelope, while the existing `tech-stack-md-prefill` source-quote handling and
 * the Deferred / N/A markers keep working.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { SummaryPanel } from '../SummaryPanel';
import {
  OPT_OUT_ANSWER_VALUE,
  type CapturedDecisionRow,
} from '../../../../api/architectConversationApi';

afterEach(() => cleanup());

function row(overrides: Partial<CapturedDecisionRow>): CapturedDecisionRow {
  return {
    decisionId: 'dec-' + (overrides.decisionCode ?? 'x'),
    decisionCode: 'service.framework',
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: '',
    answerSummary: null,
    standardsLookupRef: null,
    supersededById: null,
    ...overrides,
  };
}

const VERSIONED_ENVELOPE = JSON.stringify({
  value: { framework: 'Spring Boot', version: '4.0' },
  sourceQuote: null,
  sourceFile: null,
});

function rowEl(decisionCode: string): HTMLElement {
  return screen.getByTestId(`architect-conversation-summary-row-${decisionCode}`);
}

describe('SummaryPanel SummaryRow -- resolved labels (Spec 2026-06-26, FR4)', () => {
  it('renders the resolved chip (answerSummary) for a versioned row, NOT the raw JSON envelope', () => {
    render(
      <SummaryPanel
        decisions={[
          row({
            decisionCode: 'service.framework',
            answerValue: VERSIONED_ENVELOPE,
            answerSummary: 'Spring Boot 4.0',
          }),
        ]}
      />,
    );
    const el = rowEl('service.framework');
    expect(el.textContent).toContain('Spring Boot 4.0');
    // No raw JSON braces / quoted keys leaked into the panel.
    expect(el.textContent).not.toContain('{');
    expect(el.textContent).not.toContain('"version"');
  });

  it('renders a plain-string single-choice answer via answerSummary', () => {
    render(
      <SummaryPanel
        decisions={[
          row({ decisionCode: 'api.protocol', answerValue: 'REST/JSON', answerSummary: 'REST/JSON' }),
        ]}
      />,
    );
    expect(rowEl('api.protocol').textContent).toContain('REST/JSON');
  });

  it('falls back to the raw answerValue string when answerSummary is null (backward-compat)', () => {
    render(
      <SummaryPanel
        decisions={[
          row({ decisionCode: 'service.processModel', answerValue: 'Reactive', answerSummary: null }),
        ]}
      />,
    );
    expect(rowEl('service.processModel').textContent).toContain('Reactive');
  });

  it('keeps the tech-stack-md-prefill handling working (unwraps value, shows the source quote, no raw JSON)', () => {
    const prefillEnvelope = JSON.stringify({
      value: 'Postgres 18',
      sourceQuote: 'we run PostgreSQL 18 in prod',
      sourceFile: 'tech-stack.md',
    });
    render(
      <SummaryPanel
        decisions={[
          row({
            decisionCode: 'db.engine',
            answerValue: prefillEnvelope,
            answerSummary: null,
            createdByTask: 'tech-stack-md-prefill',
          }),
        ]}
      />,
    );
    const el = rowEl('db.engine');
    expect(el.textContent).toContain('Postgres 18');
    expect(el.textContent).not.toContain('sourceQuote'); // raw JSON not dumped inline

    // The source-quote review affordance still reveals the verbatim quote.
    fireEvent.click(
      screen.getByTestId('architect-conversation-summary-source-toggle-db.engine'),
    );
    expect(
      screen.getByTestId('architect-conversation-summary-source-quote-db.engine').textContent,
    ).toBe('we run PostgreSQL 18 in prod');
  });

  it('still renders the Deferred and N/A markers', () => {
    render(
      <SummaryPanel
        decisions={[
          row({ decisionCode: 'a.deferred', answerValue: 'deferred', answerSummary: null }),
          row({ decisionCode: 'b.optout', answerValue: OPT_OUT_ANSWER_VALUE, answerSummary: null }),
        ]}
      />,
    );
    expect(rowEl('a.deferred').textContent).toContain('Deferred');
    expect(rowEl('b.optout').textContent).toContain('N/A');
  });
});
