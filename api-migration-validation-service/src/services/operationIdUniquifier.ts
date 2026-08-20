/**
 * OAS operationId uniquification (2026-07-25 — duplicate-operationId collapse).
 *
 * WADL/OAS operation ids come from source method names, and Java method
 * OVERLOADS legally produce the SAME id on DIFFERENT routes (a legacy app had
 * `getHierarchyForOrgId` on both `POST /hierarchynodes/{orgUnitId}` and
 * `POST /hierarchy/{businessDate}/{orgUnitId}`, and `getView` on both
 * `GET /views/{viewId}` and `GET /views/{businessDate}/{viewId}`).
 *
 * The capture stack keys operations by their operationId STRING in several
 * maps (`operations.map((o) => [o.operation_id, o])` — last duplicate wins),
 * so a duplicated id silently collapses two routes into one: scenarios,
 * captures and closure repairs for one route get filed under its same-named
 * sibling, the sibling's baseline absorbs them, and the shadowed route's own
 * operation rows end up with ZERO captures — surfacing as a permanent
 * `missing_baseline` flag on the migration plan while the coverage gate reads
 * 100%.
 *
 * This module disambiguates AT THE SOURCE: after the wizard's inventories are
 * merged and BEFORE per-format expansion / persistence, any operationId shared
 * by operations on DIFFERENT routes gets a ` [route=<VERB> <path>]` suffix on
 * EVERY member of the colliding group (order-independent — no first-wins
 * asymmetry). The suffix's `route=` key deliberately FAILS the reconciliation
 * discriminator grammar (`consumes|produces|headers|params` only — same
 * design as the expansion's `[format=...]` suffix), so renamed operations
 * still reconcile on the bare `<METHOD> <path>` key and endpoint matching is
 * unchanged.
 *
 * True same-route duplicates (the identical operation listed twice) are left
 * untouched: renaming cannot distinguish them and map-collapse between
 * identical routes is behaviourally harmless.
 */
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';

/** The disambiguation suffix for one operation. */
export function routeSuffix(op: Pick<ParsedOasOperation, 'method' | 'path'>): string {
  return ` [route=${op.method.toUpperCase()} ${op.path}]`;
}

export interface UniquifyResult {
  inventory: ParsedOasInventory;
  /** originalId -> the renamed ids minted for it (for the parse-oas log line). */
  renamed: Map<string, string[]>;
}

/**
 * Disambiguate duplicate operationIds that span more than one route. Pure —
 * returns the input inventory object unchanged when nothing collides.
 */
export function uniquifyOperationIds(inventory: ParsedOasInventory): UniquifyResult {
  const byId = new Map<string, ParsedOasOperation[]>();
  for (const op of inventory.operations) {
    const group = byId.get(op.operationId) ?? [];
    group.push(op);
    byId.set(op.operationId, group);
  }

  const renamed = new Map<string, string[]>();
  const collidingIds = new Set<string>();
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    const routes = new Set(group.map((op) => `${op.method} ${op.path}`));
    if (routes.size < 2) continue; // same-route duplicates — renaming cannot help
    collidingIds.add(id);
  }
  if (collidingIds.size === 0) {
    return { inventory, renamed };
  }

  const operations = inventory.operations.map((op) => {
    if (!collidingIds.has(op.operationId)) return op;
    const newId = `${op.operationId}${routeSuffix(op)}`;
    const minted = renamed.get(op.operationId) ?? [];
    minted.push(newId);
    renamed.set(op.operationId, minted);
    return {
      ...op,
      operationId: newId,
      oasOperation: {
        ...op.oasOperation,
        operationId: newId,
        // Traceability back to the source id (mirrors x-amvs-format-of).
        'x-amvs-renamed-from': op.operationId,
      } as ParsedOasOperation['oasOperation'],
    };
  });

  return {
    inventory: { ...inventory, operations },
    renamed,
  };
}
