/**
 * PostgreSQL discovery pack -- executable v1.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3.
 *
 * Implements `DatabaseDiscoveryPack` for PostgreSQL. Uses the local
 * `PostgresAdapter` (a duplicated-from-AMVS `pg`-based adapter) for raw
 * queries. Every introspection query routes through the SQL guard via
 * `runIntrospectionQuery`; every profile query routes through
 * `runReadonlySelect` (which also applies the guard + statement_timeout +
 * row-LIMIT injection).
 *
 * Lifecycle:
 *   - `connect()` lazily constructs the adapter when first called. The
 *     orchestrator drives `connect()` exactly once per run.
 *   - `close()` disposes the pool. Idempotent.
 *
 * Snippet redaction:
 *   - View / procedure / trigger bodies are routed through
 *     `snippetRedaction.redactSnippet` inside `postgresFindings.ts` before
 *     they reach a `detailJson` payload. The finding builders also apply a
 *     defensive second redact as a safety net.
 *
 * Candidate emission:
 *   - One `physical_data_entities` candidate per discovered table.
 *   - One `physical_data_attributes` candidate per discovered column, linked
 *     to its parent table candidate via `parentCandidateClientId`.
 */

import type {
  DatabaseCandidatePayload,
  DatabaseDiscoveryPack,
  DatabaseDiscoveryPackContext,
} from '../DatabaseDiscoveryPack';
import type {
  ActualSchemaSnapshot,
  ColumnMetadata,
  ConnectionResult,
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
import { PostgresAdapter } from '../../db/PostgresAdapter';
import {
  introspectPostgresActualSchema,
  introspectPostgresColumns,
  introspectPostgresDatabaseCollation,
  introspectPostgresKeysAndIndexes,
  introspectPostgresProcedures,
  introspectPostgresScheduledJobs,
  introspectPostgresSchemas,
  introspectPostgresSequences,
  introspectPostgresTables,
  introspectPostgresTriggers,
  introspectPostgresViews,
} from './postgresIntrospection';
import { profilePostgresTables } from './postgresProfiler';
import { inferPostgresRelationships } from './postgresRelationshipInference';
import { buildAllPostgresFindings } from './postgresFindings';

/**
 * Generate a synthetic source URI for a Postgres object. Used as the
 * candidate's `filePath`.
 *
 *   - `db://postgres/{schema}/{table}` for a table
 *   - `db://postgres/{schema}/{table}#{column}` for a column
 */
function dbUri(schema: string, table: string, column?: string): string {
  const base = `db://postgres/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  return column ? `${base}#${encodeURIComponent(column)}` : base;
}

/**
 * Stable client-side id for a table candidate. Format keeps the schema +
 * table identifiable so the orchestrator can debug parent-child wiring on
 * failed runs.
 */
function tableClientId(schema: string, table: string): string {
  return `pgtab:${schema}.${table}`;
}

export class PostgresDiscoveryPack implements DatabaseDiscoveryPack {
  readonly engineKey = 'postgres' as const;
  readonly displayName = 'PostgreSQL';

  private adapter: PostgresAdapter | null = null;

  async connect(ctx: DatabaseDiscoveryPackContext): Promise<void> {
    if (this.adapter !== null) return; // idempotent
    this.adapter = new PostgresAdapter({
      dbType: 'postgres',
      host: ctx.config.host,
      port: ctx.config.port,
      database: ctx.config.databaseName,
      schema: ctx.config.schemaName ?? null,
      username: ctx.credentials.username,
      password: ctx.credentials.password,
    });
  }

  async testConnection(
    _ctx: DatabaseDiscoveryPackContext,
  ): Promise<ConnectionResult> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const { version, edition } = await adapter.getServerIdentity();
    console.log(
      `[diag-pack] db_engine=postgres op=test_connection result=ok ` +
        `elapsed_ms=${Date.now() - start}`,
    );
    return { success: true, serverVersion: version, serverEdition: edition };
  }

  async introspectSchemas(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<SchemaMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresSchemas(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_schemas ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectTables(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<TableMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresTables(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_tables ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectColumns(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ColumnMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresColumns(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_columns ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectKeysAndIndexes(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<KeyOrIndexMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresKeysAndIndexes(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_keys_and_indexes ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectSequences(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<SequenceMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresSequences(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_sequences ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectDatabaseCollation(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<string | null> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const collation = await introspectPostgresDatabaseCollation(
      adapter,
      ctx.config,
    );
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_database_collation ` +
        `present=${collation !== null} elapsed_ms=${Date.now() - start}`,
    );
    return collation;
  }

  /**
   * VERIFICATION-ONLY scan (Spec 2026-06-11 DB Schema + Data Migration Pack,
   * Task 4.2): the structural introspection walk against the TARGET Postgres
   * database, returned as a normalized snapshot. WRITES NOTHING to the model
   * -- this method never touches candidates, findings, or run rows; the
   * orchestrator is not involved at all.
   */
  async runVerificationOnlyScan(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ActualSchemaSnapshot> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const snapshot = await introspectPostgresActualSchema(adapter, ctx.config, {
      mode: 'verification_only',
    });
    console.log(
      `[diag-pack] db_engine=postgres op=verification_only_scan ` +
        `tables=${snapshot.tables.length} columns=${snapshot.columns.length} ` +
        `keys=${snapshot.keysAndIndexes.length} sequences=${snapshot.sequences.length} ` +
        `elapsed_ms=${Date.now() - start}`,
    );
    return snapshot;
  }

  async introspectScheduledJobs(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ScheduledJobMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresScheduledJobs(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_scheduled_jobs ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectViews(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ViewMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresViews(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_views ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectProcedures(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ProcedureMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresProcedures(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_procedures ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async introspectTriggers(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<TriggerMetadata[]> {
    const adapter = this.requireAdapter();
    const start = Date.now();
    const rows = await introspectPostgresTriggers(adapter, ctx.config);
    console.log(
      `[diag-pack] db_engine=postgres op=introspect_triggers ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`,
    );
    return rows;
  }

  async profileTables(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    mode: ProfilingMode,
  ): Promise<ProfileResult> {
    const adapter = this.requireAdapter();
    return profilePostgresTables(adapter, introspection, mode, ctx.config);
  }

  async inferRelationships(
    _ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    _profile: ProfileResult,
  ): Promise<RelationshipInference[]> {
    return inferPostgresRelationships(introspection);
  }

  async ingestWorkloadLogs(_ctx: DatabaseDiscoveryPackContext): Promise<void> {
    // D4 readiness hook -- v1 no-op. The orchestrator only calls this when
    // `config.allowWorkloadLogUpload === true`, but the actual ingest path
    // is deferred to a follow-up spec.
    return;
  }

  async emitCandidates(
    _ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    _profile: ProfileResult,
  ): Promise<DatabaseCandidatePayload[]> {
    const out: DatabaseCandidatePayload[] = [];

    // Build a quick lookup of PK columns per table so we can mark
    // `isPrimaryKey` on the attribute payloads.
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

    // Tables
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
          dbEngine: 'postgres',
          databaseName: _ctx.config.databaseName,
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

    // Views (regular + materialized). Postgres exposes both via pg_views /
    // pg_matviews; the introspection layer normalises to ViewMetadata with
    // isMaterialized=true for the matview flavour. The save-back maps
    // objectType -> physical_type ('View' / 'Materialized View') so they
    // surface on the Physical Entities grid alongside tables.
    for (const v of introspection.views) {
      const clientId = tableClientId(v.schemaName, v.viewName);
      out.push({
        candidateType: 'physical_data_entities',
        name: v.viewName,
        filePath: dbUri(v.schemaName, v.viewName),
        clientId,
        data: {
          dbEngine: 'postgres',
          databaseName: _ctx.config.databaseName,
          schemaName: v.schemaName,
          objectName: v.viewName,
          objectType: v.isMaterialized ? 'materialized_view' : 'view',
          estimatedRowCount: null,
          comment: null,
          confidence: 1.0,
          sourceEvidenceIds: [],
        },
      });
    }

    // Columns
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
          dbEngine: 'postgres',
          databaseName: _ctx.config.databaseName,
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
    return buildAllPostgresFindings(introspection, profile, relationships);
  }

  async close(): Promise<void> {
    if (this.adapter === null) return;
    try {
      await this.adapter.dispose();
    } finally {
      this.adapter = null;
    }
  }

  /**
   * Adapter accessor for the tests + the introspection / profile modules
   * (which receive it directly from the per-method calls above). Throws if
   * called before `connect()`.
   */
  private requireAdapter(): PostgresAdapter {
    if (this.adapter === null) {
      throw new Error(
        'PostgresDiscoveryPack: connect() must be called before any other method.',
      );
    }
    return this.adapter;
  }
}
