/**
 * Mutating-endpoint STATE-DELTA capture & comparison (Spec 2026-07-06-n —
 * Code-Tier Oracle Program).
 *
 * Response parity alone cannot prove a write endpoint: a target
 * implementation can return the right response and write the wrong rows.
 * For mutating scenarios the oracle is response parity AND state parity:
 *
 *   - CAPTURE side: snapshot the endpoint's EFFECT TABLES (from the
 *     committed endpoint_data_effects — discovery tells us exactly which
 *     tables a write touches) before + after the mutating call, and persist
 *     the delta (`state_delta_json`) on the capture / baseline item.
 *   - REPLAY side: the same snapshots on the TARGET database around the
 *     replayed call.
 *   - DIFF side: `compareStateDeltas` — identical per-table row-count deltas
 *     (and keyed rows when the ladder captured them) => `state_match`;
 *     mismatch => `state_drift`; either side missing a delta =>
 *     `state_unverified` (FAIL-CLOSED: never a silent pass).
 *
 * SNAPSHOT LADDER (bounded, deterministic, SELECT-only through the
 * sqlGuard-enforcing adapter):
 *   1. row COUNT per effect table (always).
 *   2. KEYED ROW capture when the response body exposes an id-ish value and
 *      the table's metadata names a matching column (best-effort; strategy
 *      recorded).
 * Full-table checksums are NOT attempted (unbounded); the strategy field
 * makes the coverage level explicit — nothing silent.
 */

import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import type { DbAdapter } from './db/DbAdapter';
import type { DbQueryLimits } from '../types/db';

// ---------------------------------------------------------------------------
// Effect scope: (METHOD, path template) -> physical table names
// ---------------------------------------------------------------------------

export interface EffectScopeIndex {
  /** key `${METHOD} ${pathTemplate}` -> physical table names (deduped). */
  tablesByOperationKey: Map<string, string[]>;
  /** Foundations Spec 3 (2026-08-22): per-operation effect tables REMOVED by
   *  migration scope (excluded/volatile), with the decision receipt — the
   *  preflight surfaces operations whose entire map was scoped away as
   *  explicit conflicts instead of generic no_effect_map refusals. */
  scopeExcludedByOperationKey?: Map<
    string,
    Array<{ table: string; scope: string; decision_ref: string | null }>
  >;
  /**
   * Operation keys whose committed effect edges are READ-mode (proven-read
   * classification, 2026-08-20): a write-verb endpoint mapped ONLY as reads
   * is a POST-implemented query — it needs no write map, is never refused,
   * and fires without a bracket. The end-of-job S0 fingerprint remains the
   * safety net if the proof were ever wrong.
   */
  readMappedOperationKeys: Set<string>;
  /**
   * key `${METHOD} ${pathTemplate}` -> tables the op's committed edges hold
   * as READ-mode (2026-08-26): when the end-of-job fingerprint fails on a
   * table, the ops that READ it are the prime suspects for a missed write
   * edge (the legacy read-then-write idiom whose INSERT the mining lost) —
   * the failure detail names them instead of leaving the operator to infer.
   */
  readTablesByOperationKey?: Map<string, string[]>;
}

interface RawModel {
  metaModel?: {
    entities?: {
      endpoints?: Array<{
        id?: string;
        path_or_address?: string;
        operation_verb?: string;
      }>;
      physical_data_entities?: Array<{ id?: string; name?: string }>;
    };
    relationships?: {
      endpoint_data_effects?: Array<{
        endpoint_id?: string;
        access_mode?: string;
        data_entity_point_id?: string;
      }>;
    };
  };
}

/**
 * Build the effect-scope index from ONE committed-model read. Only WRITE
 * edges (`write` / `read-write`) contribute — a read-only endpoint has no
 * state to delta. Returns null on any read failure (callers degrade to
 * no-snapshot, which the diff surfaces as `state_unverified`).
 */
/** PURE builder (exported for tests; Foundations Spec 3 added the scope
 *  filter): excluded/volatile tables never enter the write maps — the
 *  removals are RECORDED per operation with the decision receipt so the
 *  preflight can cite them. */
export function buildEffectScopeIndexFromModel(model: RawModel): EffectScopeIndex {
  const tableByEntityId = new Map<string, string>();
  const scopeByEntityId = new Map<string, { scope: string; decision_ref: string | null }>();
  for (const entity of model.metaModel?.entities?.physical_data_entities ?? []) {
    if (!entity.id || !entity.name) continue;
    tableByEntityId.set(entity.id, entity.name);
    const raw = ((entity as { migration_scope?: string | null }).migration_scope ?? '')
      .toString()
      .toLowerCase();
    if (raw === 'excluded' || raw === 'volatile') {
      scopeByEntityId.set(entity.id, {
        scope: raw,
        decision_ref:
          ((entity as { scope_decision_ref?: string | null }).scope_decision_ref ?? null) as
            | string
            | null,
      });
    }
  }
  const endpointKeyById = new Map<string, string>();
  for (const endpoint of model.metaModel?.entities?.endpoints ?? []) {
    if (!endpoint.id) continue;
    const verb = (endpoint.operation_verb ?? '').toUpperCase();
    const path = endpoint.path_or_address ?? '';
    if (verb && path) endpointKeyById.set(endpoint.id, `${verb} ${path}`);
  }

  const tablesByOperationKey = new Map<string, string[]>();
  const scopeExcludedByOperationKey: EffectScopeIndex['scopeExcludedByOperationKey'] = new Map();
  const readMappedOperationKeys = new Set<string>();
  const readTablesByOperationKey = new Map<string, string[]>();
  for (const edge of model.metaModel?.relationships?.endpoint_data_effects ?? []) {
    const mode = (edge.access_mode ?? '').toLowerCase();
    const key = edge.endpoint_id ? endpointKeyById.get(edge.endpoint_id) : undefined;
    if (!key) continue;
    if (mode === 'read') {
      // Proven-read classification (2026-08-20): the edge itself is enough
      // for the no-bracket ruling — but the TABLE is kept too (2026-08-26),
      // so a fingerprint failure on it can name this op as a suspect for a
      // missed write edge.
      readMappedOperationKeys.add(key);
      const readPointId = edge.data_entity_point_id ?? '';
      const readTable = tableByEntityId.get(readPointId.replace(/^dep_(phy|log)_/, ''));
      if (readTable) {
        const reads = readTablesByOperationKey.get(key) ?? [];
        if (!reads.includes(readTable)) reads.push(readTable);
        readTablesByOperationKey.set(key, reads);
      }
      continue;
    }
    if (mode !== 'write' && mode !== 'read-write') continue;
    const pointId = edge.data_entity_point_id ?? '';
    const entityId = pointId.replace(/^dep_(phy|log)_/, '');
    const table = tableByEntityId.get(entityId);
    if (!table) continue;
    const scoped = scopeByEntityId.get(entityId);
    if (scoped) {
      const removals = scopeExcludedByOperationKey.get(key) ?? [];
      removals.push({ table, scope: scoped.scope, decision_ref: scoped.decision_ref });
      scopeExcludedByOperationKey.set(key, removals);
      continue;
    }
    const list = tablesByOperationKey.get(key) ?? [];
    if (!list.includes(table)) list.push(table);
    tablesByOperationKey.set(key, list);
  }
  return {
    tablesByOperationKey,
    scopeExcludedByOperationKey,
    readMappedOperationKeys,
    readTablesByOperationKey,
  };
}

export async function fetchEffectScopeIndex(
  projectId: string,
  architectureId: string,
): Promise<EffectScopeIndex | null> {
  try {
    const response = await fetch(
      `${ARCHITECTURE_MODEL_SERVICE_BASE_URL}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const model = (await response.json()) as RawModel;

    return buildEffectScopeIndexFromModel(model);
  } catch {
    return null;
  }
}

/** True when the concrete (method, path) call matches a READ-mapped
 * operation key (template-matched, same discipline as effectTablesFor). */
export function isReadMappedOperation(
  index: EffectScopeIndex,
  method: string,
  path: string,
): boolean {
  const verb = method.toUpperCase();
  for (const key of index.readMappedOperationKeys) {
    const spaceAt = key.indexOf(' ');
    if (key.slice(0, spaceAt) !== verb) continue;
    if (pathMatchesTemplate(path, key.slice(spaceAt + 1))) return true;
  }
  return false;
}

/** Concrete captured path vs committed template (`/owners/{id}`). */
function pathMatchesTemplate(concrete: string, template: string): boolean {
  const c = concrete.split('?')[0].replace(/\/+$/, '');
  const t = template.split('?')[0].replace(/\/+$/, '');
  if (c === t) return true;
  const pattern = t
    .split('/')
    .map((seg) => (/^\{.+\}$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}$`).test(c);
}

/** The effect tables for a concrete (method, path) call, template-matched. */
export function effectTablesFor(
  index: EffectScopeIndex,
  method: string,
  path: string,
): string[] {
  const verb = method.toUpperCase();
  for (const [key, tables] of index.tablesByOperationKey) {
    const spaceAt = key.indexOf(' ');
    const keyVerb = key.slice(0, spaceAt);
    const keyPath = key.slice(spaceAt + 1);
    if (keyVerb === verb && pathMatchesTemplate(path, keyPath)) return tables;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Identifier guard: snapshots interpolate table names — never user input. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.$]*$/;

export interface TableSnapshot {
  table: string;
  count: number | null;
  keyed_row: Record<string, unknown> | null;
  key_column: string | null;
  key_value: string | null;
  error: string | null;
}

export interface StateSnapshot {
  tables: TableSnapshot[];
}

const SNAPSHOT_LIMITS: DbQueryLimits = { maxRows: 5, timeoutSeconds: 10 };

/**
 * Snapshot the effect tables: COUNT always; a KEYED ROW when `keyHint`
 * (id-ish value from the response) matches a column named like an id.
 * Per-table failures are recorded on the snapshot — never thrown, never
 * silent.
 */
export async function snapshotEffectTables(
  adapter: DbAdapter,
  tables: string[],
  keyHint?: { column: string; value: string } | null,
): Promise<StateSnapshot> {
  const out: TableSnapshot[] = [];
  for (const table of tables) {
    if (!SAFE_IDENTIFIER.test(table)) {
      out.push({
        table,
        count: null,
        keyed_row: null,
        key_column: null,
        key_value: null,
        error: 'unsafe table identifier — snapshot refused',
      });
      continue;
    }
    let count: number | null = null;
    let error: string | null = null;
    try {
      const result = await adapter.runReadonlySelect(
        `SELECT COUNT(*) AS row_count FROM ${table}`,
        [],
        SNAPSHOT_LIMITS,
      );
      const first = result.rows?.[0] ?? {};
      const raw = first.row_count ?? first.ROW_COUNT ?? Object.values(first)[0];
      const parsed = Number(raw);
      count = Number.isFinite(parsed) ? parsed : null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    let keyedRow: Record<string, unknown> | null = null;
    if (keyHint && SAFE_IDENTIFIER.test(keyHint.column) && error === null) {
      try {
        // ENGINE-PORTABLE literal predicate (gold standard 2026-08-07): the
        // old `?` placeholder worked on NEITHER adapter — the Sybase adapter
        // REFUSES params outright and Postgres expects `$1` — so the keyed
        // rung silently degraded to counts-only everywhere. The id-ish value
        // is embedded as a quote-doubled literal (both engines coerce a
        // quoted literal against numeric key columns); the SELECT-only guard
        // still applies.
        const literal = `'${String(keyHint.value).replace(/'/g, "''")}'`;
        const result = await adapter.runReadonlySelect(
          `SELECT * FROM ${table} WHERE ${keyHint.column} = ${literal}`,
          [],
          SNAPSHOT_LIMITS,
        );
        keyedRow = result.rows?.[0] ?? null;
      } catch {
        keyedRow = null; // keyed capture is best-effort; count remains
      }
    }

    out.push({
      table,
      count,
      keyed_row: keyedRow,
      key_column: keyHint?.column ?? null,
      key_value: keyHint?.value ?? null,
      error,
    });
  }
  return { tables: out };
}

/** Extract an id-ish key hint from a response body (best-effort, honest). */
export function keyHintFromResponse(
  body: unknown,
): { column: string; value: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const name of ['id', 'ID', 'Id']) {
    const value = record[name];
    if (typeof value === 'number' || (typeof value === 'string' && /^[\w-]+$/.test(value))) {
      return { column: 'id', value: String(value) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Delta + comparison
// ---------------------------------------------------------------------------

export interface StateDeltaJson {
  strategy: 'counts' | 'counts+keyed';
  tables: Array<{
    table: string;
    count_before: number | null;
    count_after: number | null;
    count_delta: number | null;
    keyed_row_after: Record<string, unknown> | null;
    key_column: string | null;
    key_value: string | null;
    error: string | null;
  }>;
}

export function computeStateDelta(pre: StateSnapshot, post: StateSnapshot): StateDeltaJson {
  const postByTable = new Map(post.tables.map((t) => [t.table, t]));
  let anyKeyed = false;
  const tables = pre.tables.map((before) => {
    const after = postByTable.get(before.table);
    const keyedRowAfter = after?.keyed_row ?? null;
    if (keyedRowAfter) anyKeyed = true;
    const delta =
      before.count !== null && after?.count != null ? after.count - before.count : null;
    return {
      table: before.table,
      count_before: before.count,
      count_after: after?.count ?? null,
      count_delta: delta,
      keyed_row_after: keyedRowAfter,
      key_column: after?.key_column ?? before.key_column,
      key_value: after?.key_value ?? before.key_value,
      error: before.error ?? after?.error ?? null,
    };
  });
  return { strategy: anyKeyed ? 'counts+keyed' : 'counts', tables };
}

export type StateClassification = 'state_match' | 'state_drift' | 'state_unverified';

export interface StateComparison {
  classification: StateClassification;
  detail: Array<{ table: string; kind: string; source: unknown; target: unknown }>;
}

/**
 * Compare source vs target deltas. Per-table: count_delta must match; when
 * BOTH sides captured a keyed row, the rows must match modulo
 * `volatileColumns` (identity/timestamp columns — lowercase names). A table
 * with a snapshot ERROR or a null delta on either side is UNVERIFIED
 * (fail-closed).
 */
export function compareStateDeltas(
  source: StateDeltaJson | null | undefined,
  target: StateDeltaJson | null | undefined,
  volatileColumns: Set<string> = new Set(['id', 'created_at', 'updated_at', 'timestamp']),
): StateComparison {
  if (!source || !target) {
    return { classification: 'state_unverified', detail: [] };
  }
  const targetByTable = new Map(target.tables.map((t) => [t.table, t]));
  const detail: StateComparison['detail'] = [];
  let unverified = false;

  for (const s of source.tables) {
    const t = targetByTable.get(s.table);
    if (!t || s.error || t.error || s.count_delta === null || t.count_delta === null) {
      unverified = true;
      detail.push({
        table: s.table,
        kind: 'unverified',
        source: s.error ?? s.count_delta,
        target: t?.error ?? t?.count_delta ?? 'missing',
      });
      continue;
    }
    if (s.count_delta !== t.count_delta) {
      detail.push({
        table: s.table,
        kind: 'count_delta_mismatch',
        source: s.count_delta,
        target: t.count_delta,
      });
      continue;
    }
    if (s.keyed_row_after && t.keyed_row_after) {
      const columns = new Set([
        ...Object.keys(s.keyed_row_after),
        ...Object.keys(t.keyed_row_after),
      ]);
      for (const column of columns) {
        if (volatileColumns.has(column.toLowerCase())) continue;
        const sv = s.keyed_row_after[column];
        const tv = t.keyed_row_after[column];
        if (JSON.stringify(sv) !== JSON.stringify(tv)) {
          detail.push({
            table: s.table,
            kind: `keyed_column_mismatch:${column}`,
            source: sv,
            target: tv,
          });
        }
      }
    }
  }

  const drift = detail.some((d) => d.kind !== 'unverified');
  if (drift) return { classification: 'state_drift', detail };
  if (unverified) return { classification: 'state_unverified', detail };
  return { classification: 'state_match', detail };
}
