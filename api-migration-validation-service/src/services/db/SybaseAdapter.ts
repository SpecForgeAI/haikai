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
import { SYBASE_SIDECAR_URL } from '../../config';
import { longFetchTimeoutMs, longRunningFetch } from '../longRunningFetch';

/**
 * `SybaseAdapter` -- Node-side adapter that proxies through the
 * `sybase-discovery-sidecar` JVM HTTP service for every JDBC operation.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 * Spec follow-up (2026-05-17): real implementation (replaces the throwing
 * stub) so the wizard's DB-sampling step works for Sybase ASE -- the
 * priority engine. Identical sidecar that discovery-service uses, so we
 * inherit the jTDS / jConnect auto-fallback for free.
 *
 * <h2>Why a sidecar?</h2>
 * The decision to keep all JDBC out of the Node services predates AMVS --
 * see `agent-os/diagnostic-runbook.md` and the original discovery-service
 * shaping notes. Carrying that line here means:
 * <ul>
 *   <li>No JDBC driver inside the Node runtime (no `tedious`, no `tds`,
 *       no native binaries shipped with the AMVS Docker image).</li>
 *   <li>Auto driver selection (jTDS first, jConnect fallback) is owned in
 *       one place; AMVS gets the new ASE 15.7+ compatibility automatically
 *       when an operator drops `jconn4.jar` into the sidecar's lib dir.</li>
 *   <li>SELECT-only enforcement is layered: TS-side `assertReadonlySelect`
 *       here, then JVM-side `SidecarSqlGuard` inside the sidecar.</li>
 * </ul>
 *
 * <h2>Limits / caveats (v1)</h2>
 * <ul>
 *   <li>Parameterised queries are NOT supported -- the sidecar's
 *       `/query` endpoint accepts only literal SQL. `runReadonlySelect`
 *       throws when `params` is non-empty. Callers (the LLM tool registry)
 *       should construct already-literal SQL with properly-quoted
 *       identifiers + values, OR use {@link #sampleValues} which the
 *       adapter constructs itself.</li>
 *   <li>`sampleValues` only allows a literal `where.sql` with no params
 *       for the same reason.</li>
 *   <li>The sidecar resolves credentials per-request -- no pooling on the
 *       Node side. The credential bundle therefore lives only as long as
 *       this adapter instance.</li>
 * </ul>
 */
export class SybaseAdapter implements DbAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly database: string;
  private readonly username: string;
  private readonly password: string;
  private readonly sidecarBaseUrl: string;

  constructor(config: DbConnectionConfig, opts?: { sidecarBaseUrl?: string }) {
    this.host = config.host;
    this.port = config.port;
    this.database = config.database;
    this.username = config.username;
    this.password = config.password;
    this.sidecarBaseUrl = (opts?.sidecarBaseUrl ?? SYBASE_SIDECAR_URL).replace(/\/+$/, '');
  }

  async testConnection(): Promise<{ success: true; serverVersion?: string }> {
    const resp = await this.postJson<{
      ok: boolean;
      error?: string | null;
      serverVersion?: string | null;
      driverUsed?: string | null;
    }>('/test-connection', this.commonCredsBody());
    if (!resp.ok) {
      throw new Error(
        `Sybase sidecar testConnection failed: ${resp.error ?? 'unknown error'}`,
      );
    }
    return {
      success: true,
      serverVersion: resp.serverVersion ?? undefined,
    };
  }

  async listMetadata(allowlist: DbAllowlist): Promise<DbTableMetadata[]> {
    const schemas = (allowlist.schemas ?? []).filter((s) => s && s.length > 0);
    const tables = (allowlist.tables ?? []).filter((t) => t && t.length > 0);
    if (schemas.length === 0 && tables.length === 0) {
      // Fail-closed: mirrors PostgresAdapter (an empty allowlist returns
      // zero rows so the LLM never sees the full DB by accident).
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
      throw new Error(
        `Sybase sidecar introspect failed: ${resp.error ?? 'unknown error'}`,
      );
    }
    const grouped = new Map<string, DbTableMetadata>();
    // Seed the map from `tables` so allowlisted tables with zero columns
    // still appear (the columns loop below merges in column rows).
    for (const t of resp.tables ?? []) {
      const key = `${t.schemaName}.${t.tableName}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          schema: t.schemaName,
          table: t.tableName,
          columns: [],
        });
      }
    }
    for (const c of resp.columns ?? []) {
      const key = `${c.schemaName}.${c.tableName}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          schema: c.schemaName,
          table: c.tableName,
          columns: [],
        };
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

  async runReadonlySelect(
    rawSql: string,
    params: unknown[],
    limits: DbQueryLimits,
  ): Promise<DbReadResult> {
    // SELECT-only enforcement at the TS layer (first line of defense; the
    // sidecar re-enforces at the JVM layer).
    assertReadonlySelect(rawSql);
    if (Array.isArray(params) && params.length > 0) {
      throw new Error(
        'Sybase adapter (v1) does not support parameterised queries; ' +
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
      // JDBC query-timeout ceiling = the long-fetch transport budget
      // (2026-08-11): the old hard 300s clamp silently overrode the caller's
      // timeout and killed every deep keyset page at the same wall-clock
      // point the transport fix had just raised — the byte-identical
      // 13-table truncated-load shape. The caller's budget now passes
      // through, bounded only by the transport's own ceiling (a JDBC query
      // outliving its HTTP response can never be observed anyway).
      queryTimeoutSeconds: Math.max(
        1,
        Math.min(Math.floor(longFetchTimeoutMs() / 1000), limits.timeoutSeconds),
      ),
      // PAGE-SIZE guard, not a table cap (2026-08-07): the sidecar buffers a
      // whole result set as one JSON response, so a single read is bounded —
      // full tables are read via keyset PAGINATION (fetchOrderedRows.after),
      // never one giant fetch. Callers requesting more than the guard per
      // page get a truncated=true result they MUST treat as an error.
      maxRows: Math.max(1, Math.min(MAX_SINGLE_FETCH_ROWS, limits.maxRows)),
    });
    if (!resp.ok) {
      throw new Error(
        `Sybase sidecar query failed: ${resp.error ?? 'unknown error'}`,
      );
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
      throw new Error(
        'Sybase adapter (v1) does not support parameterised where clauses; ' +
          'inline literal values.',
      );
    }
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const qTable = quoteIdent(args.table);
    const qColumn = quoteIdent(args.column);
    const whereClause =
      args.where && args.where.sql.trim().length > 0 ? `WHERE ${args.where.sql}` : '';
    // Sybase uses `SELECT TOP N` rather than the Postgres-style `LIMIT`.
    const sql =
      `SELECT DISTINCT TOP ${args.limits.maxRows} ${qColumn} ` +
      `FROM ${qSchema}${qTable} ${whereClause}`.trimEnd();
    // Run through the readonly-select path so the SELECT-only guard fires
    // even on adapter-constructed SQL (defence in depth).
    return this.runReadonlySelect(sql, [], args.limits);
  }

  async countRows(args: {
    schema?: string | null;
    table: string;
    limits: DbQueryLimits;
  }): Promise<number> {
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const sql = `SELECT COUNT(*) AS row_count FROM ${qSchema}${quoteIdent(args.table)}`;
    const res = await this.runReadonlySelect(sql, [], args.limits);
    const first = res.rows[0] ?? {};
    const raw =
      (first as Record<string, unknown>).row_count ??
      (first as Record<string, unknown>).ROW_COUNT ??
      Object.values(first)[0];
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      // Gold standard (2026-08-07): an unparseable COUNT(*) used to degrade
      // to 0 — downstream then "verified" a table as empty or skipped its
      // load entirely. A garbled count is a loud failure, never a zero.
      throw new Error(
        `countRows(${args.schema ?? ''}.${args.table}) returned an unparseable count: ` +
          `${JSON.stringify(raw)}`,
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
    // Keyset continuation (2026-08-07): rows strictly AFTER the previous
    // page's last key tuple. Literal SQL — the sidecar's /query endpoint
    // takes no params; values are literalised via sybLiteral (NULL-aware,
    // NULLS-LOW: `col IS NOT NULL` stands in for `col > NULL`). ASE has no
    // row-value comparison, so the tuple predicate is expanded.
    //
    // TYPE-AWARE rendering (2026-08-12): the sidecar wire carries
    // bigint/numeric values as STRINGS (JSON.parse precision), and quoting
    // one back at ASE against its numeric column is a type error
    // (`Implicit conversion from 'VARCHAR' to 'BIGINT'` — the live
    // hir_audit_info read failure at 1.2M rows). The predicate builder
    // passes the column index, so each cursor member renders under ITS
    // column's declared source type.
    const render = (value: unknown, index: number): string =>
      sybLiteral(value, args.orderByTypes?.[index] ?? null);
    const where = args.after && args.after.length > 0
      ? `WHERE ${keysetPredicate(args.orderBy.map(quoteIdent), args.after, render)} `
      : '';
    // Ascending sort places NULLs low natively on this engine — the
    // cross-engine NULLS-LOW ordering contract (the sibling appends
    // NULLS FIRST to match).
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
    // Key-integrity preflight (2026-08-12): a pack-declared PK the live data
    // does not satisfy makes the load un-runnable (the target PK rejects
    // it) — probe BEFORE writing anything. Two cheap single-scan probes.
    if (args.keyColumns.length === 0) {
      throw new Error('probeKeyIntegrity requires at least one key column');
    }
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const qTable = `${qSchema}${quoteIdent(args.table)}`;
    const qCols = args.keyColumns.map(quoteIdent);
    const limits = { maxRows: 1, timeoutSeconds: args.limits.timeoutSeconds };

    const nullSql =
      `SELECT TOP 1 1 AS hit FROM ${qTable} ` +
      `WHERE ${qCols.map((c) => `${c} IS NULL`).join(' OR ')}`;
    const dupSql =
      `SELECT TOP 1 1 AS hit FROM ${qTable} ` +
      `GROUP BY ${qCols.join(', ')} HAVING COUNT(*) > 1`;

    const nullRes = await this.runReadonlySelect(nullSql, [], limits);
    const dupRes = await this.runReadonlySelect(dupSql, [], limits);
    return {
      nullKeys: nullRes.rows.length > 0,
      duplicateKeys: dupRes.rows.length > 0,
    };
  }

  async dispose(): Promise<void> {
    // Stateless wrapper over HTTP -- no pool, no per-instance resources.
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private commonCredsBody(): Record<string, unknown> {
    return {
      host: this.host,
      port: this.port,
      database: this.database,
      username: this.username,
      password: this.password,
      // No `driver` field -- defaults to 'auto' on the sidecar (jTDS first,
      // jConnect fallback).
    };
  }

  private async postJson<TResp>(
    pathSuffix: string,
    body: Record<string, unknown>,
  ): Promise<TResp> {
    const url = `${this.sidecarBaseUrl}${pathSuffix}`;
    // Long-running wiring (2026-08-11): keyset page queries legitimately run
    // for many minutes on big ASE tables — a bare fetch died at undici's
    // 300s headers default, truncating loads at clean page multiples.
    const resp = await longRunningFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        const text = await resp.text();
        detail = text.substring(0, 500);
      } catch {
        // ignore
      }
      throw new Error(
        `Sybase sidecar at ${url} returned HTTP ${resp.status}: ${detail}`,
      );
    }
    return (await resp.json()) as TResp;
  }
}

/**
 * Quote a Sybase identifier safely. Sybase ASE accepts double-quoted
 * identifiers when `QUOTED_IDENTIFIER` is on (the default for jTDS /
 * jConnect connections). Doubled embedded double-quotes are the escape.
 *
 * The sidecar's connection setup leaves `QUOTED_IDENTIFIER` at its
 * connection-default state -- if a future deployment ever changes it
 * server-side, callers would need to swap to bracket quoting; the helper
 * is local to the adapter so only one site changes.
 */
function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Identifier must be a non-empty string.');
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Literalise one keyset value for the sidecar's literal-SQL /query endpoint.
 * Numbers pass through validated; booleans map to ASE bit literals; Dates
 * and strings become single-quoted literals with embedded quotes doubled
 * (ASE converts string datetime literals natively). NULL never reaches here
 * — the predicate builder maps NULLs to IS [NOT] NULL forms.
 */
/** `yyyy-MM-dd HH:mm:ss.SSS` from LOCAL getters — no timezone conversion. */
function naiveLocalDatetime(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

/** Source-type bases whose literals must render UNQUOTED (numeric family). */
const NUMERIC_TYPE_BASES = new Set([
  'int', 'integer', 'smallint', 'tinyint', 'bigint', 'unsigned',
  'numeric', 'decimal', 'money', 'smallmoney', 'float', 'real', 'bit',
]);

/** Canonical numeric string — the only shape allowed unquoted (injection-safe). */
const CANONICAL_NUMERIC_RE = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function isNumericTypeBase(sourceType: string | null): boolean {
  if (!sourceType) return false;
  const base = sourceType.trim().toLowerCase().split('(')[0].split(/\s+/)[0];
  return NUMERIC_TYPE_BASES.has(base);
}

function sybLiteral(value: unknown, sourceType: string | null = null): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('keyset value must be a finite number');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  // TYPE-AWARE numerics (2026-08-12): the sidecar wire renders
  // bigint/numeric/decimal as STRINGS to survive JSON.parse (2^53), so a
  // string cursor value on a numeric column must render UNQUOTED — ASE
  // refuses `VARCHAR > BIGINT` ("Implicit conversion ... not allowed", the
  // live hir_audit_info failure). Type-driven, never guessed from shape: a
  // varchar column holding digit strings keeps its quotes. A numeric column
  // whose value is NOT a canonical numeric string is corrupt — fail loud,
  // never quote it into a guaranteed engine error.
  if (typeof value === 'string' && isNumericTypeBase(sourceType)) {
    const s = value.trim();
    if (!CANONICAL_NUMERIC_RE.test(s)) {
      throw new Error(
        `keyset cursor value ${JSON.stringify(value)} is not a canonical numeric ` +
          `literal for its ${sourceType} column — refusing to render it into SQL`,
      );
    }
    return s;
  }
  // A Date here is defensive only (the sidecar wire is raw naive strings,
  // echoed verbatim below) — but if one ever arrives, render its LOCAL
  // wall-clock naively: toISOString() would UTC-shift the literal by the
  // process offset (+1h in BST) and the cursor would miss every row
  // (2026-08-11, ported from the work-machine parity review).
  const s = value instanceof Date ? naiveLocalDatetime(value) : String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

