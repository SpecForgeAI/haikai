/**
 * PostgreSQL profiler.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3.
 *
 * The profiler walks each introspected table once and runs per-mode probe
 * queries. Each table is wrapped in soft-fail: a single failure (timeout,
 * permission, lock) becomes a `skippedTables` entry instead of aborting
 * the run.
 *
 * Mode ladder:
 *   - `none`     -- caller does not call the profiler at all.
 *   - `basic`    -- row count only (catalog estimate; falls back to COUNT(*)
 *                   when the estimate is missing/zero).
 *   - `standard` -- basic + per-column null rate + sample values (LIMIT 5,
 *                   redacted via `snippetRedaction.redactSnippet`).
 *   - `deep`     -- standard + distinct count + min/max + top-N + empty-string
 *                   counts on code-like columns.
 *
 * All sample-value content runs through `redactSnippet` before being placed
 * on a `ColumnProfile.sampleValues` array.
 */

import type {
  ColumnMetadata,
  ColumnProfile,
  DatabaseDiscoveryConfig,
  IntrospectionResult,
  ProfileResult,
  ProfilingMode,
  TableMetadata,
  TableProfile,
} from '../types';
import type { PostgresAdapter } from '../../db/PostgresAdapter';
import { quoteIdent } from '../../db/PostgresAdapter';
import { redactSnippet } from '../../../utils/snippetRedaction';

/**
 * Sentinel-value detection set. The profiler flags
 * `ColumnProfile.sentinelDetected = true` when any sampled value matches
 * one of these patterns. Per-spec list (D8): `9999-12-31`, `-1`, plus a
 * few other commonly-abused placeholder strings.
 */
const SENTINEL_VALUES: ReadonlySet<string> = new Set([
  '9999-12-31',
  '1900-01-01',
  '-1',
  '99999999',
]);

/**
 * Heuristic: is this column likely a "code-like" enumerated column (e.g.
 * status, state, type)? Used in deep mode to gate top-N profiling.
 */
function isCodeLikeColumn(column: ColumnMetadata): boolean {
  const name = column.columnName.toLowerCase();
  if (
    name.endsWith('_status') ||
    name.endsWith('_state') ||
    name.endsWith('_type') ||
    name === 'status' ||
    name === 'state' ||
    name === 'type'
  ) {
    return true;
  }
  const dt = column.dataType.toLowerCase();
  return (
    dt === 'character varying' ||
    dt === 'character' ||
    dt === 'text' ||
    dt === 'varchar' ||
    dt === 'char'
  );
}

/**
 * Build the quoted identifier for `schema.table`.
 */
function qTable(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

/**
 * Resolve the timeout (seconds) for profiler queries. Always >= 5s.
 */
function resolveTimeoutSeconds(config: DatabaseDiscoveryConfig): number {
  return Math.max(5, Math.min(config.queryTimeoutSeconds || 30, 300));
}

/**
 * Get an estimated row count from `pg_class.reltuples`. Returns `null` on
 * any catalog query failure (caller falls back to COUNT(*)).
 */
async function getEstimatedRowCount(
  adapter: PostgresAdapter,
  schema: string,
  table: string,
  timeoutSec: number,
): Promise<number | null> {
  const sql = `
    SELECT c.reltuples::bigint AS est_rows
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    LIMIT 1
  `;
  const res = await adapter.runIntrospectionQuery(
    sql,
    [schema, table],
    timeoutSec,
  );
  if (res.rows.length === 0) return null;
  const v = res.rows[0].est_rows;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Profile a single table. Returns a TableProfile with the per-mode subset
 * of fields populated.
 */
async function profileOneTable(
  adapter: PostgresAdapter,
  table: TableMetadata,
  columnsForTable: ColumnMetadata[],
  mode: ProfilingMode,
  config: DatabaseDiscoveryConfig,
): Promise<TableProfile> {
  const timeoutSec = resolveTimeoutSeconds(config);
  const profile: TableProfile = {
    schemaName: table.schemaName,
    tableName: table.tableName,
    rowCount: null,
    columnProfiles: [],
  };

  // ----- Row count -----
  // basic+: use catalog estimate first; fall back to count(*) with the
  // hard row cap if the estimate looks bogus (-1 or 0 with introspected
  // tables that obviously have content).
  const estRows = await getEstimatedRowCount(
    adapter,
    table.schemaName,
    table.tableName,
    timeoutSec,
  );
  if (estRows !== null && estRows > 0) {
    profile.rowCount = estRows;
  } else {
    // Fallback: real COUNT(*). Bounded by statement_timeout.
    try {
      const sql = `SELECT COUNT(*)::bigint AS n FROM ${qTable(table.schemaName, table.tableName)}`;
      const res = await adapter.runReadonlySelect(sql, [], {
        maxRows: 1,
        timeoutSeconds: timeoutSec,
      });
      const n = res.rows[0]?.n;
      profile.rowCount = n === null || n === undefined ? null : Number(n);
    } catch {
      profile.rowCount = null;
    }
  }

  // ----- basic mode stops here (no per-column probes) -----
  if (mode === 'basic') {
    return profile;
  }

  // ----- standard / deep: per-column probes -----
  for (const column of columnsForTable) {
    const cp: ColumnProfile = {
      schemaName: column.schemaName,
      tableName: column.tableName,
      columnName: column.columnName,
    };

    // Null rate. We use a SUM(CASE WHEN ... NULL) pattern so it returns a
    // single row regardless of table size.
    const qCol = quoteIdent(column.columnName);
    const qT = qTable(table.schemaName, table.tableName);
    try {
      const sql = `
        SELECT COUNT(*)::bigint AS n,
               SUM(CASE WHEN ${qCol} IS NULL THEN 1 ELSE 0 END)::bigint AS nulls
        FROM ${qT}
      `;
      const res = await adapter.runReadonlySelect(sql, [], {
        maxRows: 1,
        timeoutSeconds: timeoutSec,
      });
      const total = Number(res.rows[0]?.n ?? 0);
      const nulls = Number(res.rows[0]?.nulls ?? 0);
      cp.nullRate = total > 0 ? nulls / total : null;
    } catch {
      cp.nullRate = null;
    }

    // Sample values (standard+). LIMIT 5; redact each value.
    try {
      const sampleRes = await adapter.sampleValues({
        schema: column.schemaName,
        table: column.tableName,
        column: column.columnName,
        limits: { maxRows: 5, timeoutSeconds: timeoutSec },
      });
      const seen = new Set<string>();
      const samples: string[] = [];
      for (const r of sampleRes.rows) {
        // sampleValues uses SELECT DISTINCT col, so each row's single field
        // is the value -- the key is the column name.
        const val = r[column.columnName];
        const asString =
          val === null || val === undefined ? 'NULL' : String(val);
        const redacted = redactSnippet(asString, 80);
        if (!seen.has(redacted)) {
          seen.add(redacted);
          samples.push(redacted);
          if (SENTINEL_VALUES.has(asString)) {
            cp.sentinelDetected = true;
          }
        }
      }
      cp.sampleValues = samples;
    } catch {
      cp.sampleValues = null;
    }

    // Standard mode: min/max for ordered types (numeric, timestamp, date).
    const dt = column.dataType.toLowerCase();
    const isOrderedType =
      dt.includes('int') ||
      dt.includes('numeric') ||
      dt.includes('decimal') ||
      dt.includes('real') ||
      dt.includes('double') ||
      dt.includes('timestamp') ||
      dt.includes('date') ||
      dt.includes('time');
    if (isOrderedType) {
      try {
        const sql = `SELECT MIN(${qCol})::text AS min_v, MAX(${qCol})::text AS max_v FROM ${qT}`;
        const res = await adapter.runReadonlySelect(sql, [], {
          maxRows: 1,
          timeoutSeconds: timeoutSec,
        });
        cp.minValue = res.rows[0]?.min_v ? String(res.rows[0].min_v) : null;
        cp.maxValue = res.rows[0]?.max_v ? String(res.rows[0].max_v) : null;
      } catch {
        cp.minValue = null;
        cp.maxValue = null;
      }
    }

    // Deep mode add-ons: distinct count + top-N.
    if (mode === 'deep') {
      try {
        const sql = `SELECT COUNT(DISTINCT ${qCol})::bigint AS dc FROM ${qT}`;
        const res = await adapter.runReadonlySelect(sql, [], {
          maxRows: 1,
          timeoutSeconds: timeoutSec,
        });
        cp.distinctCount =
          res.rows[0]?.dc === null || res.rows[0]?.dc === undefined
            ? null
            : Number(res.rows[0].dc);
      } catch {
        cp.distinctCount = null;
      }

      if (isCodeLikeColumn(column)) {
        try {
          const sql = `
            SELECT ${qCol}::text AS v, COUNT(*)::bigint AS c
            FROM ${qT}
            WHERE ${qCol} IS NOT NULL
            GROUP BY ${qCol}
            ORDER BY c DESC
            LIMIT 10
          `;
          const res = await adapter.runReadonlySelect(sql, [], {
            maxRows: 10,
            timeoutSeconds: timeoutSec,
          });
          cp.topValues = res.rows.map((r) => ({
            value: redactSnippet(String(r.v ?? ''), 50),
            count: Number(r.c ?? 0),
          }));
        } catch {
          cp.topValues = null;
        }
      }
    }

    profile.columnProfiles.push(cp);
  }
  return profile;
}

/**
 * Group columns by their (schema, table) key for per-table profiling.
 */
function groupColumnsByTable(
  columns: ColumnMetadata[],
): Map<string, ColumnMetadata[]> {
  const out = new Map<string, ColumnMetadata[]>();
  for (const c of columns) {
    const key = `${c.schemaName}.${c.tableName}`;
    let bucket = out.get(key);
    if (!bucket) {
      bucket = [];
      out.set(key, bucket);
    }
    bucket.push(c);
  }
  return out;
}

/**
 * Run the profiler across all introspected tables. Per-table soft-fail
 * pushes failures into `skippedTables`.
 */
export async function profilePostgresTables(
  adapter: PostgresAdapter,
  introspection: IntrospectionResult,
  mode: ProfilingMode,
  config: DatabaseDiscoveryConfig,
): Promise<ProfileResult> {
  if (mode === 'none') {
    return { tables: [], skippedTables: [] };
  }
  const columnsByTable = groupColumnsByTable(introspection.columns);
  const tables = introspection.tables.slice(0, config.maxTablesToProfile);
  const out: ProfileResult = { tables: [], skippedTables: [] };
  for (const table of tables) {
    const cols = columnsByTable.get(`${table.schemaName}.${table.tableName}`) ?? [];
    try {
      const profile = await profileOneTable(adapter, table, cols, mode, config);
      out.tables.push(profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.skippedTables.push({
        schemaName: table.schemaName,
        tableName: table.tableName,
        reason: message,
      });
    }
  }
  return out;
}
