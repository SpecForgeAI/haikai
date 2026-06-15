import {
  DbAdapter,
  DbAllowlist,
  DbConnectionConfig,
  DbQueryLimits,
  DbReadResult,
  DbTableMetadata,
} from './DbAdapter';
import { assertReadonlySelect } from './sqlGuard';
import { SYBASE_SIDECAR_URL } from '../../config';

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
      queryTimeoutSeconds: Math.max(1, Math.min(300, limits.timeoutSeconds)),
      maxRows: Math.max(1, Math.min(10_000, limits.maxRows)),
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
    const resp = await fetch(url, {
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
