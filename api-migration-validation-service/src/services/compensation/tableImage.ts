/**
 * Full-row table imaging (Capture-State Discipline Spec 1).
 *
 * The before/after/verify images are complete PK-keyed row maps built with the
 * EXISTING read-only adapter's deterministic keyset pagination
 * (`fetchOrderedRows`, NULLS-LOW ascending over the primary key) — the same
 * machinery the data-parity comparator trusts. Reads go through the read-only
 * adapter (SELECT-only guard intact); nothing here writes.
 *
 * BOUNDED, FAIL-CLOSED: a table whose live row count exceeds the CONFIG cap
 * (`COMPENSATION_FULL_IMAGE_MAX_ROWS`) refuses with `table_too_large` — the
 * v1 ladder has exactly one rung (full image) and says so loudly rather than
 * degrading to a diff it cannot verify. Raising the cap is a CONFIG decision.
 */

import {
  COMPENSATION_FULL_IMAGE_MAX_ROWS,
  COMPENSATION_IMAGE_PAGE_ROWS,
  COMPENSATION_STATEMENT_TIMEOUT_SECONDS,
} from '../../config';
import type { DbAdapter } from '../db/DbAdapter';
import { MAX_SINGLE_FETCH_ROWS } from '../db/DbAdapter';
import type { CompensationRefusal, CompensationTableMeta, TableImage } from './types';

/** Identifier guard — table/column names are interpolated, never user input. */
export const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.$]*$/;

/** Deterministic PK-tuple key: JSON array of stringified pk values. */
export function pkKeyOf(row: Record<string, unknown>, pkColumns: string[]): string {
  return JSON.stringify(pkColumns.map((c) => valueForColumn(row, c)).map(stringifyKeyPart));
}

function stringifyKeyPart(v: unknown): string {
  if (v === null || v === undefined) return '\u0000null';
  return String(v);
}

/** Column lookup tolerant of case-mangling between engines/drivers. */
export function valueForColumn(row: Record<string, unknown>, column: string): unknown {
  if (column in row) return row[column];
  const lower = column.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lower) return row[key];
  }
  return undefined;
}

export interface TableImageResult {
  image: TableImage | null;
  refusal: CompensationRefusal | null;
}

/**
 * Image one table completely. `schema` rides through to the adapter (Sybase
 * SIT tables typically resolve without one; the Postgres target uses its
 * configured schema).
 */
export async function captureTableImage(
  adapter: DbAdapter,
  meta: CompensationTableMeta,
  schema?: string | null,
): Promise<TableImageResult> {
  const refuse = (reason: CompensationRefusal['reason'], detail: string): TableImageResult => ({
    image: null,
    refusal: { table: meta.table, reason, detail },
  });

  if (!SAFE_IDENTIFIER.test(meta.table)) {
    return refuse('unsafe_identifier', `table identifier rejected: ${meta.table}`);
  }
  if (meta.pkColumns.length === 0) {
    return refuse(
      'missing_pk',
      'no primary key in the committed model (constraints_metadata.primary_key / is_primary_key) — ' +
        'an unkeyed table cannot be row-diffed; remedy: harvest/save-back the PK, then re-run',
    );
  }
  for (const col of meta.pkColumns) {
    if (!SAFE_IDENTIFIER.test(col)) {
      return refuse('unsafe_identifier', `pk column identifier rejected: ${col}`);
    }
  }

  const limits = {
    maxRows: Math.min(COMPENSATION_IMAGE_PAGE_ROWS, MAX_SINGLE_FETCH_ROWS),
    timeoutSeconds: COMPENSATION_STATEMENT_TIMEOUT_SECONDS,
  };

  let liveCount: number;
  try {
    liveCount = await adapter.countRows({ schema: schema ?? null, table: meta.table, limits });
  } catch (err) {
    return refuse('image_read_failed', err instanceof Error ? err.message : String(err));
  }
  if (liveCount > COMPENSATION_FULL_IMAGE_MAX_ROWS) {
    return refuse(
      'table_too_large',
      `${liveCount} rows exceeds COMPENSATION_FULL_IMAGE_MAX_ROWS=${COMPENSATION_FULL_IMAGE_MAX_ROWS} — ` +
        'raise the cap (CONFIG) or accept exclusion of this endpoint from compensated capture',
    );
  }

  const typesByColumn = new Map(meta.columns.map((c) => [c.name.toLowerCase(), c.sourceType]));
  const orderByTypes = meta.pkColumns.map((c) => typesByColumn.get(c.toLowerCase()) ?? null);

  const rowsByPk = new Map<string, Record<string, unknown>>();
  let after: unknown[] | null = null;
  // countRows above bounds the loop; the +2 page slack tolerates writes racing
  // the image inside a bracket (they would surface at verify as residue).
  const maxPages = Math.ceil((liveCount + 1) / limits.maxRows) + 2;
  for (let page = 0; page < maxPages; page++) {
    let result;
    try {
      result = await adapter.fetchOrderedRows({
        schema: schema ?? null,
        table: meta.table,
        orderBy: meta.pkColumns,
        limits,
        after,
        orderByTypes,
      });
    } catch (err) {
      return refuse('image_read_failed', err instanceof Error ? err.message : String(err));
    }
    const rows = result.rows ?? [];
    for (const row of rows) {
      rowsByPk.set(pkKeyOf(row, meta.pkColumns), row);
    }
    if (rows.length < limits.maxRows) break;
    const last = rows[rows.length - 1];
    after = meta.pkColumns.map((c) => valueForColumn(last, c) ?? null);
  }

  return {
    image: { table: meta.table, pkColumns: meta.pkColumns, rowsByPk, rowCount: rowsByPk.size },
    refusal: null,
  };
}

// ---------------------------------------------------------------------------
// Scoped-row imaging primitives (state-discipline remediation Item #1,
// 2026-08-27). These never materialise a whole table: a scoped image reads
// only the rows a call can touch (WHERE <pk> = <value>), the sweep reads only
// rows above a recorded max(PK), and the guard reads aggregates. All go
// through `runReadonlySelect` (SELECT-only guard intact).
// ---------------------------------------------------------------------------

function qualifiedTable(table: string, schema?: string | null): string {
  return schema ? `${schema}.${table}` : table;
}

/** Literal rendering for scoped predicates: numbers verbatim, everything else
 *  single-quoted with quote doubling. Values originate from request params. */
export function renderScopedLiteral(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const s = String(value ?? '');
  return `'${s.replace(/'/g, "''")}'`;
}

/** Rows matching `column = value`, keyed by PK tuple. Errors surface as
 *  `error` (callers decide residue vs refusal semantics). */
export async function captureScopedRows(
  adapter: DbAdapter,
  meta: CompensationTableMeta,
  schema: string | null | undefined,
  column: string,
  value: unknown,
): Promise<{ rowsByPk: Map<string, Record<string, unknown>> | null; error: string | null }> {
  if (!SAFE_IDENTIFIER.test(meta.table) || !SAFE_IDENTIFIER.test(column)) {
    return { rowsByPk: null, error: `identifier rejected: ${meta.table}.${column}` };
  }
  try {
    const result = await adapter.runReadonlySelect(
      `SELECT * FROM ${qualifiedTable(meta.table, schema)} WHERE ${column} = ${renderScopedLiteral(value)}`,
      [],
      { maxRows: Math.min(COMPENSATION_IMAGE_PAGE_ROWS, MAX_SINGLE_FETCH_ROWS), timeoutSeconds: COMPENSATION_STATEMENT_TIMEOUT_SECONDS },
    );
    const rowsByPk = new Map<string, Record<string, unknown>>();
    for (const row of result.rows ?? []) {
      rowsByPk.set(pkKeyOf(row, meta.pkColumns), row);
    }
    return { rowsByPk, error: null };
  } catch (err) {
    return { rowsByPk: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** New-row sweep: rows whose single-column PK exceeds `above`. */
export async function captureRowsAbove(
  adapter: DbAdapter,
  meta: CompensationTableMeta,
  schema: string | null | undefined,
  pkColumn: string,
  above: number,
): Promise<{ rowsByPk: Map<string, Record<string, unknown>> | null; error: string | null }> {
  if (!SAFE_IDENTIFIER.test(meta.table) || !SAFE_IDENTIFIER.test(pkColumn)) {
    return { rowsByPk: null, error: `identifier rejected: ${meta.table}.${pkColumn}` };
  }
  try {
    const result = await adapter.runReadonlySelect(
      `SELECT * FROM ${qualifiedTable(meta.table, schema)} WHERE ${pkColumn} > ${above}`,
      [],
      { maxRows: Math.min(COMPENSATION_IMAGE_PAGE_ROWS, MAX_SINGLE_FETCH_ROWS), timeoutSeconds: COMPENSATION_STATEMENT_TIMEOUT_SECONDS },
    );
    const rowsByPk = new Map<string, Record<string, unknown>>();
    for (const row of result.rows ?? []) {
      rowsByPk.set(pkKeyOf(row, meta.pkColumns), row);
    }
    return { rowsByPk, error: null };
  } catch (err) {
    return { rowsByPk: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** max(PK) for a single-column numeric-ish PK; null when unreadable. */
export async function captureMaxOfColumn(
  adapter: DbAdapter,
  table: string,
  column: string,
  schema?: string | null,
): Promise<number | null> {
  if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) return null;
  try {
    const result = await adapter.runReadonlySelect(
      `SELECT MAX(${column}) AS max_val FROM ${qualifiedTable(table, schema)}`,
      [],
      { maxRows: 1, timeoutSeconds: COMPENSATION_STATEMENT_TIMEOUT_SECONDS },
    );
    const raw = result.rows?.[0] ? valueForColumn(result.rows[0], 'max_val') : null;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** A single-column PK whose declared type is numeric-ish — the requirement
 *  for the max(PK) sweep and guard. Identity columns qualify implicitly. */
export function sweepablePkColumn(meta: CompensationTableMeta): string | null {
  if (meta.pkColumns.length !== 1) return null;
  const pk = meta.pkColumns[0];
  const col = meta.columns.find((c) => c.name.toLowerCase() === pk.toLowerCase());
  if (!col) return null;
  if (col.isIdentity) return pk;
  const t = (col.sourceType ?? '').toLowerCase();
  return /int|numeric|decimal|number|serial|bigserial/.test(t) ? pk : null;
}
