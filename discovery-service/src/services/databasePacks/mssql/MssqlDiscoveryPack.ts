/**
 * SQL Server discovery pack -- executable via the JVM/JDBC db-discovery
 * sidecar.
 *
 * Spec: SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11),
 * task 2.1. Design of record:
 * `agent-os/planning/2026-09-11-sqlserver-postgres-pair-shaping.md`.
 *
 * Implements {@link DatabaseDiscoveryPack} for SQL Server 2016+ (the pair's
 * SOURCE is SQL Server 2022 / 16.x). Discovery-service stays pure Node; all
 * JDBC I/O happens in the sidecar process, reached through the shared
 * `../sidecarClient` with `engine: 'mssql'` on every request. This pack is a
 * thin HTTP client over the sidecar plus the per-engine transformation /
 * profiling / finding-emission layers -- structurally the Sybase pack's twin,
 * which is what makes the cross-engine conformance pins meaningful.
 *
 * Sidecar location:
 *   - `DB_SIDECAR_URL`, then the legacy `SYBASE_SIDECAR_URL` alias, then
 *     `http://localhost:8093` (WIRE-CONTRACT v2 §6).
 *
 * Lifecycle:
 *   - `connect()` caches the credentials (including the SQL-Server-only
 *     connection extras) on the instance. No long-lived connection is opened
 *     here -- every sidecar call carries credentials and the sidecar connects
 *     per request.
 *   - `close()` clears the cached credentials + introspection; no pool.
 *
 * Snippet redaction:
 *   - View / routine / trigger bodies are routed through the shared finding
 *     builders' redaction inside `mssqlFindings.ts` before they reach any
 *     persisted payload. Builders apply a defensive second pass.
 *
 * Candidate emission:
 *   - One `physical_data_entities` candidate per discovered table AND per
 *     discovered view.
 *   - One `physical_data_attributes` candidate per discovered column,
 *     parent-linked via `parentCandidateClientId`.
 */

import type {
  DatabaseCandidatePayload,
  DatabaseDiscoveryPack,
  DatabaseDiscoveryPackContext,
} from '../DatabaseDiscoveryPack';
import type {
  ColumnMetadata,
  ConnectionResult,
  ExtendedObjectMetadata,
  IntrospectionResult,
  KeyOrIndexMetadata,
  ProcedureMetadata,
  ProfileResult,
  ProfilingMode,
  RelationshipInference,
  ScheduledJobMetadata,
  SchemaMetadata,
  SequenceMetadata,
  TableMetadata,
  TriggerMetadata,
  ViewMetadata,
} from '../types';
import type { FindingEmitInput } from '../../findings/FindingEmitter';
import {
  attributeStructuralFidelityFields,
  buildConstraintsMetadata,
} from '../candidateStructuralFidelity';
import { harvestLiveProcSources } from './mssqlProcHarvest';
import { profileTsqlRoutine } from '../sybase/tsqlRoutineProfiler';
import {
  callSidecarIntrospect,
  callSidecarQuery,
  callSidecarTestConnection,
  type SidecarCredentials,
  type SidecarIntrospectionResponse,
} from '../sidecarClient';
import {
  EMPTY_MSSQL_EXTRAS,
  transformMssqlIntrospection,
  type MssqlIntrospectionResult,
} from './mssqlIntrospection';
import { profileMssqlTables } from './mssqlProfiler';
import { inferMssqlRelationships } from './mssqlRelationshipInference';
import { buildAllMssqlFindings } from './mssqlFindings';

/** Engine key on the wire, in `db://` URIs, and in candidate payloads. */
const ENGINE = 'mssql' as const;

function dbUri(schema: string, table: string, column?: string): string {
  const base = `db://${ENGINE}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  return column ? `${base}#${encodeURIComponent(column)}` : base;
}

/**
 * Candidate client-id prefix. `mstab:` is to SQL Server what `sybtab:` is to
 * Sybase -- distinct per engine so a project that scanned both never collides
 * two same-named tables into one candidate.
 */
function tableClientId(schema: string, table: string): string {
  return `mstab:${schema}.${table}`;
}

export class MssqlDiscoveryPack implements DatabaseDiscoveryPack {
  readonly engineKey = ENGINE;
  readonly displayName = 'SQL Server';

  /**
   * Cached sidecar-credential payload, populated on `connect()` and cleared
   * on `close()`. The pack does NOT persist credentials -- the orchestrator's
   * secrets store is the authoritative holder for the run; this field is a
   * per-call convenience that lives only while the pack instance is in
   * flight.
   */
  private creds: SidecarCredentials | null = null;

  /**
   * Cached raw introspection response so downstream introspect* methods do
   * not re-hit the sidecar. The orchestrator calls every introspect* method
   * on the same pack instance per run, so caching is safe.
   */
  private cachedSidecarIntrospection: SidecarIntrospectionResponse | null =
    null;

  /**
   * Cached normalised introspection (engine-neutral IR + the pack-private
   * SQL Server extras). Stored so the profiler / relationship-inference /
   * finding layers reuse one transform per run.
   */
  private cachedIntrospection: MssqlIntrospectionResult | null = null;

  async connect(ctx: DatabaseDiscoveryPackContext): Promise<void> {
    if (this.creds !== null) return; // idempotent
    const auth = ctx.config.mssqlAuth;
    this.creds = {
      engine: ENGINE,
      host: ctx.config.host,
      port: ctx.config.port,
      database: ctx.config.databaseName,
      username: ctx.credentials.username,
      password: ctx.credentials.password,
      // Connection extras (auth scheme / domain / TLS posture / named
      // instance). Defaults match the wire contract: SQL login, encryption
      // ON, certificate NOT trusted -- the safe posture, which the user
      // relaxes deliberately in the scan form.
      mssql: {
        scheme: auth?.scheme ?? 'sql',
        domain: auth?.domain ?? null,
        encrypt: auth ? auth.encrypt !== false : true,
        trustServerCertificate: auth?.trustServerCertificate === true,
        instanceName: auth?.instanceName ?? null,
      },
    };
  }

  async testConnection(
    _ctx: DatabaseDiscoveryPackContext,
  ): Promise<ConnectionResult> {
    const creds = this.requireCreds();
    const start = Date.now();
    const resp = await callSidecarTestConnection(creds);
    if (!resp.ok) {
      console.warn(
        `[diag-pack] db_engine=${ENGINE} op=test_connection result=fail ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      throw new Error(
        `SQL Server sidecar testConnection failed: ${resp.error ?? 'unknown error'}`,
      );
    }
    console.log(
      `[diag-pack] db_engine=${ENGINE} op=test_connection result=ok ` +
        `driver_used=${resp.driverUsed ?? 'unknown'} elapsed_ms=${Date.now() - start}`,
    );
    return {
      success: true,
      serverVersion: resp.serverVersion ?? undefined,
      serverEdition: resp.serverEdition ?? undefined,
      driverUsed: resp.driverUsed ?? undefined,
    };
  }

  /**
   * Lazy introspection -- we hit the sidecar exactly once per run, then serve
   * all introspect* method calls out of the cached response.
   */
  private async ensureIntrospection(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<MssqlIntrospectionResult> {
    if (this.cachedIntrospection !== null) return this.cachedIntrospection;
    const creds = this.requireCreds();
    const start = Date.now();
    const sidecarResp = await callSidecarIntrospect(creds, {
      includeSchemas: ctx.config.includeSchemas ?? null,
      includeTables: ctx.config.includeTables ?? null,
      queryTimeoutSeconds: ctx.config.queryTimeoutSeconds,
    });
    if (!sidecarResp.ok) {
      console.warn(
        `[diag-pack] db_engine=${ENGINE} op=introspect_all result=fail ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      throw new Error(
        `SQL Server sidecar introspect failed: ${sidecarResp.error ?? 'unknown error'}`,
      );
    }
    this.cachedSidecarIntrospection = sidecarResp;
    this.cachedIntrospection = transformMssqlIntrospection(sidecarResp);
    const intro = this.cachedIntrospection;
    console.log(
      `[diag-pack] db_engine=${ENGINE} op=introspect_all result=ok ` +
        `elapsed_ms=${Date.now() - start} ` +
        `tables=${intro.tables.length} columns=${intro.columns.length} ` +
        `views=${intro.views.length} procedures=${intro.procedures.length} ` +
        `triggers=${intro.triggers.length} ` +
        `extended_objects=${(intro.extendedObjects ?? []).length}`,
    );
    return this.cachedIntrospection;
  }

  /**
   * Server collation detection. SQL Server has no separate charset knob --
   * the COLLATION carries both the code page and the sort order, and the
   * JDBC driver always speaks Unicode on the wire, so nothing is declared
   * back onto the connection (the Sybase path must declare a charset; here
   * that would be meaningless and is deliberately not done).
   *
   * `SERVERPROPERTY('Collation')` is the instance default;
   * `DATABASEPROPERTYEX(DB_NAME(), 'Collation')` is the one that actually
   * governs this database's string columns, so the database collation is
   * the value returned as the sort order.
   */
  async detectServerCharset(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<{
    charset: string | null;
    sortorderName: string | null;
    caseSensitive: boolean | null;
  } | null> {
    const creds = this.requireCreds();
    const sql =
      "SELECT CONVERT(varchar(128), SERVERPROPERTY('Collation')) AS server_collation, " +
      "CONVERT(varchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS database_collation";
    const r = await callSidecarQuery(creds, {
      sql,
      queryTimeoutSeconds: ctx.config.queryTimeoutSeconds ?? 60,
      maxRows: 5,
    });
    const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const dbCollation = row.database_collation
      ? String(row.database_collation)
      : null;
    const serverCollation = row.server_collation
      ? String(row.server_collation)
      : null;
    const effective = dbCollation ?? serverCollation;
    // `_CS_` = case sensitive, `_CI_` = case insensitive. A binary collation
    // (`_BIN` / `_BIN2`) compares byte-wise and is therefore case-sensitive.
    const caseSensitive =
      effective === null
        ? null
        : /_CS(_|$)/i.test(effective) || /_BIN2?(_|$)/i.test(effective)
        ? true
        : /_CI(_|$)/i.test(effective)
        ? false
        : null;
    console.log(
      `[diag-pack] db_engine=${ENGINE} op=charset_detect ` +
        `database_collation=${dbCollation ?? 'unknown'} ` +
        `server_collation=${serverCollation ?? 'unknown'} ` +
        `case_sensitive=${String(caseSensitive)}`,
    );
    return {
      // No charset declaration on this engine -- the collation IS the answer.
      charset: null,
      sortorderName: effective,
      caseSensitive,
    };
  }

  /** Live stored-object harvest -- read-only via /query. */
  async harvestProcSources(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<import('../../../scl/sqlProcHarvester').LiveProcSource[]> {
    const creds = this.requireCreds();
    const start = Date.now();
    const sources = await harvestLiveProcSources(
      creds,
      ctx.config.queryTimeoutSeconds ?? 60,
    );
    console.log(
      `[diag-pack] db_engine=${ENGINE} op=proc_harvest result=ok ` +
        `objects=${sources.length} elapsed_ms=${Date.now() - start}`,
    );
    return sources;
  }

  /**
   * T-SQL routine profiler -- shared with the Sybase pack, because the
   * dialect IS shared: both engines descend from the same Sybase/Microsoft
   * T-SQL and the profiler recognises the union of both engines' constructs
   * (the SQL-Server-only ones -- TRY/CATCH, THROW, XACT_ABORT, MERGE, OUTPUT,
   * APPLY, NEXT VALUE FOR, FOR SYSTEM_TIME -- simply never fire on an ASE
   * body).
   */
  profileRoutine = profileTsqlRoutine;

  /** Live uniqueness probe -- read-only via /query. */
  async probeKeyCandidate(
    ctx: DatabaseDiscoveryPackContext,
    args: { schemaName: string | null; tableName: string; columns: string[] },
  ): Promise<{ total: number | null; distinct: number | null } | null> {
    const creds = this.requireCreds();
    const safe = (ident: string): string => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
        throw new Error(`unsafe identifier in key probe: ${ident}`);
      }
      return ident;
    };
    const qn = args.schemaName
      ? `${safe(args.schemaName)}.${safe(args.tableName)}`
      : safe(args.tableName);
    const cols = args.columns.map(safe).join(', ');
    const sql =
      `SELECT (SELECT COUNT(*) FROM ${qn}) AS total_rows, ` +
      `(SELECT COUNT(*) FROM (SELECT DISTINCT ${cols} FROM ${qn}) AS d) AS distinct_rows`;
    const r = await callSidecarQuery(creds, {
      sql,
      queryTimeoutSeconds: ctx.config.queryTimeoutSeconds ?? 120,
      maxRows: 1,
    });
    const row = (r.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const total = Number(row.total_rows);
    const distinct = Number(row.distinct_rows);
    return {
      total: Number.isFinite(total) ? total : null,
      distinct: Number.isFinite(distinct) ? distinct : null,
    };
  }

  /** Sequence-table row probe -- read-only via /query. */
  async probeSequenceRows(
    ctx: DatabaseDiscoveryPackContext,
    idiom: import('../../../scl/sqlProcHarvester').SequenceGeneratorIdiom,
  ): Promise<Array<{ name: string | null; value: number | null }>> {
    const creds = this.requireCreds();
    const safe = (ident: string): string => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
        throw new Error(`unsafe identifier in sequence idiom: ${ident}`);
      }
      return ident;
    };
    const nameSel = idiom.nameColumn ? `${safe(idiom.nameColumn)} AS seq_name, ` : '';
    const sql =
      `SELECT ${nameSel}${safe(idiom.numberColumn)} AS seq_value ` +
      `FROM ${safe(idiom.seqTable)}`;
    const r = await callSidecarQuery(creds, {
      sql,
      queryTimeoutSeconds: ctx.config.queryTimeoutSeconds ?? 60,
      maxRows: 200,
    });
    return (r.rows ?? []).map((row) => {
      const rec = row as Record<string, unknown>;
      const value = Number(rec.seq_value);
      return {
        name: idiom.nameColumn ? String(rec.seq_name ?? '') : null,
        value: Number.isFinite(value) ? value : null,
      };
    });
  }

  async introspectSchemas(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<SchemaMetadata[]> {
    return (await this.ensureIntrospection(ctx)).schemas;
  }

  async introspectTables(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<TableMetadata[]> {
    return (await this.ensureIntrospection(ctx)).tables;
  }

  async introspectColumns(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ColumnMetadata[]> {
    return (await this.ensureIntrospection(ctx)).columns;
  }

  async introspectKeysAndIndexes(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<KeyOrIndexMetadata[]> {
    return (await this.ensureIntrospection(ctx)).keysAndIndexes;
  }

  async introspectViews(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ViewMetadata[]> {
    return (await this.ensureIntrospection(ctx)).views;
  }

  async introspectProcedures(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ProcedureMetadata[]> {
    return (await this.ensureIntrospection(ctx)).procedures;
  }

  async introspectTriggers(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<TriggerMetadata[]> {
    return (await this.ensureIntrospection(ctx)).triggers;
  }

  async introspectSequences(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<SequenceMetadata[]> {
    return (await this.ensureIntrospection(ctx)).sequences ?? [];
  }

  /**
   * The DB-level default collation. Served from the cached introspection --
   * the sidecar reads `DATABASEPROPERTYEX(db, 'Collation')` as part of the
   * catalog walk, so no extra round trip is needed. This is the value the
   * collation hazard reasons against: a `_CI_` database default means EVERY
   * string column without an explicit collation is case-insensitive today.
   */
  async introspectDatabaseCollation(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<string | null> {
    return (await this.ensureIntrospection(ctx)).databaseCollation ?? null;
  }

  /**
   * SQL Server Agent jobs, served from the cached introspection (the sidecar
   * reads `msdb.dbo.sysjobs` + `sysjobsteps` + `sysjobschedules`). An account
   * without `SQLAgentReaderRole` sees none, and the applicability resolver
   * then surfaces a `db_jobs` evidence gap rather than pretending there are
   * no jobs.
   */
  async introspectScheduledJobs(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ScheduledJobMetadata[]> {
    return (await this.ensureIntrospection(ctx)).scheduledJobs ?? [];
  }

  /**
   * Objects with no row in the six classic arrays -- Service Broker queues /
   * services / contracts, user-defined table types, synonyms, full-text
   * catalogs, CLR assemblies, XML schema collections, partition
   * schemes/functions, CDC + change tracking, FILESTREAM filegroups, DDL
   * triggers, row-level-security policies, external tables and the temporal
   * history links.
   */
  async introspectExtendedObjects(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ExtendedObjectMetadata[]> {
    return (await this.ensureIntrospection(ctx)).extendedObjects ?? [];
  }

  async profileTables(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    mode: ProfilingMode,
  ): Promise<ProfileResult> {
    const creds = this.requireCreds();
    return profileMssqlTables(creds, introspection, mode, ctx.config);
  }

  async inferRelationships(
    _ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    _profile: ProfileResult,
  ): Promise<RelationshipInference[]> {
    return inferMssqlRelationships(
      introspection,
      this.cachedIntrospection?.mssql.indexes ?? [],
    );
  }

  async ingestWorkloadLogs(
    _ctx: DatabaseDiscoveryPackContext,
  ): Promise<void> {
    // D4 readiness hook -- no-op, same as every other pack.
    return;
  }

  async emitCandidates(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    _profile: ProfileResult,
  ): Promise<DatabaseCandidatePayload[]> {
    const out: DatabaseCandidatePayload[] = [];

    const pkColumnsByTable = new Map<string, Set<string>>();
    for (const k of introspection.keysAndIndexes) {
      if (k.kind !== 'primary_key') continue;
      const key = `${k.schemaName}.${k.tableName}`;
      let set = pkColumnsByTable.get(key);
      if (!set) {
        set = new Set();
        pkColumnsByTable.set(key, set);
      }
      for (const c of k.columns) set.add(c);
    }

    for (const t of introspection.tables) {
      const clientId = tableClientId(t.schemaName, t.tableName);
      // Structural constraint/index truth (Spec 2026-05-29) as METADATA on the
      // entity -- NOT a separate entity type. null/absent round-trips cleanly.
      const constraintsMetadata = buildConstraintsMetadata(
        t.schemaName,
        t.tableName,
        introspection.keysAndIndexes,
      );
      out.push({
        candidateType: 'physical_data_entities',
        name: t.tableName,
        filePath: dbUri(t.schemaName, t.tableName),
        clientId,
        data: {
          dbEngine: ENGINE,
          databaseName: ctx.config.databaseName,
          schemaName: t.schemaName,
          objectName: t.tableName,
          objectType: 'table',
          estimatedRowCount: t.estimatedRowCount ?? null,
          comment: t.comment ?? null,
          constraints_metadata: constraintsMetadata,
          confidence: 1.0,
          sourceEvidenceIds: [],
        },
      });
    }

    // Views are physical-data entities too -- the user can review them
    // alongside tables and decide whether to promote each into the model.
    // SQL Server has no materialized view (an INDEXED VIEW is the nearest
    // construct and is an OUT item by owner ruling, flagged as its own
    // named-reason Finding), so every view emits as objectType='view'.
    for (const v of introspection.views) {
      const clientId = tableClientId(v.schemaName, v.viewName);
      out.push({
        candidateType: 'physical_data_entities',
        name: v.viewName,
        filePath: dbUri(v.schemaName, v.viewName),
        clientId,
        data: {
          dbEngine: ENGINE,
          databaseName: ctx.config.databaseName,
          schemaName: v.schemaName,
          objectName: v.viewName,
          objectType: 'view',
          estimatedRowCount: null,
          comment: null,
          confidence: 1.0,
          sourceEvidenceIds: [],
        },
      });
    }

    for (const c of introspection.columns) {
      const parentKey = `${c.schemaName}.${c.tableName}`;
      const parentClientId = tableClientId(c.schemaName, c.tableName);
      const pkSet = pkColumnsByTable.get(parentKey);
      const isPk = pkSet ? pkSet.has(c.columnName) : false;
      out.push({
        candidateType: 'physical_data_attributes',
        name: c.columnName,
        filePath: dbUri(c.schemaName, c.tableName, c.columnName),
        clientId: `${parentClientId}#${c.columnName}`,
        parentCandidateClientId: parentClientId,
        data: {
          dbEngine: ENGINE,
          databaseName: ctx.config.databaseName,
          schemaName: c.schemaName,
          tableName: c.tableName,
          columnName: c.columnName,
          dataType: c.dataType,
          maxLength: c.maxLength ?? null,
          isNullable: c.isNullable,
          isPrimaryKey: isPk,
          defaultExpression: c.defaultExpression ?? null,
          ordinalPosition: c.ordinalPosition,
          // Structural-fidelity fields (Spec 2026-05-29), keyed to match the
          // snake_case AMS DTO names verbatim. NO type normalization.
          ...attributeStructuralFidelityFields(c),
          confidence: 1.0,
          sourceEvidenceIds: [],
        },
      });
    }
    return out;
  }

  async emitFindings(
    _ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    profile: ProfileResult,
    relationships: RelationshipInference[],
  ): Promise<FindingEmitInput[]> {
    // The orchestrator rebuilds the IR from the individual introspect* calls,
    // so the neutral halves arrive here on `introspection`. The pack-private
    // SQL Server extras (and the applicability map, which the orchestrator's
    // envelope has no slot for) come from this run's cached transform.
    const cached = this.cachedIntrospection;
    const merged: MssqlIntrospectionResult = {
      ...introspection,
      extendedObjects:
        introspection.extendedObjects ?? cached?.extendedObjects ?? [],
      metadataApplicability:
        introspection.metadataApplicability ?? cached?.metadataApplicability,
      mssql: cached?.mssql ?? EMPTY_MSSQL_EXTRAS,
    };
    return buildAllMssqlFindings(merged, profile, relationships);
  }

  async close(): Promise<void> {
    // No JDBC pool on this side; the sidecar manages its own per-request
    // connections. We just clear the cached credentials + introspection.
    this.creds = null;
    this.cachedSidecarIntrospection = null;
    this.cachedIntrospection = null;
  }

  private requireCreds(): SidecarCredentials {
    if (this.creds === null) {
      throw new Error(
        'MssqlDiscoveryPack: connect() must be called before any other method.',
      );
    }
    return this.creds;
  }
}
