/**
 * Add-operation support helpers (Spec 2026-06-23 Import a Postman Collection
 * into Capture, Task Group 6 -- R2/R4c/R7/R8).
 *
 * NET-NEW file carrying the bulk of the add-operation action's logic so the
 * huge `captureSessionActions.ts` only gains a thin, anchored wiring seam.
 *
 * The add-operation action appends ONE endpoint to a capture session as an
 * `included=true` operation row BEFORE any `manual-capture` send, so an
 * imported Postman item that maps to an endpoint NOT already in the session's
 * operation set still satisfies the `manual-capture` route's
 * OPERATION_NOT_FOUND / OPERATION_NOT_INCLUDED guards (R7/A2). It reuses the
 * SAME `synthesiseOperationFromEndpoint` mapping + `createOperation` snake_case
 * AMS create shape as the `account-endpoints` include path (R8) -- this file
 * never forks that shape; it composes the existing primitives.
 *
 * The request body is camelCase (the frontend `AddOperationRequest` client owns
 * that shape); the snake_case AMS create shape is applied here, server-side.
 */

import type { ParsedOasOperation } from '../types/oas';

/**
 * Camel-case add-operation request body (mirrors the frontend
 * `AddOperationRequest` client shape). `endpointId` is present when the imported
 * item matched a committed architecture endpoint (the server reuses
 * `synthesiseOperationFromEndpoint` over that endpoint row); it is omitted for an
 * architecture-unmatched endpoint the user kept and chose to run. `method` +
 * `path` are ALWAYS sent so a row can be synthesised even with no `endpointId`.
 */
export interface AddOperationBody {
  projectId?: string;
  endpointId?: string | null;
  method?: string;
  path?: string;
  operationId?: string | null;
  summary?: string | null;
  description?: string | null;
}

/** Validated, normalised add-operation inputs. */
export interface NormalisedAddOperation {
  method: string;
  path: string;
  operationId: string | null;
  endpointId: string | null;
  summary: string | null;
  description: string | null;
}

/** A validation failure carrying the HTTP status + message for `fail(...)`. */
export interface AddOperationValidationError {
  status: number;
  message: string;
}

/**
 * Validate + normalise the camelCase add-operation body. Returns a discriminated
 * result so the route can `fail(res, err.status, err.message)` without
 * re-deriving the validation. `method` + `path` are REQUIRED (an endpoint can be
 * synthesised from them even with no `endpointId`); everything else is optional.
 */
export function normaliseAddOperationBody(
  body: AddOperationBody,
):
  | { ok: true; value: NormalisedAddOperation }
  | { ok: false; error: AddOperationValidationError } {
  const method =
    typeof body.method === 'string' && body.method.trim().length > 0
      ? body.method.trim().toUpperCase()
      : null;
  const path =
    typeof body.path === 'string' && body.path.trim().length > 0
      ? body.path.trim()
      : null;
  if (!method) {
    return { ok: false, error: { status: 400, message: 'method is required' } };
  }
  if (!path) {
    return { ok: false, error: { status: 400, message: 'path is required' } };
  }
  const endpointId =
    typeof body.endpointId === 'string' && body.endpointId.length > 0
      ? body.endpointId
      : null;
  const operationId =
    typeof body.operationId === 'string' && body.operationId.length > 0
      ? body.operationId
      : null;
  const summary = typeof body.summary === 'string' && body.summary.length > 0 ? body.summary : null;
  const description =
    typeof body.description === 'string' && body.description.length > 0 ? body.description : null;

  return {
    ok: true,
    value: { method, path, operationId, endpointId, summary, description },
  };
}

/**
 * Stable operation-id derivation for an architecture-unmatched endpoint (no
 * `endpointId`, so no `synthesiseOperationFromEndpoint` source row). Mirrors the
 * `${METHOD}_${path}` fallback that `synthesiseOperationFromEndpoint` itself uses
 * when an endpoint has no name, so an imported item with no committed endpoint
 * still gets a deterministic, collision-free operation_id.
 */
export function deriveOperationId(method: string, path: string, explicit: string | null): string {
  if (explicit) return explicit;
  const safePath = path.length > 0 ? path : 'unknown';
  return `${method.toUpperCase()}_${safePath}`;
}

/**
 * Find an existing operation row for this session that already covers the target
 * (idempotency for add-operation). Matches by operation_id when one was supplied,
 * else by method+path identity. Returns the matching row or null.
 *
 * `operations` is the snake_case AMS operation-row list (`OperationDto[]`); we
 * read only `id` / `operation_id` / `method` / `path` so the function stays
 * decoupled from the full DTO and trivially testable.
 */
export function findExistingOperationRow<
  T extends { operation_id?: string | null; method?: string | null; path?: string | null },
>(operations: ReadonlyArray<T>, target: NormalisedAddOperation): T | null {
  const wantMethod = target.method.toUpperCase();
  const wantPath = target.path;
  for (const op of operations) {
    if (target.operationId && op.operation_id === target.operationId) return op;
    const opMethod = typeof op.method === 'string' ? op.method.toUpperCase() : '';
    if (opMethod === wantMethod && op.path === wantPath) return op;
  }
  return null;
}

/**
 * Build the snake_case `createOperation` body for an architecture-unmatched
 * endpoint (no source endpoint row to synthesise from). Mirrors the
 * `account-endpoints` include shape field-for-field -- `included=true`, no
 * safety verdict (`safe_to_execute=null` so the user reviews it like any other
 * row), null schemas, and an `x-amvs-source` marker so a future diagnostic can
 * spot import-derived rows. Kept in this helper so the route's wiring seam stays
 * a one-liner; the shape is IDENTICAL to the one the synthesised path produces.
 */
export function buildSynthesisedCreateBody(
  sessionId: string,
  target: NormalisedAddOperation,
): {
  session_id: string;
  operation_id: string;
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  included: boolean;
  safe_to_execute: null;
  request_schema_json: null;
  response_schema_json: null;
  oas_operation_json: Record<string, unknown>;
} {
  const operationId = deriveOperationId(target.method, target.path, target.operationId);
  return {
    session_id: sessionId,
    operation_id: operationId,
    method: target.method.toUpperCase(),
    path: target.path,
    summary: target.summary,
    description: target.description,
    // Imported endpoints are appended INCLUDED so the immediately-following
    // manual-capture send passes the OPERATION_NOT_INCLUDED guard (R7/A2).
    included: true,
    // No safety verdict on an import-appended row -- the user reviews it.
    safe_to_execute: null,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: {
      operationId,
      summary: target.summary ?? undefined,
      description: target.description ?? undefined,
      'x-amvs-source': 'postman-import-add-operation',
      responses: {},
    },
  };
}

/**
 * Project a created/synthesised operation into a `ParsedOasOperation` for the
 * `oasInventoryStore` append, so `/start` sees the new row WITHOUT a re-parse
 * (mirrors `account-endpoints` appending `includedOps` to the cached inventory).
 * Used for the no-endpointId synthesised path; the endpointId path reuses
 * `synthesiseOperationFromEndpoint`'s own `ParsedOasOperation` return.
 */
export function toInventoryOperation(target: NormalisedAddOperation): ParsedOasOperation {
  const operationId = deriveOperationId(target.method, target.path, target.operationId);
  const lower = target.method.toLowerCase();
  return {
    operationId,
    method: lower as ParsedOasOperation['method'],
    path: target.path,
    summary: target.summary,
    description: target.description,
    requestSchema: null,
    responseSchema: null,
    oasOperation: {
      operationId,
      summary: target.summary ?? undefined,
      description: target.description ?? undefined,
      'x-amvs-source': 'postman-import-add-operation',
      responses: {},
    } as unknown as ParsedOasOperation['oasOperation'],
  };
}
