/**
 * `DatabaseDiscoveryPack` -- the per-engine contract for database discovery.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 *
 * Each engine pack (PostgreSQL in Group 3, Sybase-via-sidecar in Group 4)
 * implements this interface. The orchestrator (`databasePackOrchestrator`)
 * walks the methods in order:
 *
 *     connect -> testConnection -> introspectSchemas
 *             -> introspectTables -> introspectColumns
 *             -> introspectKeysAndIndexes -> introspectViews
 *             -> introspectProcedures -> introspectTriggers
 *             -> profileTables (per mode)
 *             -> inferRelationships
 *             -> emitCandidates -> emitFindings
 *             -> close
 *
 * Each step is wrapped by the orchestrator in {@link withDbPackSoftFail}
 * (see `databasePackOrchestrator.ts`); a failure in any one step emits a
 * `db_pack_warning` finding and lets the run continue.
 *
 * `ingestWorkloadLogs` is the D4 readiness hook. v1 packs implement it as
 * a no-op `async () => { return; }` -- the orchestrator skips it entirely
 * when `allowWorkloadLogUpload === false`. No UI control wires it up in v1.
 *
 * Reuse contract
 * --------------
 * - All findings emitted by the pack go through the singleton
 *   {@link import('../findings/FindingEmitter').FindingEmitter}; the pack
 *   does NOT create its own emitter or persistence path.
 * - All snippet content (view body, procedure body, trigger body, sample
 *   row values) MUST go through
 *   {@link import('../../utils/snippetRedaction').redactSnippet} before
 *   being attached to a finding or evidence payload.
 * - All SQL queries issued against the target database MUST go through
 *   {@link import('../db/sqlGuard').assertReadonlySelect} before send.
 */

import type {
  ActualSchemaSnapshot,
  ColumnMetadata,
  ConnectionResult,
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
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
} from './types';
import type { FindingEmitInput } from '../findings/FindingEmitter';

/**
 * Re-export the profiling mode so callers don't need a separate import.
 */
export type { ProfilingMode };

/**
 * Per-run input to {@link DatabaseDiscoveryPack}. Carries the redacted-safe
 * config + the in-memory credentials. The orchestrator constructs this once
 * at run start and threads it through every step.
 */
export interface DatabaseDiscoveryPackContext {
  config: DatabaseDiscoveryConfig;
  credentials: DatabaseDiscoveryCredentials;
  runId: string;
  projectId: string;
  architectureId: string;
}

/**
 * Candidate emit payload returned by `emitCandidates`. v1 packs emit
 * `physical_data_entities` (per table) and `physical_data_attributes` (per
 * column) candidates via `bulkSaveCandidates` (wired in Group 3+). The
 * orchestrator is responsible for the actual persistence call; the pack
 * returns the payload shape.
 */
export interface DatabaseCandidatePayload {
  candidateType:
    | 'physical_data_entities'
    | 'physical_data_attributes'
    | 'logical_data_entity_relationships';
  /** Human-readable name (table or column). */
  name: string;
  /** Synthetic source URI -- `db://{engine}/{schema}/{table}[#{column}]`. */
  filePath: string;
  /** Structured payload persisted into the candidate row. */
  data: Record<string, unknown>;
  /**
   * Parent linkage. When `candidateType === 'physical_data_attributes'` the
   * parent is the table candidate; otherwise undefined.
   */
  parentCandidateClientId?: string;
  /** Stable client-side id used to wire parent linkages within a batch. */
  clientId: string;
}

/**
 * The engine pack interface. Each method is async; orchestrator wraps each
 * call in soft-fail and respects the per-finding-type cap.
 */
export interface DatabaseDiscoveryPack {
  /** Stable identifier (`'postgres'` / `'sybase'`). */
  readonly engineKey: 'postgres' | 'sybase';

  /** Human-readable label for log lines + the Findings tab. */
  readonly displayName: string;

  /**
   * Open the underlying connection / pool. MUST be idempotent for the
   * lifetime of the pack instance.
   */
  connect(ctx: DatabaseDiscoveryPackContext): Promise<void>;

  /** Smoke test the connection. Returns engine version on success. */
  testConnection(ctx: DatabaseDiscoveryPackContext): Promise<ConnectionResult>;

  introspectSchemas(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<SchemaMetadata[]>;

  introspectTables(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<TableMetadata[]>;

  introspectColumns(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ColumnMetadata[]>;

  introspectKeysAndIndexes(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<KeyOrIndexMetadata[]>;

  introspectViews(ctx: DatabaseDiscoveryPackContext): Promise<ViewMetadata[]>;

  introspectProcedures(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ProcedureMetadata[]>;

  introspectTriggers(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<TriggerMetadata[]>;

  /**
   * Introspect sequences / auto-increment generators (Spec 2026-05-29 DB
   * Structural Fidelity). Optional: a pre-existing pack that does not yet
   * implement it is tolerated (the orchestrator defaults the result to []).
   * The result feeds the Group B `sequence_definition` finding and confirms
   * serial-column sequences during column mapping. NO new architecture entity
   * type is produced from sequences.
   */
  introspectSequences?(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<SequenceMetadata[]>;

  /**
   * Introspect the database-level default collation (Spec 2026-05-30
   * Data-Layer Fidelity 2, Group B). Optional: a pre-existing pack that does
   * not implement it is tolerated (the orchestrator leaves
   * `IntrospectionResult.databaseCollation` null). The result is the VERBATIM
   * database-wide collation against which per-column collations are compared
   * for the Sybase-CI -> Postgres-CS cross-engine hazard. NO new architecture
   * entity type is produced.
   */
  introspectDatabaseCollation?(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<string | null>;

  /**
   * Introspect database-resident scheduled jobs / agents (Spec 2026-05-30
   * Data-Layer Fidelity 2, Group F). Optional: a pre-existing pack that does
   * not implement it is tolerated (the orchestrator defaults the result to
   * []). On Postgres this probes pg_cron / pgAgent; on Sybase it reads the Job
   * Scheduler where the sidecar exposes it. The result feeds the DB-resident
   * jobs/agents Finding (procedural reality). NO new architecture entity type
   * is produced -- jobs are a Finding, not an entity.
   */
  introspectScheduledJobs?(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ScheduledJobMetadata[]>;

  /**
   * VERIFICATION-ONLY scan mode (Spec 2026-06-11 DB Schema + Data Migration
   * Pack -- Task 4.2). Runs the structural introspection walk against the
   * TARGET database and returns the normalized actual-schema snapshot to the
   * caller, WRITING NOTHING to the model -- no candidates, no findings, no
   * discovery-run rows ever originate from this method. Optional: only the
   * Postgres pack implements it in v1 (the verification target is always
   * PostgreSQL); the route rejects engines whose pack does not implement it.
   */
  runVerificationOnlyScan?(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<ActualSchemaSnapshot>;

  /**
   * Run the profiler over the introspected tables, honoring `profilingMode`.
   * Per-table soft-fail is the pack's responsibility -- a single unreadable
   * table becomes an entry in `skippedTables` rather than a thrown error.
   */
  profileTables(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    mode: ProfilingMode,
  ): Promise<ProfileResult>;

  /**
   * OPTIONAL capability (2026-08-23): harvest LIVE stored proc/function/
   * trigger sources from the engine catalog (read-only). Engines without a
   * stored-object catalog simply omit it. The orchestrator soft-fails and
   * carries the sources on the run for the CODE scan's repo-vs-live merge
   * (live wins; loud drift findings).
   */
  harvestProcSources?(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<import('../../scl/sqlProcHarvester').LiveProcSource[]>;

  /**
   * OPTIONAL capability (2026-08-23, Oracle Nine item 2): read the rows of a
   * detected sequence-generator table (name + current value). Read-only.
   */
  /**
   * OPTIONAL capability (2026-08-23, item 3): detect the server's default
   * charset + sortorder from the engine catalog. Implementations SHOULD
   * also declare the detected charset on all subsequent connections.
   */
  detectServerCharset?(
    ctx: DatabaseDiscoveryPackContext,
  ): Promise<{
    charset: string | null;
    sortorderName: string | null;
    caseSensitive: boolean | null;
  } | null>;

  probeSequenceRows?(
    ctx: DatabaseDiscoveryPackContext,
    idiom: import('../../scl/sqlProcHarvester').SequenceGeneratorIdiom,
  ): Promise<Array<{ name: string | null; value: number | null }>>;

  /**
   * Compute declared + inferred + ambiguous relationships. Uses the
   * introspection + profile data the orchestrator already has.
   */
  inferRelationships(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    profile: ProfileResult,
  ): Promise<RelationshipInference[]>;

  /**
   * D4 readiness hook. v1 default implementation is a no-op. The
   * orchestrator skips the call entirely when
   * `ctx.config.allowWorkloadLogUpload === false`.
   */
  ingestWorkloadLogs(ctx: DatabaseDiscoveryPackContext): Promise<void>;

  /**
   * Build `physical_data_entities` + `physical_data_attributes` candidate
   * payloads from the gathered introspection + profile data. The
   * orchestrator persists these via `bulkSaveCandidates` (Group 3 wires
   * the persistence call; Group 2 just defines the shape).
   */
  emitCandidates(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    profile: ProfileResult,
  ): Promise<DatabaseCandidatePayload[]>;

  /**
   * Build the DB Findings for this run (structural, profiling, data
   * quality, hidden-logic, migration risk). Returns the list of
   * `FindingEmitInput`s; the orchestrator pipes them through the singleton
   * `FindingEmitter` and respects the `MAX_FINDINGS_PER_TYPE_PER_RUN` cap.
   */
  emitFindings(
    ctx: DatabaseDiscoveryPackContext,
    introspection: IntrospectionResult,
    profile: ProfileResult,
    relationships: RelationshipInference[],
  ): Promise<FindingEmitInput[]>;

  /** Release pooled resources. Idempotent. Called from the orchestrator's `finally`. */
  close(): Promise<void>;
}
