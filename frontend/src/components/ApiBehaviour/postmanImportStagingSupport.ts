/**
 * Pure mapping + classification helpers for the Postman import staging UI.
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R3 / R5
 * (Task Groups 3 + 4). This module is PURE (no fetch, no DOM): it maps each
 * parsed `ImportedRequest` onto a session operation row by `(method, path)`
 * and classifies its architecture-match status off the VERBATIM
 * `InventoryReconciliationResponse` -- so both the staging table (Group 3) and
 * the architecture-match warning step (Group 4) read one shared, tested seam.
 *
 * NOTHING here re-derives coverage: the reconciliation payload is the single
 * source of truth. We only JOIN the imported items onto the rows the AMS
 * calculator already classified (`operations_without_model_endpoint`).
 */

import type {
  ApiBehaviourOperationDto,
  InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import type { ImportedRequest } from '../../utils/postmanImport';

/**
 * The architecture-match disposition of a staged import item:
 *   - `matched`        the mapped operation IS backed by a committed
 *                      architecture endpoint (NOT in
 *                      `operations_without_model_endpoint`).
 *   - `unmatched`      the item maps to a session operation, but that operation
 *                      is NOT backed by a committed architecture endpoint
 *                      (it appears in `operations_without_model_endpoint`).
 *   - `no-operation`   the item maps to NO session operation row at all.
 *
 * Both `unmatched` and `no-operation` route to the Group 4 warning step; only
 * `matched` items are silently runnable.
 */
export type ArchMatchStatus = 'matched' | 'unmatched' | 'no-operation';

/** One staged import item joined onto its session operation + arch status. */
export interface StagedImportItem {
  /** Stable index of the source `ImportedRequest` in the parsed list. */
  index: number;
  /** The parsed request this row was resolved from. */
  request: ImportedRequest;
  /**
   * The session operation row this item maps to by `(method, path)`, or `null`
   * when the item maps to NO known operation (`no-operation`).
   */
  operation: ApiBehaviourOperationDto | null;
  /** Architecture-match disposition (drives the Group 4 routing). */
  archStatus: ArchMatchStatus;
  /**
   * TRUE when the item is safe to run silently (mapped to an operation AND that
   * operation is backed by a committed architecture endpoint AND the body is a
   * supported `application/json` body). FALSE routes the item to Group 4 (or
   * flags an unsupported body) -- never silently runnable.
   */
  runnable: boolean;
}

/** Upper-case + collapse a method to its canonical comparable form. */
function normaliseMethod(method: string | null | undefined): string {
  return (method ?? '').trim().toUpperCase();
}

/**
 * Normalise a URL path for `(method, path)` comparison: ensure a single leading
 * slash, drop any trailing slash (except the root), and lower-case. Parameterised
 * segments (`{id}` / `:id`) are NOT resolved here -- the imported path is already
 * concrete and is compared against the operation row's stored `path` verbatim
 * (the wizard pre-substitutes tokens before any send). Fail-soft on nullish.
 */
export function normalisePath(path: string | null | undefined): string {
  let p = (path ?? '').trim();
  if (p.length === 0) return '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

/** A `(method, path)` join key for an operation row / imported request. */
export function operationKey(
  method: string | null | undefined,
  path: string | null | undefined,
): string {
  return `${normaliseMethod(method)} ${normalisePath(path)}`;
}

/**
 * Map ONE imported request to a session operation row by `(method, path)`.
 * Returns the first row whose normalised method + path match; `null` when none
 * match (the item maps to NO known operation -> Group 4).
 */
export function matchOperation(
  request: ImportedRequest,
  operations: ApiBehaviourOperationDto[],
): ApiBehaviourOperationDto | null {
  const wanted = operationKey(request.method, request.path);
  for (const op of operations) {
    if (operationKey(op.method, op.path) === wanted) return op;
  }
  return null;
}

/**
 * Build the set of operation-row ids the reconciliation marked as NOT backed by
 * a committed architecture endpoint (the discovery-gap rows). Read VERBATIM from
 * `operations_without_model_endpoint`; we never recompute the comparison.
 */
export function buildWithoutModelEndpointKeys(
  reconciliation: InventoryReconciliationResponse | null,
): { rowIds: Set<string>; keys: Set<string> } {
  const rowIds = new Set<string>();
  const keys = new Set<string>();
  const refs = reconciliation?.operations_without_model_endpoint ?? [];
  for (const ref of refs) {
    if (ref.operation_row_id) rowIds.add(ref.operation_row_id);
    // Fall back to a (method, path) key so an item that maps to NO session row
    // yet (the no-operation case) can still be classed against the gap list.
    keys.add(operationKey(ref.method, ref.path));
  }
  return { rowIds, keys };
}

/**
 * Join parsed `ImportedRequest[]` onto the session operation rows + the verbatim
 * reconciliation payload, classifying each item's architecture-match status.
 *
 * Mapping: `(method, path)` against the operation rows. Classification:
 *   - no matching operation row              -> `no-operation` (Group 4)
 *   - matched, but the row is in
 *     `operations_without_model_endpoint`     -> `unmatched`    (Group 4)
 *   - matched + backed by a committed endpoint -> `matched`     (runnable)
 *
 * `runnable` additionally requires a SUPPORTED body (no `unsupportedReason`) so
 * a non-`application/json` item is never silently sent.
 */
export function stageImportItems(
  importedRequests: ImportedRequest[],
  operations: ApiBehaviourOperationDto[],
  reconciliation: InventoryReconciliationResponse | null,
): StagedImportItem[] {
  const { rowIds, keys } = buildWithoutModelEndpointKeys(reconciliation);

  return importedRequests.map((request, index) => {
    const operation = matchOperation(request, operations);

    let archStatus: ArchMatchStatus;
    if (operation === null) {
      archStatus = 'no-operation';
    } else if (
      (operation.id && rowIds.has(operation.id)) ||
      keys.has(operationKey(operation.method, operation.path))
    ) {
      archStatus = 'unmatched';
    } else {
      archStatus = 'matched';
    }

    const runnable =
      archStatus === 'matched' && request.unsupportedReason === undefined;

    return { index, request, operation, archStatus, runnable };
  });
}

/**
 * The subset of staged items routed to the Group 4 architecture-match warning
 * step: anything NOT cleanly `matched` (i.e. `unmatched` to a committed endpoint
 * OR mapping to `no-operation`). These are NEVER silently runnable.
 */
export function flaggedForArchMatch(
  staged: StagedImportItem[],
): StagedImportItem[] {
  return staged.filter((s) => s.archStatus !== 'matched');
}
