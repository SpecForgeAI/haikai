/**
 * Tests — ApiSurfaceLockedAnswer (read-only Group B render under API
 * like-for-like)
 * Spec 2026-06-24-target-conversation-tech-stack-constraints, Task Group 7
 * (FR9 / FR1 `L` treatment — frontend read-only render half).
 *
 * Per tasks.md §7.1 (frontend half) — focused tests covering:
 *   - A locked Group B question renders READ-ONLY with the
 *     "locked — API like-for-like" affordance (not editable choices) + its
 *     resolved value + source provenance.
 *   - The envelope `{ value, sourceQuote, sourceFile }` is unwrapped; a malformed
 *     payload degrades to the raw value without throwing.
 *
 * The mirrored `api.surfaceMode` enum / `L` treatment-shape contract lives in
 * `src/api/__tests__/apiSurfaceMode.contractWithGateway.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import {
  ApiSurfaceLockedAnswer,
  unwrapLockedAnswerValue,
  isApiSurfaceLockRow,
  API_SURFACE_LOCK_TASK_NAME,
} from '../ApiSurfaceLockedAnswer';
import { API_LIKE_FOR_LIKE_LOCK_LABEL } from '../../../../api/architectConversationApi';

afterEach(() => cleanup());

const LOCKED_ENVELOPE = JSON.stringify({
  value: 'REST/JSON',
  sourceQuote: 'openapi: 3.1.0',
  sourceFile: 'contracts/widgets-openapi.yaml',
});

describe('ApiSurfaceLockedAnswer (TG7 / FR9)', () => {
  it('renders the locked Group B answer read-only with the "locked — API like-for-like" affordance + provenance', () => {
    render(
      <ApiSurfaceLockedAnswer
        decisionCode="api.protocol"
        answerValue={LOCKED_ENVELOPE}
      />,
    );

    // The "locked — API like-for-like" affordance is present.
    const badge = screen.getByTestId('api-surface-lock-badge-api.protocol');
    expect(badge.textContent).toBe(API_LIKE_FOR_LIKE_LOCK_LABEL);

    // The resolved value renders (read-only).
    expect(
      screen.getByTestId('api-surface-locked-value-api.protocol').textContent,
    ).toBe('REST/JSON');

    // Source provenance (file + quote) is shown.
    const provenance = screen.getByTestId('api-surface-locked-provenance-api.protocol');
    expect(provenance.textContent).toContain('contracts/widgets-openapi.yaml');
    expect(
      screen.getByTestId('api-surface-locked-quote-api.protocol').textContent,
    ).toBe('openapi: 3.1.0');

    // It is READ-ONLY: there are NO editable choice controls (no buttons / inputs).
    const root = screen.getByTestId('api-surface-locked-answer-api.protocol');
    expect(root.getAttribute('aria-readonly')).toBe('true');
    expect(root.querySelectorAll('button').length).toBe(0);
    expect(root.querySelectorAll('input').length).toBe(0);
  });

  it('unwraps the { value, sourceQuote, sourceFile } envelope and degrades a malformed payload to the raw value', () => {
    expect(unwrapLockedAnswerValue(LOCKED_ENVELOPE)).toEqual({
      value: 'REST/JSON',
      sourceQuote: 'openapi: 3.1.0',
      sourceFile: 'contracts/widgets-openapi.yaml',
    });

    // Malformed (non-JSON) payload => raw value, no provenance, no throw.
    const malformed = unwrapLockedAnswerValue('not-json');
    expect(malformed.value).toBe('not-json');
    expect(malformed.sourceQuote).toBeNull();
    expect(malformed.sourceFile).toBeNull();
  });

  it('isApiSurfaceLockRow discriminates lock rows by the task marker', () => {
    expect(isApiSurfaceLockRow({ createdByTask: API_SURFACE_LOCK_TASK_NAME })).toBe(
      true,
    );
    expect(isApiSurfaceLockRow({ createdByTask: 'architect-persona-conversation' })).toBe(
      false,
    );
    expect(isApiSurfaceLockRow({ createdByTask: undefined })).toBe(false);
  });
});
