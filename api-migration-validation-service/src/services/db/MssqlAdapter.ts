import {
  DbAdapter,
  DbAllowlist,
  DbConnectionConfig,
  DbQueryLimits,
  DbReadResult,
  DbTableMetadata,
  MAX_SINGLE_FETCH_ROWS,
} from './DbAdapter';
import { assertReadonlySelect } from './sqlGuard';
import { keysetPredicate } from './keyset';
import { DB_SIDECAR_URL } from '../../config';
import { longFetchTimeoutMs, longRunningFetch } from '../longRunningFetch';
import {
  MAX_ROUTINE_RESULT_SET_ROWS,
  type RoutineInvocationEnvelope,
  type RoutineInvocationRequest,
} from './routineEnvelope';
import { mapSidecarCallResponse, type SidecarCallResponse } from './sidecarCallEnvelope';
import type { MssqlAuth } from '../../types/db';

/**
 * `MssqlAdapter` — Node-side adapter for Microsoft SQL Server that proxies
 * every JDBC operation through the `db-discovery-sidecar` JVM HTTP service
 * (second-pair programme, Spec 3, 2026-09-11; wire contract in
 * agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/WIRE-CONTRACT.md).
 *
 * Same posture as the Sybase adapter: no JDBC in Node, literal-SQL `/query`
 * (no params), two-layer SELECT-only guard, per-request credentials, keyset
 * pagination over `fetchOrderedRows`. Dialect differences owned HERE:
 *   - identifiers are bracket-quoted (`[name]`, `]` doubled) — never subject
 *     to the QUOTED_IDENTIFIER session option;
 *   - literals: N'…' for the n-typed families, `0x…` for binary families,
 *     7-digit fractions preserved for datetime2/time/datetimeoffset cursors,
 *     uniqueidentifier quoted; numeric families unquoted (canonical-checked);
 *   - the `/call` param type rides `sourceType` (the contract's neutral key).
 */
export class MssqlAdapter implements DbAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly database: string;
  private readonly username: string;
  private readonly password: string;
  private readonly auth: MssqlAuth | null;
  private readonly sidecarBaseUrl: string;

  constructor(config: DbConnectionConfig, opts?: { sidecarBaseUrl?: string }) {
    this.host = config.host;
    this.port = config.port;
    this.database = config.database;
    this.username = config.username;
    this.password = config.password;
    this.auth = config.mssqlAuth ?? null;
    this.sidecarBaseUrl = (opts?.sidecarBaseUrl ?? DB_SIDECAR_URL).replace(/\/+$/, '');
  }

  async testConnection(): Promise<{ success: true; serverVersion?: string }> {
    const resp = await this.postJson<{
      ok: boolean;
      error?: string | null;
      serverVersion?: string | null;
      serverEdition?: string | null;
      driverUsed?: string | null;
    }>('/test-connection', this.commonCredsBody());
    if (!resp.ok) {
      throw new Error(`SQL Server sidecar testConnection failed: ${resp.error ?? 'unknown error'}`);
    }
    const version = resp.serverVersion ?? undefined;
    return {
      success: true,
      serverVersion:
        version && resp.serverEdition ? `${version} (${resp.serverEdition})` : version,
    };
  }

  async listMetadata(allowlist: DbAllowlist): Promise<DbTableMetadata[]> {
    const schemas = (allowlist.schemas ?? []).filter((s) => s && s.length > 0);
    const tables = (allowlist.tables ?? []).filter((t) => t && t.length > 0);
    if (schemas.length === 0 && tables.length === 0) {
      // Fail-closed: an empty allowlist returns zero rows (never the full DB).
      return [];
    }
    const resp = await this.postJson<{
      ok: boolean;
      error?: string | null;
      tables?: Array<{ schemaName: string; tableName: string }>;
      columns?: Array<{
        schemaName: string;
        tableName: string;
        columnName: string;
        dataType: string;
        isNullable: boolean;
      }>;
    }>('/introspect', {
      ...this.commonCredsBody(),
      includeSchemas: schemas.length > 0 ? schemas : null,
      includeTables: tables.length > 0 ? tables : null,
      queryTimeoutSeconds: 30,
    });
    if (!resp.ok) {
      throw new Error(`SQL Server sidecar introspect failed: ${resp.error ?? 'unknown error'}`);
    }
    const grouped = new Map<string, DbTableMetadata>();
    for (const t of resp.tables ?? []) {
      const key = `${t.schemaName}.${t.tableName}`;
      if (!grouped.has(key)) {
        grouped.set(key, { schema: t.schemaName, table: t.tableName, columns: [] });
      }
    }
    for (const c of resp.columns ?? []) {
      const key = `${c.schemaName}.${c.tableName}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = { schema: c.schemaName, table: c.tableName, columns: [] };
        grouped.set(key, entry);
      }
      entry.columns.push({
        schema: c.schemaName,
        table: c.tableName,
        column: c.columnName,
        dataType: c.dataType,
        isNullable: !!c.isNullable,
      });
    }
    return Array.from(grouped.values());
  }

  async runReadonlySelect(rawSql: string, params: unknown[], limits: DbQueryLimits): Promise<DbReadResult> {
    assertReadonlySelect(rawSql);
    if (Array.isArray(params) && params.length > 0) {
      throw new Error(
        'SQL Server adapter does not support parameterised queries; ' +
          'construct the SQL with literal values (or use sampleValues).',
      );
    }
    const resp = await this.postJson<{
      ok: boolean;
      error?: string | null;
      rows?: Array<Record<string, unknown>>;
      rowCount?: number;
      truncated?: boolean;
    }>('/query', {
      ...this.commonCredsBody(),
      sql: rawSql,
      queryTimeoutSeconds: Math.max(1, Math.min(Math.floor(longFetchTimeoutMs() / 1000), limits.timeoutSeconds)),
      // PAGE-SIZE guard, not a table cap: full tables are read via keyset pagination.
      maxRows: Math.max(1, Math.min(MAX_SINGLE_FETCH_ROWS, limits.maxRows)),
    });
    if (!resp.ok) {
      throw new Error(`SQL Server sidecar query failed: ${resp.error ?? 'unknown error'}`);
    }
    return {
      rows: resp.rows ?? [],
      rowCount: resp.rowCount ?? (resp.rows ? resp.rows.length : 0),
      truncated: !!resp.truncated,
    };
  }

  async sampleValues(args: {
    schema?: string | null;
    table: string;
    column: string;
    limits: DbQueryLimits;
    where?: { sql: string; params: unknown[] } | null;
  }): Promise<DbReadResult> {
    if (args.where && Array.isArray(args.where.params) && args.where.params.length > 0) {
      throw new Error('SQL Server adapter does not support parameterised where clauses; inline literal values.');
    }
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const whereClause = args.where && args.where.sql.trim().length > 0 ? `WHERE ${args.where.sql}` : '';
    const sql =
      `SELECT DISTINCT TOP ${args.limits.maxRows} ${quoteIdent(args.column)} ` +
      `FROM ${qSchema}${quoteIdent(args.table)} ${whereClause}`.trimEnd();
    return this.runReadonlySelect(sql, [], args.limits);
  }

  async countRows(args: { schema?: string | null; table: string; limits: DbQueryLimits }): Promise<number> {
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const sql = `SELECT COUNT_BIG(*) AS row_count FROM ${qSchema}${quoteIdent(args.table)}`;
    const res = await this.runReadonlySelect(sql, [], args.limits);
    const first = res.rows[0] ?? {};
    const raw =
      (first as Record<string, unknown>).row_count ??
      (first as Record<string, unknown>).ROW_COUNT ??
      Object.values(first)[0];
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(
        `countRows(${args.schema ?? ''}.${args.table}) returned an unparseable count: ${JSON.stringify(raw)}`,
      );
    }
    return n;
  }

  async fetchOrderedRows(args: {
    schema?: string | null;
    table: string;
    orderBy: string[];
    limits: DbQueryLimits;
    after?: unknown[] | null;
    orderByTypes?: Array<string | null> | null;
  }): Promise<DbReadResult> {
    if (args.orderBy.length === 0) {
      throw new Error('fetchOrderedRows requires at least one order column');
    }
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const orderBy = args.orderBy.map((c) => quoteIdent(c)).join(', ');
    // Keyset continuation with TYPE-AWARE literal rendering (each cursor
    // member renders under ITS column's declared source type).
    const render = (value: unknown, index: number): string =>
      mssqlLiteral(value, args.orderByTypes?.[index] ?? null);
    const where =
      args.after && args.after.length > 0
        ? `WHERE ${keysetPredicate(args.orderBy.map(quoteIdent), args.after, render)} `
        : '';
    // Ascending sort places NULLs low natively on SQL Server — the
    // cross-engine NULLS-LOW ordering contract.
    const sql =
      `SELECT TOP ${Math.max(1, args.limits.maxRows)} * ` +
      `FROM ${qSchema}${quoteIdent(args.table)} ${where}ORDER BY ${orderBy}`;
    return this.runReadonlySelect(sql, [], args.limits);
  }

  async probeKeyIntegrity(args: {
    schema?: string | null;
    table: string;
    keyColumns: string[];
    limits: DbQueryLimits;
  }): Promise<{ nullKeys: boolean; duplicateKeys: boolean }> {
    if (args.keyColumns.length === 0) {
      throw new Error('probeKeyIntegrity requires at least one key column');
    }
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const qTable = `${qSchema}${quoteIdent(args.table)}`;
    const qCols = args.keyColumns.map(quoteIdent);
    const limits = { maxRows: 1, timeoutSeconds: args.limits.timeoutSeconds };
    const nullSql = `SELECT TOP 1 1 AS hit FROM ${qTable} WHERE ${qCols.map((c) => `${c} IS NULL`).join(' OR ')}`;
    const dupSql = `SELECT TOP 1 1 AS hit FROM ${qTable} GROUP BY ${qCols.join(', ')} HAVING COUNT(*) > 1`;
    const nullRes = await this.runReadonlySelect(nullSql, [], limits);
    const dupRes = await this.runReadonlySelect(dupSql, [], limits);
    return { nullKeys: nullRes.rows.length > 0, duplicateKeys: dupRes.rows.length > 0 };
  }

  async dispose(): Promise<void> {
    // Stateless wrapper over HTTP — no pool, no per-instance resources.
  }

  /** Invoke one routine through the sidecar's `/call` (structured names + typed params, no SQL text). */
  async callRoutine(request: RoutineInvocationRequest): Promise<RoutineInvocationEnvelope> {
    const resp = await this.postJson<SidecarCallResponse>('/call', {
      ...this.commonCredsBody(),
      schemaName: request.schema_name,
      routineName: request.routine_name,
      routineKind: request.routine_kind,
      params: [
        ...(request.routine_kind === 'function' && request.returns_type
          ? [{ name: 'return_value', ordinal: 0, sourceType: request.returns_type, direction: 'out', value: null, isNull: true }]
          : []),
        ...request.params.map((p) => ({
          name: p.name,
          ordinal: p.ordinal,
          sourceType: p.source_type,
          direction: p.direction,
          value: p.value === null || p.value === undefined ? null : String(p.value),
          isNull: p.value === null || p.value === undefined,
        })),
      ],
      returnStatus: request.return_status,
      sessionSet: request.session_set,
      maxRowsPerResultSet: Math.max(1, Math.min(MAX_ROUTINE_RESULT_SET_ROWS, request.limits.max_rows_per_result_set)),
      maxResultSets: Math.max(1, request.limits.max_result_sets),
      queryTimeoutSeconds: Math.max(1, Math.min(Math.floor(longFetchTimeoutMs() / 1000), request.limits.timeout_seconds)),
    });
    if (!resp.ok) {
      throw new Error(`SQL Server sidecar call failed: ${resp.error ?? 'unknown error'}`);
    }
    return mapSidecarCallResponse(resp, { login: this.username, sessionSet: request.session_set });
  }

  // -------------------------------------------------------------------------

  private commonCredsBody(): Record<string, unknown> {
    return {
      engine: 'mssql',
      host: this.host,
      port: this.port,
      database: this.database,
      username: this.username,
      password: this.password,
      authScheme: this.auth?.authScheme ?? 'sql',
      domain: this.auth?.domain ?? null,
      encrypt: this.auth?.encrypt ?? true,
      trustServerCertificate: this.auth?.trustServerCertificate ?? false,
      instanceName: this.auth?.instanceName ?? null,
    };
  }

  private async postJson<TResp>(pathSuffix: string, body: Record<string, unknown>): Promise<TResp> {
    const url = `${this.sidecarBaseUrl}${pathSuffix}`;
    const resp = await longRunningFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        detail = (await resp.text()).substring(0, 500);
      } catch {
        // ignore
      }
      throw new Error(`SQL Server sidecar at ${url} returned HTTP ${resp.status}: ${detail}`);
    }
    return (await resp.json()) as TResp;
  }
}

/** Bracket-quote a SQL Server identifier (`]` doubled). Never depends on QUOTED_IDENTIFIER. */
export function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Identifier must be a non-empty string.');
  }
  return `[${name.replace(/]/g, ']]')}]`;
}

/** Source-type bases whose literals render UNQUOTED (numeric family). */
const NUMERIC_TYPE_BASES = new Set([
  'int', 'integer', 'smallint', 'tinyint', 'bigint', 'numeric', 'decimal',
  'money', 'smallmoney', 'float', 'real', 'bit',
]);
/** Source-type bases whose string literals render as N'…' (UTF-16 families). */
const NATIONAL_TYPE_BASES = new Set(['nchar', 'nvarchar', 'ntext', 'sysname', 'xml']);
/** Source-type bases whose `\x`-hex wire values render as 0x… binary literals. */
const BINARY_TYPE_BASES = new Set(['binary', 'varbinary', 'image', 'rowversion', 'timestamp']);

/** Canonical numeric string — the only shape allowed unquoted (injection-safe). */
const CANONICAL_NUMERIC_RE = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const HEX_WIRE_RE = /^\\x([0-9a-fA-F]*)$/;

function typeBase(sourceType: string | null): string {
  return (sourceType ?? '').trim().toLowerCase().split('(')[0].split(/\s+/)[0];
}

/** `yyyy-MM-dd HH:mm:ss.SSS` from LOCAL getters — no timezone conversion. */
function naiveLocalDatetime(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

/**
 * Literalise one keyset value for the sidecar's literal-SQL `/query`
 * endpoint under the column's declared SQL Server type. NULL never reaches
 * here (the predicate builder maps NULLs to IS [NOT] NULL forms).
 */
export function mssqlLiteral(value: unknown, sourceType: string | null = null): string {
  const base = typeBase(sourceType);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('keyset value must be a finite number');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string' && NUMERIC_TYPE_BASES.has(base)) {
    const s = value.trim();
    if (!CANONICAL_NUMERIC_RE.test(s)) {
      throw new Error(
        `keyset cursor value ${JSON.stringify(value)} is not a canonical numeric literal for its ${sourceType} column — refusing to render it into SQL`,
      );
    }
    return s;
  }
  if (typeof value === 'string' && BINARY_TYPE_BASES.has(base)) {
    const m = HEX_WIRE_RE.exec(value.trim());
    if (!m) {
      throw new Error(
        `keyset cursor value ${JSON.stringify(value)} is not a \\x-hex wire value for its ${sourceType} column — refusing to render it into SQL`,
      );
    }
    return `0x${m[1].toLowerCase()}`;
  }
  const s = value instanceof Date ? naiveLocalDatetime(value) : String(value);
  const quoted = `'${s.replace(/'/g, "''")}'`;
  return NATIONAL_TYPE_BASES.has(base) ? `N${quoted}` : quoted;
}
