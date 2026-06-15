/**
 * Sybase discovery pack -- executable v1 via the JVM/JDBC sidecar.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4 (D1 override:
 * Sybase MUST be executable in v1; no silent stub).
 *
 * Implements {@link DatabaseDiscoveryPack} for Sybase ASE. Discovery-service
 * stays pure Node; all JDBC I/O happens in the {@code sybase-discovery-
 * sidecar} JVM process. This pack is a thin HTTP client over the sidecar
 * plus the per-engine transformation / finding emission layers.
 *
 * Sidecar location:
 *   - Resolved via {@code SYBASE_SIDECAR_URL} env var
 *     (default {@code http://localhost:8093}).
 *   - Each method opens a new fetch; the sidecar holds no per-pack state.
 *
 * Lifecycle:
 *   - {@code connect()} just caches the credentials on the instance. No
 *     long-lived connection is opened here -- every sidecar call carries
 *     credentials and the sidecar connects per request.
 *   - {@code close()} clears the cached credentials; no pool to dispose.
 *
 * Snippet redaction:
 *   - View / procedure / trigger bodies are routed through
 *     {@code snippetRedaction.redactSnippet} inside {@code sybaseFindings.ts}
 *     before they reach any persisted payload. Builders apply a defensive
 *     second pass.
 *
 * Candidate emission:
 *   - One {@code physical_data_entities} candidate per discovered table.
 *   - One {@code physical_data_attributes} candidate per discovered column,
 *     parent-linked via {@code parentCandidateClientId}.
 */

import type {
  DatabaseCandidatePayload,
  DatabaseDiscoveryPack,
  DatabaseDiscoveryPackContext,
} from '../DatabaseDiscoveryPack';
import type {
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
import {
  callSidecarIntrospect,
  callSidecarTestConnection,
  type SidecarCredentials,
  type SidecarIntrospectionResponse,
} from './sybaseSidecarClient';
import { transformSidecarIntrospection } from './sybaseIntrospection';
import { profileSybaseTables } from './sybaseProfiler';
import { inferSybaseRelationships } from './sybaseRelationshipInference';
import { buildAllSybaseFindings } from './sybaseFindings';

function dbUri(schema: string, table: string, column?: string): string {
  const base = `db://sybase/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  return column ? `${base}#${encodeURIComponent(column)}` : base;
}

function tableClientId(schema: string, table: string): string {
  return `sybtab:${schema}.${table}`;
}

export class SybaseDiscoveryPack implements DatabaseDiscoveryPack {
  readonly engineKey = 'sybase' as const;
  readonly displayName = 'Sybase ASE';

  /**
   * Cached sidecar-credential payload, populated on {@code connect()} and
   * cleared on {@code close()}. The pack does NOT persist credentials --
   * the orchestrator's secrets store is the authoritative holder for the
   * run; this field is a per-call convenience that lives only while the
   * pack instance is in-flight.
   */
  private creds: SidecarCredentials | null = null;

  /**
   * Cached introspection response so that downstream introspect* methods
   * do not re-hit the sidecar. The orchestrator calls every introspect*
   * method on the same pack instance per run, so caching is safe.
   */
  private cachedSidecarIntrospection: SidecarIntrospectionResponse | null =
    null;

  /**
   * Cached normalised introspection result. Stored so the profiler /
   * relationship-inference layers can reuse the table list without
   * re-deriving it on each call.
   */
  private cachedIntrospection: IntrospectionResult | null = null;

  async connect(ctx: DatabaseDiscoveryPackContext): Promise<void> {
    if (this.creds !== null) return; // idempotent
    this.creds = {
      host: ctx.config.host,
      port: ctx.config.port,
      database: ctx.config.databaseName,
      username: ctx.credentials.username,
      password: ctx.credentials.password,
      driver: ctx.config.sybaseDriver ?? 'auto',
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
        `[diag-pack] db_engine=sybase op=test_connection result=fail ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      throw new Error(
        `Sybase sidecar testConnection failed: ${resp.error ?? 'unknown error'}`,
      );
    }
    console.log(
      `[diag-pack] db_engine=sybase op=test_connection result=ok ` +
        `driver_used=${resp.driverUsed ?? 'unknown'} elapsed_ms=${Date.now() - start}`,
    );
    return {
      success: true,
      serverVersion: resp.serverVersion ?? undefined,
      driverUsed: resp.driverUsed ?? undefined,
    };
  }

  /**
   * Lazy introspection -- we hit the sidecar exactly once per run, then
   * serve all introspect* method calls out of the cached response.
   */
  private async ensureIntrospection(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<IntrospectionResult> {
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
        `[diag-pack] db_engine=sybase op=introspect_all result=fail ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      throw new Error(
        `Sybase sidecar introspect failed: ${sidecarResp.error ?? 'unknown error'}`,
      );
    }
    this.cachedSidecarIntrospection = sidecarResp;
    this.cachedIntrospection = transformSidecarIntrospection(sidecarResp);
    const intro = this.cachedIntrospection;
    console.log(
      `[diag-pack] db_engine=sybase op=introspect_all result=ok ` +
        `elapsed_ms=${Date.now() - start} ` +
        `tables=${intro.tables.length} columns=${intro.columns.length} ` +
        `views=${intro.views.length} procedures=${intro.procedures.length} ` +
        `triggers=${intro.triggers.length}`,
    );
    return this.cachedIntrospection;
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
   * Database-resident scheduled jobs / agents (Spec 2026-05-30 Data-Layer
   * Fidelity 2, Group F). Served from the cached sidecar introspection -- the
   * Sybase Job Scheduler where the sidecar surfaces it. The current sidecar
   * build does not project a jobs array (sybaseSidecarClient TODO(oracle-W3)),
   * so this returns [] today; the orchestrator then emits no jobs/agents
   * finding on the Sybase path until the sidecar surfaces the scheduler.
   */
  async introspectScheduledJobs(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ScheduledJobMetadata[]> {
    return (await this.ensureIntrospection(ctx)).scheduledJobs ?? [];
  }

  async profileTables(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    mode: ProfilingMode,
  ): Promise<ProfileResult> {
    const creds = this.requireCreds();
    return profileSybaseTables(creds, introspection, mode, ctx.config);
  }

  async inferRelationships(
    _ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    _profile: ProfileResult,
  ): Promise<RelationshipInference[]> {
    return inferSybaseRelationships(introspection);
  }

  async ingestWorkloadLogs(
    _ctx: DatabaseDiscoveryPackContext,
  ): Promise<void> {
    // D4 readiness hook -- v1 no-op.
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
          dbEngine: 'sybase',
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
    // Sybase ASE has no materialized-view concept at the catalog level
    // (sysobjects.type='V' is the only flavour), so every view emits as
    // objectType='view'. The save-back's objectType -> physical_type fallback
    // ('View') makes them visible on the Physical Entities grid.
    for (const v of introspection.views) {
      const clientId = tableClientId(v.schemaName, v.viewName);
      out.push({
        candidateType: 'physical_data_entities',
        name: v.viewName,
        filePath: dbUri(v.schemaName, v.viewName),
        clientId,
        data: {
          dbEngine: 'sybase',
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
          dbEngine: 'sybase',
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
    return buildAllSybaseFindings(introspection, profile, relationships);
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
        'SybaseDiscoveryPack: connect() must be called before any other method.',
      );
    }
    return this.creds;
  }
}
