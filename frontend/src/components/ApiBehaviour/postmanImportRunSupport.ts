/**
 * Pure orchestration helpers for the Postman import RUN (send) phase.
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R2 / R4 / R7
 * (Task Group 8). This module is PURE (no fetch, no DOM): it decides WHICH
 * staged import items may be sent, maps a runnable item onto the
 * `ManualCaptureRequest` body the existing `manualCapture` client expects, and
 * resolves the operation row an item must target (after the Group 4 arch-match
 * step may have created a new row via add-operation).
 *
 * The actual sending (the `manualCapture` loop, the `/start` call, the
 * re-enter-secrets prompt) lives in the `usePostmanImportRun` hook + the two
 * integration sites (the wizard step and the detail-view append modal). Keeping
 * the SELECTION + MAPPING rules here makes the run logic unit-testable without a
 * DOM.
 */

import type {
  ApiBehaviourOperationDto,
  ManualCaptureRequest,
} from '../../api/apiBehaviourClient';
import type {
  StagedImportItem,
} from './postmanImportStagingSupport';
import { matchOperation } from './postmanImportStagingSupport';
import type { ArchMatchResolution } from './postmanImportArchMatchSupport';

/**
 * The three Mode-1 run modes (the wizard run-mode selector) plus the implicit
 * Mode-2 append. The wizard surfaces all three; Mode 2 always replays live
 * (equivalent to the `postman-only` send phase without a fresh `/start`).
 *
 *   - `llm`          LLM only -- today's behaviour, NO Postman upload. The
 *                    run-mode selector still offers it so the wizard's existing
 *                    planner + `execute_http_request` path is unchanged.
 *   - `postman-delta` Postman + LLM delta -- fire the imported items as concrete
 *                    captures after `/start`, then the server-side delta tops up
 *                    only the uncovered scenarios (Group 7).
 *   - `postman-only` Postman only -- fire the imported items, skip the planner +
 *                    LLM loop; `/start` carries `coverageOverrideJustification`
 *                    + `postmanOnly` so the coverage gate does not fail closed.
 */
export type PostmanRunMode = 'llm' | 'postman-delta' | 'postman-only';

/** Whether a run mode actually imports Postman items (vs LLM-only). */
export function modeUsesPostman(mode: PostmanRunMode): boolean {
  return mode === 'postman-delta' || mode === 'postman-only';
}

/** Whether a run mode runs the LLM loop server-side (Mode 1a + 1b). */
export function modeRunsLlm(mode: PostmanRunMode): boolean {
  return mode === 'llm' || mode === 'postman-delta';
}

/**
 * Re-resolve the operation row a staged item must target for the send. A
 * `matched` item already carries its operation; an item the user KEPT in the
 * arch-match step gets a freshly-added row (the parent feeds the updated
 * operation list back in), so we re-match by `(method, path)` against the
 * latest rows rather than trusting the stale `item.operation`.
 */
export function resolveSendOperation(
  item: StagedImportItem,
  operations: ApiBehaviourOperationDto[],
): ApiBehaviourOperationDto | null {
  if (item.operation) {
    // Prefer the freshest row identity (the add-operation row may have a new id
    // / included flag), falling back to the originally-mapped row.
    const fresh = matchOperation(item.request, operations);
    return fresh ?? item.operation;
  }
  return matchOperation(item.request, operations);
}

/**
 * Decide whether a staged item may be SENT in this run, given the arch-match
 * resolution map. The rules (never silently run an unresolved item):
 *   - an item with an unsupported body is NEVER sent.
 *   - a cleanly `matched` item is sent.
 *   - a flagged item is sent ONLY when the user resolved it as `kept`
 *     (keep & run). `staged` (added to architecture for review) and `deleted`
 *     items are NOT sent; a still-`pending` flagged item blocks (not sent).
 */
export function isItemSendable(
  item: StagedImportItem,
  resolutions: Record<number, ArchMatchResolution>,
): boolean {
  if (item.request.unsupportedReason !== undefined) return false;
  if (item.archStatus === 'matched') return true;
  return resolutions[item.index] === 'kept';
}

/**
 * The ordered subset of staged items that will physically send this run --
 * preserving source order so the capture stream reads top-to-bottom.
 */
export function sendableItems(
  staged: StagedImportItem[],
  resolutions: Record<number, ArchMatchResolution>,
): StagedImportItem[] {
  return staged.filter((item) => isItemSendable(item, resolutions));
}

/**
 * Map one sendable staged item + its resolved operation row onto the
 * `ManualCaptureRequest` body. The body is camelCase (the existing
 * `manual-capture` contract); the path is the concrete resolved path the parser
 * staged (the route does NO further substitution). Query keys ride through as
 * the parser's `{ key: value }` record; headers likewise. `body` is the parsed
 * JSON value (or null for a bodiless request).
 *
 * `mutatingCallsConfirmed` is threaded from the session so a mutating import
 * send is permitted under the same explicit-intent posture as an LLM send.
 */
export function buildManualCaptureRequest(
  item: StagedImportItem,
  operation: ApiBehaviourOperationDto,
  options?: { mutatingCallsConfirmed?: boolean },
): ManualCaptureRequest {
  // The manual-capture route validates by the AMS operation ROW UUID
  // (`op.id`), like every other caller (AddNewBehaviourModal sends
  // `selectedOperation.id`). Sending `operation_id` — the OAS id STRING,
  // always present on the DTO — made every live Postman replay 404 with
  // "Operation '<oas id>' was not found for this session" (2026-07-26 fix;
  // both layers were tested against mocks, so the mismatch never surfaced).
  const operationId = operation.id;
  return {
    operationId,
    method: item.request.method,
    path: item.request.path,
    query: Object.keys(item.request.query).length > 0 ? item.request.query : null,
    headers:
      Object.keys(item.request.headers).length > 0 ? item.request.headers : null,
    body: item.request.body,
    mutatingCallsConfirmed: options?.mutatingCallsConfirmed === true,
  };
}

/**
 * Whether the run may proceed to the SEND phase: every flagged item must be
 * resolved (NOT `pending`) so an unmatched / unmapped item is never silently
 * runnable. Mirrors `allFlaggedResolved` but expressed over the staged set so a
 * caller with only the staged list + resolutions can gate the run.
 */
export function canSendRun(
  staged: StagedImportItem[],
  resolutions: Record<number, ArchMatchResolution>,
): boolean {
  return staged.every((item) => {
    if (item.archStatus === 'matched') return true;
    const r = resolutions[item.index] ?? 'pending';
    return r !== 'pending';
  });
}

/**
 * One captured Postman request, in the wire shape the AMVS /start handler
 * forwards into the orchestrator deps (Mode 1b delta, R6). `expectedStatus` is
 * the real response status class derived from the manual-capture response, so
 * the per-op Stage-1 pre-filter can subtract candidates that obviously match.
 */
export interface PostmanCapturedWire {
  method: string;
  path: string;
  expectedStatus: string | null;
}

/**
 * Map a real HTTP status onto the same expected-status class the planner uses
 * (mirrors the AMVS `classifyStatus`): 404 -> not_found, 2xx -> success, other
 * 4xx -> client_error, else null. Keeps the client-built captured map aligned
 * with the server-side Stage-1 keying.
 */
export function classifyStatus(status: number | null | undefined): string | null {
  if (typeof status !== 'number') return null;
  if (status === 404) return 'not_found';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400 && status < 500) return 'client_error';
  return null;
}

/**
 * Add ONE captured send to the per-operation captured map (keyed by the
 * operation_id the AMVS delta keys on). Pure: returns a NEW map so callers can
 * fold over the send loop without mutating shared state.
 */
export function addCaptured(
  capturedByOp: Record<string, PostmanCapturedWire[]>,
  operationId: string,
  captured: PostmanCapturedWire,
): Record<string, PostmanCapturedWire[]> {
  const next = { ...capturedByOp };
  next[operationId] = [...(next[operationId] ?? []), captured];
  return next;
}
