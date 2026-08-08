/**
 * Rebuild a `ParsedOasInventory` from the session's PERSISTED operation rows
 * (2026-08-08 — kills the "Pass B unavailable, re-parse the OAS" dead end).
 *
 * The parsed inventory used to live ONLY in the in-memory
 * `oasInventoryStore`, which dies with every AMVS restart — so "Retry
 * uncovered APIs" on any pre-restart session refused to run its LLM repair
 * and demanded a contract re-parse the operator should never need. But the
 * rows `persistInventory` wrote at parse time carry the ENTIRE parsed
 * contract per operation: `oas_operation_json` is the verbatim dereferenced
 * OAS operation (including `x-amvs-soap` and the format-variant markers),
 * and `request_schema_json` / `response_schema_json` are the dereferenced
 * media-type schemas. Rebuilding from them is lossless for every consumer of
 * the inventory (the contract tools, the repair loop, scenario prompts) —
 * only the spec's cosmetic `title`/`version` are gone, and those are
 * diagnostic-only.
 *
 * The capture flow therefore needs NO API contract to repair coverage: the
 * persisted evidence is authoritative. A freshly uploaded contract (the
 * `refresh-oas-cache` action) can still REPLACE the cache when the operator
 * has one, but it is an enrichment, never a prerequisite.
 */

import type { OperationDto } from './archModelClient';
import type { HttpMethod, ParsedOasInventory, ParsedOasOperation } from '../types/oas';

/** Cosmetic title marking a rebuilt (vs freshly parsed) inventory in logs. */
export const REBUILT_INVENTORY_TITLE = 'rebuilt from persisted session operations';

/**
 * Map persisted operation rows back to a `ParsedOasInventory`. Returns null
 * when there are no rows (nothing to rebuild from — the only case where the
 * repair pass is genuinely unavailable). Pure; malformed row fields degrade
 * per-field (missing oas_operation_json becomes an empty operation object,
 * never a throw).
 */
export function rebuildInventoryFromOperations(
  operations: ReadonlyArray<OperationDto>,
): ParsedOasInventory | null {
  if (operations.length === 0) return null;
  const rebuilt: ParsedOasOperation[] = operations.map((row) => ({
    operationId: row.operation_id,
    method: ((row.method || 'get').toLowerCase()) as HttpMethod,
    path: row.path || '/',
    summary: row.summary ?? null,
    description: row.description ?? null,
    requestSchema: (row.request_schema_json ?? null) as ParsedOasOperation['requestSchema'],
    responseSchema: (row.response_schema_json ?? null) as ParsedOasOperation['responseSchema'],
    oasOperation: (row.oas_operation_json ?? {}) as ParsedOasOperation['oasOperation'],
  }));
  return { operations: rebuilt, title: REBUILT_INVENTORY_TITLE, version: null };
}
