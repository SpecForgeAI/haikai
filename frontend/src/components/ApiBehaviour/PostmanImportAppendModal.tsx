/**
 * PostmanImportAppendModal
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R7 / A1 / A3 / A6
 * (Task Group 8). Mode 2 -- the POST-HOC APPEND launched from the capture-session
 * detail view. It appends a Postman collection to an EXISTING run by REPLAYING
 * LIVE: each imported item is re-executed against the live API via the existing
 * `manual-capture` primitive (the shared `usePostmanImportRun` hook), landing
 * `manual` scenarios + un-reviewed captures into the normal review/baseline flow.
 *
 * The modal embeds the SAME Group 3 staging table + Group 4 arch-match step the
 * wizard uses. Items that do not match a committed architecture endpoint (or any
 * known operation) are routed to the arch-match step before any send; "Add to
 * architecture" stages a discovery candidate (A4), "Keep & run" creates the
 * operation row via add-operation BEFORE the send (A2), "Delete" drops it.
 *
 * On a finished (completed/failed) session the secrets are purged, so the first
 * send may fail 409 `SECRETS_NOT_LOADED`. The hook detects it and PAUSES the run;
 * the modal then surfaces a re-enter-secrets prompt that defers to the detail
 * view's existing parent-owned secrets form (`onRequestReenterSecrets`) before
 * the caller retries (A3) -- the send is never silently dropped.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listOperations,
  reconcileInventory,
  type ApiBehaviourOperationDto,
  type InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import { stageImportedDiscoveryCandidate } from '../../api/discoveryApi';
import {
  parsePostmanCollection,
  type ImportedRequest,
} from '../../utils/postmanImport';
import { PostmanImportStaging } from './PostmanImportStaging';
import { PostmanImportArchMatchStep } from './PostmanImportArchMatchStep';
import { usePostmanImportRun } from './usePostmanImportRun';
import type { StagedImportItem } from './postmanImportStagingSupport';
import styles from './PostmanImportAppendModal.module.css';

export interface PostmanImportAppendModalProps {
  open: boolean;
  projectId: string;
  architectureId: string;
  sessionId: string;
  /** True when in-memory secrets are loaded for this UI session. */
  secretsLoaded: boolean;
  /** Threaded onto each send so mutating imports are permitted. */
  mutatingCallsConfirmed?: boolean;
  /**
   * Defer to the detail view's existing parent-owned re-enter-secrets prompt
   * (the modal does not rebuild secret entry -- A3). Called when a send is
   * blocked 409 SECRETS_NOT_LOADED.
   */
  onRequestReenterSecrets?: () => void;
  /** Called after at least one item was captured so the parent can refresh. */
  onAppended?: () => void;
  onClose: () => void;
}

export function PostmanImportAppendModal({
  open,
  projectId,
  architectureId,
  sessionId,
  secretsLoaded,
  mutatingCallsConfirmed,
  onRequestReenterSecrets,
  onAppended,
  onClose,
}: PostmanImportAppendModalProps): React.ReactElement | null {
  const [importedRequests, setImportedRequests] = useState<ImportedRequest[]>(
    [],
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [operations, setOperations] = useState<ApiBehaviourOperationDto[]>([]);
  const [reconciliation, setReconciliation] =
    useState<InventoryReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appended, setAppended] = useState(false);

  const run = usePostmanImportRun({
    projectId,
    architectureId,
    sessionId,
    importedRequests,
    operations,
    reconciliation,
    mutatingCallsConfirmed,
  });

  // Reset transient state every open so a re-open starts clean.
  useEffect(() => {
    if (!open) return;
    setImportedRequests([]);
    setFileName(null);
    setParseError(null);
    setAppended(false);
  }, [open]);

  // Fetch the session's operation rows + reconciliation once on open so the
  // staging table can map items + render coverage. Fail-soft: a reconciliation
  // failure leaves coverage null (the staging panel hides it) but the run can
  // still proceed for `matched`-by-operation items.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const ops = await listOperations(projectId, architectureId, sessionId);
        if (cancelled) return;
        setOperations(ops);
        try {
          const rec = await reconcileInventory(
            projectId,
            architectureId,
            sessionId,
            {},
          );
          if (!cancelled) setReconciliation(rec);
        } catch {
          if (!cancelled) setReconciliation(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load session operations',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, architectureId, sessionId]);

  const handleFile = useCallback(
    async (file: File | null) => {
      setParseError(null);
      if (!file) {
        setImportedRequests([]);
        setFileName(null);
        return;
      }
      setFileName(file.name);
      try {
        const text = await file.text();
        const json = JSON.parse(text) as Record<string, unknown>;
        const parsed = parsePostmanCollection(json);
        setImportedRequests(parsed);
        if (parsed.length === 0) {
          setParseError('No importable requests were found in this collection.');
        }
      } catch {
        setImportedRequests([]);
        setParseError('Could not parse this file as a Postman collection (JSON).');
      }
    },
    [],
  );

  const handleStageCandidate = useCallback(
    async (item: StagedImportItem) => {
      // STAGE A DISCOVERY CANDIDATE -- never a committed-architecture write (A4).
      await stageImportedDiscoveryCandidate(projectId, architectureId, {
        method: item.request.method,
        path: item.request.path,
        sourceItemName: item.request.sourceItemName,
      });
    },
    [projectId, architectureId],
  );

  const handleAppend = useCallback(async () => {
    const result = await run.runSends();
    // Any successful capture means the parent should refresh its review table.
    const anySent = run.outcomes.some((o) => o.ok) || result.allSent;
    if (anySent) {
      setAppended(true);
      onAppended?.();
    }
    if (result.secretsRequired) {
      // Defer to the detail view's existing re-enter-secrets form (A3).
      onRequestReenterSecrets?.();
    }
  }, [run, onAppended, onRequestReenterSecrets]);

  const sendDisabled = useMemo(
    () =>
      run.sending ||
      !run.canSend ||
      importedRequests.length === 0 ||
      loading,
    [run.sending, run.canSend, importedRequests.length, loading],
  );

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !run.sending) onClose();
      }}
      data-testid="postman-import-append-modal"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="postman-import-append-title"
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="postman-import-append-title">
            Append a Postman collection
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={run.sending}
            data-testid="postman-import-append-close"
            title="Close"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.helperText}>
            Upload a Postman collection (v2.1 JSON). Each request is replayed live
            against the current API via the manual-capture primitive and lands in
            the review flow. Items that do not match a committed architecture
            endpoint are flagged below and must be resolved before they run.
          </p>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Postman collection (.json)</label>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) =>
                void handleFile(e.target.files ? e.target.files[0] : null)
              }
              data-testid="postman-import-append-file"
            />
            {fileName && (
              <span className={styles.helperText}>{fileName}</span>
            )}
          </div>

          {parseError && (
            <div
              className={styles.errorBanner}
              role="alert"
              data-testid="postman-import-append-parse-error"
            >
              {parseError}
            </div>
          )}
          {loadError && (
            <div
              className={styles.errorBanner}
              role="alert"
              data-testid="postman-import-append-load-error"
            >
              {loadError}
            </div>
          )}

          {importedRequests.length > 0 && (
            <>
              <PostmanImportStaging
                importedRequests={importedRequests}
                operations={operations}
                reconciliation={reconciliation}
                loading={loading}
                onUpdateRequest={(index, request) =>
                  setImportedRequests((prev) =>
                    prev.map((r, i) => (i === index ? request : r)),
                  )
                }
              />

              {run.flagged.length > 0 && (
                <PostmanImportArchMatchStep
                  projectId={projectId}
                  architectureId={architectureId}
                  sessionId={sessionId}
                  flagged={run.flagged}
                  resolutions={run.resolutions}
                  onResolutionChange={run.setResolution}
                  onStageDiscoveryCandidate={handleStageCandidate}
                  onDeleteItem={run.deleteItem}
                  onOperationAdded={run.addOperationRow}
                />
              )}

              {run.secretsRequired && (
                <div
                  className={styles.secretsBanner}
                  role="alert"
                  data-testid="postman-import-append-secrets-required"
                >
                  <strong>Secrets are not loaded for this session.</strong>
                  <span>
                    This run has finished, so its in-memory secrets were purged.
                    Re-enter the secrets, then retry the append.
                  </span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      run.clearSecretsRequired();
                      onRequestReenterSecrets?.();
                    }}
                    data-testid="postman-import-append-reenter-secrets"
                  >
                    Re-enter secrets
                  </button>
                </div>
              )}

              {run.outcomes.length > 0 && (
                <div
                  className={styles.outcomeList}
                  data-testid="postman-import-append-outcomes"
                >
                  {run.outcomes.map((o) => (
                    <div
                      key={o.index}
                      className={o.ok ? styles.outcomeOk : styles.outcomeFail}
                      data-testid={`postman-import-append-outcome-${o.index}`}
                    >
                      {o.ok ? 'Captured' : `Failed: ${o.error ?? 'unknown'}`} —{' '}
                      {o.sourceItemName}
                    </div>
                  ))}
                </div>
              )}

              {appended && !run.secretsRequired && (
                <div
                  className={styles.successBanner}
                  role="status"
                  data-testid="postman-import-append-success"
                >
                  Imported requests captured. Review them in the panel below.
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={run.sending}
            data-testid="postman-import-append-cancel"
          >
            Close
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleAppend()}
            disabled={sendDisabled}
            data-testid="postman-import-append-run"
            title={
              !run.canSend
                ? 'Resolve every flagged item before appending.'
                : !secretsLoaded
                  ? 'Secrets may need re-entry; the run will prompt if so.'
                  : 'Replay the imported requests live'
            }
          >
            {run.sending ? 'Appending…' : 'Append & capture'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PostmanImportAppendModal;
