/**
 * LogCorpusAppendModal (Capture-State Discipline & Log-Replay program,
 * Spec 6, 2026-08-18) — the application-log analog of
 * {@link PostmanImportAppendModal}: the POST-HOC APPEND launched from the
 * capture-session detail view.
 *
 * Uploading a log ALWAYS stages the extracted corpus for reconciliation
 * round 2 (Spec 5 persists it atomically; a zero-useful source is abandoned
 * loudly). Optionally, the operator can ALSO capture the NON-mutating
 * requests into this session now via the existing `manual-capture`
 * primitive — the appended captures ride the normal review/baseline flow
 * and the parent's `onAppended` refresh drives gate-recompute-on-append.
 * Mutating corpus items never fire here (the manual-capture path is
 * unbracketed); they remain round-2 material.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  listOperations,
  manualCapture,
  type ApiBehaviourOperationDto,
} from '../../api/apiBehaviourClient';
import { LogCorpusSection } from './LogCorpusSection';
import {
  corpusItemToManualCapture,
  matchCorpusItemToOperation,
  splitCorpusForPreFire,
  type LogCorpusExtractResponse,
} from './logCorpusRunSupport';
import styles from './PostmanImportAppendModal.module.css';

export interface LogCorpusAppendModalProps {
  open: boolean;
  projectId: string;
  architectureId: string;
  sessionId: string;
  /** Threaded onto each send so the manual-capture gates resolve. */
  mutatingCallsConfirmed?: boolean;
  /** Called after at least one item was captured so the parent can refresh. */
  onAppended?: () => void;
  onClose: () => void;
}

export function LogCorpusAppendModal({
  open,
  projectId,
  architectureId,
  sessionId,
  mutatingCallsConfirmed,
  onAppended,
  onClose,
}: LogCorpusAppendModalProps): React.ReactElement | null {
  const [corpusResult, setCorpusResult] = useState<LogCorpusExtractResponse | null>(null);
  const [operations, setOperations] = useState<ApiBehaviourOperationDto[]>([]);
  const [sending, setSending] = useState(false);
  const [sendSummary, setSendSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCorpusResult(null);
    setSendSummary(null);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const ops = await listOperations(projectId, architectureId, sessionId);
        if (!cancelled) setOperations(ops);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, architectureId, sessionId]);

  const handleCaptureNow = useCallback(async () => {
    if (!corpusResult || corpusResult.abandoned) return;
    setSending(true);
    setError(null);
    try {
      const { fireable, heldMutating } = splitCorpusForPreFire(corpusResult.items ?? []);
      let sent = 0;
      let unmatched = 0;
      for (const item of fireable) {
        const operation = matchCorpusItemToOperation(item, operations);
        if (!operation) {
          unmatched += 1;
          continue;
        }
        try {
          await manualCapture(
            projectId,
            architectureId,
            sessionId,
            corpusItemToManualCapture(item, operation, {
              mutatingCallsConfirmed: mutatingCallsConfirmed === true,
            }),
          );
          sent += 1;
        } catch {
          unmatched += 1; // counted honestly below; review view shows detail
        }
      }
      setSendSummary(
        `${sent} request(s) captured into this session; ${unmatched} not sent; ` +
          `${heldMutating.length} mutating request(s) held for round 2 only.`,
      );
      if (sent > 0) onAppended?.();
    } finally {
      setSending(false);
    }
  }, [
    corpusResult,
    operations,
    projectId,
    architectureId,
    sessionId,
    mutatingCallsConfirmed,
    onAppended,
  ]);

  if (!open) return null;

  return (
    <div className={styles.overlay} data-testid="log-corpus-append-modal">
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <h3>Append application log</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p>
          Extracting stages the corpus for reconciliation round 2. Optionally, capture
          the non-mutating requests into THIS session now — they land as reviewable
          captures and the coverage gate recomputes on append.
        </p>

        <LogCorpusSection
          projectId={projectId}
          architectureId={architectureId}
          corpusResult={corpusResult}
          onCorpusResult={setCorpusResult}
          includeInInitial={false}
          onIncludeInInitialChange={() => {}}
          showIncludeCheckbox={false}
        />

        {error && (
          <div role="alert" data-testid="log-corpus-append-error">
            {error}
          </div>
        )}
        {sendSummary && (
          <div data-testid="log-corpus-append-summary">{sendSummary}</div>
        )}

        <div className={styles.footer}>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            disabled={sending || !corpusResult || corpusResult.abandoned}
            onClick={() => void handleCaptureNow()}
            data-testid="log-corpus-append-capture-now"
          >
            {sending ? 'Capturing…' : 'Capture non-mutating requests now'}
          </button>
        </div>
      </div>
    </div>
  );
}
