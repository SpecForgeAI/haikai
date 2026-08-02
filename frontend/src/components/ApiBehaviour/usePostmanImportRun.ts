/**
 * usePostmanImportRun
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R2 / R4 / R5 / R7
 * (Task Group 8). The SHARED send-orchestration hook used by BOTH the Mode 1
 * wizard step and the Mode 2 detail-view append modal. It owns:
 *
 *   - the parsed `ImportedRequest[]` + the per-item arch-match RESOLUTION map
 *     (so a flagged item is never silently runnable -- `staged` / `kept` /
 *     `deleted` is recorded before the send),
 *   - the operation rows (which a "Keep & run" add-operation call extends),
 *   - the `manual-capture` REPLAY-LIVE send loop (each sendable item fired via
 *     the existing `manualCapture` client -- the single execute->persist
 *     primitive; NO forked send/redact/persist logic),
 *   - 409 `SECRETS_NOT_LOADED` detection (`isSecretsNotLoadedError`) so the
 *     caller can prompt a re-enter-secrets step (`POST /secrets`) before
 *     retrying -- the run is PAUSED, never silently dropped.
 *
 * The hook is deliberately UI-agnostic: it returns state + actions and renders
 * nothing. The wizard / modal render the staging table + arch-match step + the
 * re-enter-secrets prompt and call `runSends(...)`. The hook reuses the existing
 * frontend clients (`manualCapture`, `isSecretsNotLoadedError`) -- no new fetch
 * shims (R8).
 */

import { useCallback, useMemo, useState } from 'react';
import {
  manualCapture,
  isSecretsNotLoadedError,
  ApiBehaviourApiError,
  type ApiBehaviourOperationDto,
} from '../../api/apiBehaviourClient';
import type { ImportedRequest } from '../../utils/postmanImport';
import type { InventoryReconciliationResponse } from '../../api/apiBehaviourClient';
import {
  stageImportItems,
  flaggedForArchMatch,
  type StagedImportItem,
} from './postmanImportStagingSupport';
import type { ArchMatchResolution } from './postmanImportArchMatchSupport';
import {
  sendableItems,
  resolveSendOperation,
  buildManualCaptureRequest,
  canSendRun,
  hasUnresolvedSendableParams,
  classifyStatus,
  addCaptured,
  type PostmanCapturedWire,
} from './postmanImportRunSupport';

export interface UsePostmanImportRunParams {
  projectId: string;
  architectureId: string;
  sessionId: string;
  /** Parsed import items (from `parsePostmanCollection`). */
  importedRequests: ImportedRequest[];
  /** The session's operation rows; "Keep & run" appends to this via `addOperation`. */
  operations: ApiBehaviourOperationDto[];
  /** Verbatim reconciliation payload (arch-match source of truth). */
  reconciliation: InventoryReconciliationResponse | null;
  /** Threaded onto each `manual-capture` send so mutating imports are permitted. */
  mutatingCallsConfirmed?: boolean;
}

/** Per-item send outcome surfaced to the caller for the run summary. */
export interface PostmanSendOutcome {
  index: number;
  sourceItemName: string;
  ok: boolean;
  error?: string;
}

export interface UsePostmanImportRun {
  /** The joined + classified staged items (mapping + arch status). */
  staged: StagedImportItem[];
  /** The subset routed to the Group 4 arch-match step (NOT cleanly matched). */
  flagged: StagedImportItem[];
  /** Per-item arch-match resolution map (the parent owns it via the setters). */
  resolutions: Record<number, ArchMatchResolution>;
  /** Record a resolution for a flagged item (used by the arch-match step). */
  setResolution: (index: number, resolution: ArchMatchResolution) => void;
  /** Append an operation row created by a "Keep & run" add-operation call. */
  addOperationRow: (operation: ApiBehaviourOperationDto) => void;
  /** Mark a deleted item resolved (drop it from the import set). */
  deleteItem: (item: StagedImportItem) => void;
  /** True once every flagged item is resolved (the run may send). */
  canSend: boolean;
  /** True while a send loop is in flight. */
  sending: boolean;
  /** True when the last send was blocked by 409 SECRETS_NOT_LOADED. */
  secretsRequired: boolean;
  /** Clear the secrets-required flag (after the caller re-enters secrets). */
  clearSecretsRequired: () => void;
  /** Per-item outcomes from the last `runSends`. */
  outcomes: PostmanSendOutcome[];
  /**
   * Fire every sendable item through `manualCapture` in source order. Resolves
   * to `{ allSent, secretsRequired }`. On the FIRST 409 SECRETS_NOT_LOADED the
   * loop stops and `secretsRequired` is set so the caller prompts re-entry; the
   * already-sent items stay captured and a retry resumes from the unsent set.
   */
  runSends: () => Promise<{
    allSent: boolean;
    secretsRequired: boolean;
    /** Per-operation captured map (keyed by operation_id) for the Mode 1b delta. */
    capturedByOp: Record<string, PostmanCapturedWire[]>;
  }>;
}

export function usePostmanImportRun({
  projectId,
  architectureId,
  sessionId,
  importedRequests,
  operations,
  reconciliation,
  mutatingCallsConfirmed,
}: UsePostmanImportRunParams): UsePostmanImportRun {
  const [resolutions, setResolutions] = useState<
    Record<number, ArchMatchResolution>
  >({});
  // Operation rows created by "Keep & run" add-operation calls, layered over
  // the prop rows so the send loop can re-match against them.
  const [addedOperations, setAddedOperations] = useState<
    ApiBehaviourOperationDto[]
  >([]);
  // Indices the user dropped via "Delete the item" -- excluded from the run.
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(
    () => new Set(),
  );
  const [sending, setSending] = useState(false);
  const [secretsRequired, setSecretsRequired] = useState(false);
  const [outcomes, setOutcomes] = useState<PostmanSendOutcome[]>([]);

  const allOperations = useMemo(
    () => [...operations, ...addedOperations],
    [operations, addedOperations],
  );

  const staged = useMemo(
    () =>
      stageImportItems(importedRequests, allOperations, reconciliation).filter(
        (item) => !deletedIndices.has(item.index),
      ),
    [importedRequests, allOperations, reconciliation, deletedIndices],
  );

  const flagged = useMemo(() => flaggedForArchMatch(staged), [staged]);

  const canSend = useMemo(
    () =>
      canSendRun(staged, resolutions) &&
      // Items that would send but still carry unresolved path params hold the
      // gate (2026-08-02) — never silently skipped, never fired templated.
      !hasUnresolvedSendableParams(staged, resolutions),
    [staged, resolutions],
  );

  const setResolution = useCallback(
    (index: number, resolution: ArchMatchResolution) => {
      setResolutions((prev) => ({ ...prev, [index]: resolution }));
    },
    [],
  );

  const addOperationRow = useCallback((operation: ApiBehaviourOperationDto) => {
    setAddedOperations((prev) => [...prev, operation]);
  }, []);

  const deleteItem = useCallback((item: StagedImportItem) => {
    setDeletedIndices((prev) => {
      const next = new Set(prev);
      next.add(item.index);
      return next;
    });
  }, []);

  const clearSecretsRequired = useCallback(() => {
    setSecretsRequired(false);
  }, []);

  const runSends = useCallback(async (): Promise<{
    allSent: boolean;
    secretsRequired: boolean;
    capturedByOp: Record<string, PostmanCapturedWire[]>;
  }> => {
    setSending(true);
    setSecretsRequired(false);
    const toSend = sendableItems(staged, resolutions);
    const results: PostmanSendOutcome[] = [];
    let capturedByOp: Record<string, PostmanCapturedWire[]> = {};
    let secretsBlocked = false;
    let allSent = true;
    try {
      for (const item of toSend) {
        const operation = resolveSendOperation(item, allOperations);
        if (!operation) {
          // Defensive: a sendable item without a resolved operation row would
          // 404 at the route; skip it and record the failure rather than send a
          // body that cannot map to an operation.
          allSent = false;
          results.push({
            index: item.index,
            sourceItemName: item.request.sourceItemName,
            ok: false,
            error: 'No operation row resolved for this item',
          });
          continue;
        }
        try {
          const res = await manualCapture(
            projectId,
            architectureId,
            sessionId,
            buildManualCaptureRequest(item, operation, {
              mutatingCallsConfirmed,
            }),
          );
          // Build the per-op captured map (Mode 1b delta): key on the same
          // operation_id the AMVS Stage-1 keys on; classify the REAL response
          // status so the pre-filter can subtract obvious matches.
          const opKey = operation.operation_id ?? operation.id;
          capturedByOp = addCaptured(capturedByOp, opKey, {
            method: item.request.method,
            path: item.request.path,
            expectedStatus: classifyStatus(res.capture?.response_status),
          });
          results.push({
            index: item.index,
            sourceItemName: item.request.sourceItemName,
            ok: true,
          });
        } catch (err) {
          allSent = false;
          if (isSecretsNotLoadedError(err)) {
            // Pause the run: the caller must re-enter secrets, then retry. The
            // unsent items stay unsent so a retry resumes from here.
            secretsBlocked = true;
            results.push({
              index: item.index,
              sourceItemName: item.request.sourceItemName,
              ok: false,
              error: 'Secrets not loaded',
            });
            break;
          }
          const detail =
            err instanceof ApiBehaviourApiError
              ? err.body?.message ?? err.message
              : err instanceof Error
                ? err.message
                : 'Send failed';
          results.push({
            index: item.index,
            sourceItemName: item.request.sourceItemName,
            ok: false,
            error: detail,
          });
        }
      }
    } finally {
      setOutcomes(results);
      setSecretsRequired(secretsBlocked);
      setSending(false);
    }
    return { allSent, secretsRequired: secretsBlocked, capturedByOp };
  }, [
    projectId,
    architectureId,
    sessionId,
    staged,
    resolutions,
    allOperations,
    mutatingCallsConfirmed,
  ]);

  return {
    staged,
    flagged,
    resolutions,
    setResolution,
    addOperationRow,
    deleteItem,
    canSend,
    sending,
    secretsRequired,
    clearSecretsRequired,
    outcomes,
    runSends,
  };
}

export default usePostmanImportRun;
