/**
 * SQL Server profiler -- row counts + null-rate + sample probes over the
 * sidecar's {@code /query} endpoint.
 *
 * Spec: SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11),
 * task 2.1.
 *
 * The probe SQL is the SAME as the Sybase profiler's and that is deliberate,
 * not lazy: every statement it issues (`SELECT COUNT(*)`, `SUM(CASE WHEN ...)`,
 * `SELECT TOP 5`, `CONVERT(varchar(64), MIN(col))`, `COUNT(DISTINCT col)`,
 * `[bracketed]` identifiers) is valid T-SQL on SQL Server verbatim -- the
 * bracket quoting form was chosen for the ASE path precisely because it is
 * the Microsoft-compatible one. Keeping the two profilers textually parallel
 * means a probe fix lands the same way on both engines.
 *
 * The ONE engine difference is {@link isOrderedType}: SQL Server adds
 * `datetime2`, `datetimeoffset` and `uniqueidentifier` to the ordered set.
 * `datetime2` / `datetimeoffset` are ordered temporal types the ASE list
 * never had to name, and `uniqueidentifier` has a well-defined (if unusual)
 * SQL Server sort order, so MIN/MAX on it is a real, useful bound.
 *
 * Mode ladder mirrors the other packs (spec D8):
 *   - `none`     -- caller skips the profiler entirely.
 *   - `basic`    -- row count only.
 *   - `standard` -- row count + per-column null rate + sample values
 *                   (TOP 5, redacted on the finding emit path).
 *   - `deep`     -- standard + distinct count.
 *
 * Sample value content is forwarded raw from the sidecar; redaction is
 * applied inside {@code mssqlFindings} before the value reaches a Finding
 * payload.
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
import type { SidecarCredentials } from '../sidecarClient';
import { callSidecarQuery } from '../sidecarClient';
import { redactSnippet } from '../../../utils/snippetRedaction';

/**
 * Sentinel-value detection set. Same as the Postgres / Sybase packs.
 */
const SENTINEL_VALUES: ReadonlySet<string> = new Set([
  '9999-12-31',
  '1900-01-01',
  '-1',
  '99999999',
]);

/**
 * Quote a SQL Server identifier. The bracket form works regardless of the
 * session's QUOTED_IDENTIFIER setting.
 */
function quoteId(name: string): string {
  // Reject anything that looks like a SQL injection attempt at this layer.
  // The sidecar's SQL guard will catch it again, but we fail fast here.
  if (!/^[A-Za-z_][A-Za-z0-9_$#@]*$/.test(name)) {
    throw new Error(`SQL Server identifier rejected by quoteId: '${name}'`);
  }
  return `[${name}]`;
}

/**
 * Detect whether a column data type looks ordered (numeric, date, time).
 *
 * SQL Server additions over the ASE list:
 *   - `datetime2` / `datetimeoffset` -- the high-precision temporal types
 *     (already matched by the `date` / `time` substrings, but named here so
 *     the intent is explicit and a future substring change cannot silently
 *     drop them).
 *   - `uniqueidentifier` -- SQL Server orders GUIDs by its own documented
 *     byte-group comparison, so MIN/MAX returns a real bound.
 */
function isOrderedType(dataType: string): boolean {
  const dt = (dataType ?? '').toLowerCase();
  return (
    dt.includes('int') ||
    dt.includes('numeric') ||
    dt.includes('decimal') ||
    dt.includes('money') ||
    dt.includes('float') ||
    dt.includes('real') ||
    dt.includes('double') ||
    dt.includes('date') ||
    dt.includes('time') ||
    dt.includes('smalldatetime') ||
    dt.includes('datetime') ||
    dt.includes('datetime2') ||
    dt.includes('datetimeoffset') ||
    dt.includes('uniqueidentifier')
  );
}

/**
 * Resolve a sensible timeout (5..300s clamp).
 */
function resolveTimeoutSeconds(config: DatabaseDiscoveryConfig): number {
  return Math.max(5, Math.min(config.queryTimeoutSeconds || 30, 300));
}

/**
 * Group columns by `${schema}.${table}` for per-table probing.
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
 * Profile a single SQL Server table.
 *
 * Each probe is wrapped in its own try/catch so a failure on one column
 * does not throw the whole table away. Failures simply leave the
 * corresponding field undefined / null in the {@link ColumnProfile}.
 */
async function profileOneTable(
  creds: SidecarCredentials,
  table: TableMetadata,
  columnsForTable: ColumnMetadata[],
  mode: ProfilingMode,
  config: DatabaseDiscoveryConfig,
): Promise<TableProfile> {
  const timeoutSec = resolveTimeoutSeconds(config);
  const qSchema = quoteId(table.schemaName);
  const qTable = quoteId(table.tableName);
  const fullName = `${qSchema}.${qTable}`;

  const profile: TableProfile = {
    schemaName: table.schemaName,
    tableName: table.tableName,
    rowCount: null,
    columnProfiles: [],
  };

  // ----- row count -----
  try {
    const sql = `SELECT COUNT(*) AS n FROM ${fullName}`;
    const r = await callSidecarQuery(creds, {
      sql,
      queryTimeoutSeconds: timeoutSec,
      maxRows: 1,
    });
    const n = (r.rows[0] ?? {}).n;
    profile.rowCount = typeof n === 'number' ? n : Number(n) || null;
  } catch {
    profile.rowCount = null;
  }

  if (mode === 'basic') {
    return profile;
  }

  // ----- per-column probes -----
  for (const column of columnsForTable) {
    const cp: ColumnProfile = {
      schemaName: column.schemaName,
      tableName: column.tableName,
      columnName: column.columnName,
    };
    let qCol: string;
    try {
      qCol = quoteId(column.columnName);
    } catch {
      // Unknown / unsafe column name -- skip this column entirely.
      profile.columnProfiles.push(cp);
      continue;
    }

    // Null rate.
    try {
      const sql = `SELECT COUNT(*) AS n, SUM(CASE WHEN ${qCol} IS NULL THEN 1 ELSE 0 END) AS nulls FROM ${fullName}`;
      const r = await callSidecarQuery(creds, {
        sql,
        queryTimeoutSeconds: timeoutSec,
        maxRows: 1,
      });
      const total = Number((r.rows[0] ?? {}).n ?? 0);
      const nulls = Number((r.rows[0] ?? {}).nulls ?? 0);
      cp.nullRate = total > 0 ? nulls / total : null;
    } catch {
      cp.nullRate = null;
    }

    // Sample values (standard+). `SELECT TOP 5` is the Microsoft form the
    // ASE path already uses, so the statement is identical on both engines.
    try {
      const sql = `SELECT TOP 5 ${qCol} FROM ${fullName} WHERE ${qCol} IS NOT NULL`;
      const r = await callSidecarQuery(creds, {
        sql,
        queryTimeoutSeconds: timeoutSec,
        maxRows: 5,
      });
      const seen = new Set<string>();
      const samples: string[] = [];
      for (const row of r.rows ?? []) {
        const v = (row as Record<string, unknown>)[column.columnName];
        const asString = v === null || v === undefined ? 'NULL' : String(v);
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

    if (isOrderedType(column.dataType)) {
      try {
        const sql = `SELECT CONVERT(varchar(64), MIN(${qCol})) AS min_v, CONVERT(varchar(64), MAX(${qCol})) AS max_v FROM ${fullName}`;
        const r = await callSidecarQuery(creds, {
          sql,
          queryTimeoutSeconds: timeoutSec,
          maxRows: 1,
        });
        const minV = (r.rows[0] ?? {}).min_v;
        const maxV = (r.rows[0] ?? {}).max_v;
        cp.minValue = minV == null ? null : String(minV);
        cp.maxValue = maxV == null ? null : String(maxV);
      } catch {
        cp.minValue = null;
        cp.maxValue = null;
      }
    }

    if (mode === 'deep') {
      try {
        const sql = `SELECT COUNT(DISTINCT ${qCol}) AS dc FROM ${fullName}`;
        const r = await callSidecarQuery(creds, {
          sql,
          queryTimeoutSeconds: timeoutSec,
          maxRows: 1,
        });
        const dc = (r.rows[0] ?? {}).dc;
        cp.distinctCount = dc == null ? null : Number(dc);
      } catch {
        cp.distinctCount = null;
      }
    }

    profile.columnProfiles.push(cp);
  }

  return profile;
}

/**
 * Run the profiler over every introspected table (subject to
 * {@code maxTablesToProfile}). Per-table soft-fail.
 */
export async function profileMssqlTables(
  creds: SidecarCredentials,
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
    const cols =
      columnsByTable.get(`${table.schemaName}.${table.tableName}`) ?? [];
    try {
      const profile = await profileOneTable(creds, table, cols, mode, config);
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

// Re-export internals for unit tests.
export const __testOnly = { isOrderedType, quoteId };
