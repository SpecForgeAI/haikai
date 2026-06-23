/**
 * Pure helpers for the Postman import architecture-match warning step.
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R5 / A2 / A4 / A5
 * (Task Group 4). This module is PURE (no fetch, no DOM): it builds the
 * `AddOperationRequest` for a kept-and-run unmatched item and tracks the
 * per-item resolution state so the component stays presentational and the
 * routing rules are unit-testable.
 *
 * The two user actions on a flagged item are:
 *   - "Add to architecture" -> STAGE A DISCOVERY CANDIDATE (NOT a committed
 *     architecture write); the caller's `onStageDiscoveryCandidate` seam routes
 *     it through the existing discovery review/approve path.
 *   - "Delete the item"     -> drop it from the staged import set.
 *
 * Plus the kept-and-run path: an unmatched item the user chooses to KEEP & RUN
 * must have its operation row CREATED FIRST (via the add-operation client) so
 * the subsequent `manual-capture` send clears the route's
 * OPERATION_NOT_FOUND / OPERATION_NOT_INCLUDED guards.
 */

import type { AddOperationRequest } from '../../api/apiBehaviourClient';
import type { StagedImportItem } from './postmanImportStagingSupport';

/**
 * The disposition the user has chosen for a flagged item:
 *   - `pending`   not yet resolved (blocks the run).
 *   - `staged`    "Add to architecture" -> staged as a discovery candidate.
 *   - `deleted`   "Delete the item" -> dropped from the import set.
 *   - `kept`      kept & run -> the operation row is (being) created via
 *                 add-operation before the send.
 */
export type ArchMatchResolution = 'pending' | 'staged' | 'deleted' | 'kept';

/**
 * Build the add-operation request for a flagged item the user chose to KEEP &
 * RUN. The resolved method + path are always sent (so the server can synthesise
 * a row); `summary` carries the source item name for a readable row label.
 * `endpointId` is intentionally omitted -- a flagged item by definition does NOT
 * match a committed architecture endpoint, so there is none to synthesise from.
 */
export function buildAddOperationRequest(
  item: StagedImportItem,
): AddOperationRequest {
  return {
    method: item.request.method,
    path: item.request.path,
    summary: item.request.sourceItemName || null,
  };
}

/**
 * Whether the run can proceed: every flagged item must be resolved (NOT
 * `pending`). A still-pending flagged item keeps the run blocked so an
 * unmatched / unmapped item is never silently runnable.
 */
export function allFlaggedResolved(
  resolutions: Record<number, ArchMatchResolution>,
  flagged: StagedImportItem[],
): boolean {
  return flagged.every((item) => {
    const r = resolutions[item.index] ?? 'pending';
    return r !== 'pending';
  });
}

/**
 * The flagged items the user chose to KEEP & RUN -- the set whose operation rows
 * must be created (add-operation) BEFORE any `manual-capture` send.
 */
export function keptForRun(
  resolutions: Record<number, ArchMatchResolution>,
  flagged: StagedImportItem[],
): StagedImportItem[] {
  return flagged.filter((item) => resolutions[item.index] === 'kept');
}
