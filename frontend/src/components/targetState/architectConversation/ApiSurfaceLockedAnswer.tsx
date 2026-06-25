/**
 * ApiSurfaceLockedAnswer — read-only render of a Group B question locked under
 * API like-for-like
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR9 / FR1 `L`
 * treatment).
 *
 * Under `api.surfaceMode = like_for_like` the WHOLE of Group B (`api.protocol`,
 * `api.versioning`, `api.contractFormat`, `api.auth`, `api.errorContract`,
 * `api.rateLimiting`) is auto-answered + LOCKED from the reconciled source
 * contract / baseline (treatment class `L`) and NOT asked. The gateway
 * suppresses the question + writes the locked answer through the existing
 * captured-decision envelope (`answerValue = JSON.stringify({ value,
 * sourceQuote, sourceFile })`, `createdByTask = 'api-like-for-like-lock'`).
 *
 * This component renders such a locked answer READ-ONLY: the resolved value, the
 * "locked — API like-for-like" affordance, and the source provenance — NOT as
 * editable choices. It is purely presentational + additive (no rewrite of the
 * tab / answer controls); a host renders it in place of the editable answer
 * control for a locked Group B code.
 *
 * `may_change` reverts Group B to its underlying H/I/G class and the normal
 * editable controls render instead — this component is simply not used then.
 */

import { useMemo } from 'react';
import {
  API_LIKE_FOR_LIKE_LOCK_LABEL,
  type CapturedDecisionRow,
} from '../../../api/architectConversationApi';
import styles from './ApiSurfaceLockedAnswer.module.css';

/** Fixed `created_by_task` marker stamped on a like-for-like lock row (gateway). */
export const API_SURFACE_LOCK_TASK_NAME = 'api-like-for-like-lock';

/** The decoupled value + provenance unwrapped from a locked row's envelope. */
export interface LockedAnswerUnwrapped {
  /** The resolved Group B answer value (e.g. `REST/JSON`). */
  value: string;
  /** Provenance quote from the source contract / baseline, or null. */
  sourceQuote: string | null;
  /** Provenance file of the source contract / baseline, or null. */
  sourceFile: string | null;
}

/**
 * Defensively unwrap a locked Group B row's `answerValue` (the existing
 * `{ value, sourceQuote, sourceFile }` envelope). A malformed payload falls back
 * to the raw string with no provenance, never throwing.
 */
export function unwrapLockedAnswerValue(raw: string): LockedAnswerUnwrapped {
  try {
    const parsed = JSON.parse(raw) as {
      value?: unknown;
      sourceQuote?: unknown;
      sourceFile?: unknown;
    };
    return {
      value:
        typeof parsed.value === 'string' && parsed.value.length > 0
          ? parsed.value
          : raw,
      sourceQuote:
        typeof parsed.sourceQuote === 'string' && parsed.sourceQuote.length > 0
          ? parsed.sourceQuote
          : null,
      sourceFile:
        typeof parsed.sourceFile === 'string' && parsed.sourceFile.length > 0
          ? parsed.sourceFile
          : null,
    };
  } catch {
    return { value: raw, sourceQuote: null, sourceFile: null };
  }
}

/** True iff a captured-decision row is an API like-for-like lock row. */
export function isApiSurfaceLockRow(row: Pick<CapturedDecisionRow, 'createdByTask'>): boolean {
  return row.createdByTask === API_SURFACE_LOCK_TASK_NAME;
}

export interface ApiSurfaceLockedAnswerProps {
  /** The Group B decision code (e.g. `api.protocol`). */
  decisionCode: string;
  /**
   * The locked captured-decision row's `answerValue` (the `{ value, sourceQuote,
   * sourceFile }` envelope). Unwrapped + rendered read-only.
   */
  answerValue: string;
}

/**
 * Render a locked Group B question read-only with the "locked — API
 * like-for-like" affordance + its source provenance. NOT editable — there are no
 * choice controls; the value is fixed from the source contract.
 */
export function ApiSurfaceLockedAnswer({
  decisionCode,
  answerValue,
}: ApiSurfaceLockedAnswerProps) {
  const unwrapped = useMemo(
    () => unwrapLockedAnswerValue(answerValue),
    [answerValue],
  );

  return (
    <div
      className={styles.lockedAnswer}
      data-testid={`api-surface-locked-answer-${decisionCode}`}
      aria-readonly="true"
    >
      <div className={styles.lockHeader}>
        <span className={styles.decisionCode}>{decisionCode}</span>
        <span
          className={styles.lockBadge}
          data-testid={`api-surface-lock-badge-${decisionCode}`}
        >
          {API_LIKE_FOR_LIKE_LOCK_LABEL}
        </span>
      </div>

      <div className={styles.resolvedValueRow}>
        <span
          className={styles.resolvedValue}
          data-testid={`api-surface-locked-value-${decisionCode}`}
        >
          {unwrapped.value}
        </span>
      </div>

      <p className={styles.lockExplainer}>
        This API-surface decision is locked from the source contract because the
        migration mode is <strong>API like-for-like</strong>. It is not editable
        here; switch the API surface to <em>may change</em> to answer it.
      </p>

      {(unwrapped.sourceQuote || unwrapped.sourceFile) && (
        <div
          className={styles.provenance}
          data-testid={`api-surface-locked-provenance-${decisionCode}`}
        >
          <div className={styles.provenanceLabel}>
            Source
            {unwrapped.sourceFile ? ` (${unwrapped.sourceFile})` : ''}
          </div>
          {unwrapped.sourceQuote && (
            <span
              className={styles.provenanceQuote}
              data-testid={`api-surface-locked-quote-${decisionCode}`}
            >
              {unwrapped.sourceQuote}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
