/**
 * Database discovery pack -- configuration + credential + result types.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 *
 * SECURITY CONTRACT
 * -----------------
 * - `DatabaseDiscoveryConfig` is the FULL request shape. It contains
 *   profiling flags + filters. NO password is on it; the password travels
 *   alongside in a separate `DatabaseDiscoveryCredentials` object kept ONLY
 *   in the in-process secret bundle (see `secretsStore.ts`).
 * - `RedactedDatabaseDiscoveryConfig` is the SAFE-TO-PERSIST shape. It is
 *   what gets written into the discovery run's `config_snapshot` in AMS.
 *   The `toRedactedConfig` helper strips both username and password and
 *   keeps the connection metadata that operators need for traceability
 *   (engine + host + database + filters + profiling mode).
 * - Username is also redacted: shaping notes spec section "Persisted config
 *   snapshot is redacted" calls out "NEVER raw username/password". The
 *   spec.md "DB config DTO fields" line keeps `username` on the IN-MEMORY
 *   request shape but the PERSISTED snapshot must not include it.
 */

/**
 * Engine identifier. Mirrors `DbType` in `../db/DbAdapter.ts` and the AMS
 * `discovery_kind` column's child-level engine discriminator.
 */
export const DATABASE_ENGINES = ['postgres', 'sybase', 'mssql'] as const;
export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export function isDatabaseEngine(value: unknown): value is DatabaseEngine {
  return typeof value === 'string' && (DATABASE_ENGINES as readonly string[]).includes(value);
}

/** Conventional default port per engine (UI + route defaults). */
export const DEFAULT_PORT_BY_ENGINE: Record<DatabaseEngine, number> = {
  postgres: 5432,
  sybase: 5000,
  mssql: 1433,
};

/** The 400 message fragment listing the accepted engine values. */
export const DATABASE_ENGINE_CHOICES = DATABASE_ENGINES.map((e) => `"${e}"`).join(', ');

/**
 * Profiling ladder per D8 of the shaping notes.
 *
 * - `none`     -- introspection only, NO profile queries against the DB.
 * - `basic`    -- row count + null rate per column.
 * - `standard` -- basic + min/max + sample values for selected columns
 *                 (default).
 * - `deep`     -- standard + distinct-count exacts on large tables +
 *                 value-overlap sampling for relationship inference.
 *                 REQUIRES an explicit confirmation flag on the request
 *                 (`deepProfilingConfirmed=true`); without it, the pack
 *                 rejects the run with a finding-emitter warning.
 */
export type ProfilingMode = 'none' | 'basic' | 'standard' | 'deep';

/**
 * Full database-discovery request payload (in-memory only).
 *
 * Per the shaping notes, `username` lives here so the pack can construct
 * an adapter, but it MUST NOT survive into the persisted `config_snapshot`
 * -- see {@link toRedactedConfig}. The `password` is intentionally NOT on
 * this interface: it travels via {@link DatabaseDiscoveryCredentials} and
 * lives only in the in-process secrets bundle keyed by `runId`.
 */
export interface DatabaseDiscoveryConfig {
  /** Engine to use; selects the pack via `databasePackFactory`. */
  dbEngine: DatabaseEngine;

  /** Connection host (e.g. `db.internal.example.com`). Display-safe. */
  host: string;

  /** Connection port. */
  port: number;

  /** Target database name. */
  databaseName: string;

  /**
   * Catalog name (Sybase / SQL-Server-style). Optional for engines that
   * use `databaseName` directly (Postgres).
   */
  catalogName?: string | null;

  /**
   * Default / single schema name when neither include nor exclude lists are
   * provided. Used by introspection to scope the catalog walk.
   */
  schemaName?: string | null;

  /** Optional include filter (schema names). Empty / undefined = no filter. */
  includeSchemas?: string[] | null;

  /** Optional exclude filter (schema names). Empty / undefined = no filter. */
  excludeSchemas?: string[] | null;

  /** Optional include filter (table names, qualified or bare). */
  includeTables?: string[] | null;

  /** Optional exclude filter (table names, qualified or bare). */
  excludeTables?: string[] | null;

  /** Profiling ladder; default = `standard`. */
  profilingMode: ProfilingMode;

  /** Hard cap on number of tables profiled per run (prevents runaway). */
  maxTablesToProfile: number;

  /** Hard row cap injected into every profile / sample SELECT. */
  maxRowsPerProfileQuery: number;

  /** Per-query statement timeout (seconds). */
  queryTimeoutSeconds: number;

  /**
   * D4 readiness flag -- v1 hooks only. When true the orchestrator MAY
   * expose a workload-log upload control to the UI; the actual ingest path
   * is deferred. Default false.
   */
  allowWorkloadLogUpload: boolean;

  /**
   * Read-only confirmation captured from the UI second-click pattern.
   * Independent of the DB user's grant set (defense in depth: the user
   * MUST acknowledge the run is read-only-only-only).
   */
  readOnlyConfirmed?: boolean;

  /**
   * Required when `profilingMode === 'deep'`. The orchestrator MUST reject
   * a deep run without this flag (emits `db_pack_warning`).
   */
  deepProfilingConfirmed?: boolean;

  /**
   * In-memory only; populated by the runtime when the user supplies a
   * username with the request. Stripped by {@link toRedactedConfig} before
   * persistence.
   */
  username?: string;

  /**
   * Sybase-only: which JDBC driver flavour the sidecar should attempt.
   * `auto` (default) tries jTDS first then falls through to jConnect; the
   * explicit values force one driver. Ignored by non-Sybase engines.
   */
  sybaseDriver?: 'auto' | 'jtds' | 'jconnect';

  /**
   * Engine-scoped connection extras carried for engines whose JDBC URL needs
   * more than host/port/database/user/password. Populated by the scan entry
   * form; passed straight through to the sidecar's connection block. The
   * secret-bearing half of a connection NEVER lives here -- only the
   * NON-secret knobs (auth scheme, domain, TLS posture, named instance).
   * Ignored by engines that do not declare the extras.
   */
  mssqlAuth?: MssqlAuthConfig;
}

/**
 * SQL-Server-shaped connection extras (WIRE-CONTRACT v2 §1). Carried on the
 * discovery config and forwarded verbatim to the sidecar's connection block.
 *
 * NO SECRETS: the username / password travel in
 * {@link DatabaseDiscoveryCredentials} exactly as for every other engine.
 * `domain` is a Windows DOMAIN name, not a credential -- it is part of the
 * NTLM principal, and is safe to persist in the redacted config snapshot.
 */
export interface MssqlAuthConfig {
  /**
   * `sql` = a SQL login (Mixed Mode). `ntlm` = a Windows domain login,
   * performed in pure Java by `mssql-jdbc`
   * (`authenticationScheme=NTLM;domain=...`). Kerberos SSO is deliberately
   * out of scope: it needs a native DLL.
   */
  scheme: 'sql' | 'ntlm';
  /** Windows domain. REQUIRED when `scheme === 'ntlm'`. */
  domain?: string | null;
  /** TLS on the wire. Defaults ON -- `mssql-jdbc` 12.x encrypts by default. */
  encrypt: boolean;
  /** Accept a self-signed / non-CA-trusted server certificate. Defaults OFF. */
  trustServerCertificate: boolean;
  /** Named instance. The port is still honoured when both are supplied. */
  instanceName?: string | null;
}

/**
 * In-memory secret payload. NEVER persisted; lives only in the per-run
 * secrets bundle (`secretsStore.ts`) and is purged on run terminal status.
 */
export interface DatabaseDiscoveryCredentials {
  username: string;
  password: string;
}

/**
 * Persisted shape written into AMS `config_snapshot`. Stripped of every
 * secret-bearing field; safe to expose in run-history views.
 */
export interface RedactedDatabaseDiscoveryConfig {
  engine: DatabaseEngine;
  host: string;
  port: number;
  databaseName: string;
  catalogName?: string | null;
  schemaName?: string | null;
  includeSchemas?: string[] | null;
  excludeSchemas?: string[] | null;
  includeTables?: string[] | null;
  excludeTables?: string[] | null;
  profilingMode: ProfilingMode;
  maxTablesToProfile: number;
  maxRowsPerProfileQuery: number;
  queryTimeoutSeconds: number;
  readOnlyConfirmed: boolean;
  deepProfilingConfirmed: boolean;
  /** Sybase-only driver choice ('auto' / 'jtds' / 'jconnect'). null for non-Sybase. */
  sybaseDriver?: 'auto' | 'jtds' | 'jconnect' | null;
  /**
   * Engine connection extras, MINUS every secret. The scheme / TLS posture /
   * named instance / Windows domain are audit-relevant connection facts, so
   * they survive into the persisted snapshot; the credentials never do (see
   * {@link containsCredentials}). null when the engine declares no extras.
   */
  mssqlAuth?: MssqlAuthConfig | null;
  /** D4 readiness flag — whether the run was supplied a workload log file. */
  workloadLogProvided: boolean;
  /**
   * Negative assertion -- present so consumers can audit-grep this object
   * and confirm secrets were NOT carried through. Always literal `false`.
   */
  containsCredentials: false;
}

/**
 * Strip the secret-bearing fields and produce the persisted shape.
 *
 * Caller passes `hasWorkloadLog` separately because the workload log file
 * isn't a config field per se -- it's an upload that may or may not have
 * been supplied alongside the run-start request. v1 always passes `false`
 * (D4 deferred).
 */
export function toRedactedConfig(
  config: DatabaseDiscoveryConfig,
  hasWorkloadLog: boolean,
): RedactedDatabaseDiscoveryConfig {
  return {
    engine: config.dbEngine,
    host: config.host,
    port: config.port,
    databaseName: config.databaseName,
    catalogName: config.catalogName ?? null,
    schemaName: config.schemaName ?? null,
    includeSchemas: config.includeSchemas ?? null,
    excludeSchemas: config.excludeSchemas ?? null,
    includeTables: config.includeTables ?? null,
    excludeTables: config.excludeTables ?? null,
    profilingMode: config.profilingMode,
    maxTablesToProfile: config.maxTablesToProfile,
    maxRowsPerProfileQuery: config.maxRowsPerProfileQuery,
    queryTimeoutSeconds: config.queryTimeoutSeconds,
    readOnlyConfirmed: config.readOnlyConfirmed === true,
    deepProfilingConfirmed: config.deepProfilingConfirmed === true,
    sybaseDriver: config.dbEngine === 'sybase' ? (config.sybaseDriver ?? 'auto') : null,
    // Connection extras minus secrets. Only the non-secret knobs are copied,
    // field by field -- a spread would carry forward any future secret-bearing
    // addition silently.
    mssqlAuth: config.mssqlAuth
      ? {
          scheme: config.mssqlAuth.scheme,
          domain: config.mssqlAuth.domain ?? null,
          encrypt: config.mssqlAuth.encrypt !== false,
          trustServerCertificate:
            config.mssqlAuth.trustServerCertificate === true,
          instanceName: config.mssqlAuth.instanceName ?? null,
        }
      : null,
    workloadLogProvided: hasWorkloadLog === true,
    containsCredentials: false,
  };
}

// -----------------------------------------------------------------------------
// Introspection / profiling / inference result shapes
// -----------------------------------------------------------------------------

/**
 * Result of a `connect()` call. `serverVersion` is best-effort; the field
 * is optional so adapters that can't extract it don't break the contract.
 */
export interface ConnectionResult {
  success: true;
  serverVersion?: string;
  /** Engine-reported edition / build metadata for the run's evidence log. */
  serverEdition?: string;
  /**
   * Sybase-only: which driver flavour ultimately opened the connection
   * (`jtds` / `jconnect`). Populated when the engine pack can report it;
   * undefined for non-Sybase engines.
   */
  driverUsed?: string;
}

/**
 * Schema metadata returned by `introspectSchemas`.
 */
export interface SchemaMetadata {
  schemaName: string;
  /** Optional owner / creator if the engine exposes it. */
  owner?: string | null;
}

/**
 * Table metadata returned by `introspectTables`.
 */
export interface TableMetadata {
  schemaName: string;
  tableName: string;
  /** `'table' | 'view' | 'materialized_view'` -- engine-normalised. */
  objectType: 'table' | 'view' | 'materialized_view';
  /** Best-effort row count (catalog statistic; not a live count). */
  estimatedRowCount?: number | null;
  /** Optional comment / description. */
  comment?: string | null;
}

/**
 * Column metadata returned by `introspectColumns`.
 *
 * The structural-fidelity fields (`scale`, `precision`, `isIdentity`,
 * `sequenceName`) are the IR source for the Group A
 * `physical_data_attributes` enrichment (Spec: 2026-05-29 DB Structural
 * Fidelity). They are captured VERBATIM -- no type normalization; the
 * Sybase->Postgres mapping is a downstream migration concern. All four are
 * optional so the pre-existing introspectors and their tests round-trip
 * unchanged when they do not populate them.
 *
 * Spec 2026-05-30 Data-Layer Fidelity 2 adds `collation` (Group B) and
 * `isGenerated` / `generationExpression` (Group E) -- additive, optional,
 * verbatim, ALONGSIDE the Oracle-W3 / Spec-3 fields (which are untouched).
 */
export interface ColumnMetadata {
  schemaName: string;
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
  defaultExpression?: string | null;
  ordinalPosition: number;
  /** Character / numeric length where applicable. */
  maxLength?: number | null;
  /**
   * Numeric scale (digits to the right of the decimal point) where the engine
   * reports one. Sourced verbatim from
   * `information_schema.columns.numeric_scale` (Postgres) / the sidecar column
   * scale (Sybase). null/undefined when N/A.
   */
  scale?: number | null;
  /**
   * Numeric precision (total significant digits) where the engine reports one.
   * Sourced verbatim from `information_schema.columns.numeric_precision`
   * (Postgres) / the sidecar column precision (Sybase). null/undefined when N/A.
   */
  precision?: number | null;
  /**
   * TRUE when the column is an identity / auto-increment column (Postgres
   * `GENERATED ... AS IDENTITY` or a serial/sequence default; Sybase column
   * with the identity property). undefined when unknown / not introspected.
   */
  isIdentity?: boolean;
  /**
   * Name of the sequence backing this column when the identity / default is
   * sequence-driven (e.g. a Postgres `nextval('seq'::regclass)` default).
   * Cross-references a {@link SequenceMetadata} record. null/undefined when the
   * column is not sequence-backed.
   */
  sequenceName?: string | null;
  /**
   * Column-level collation (Spec 2026-05-30 Data-Layer Fidelity 2, Group B).
   * The VERBATIM engine collation string (e.g. Postgres `"en_US.utf8"` /
   * `"C"`; a Sybase case-insensitive sort-order name where the sidecar exposes
   * it). NO normalization -- the cross-engine case-sensitivity hazard lives in
   * the collation Finding, never as a mutation of the captured value.
   * null/undefined when the column uses the database default collation or the
   * engine / sidecar does not report a per-column collation. Cross-engine
   * relevance: a Sybase case-INSENSITIVE collation that Postgres's
   * case-SENSITIVE default would not reproduce silently changes
   * `WHERE name='smith'` semantics.
   */
  collation?: string | null;
  /**
   * TRUE when the column is a COMPUTED / GENERATED column (Spec 2026-05-30
   * Data-Layer Fidelity 2, Group E) -- a Postgres
   * `GENERATED ALWAYS AS (expr) STORED` column or a Sybase computed column --
   * as opposed to a plain writable column. Without this flag a generated
   * column is wrongly recreated as a plain column populated by INSERT/UPDATE.
   * undefined when unknown / not introspected; false/undefined for a plain
   * writable column.
   */
  isGenerated?: boolean;
  /**
   * The VERBATIM generation expression for a computed / generated column
   * (Spec 2026-05-30 Data-Layer Fidelity 2, Group E), e.g. the `(price * qty)`
   * body of `GENERATED ALWAYS AS (price * qty) STORED`. NO normalization. Only
   * meaningful when {@link isGenerated} is true; null/undefined otherwise or
   * when the engine / sidecar does not report the expression.
   */
  generationExpression?: string | null;
}

/**
 * Sequence / auto-increment generator metadata.
 *
 * There was no sequence IR type before Spec 2026-05-29; this is the minimal
 * carrier sufficient to (a) populate the attribute identity / sequence fields
 * and (b) feed the Group B `sequence_definition` finding. NO new architecture
 * entity type is minted from this -- it is an IR-only carrier whose body lands
 * as a Finding, not as a meta-model entity.
 *
 * Spec 2026-05-30 Data-Layer Fidelity 2 (Group C) adds `currentValue` -- the
 * sequence's allocation high-water mark -- additive, optional, verbatim,
 * ALONGSIDE the start/increment/min/max/cycle fields (which are untouched).
 */
export interface SequenceMetadata {
  schemaName: string;
  sequenceName: string;
  /** Engine data type of the sequence where reported (e.g. `bigint`). */
  dataType?: string | null;
  /** Start value where the catalog reports one. */
  startValue?: string | null;
  /** Increment step where the catalog reports one. */
  increment?: string | null;
  /** Min value where the catalog reports one. */
  minValue?: string | null;
  /** Max value where the catalog reports one. */
  maxValue?: string | null;
  /** TRUE when the sequence wraps around (CYCLE). */
  cycle?: boolean;
  /**
   * The sequence's CURRENT value -- the allocation high-water mark (Spec
   * 2026-05-30 Data-Layer Fidelity 2, Group C). VERBATIM engine value, kept as
   * a STRING so a `bigint` past Number.MAX_SAFE_INTEGER is never lossily
   * coerced (the same string discipline as `startValue` / `maxValue`). On
   * Postgres this is `pg_sequences.last_value` (the last value handed out, i.e.
   * what `currval()` would return); a never-yet-used sequence reports null /
   * its start value. Cross-engine relevance: recreating the sequence at its
   * START rather than this high-water mark means the FIRST post-cutover INSERT
   * re-allocates an already-used id and COLLIDES with an existing PK. The
   * current Sybase sidecar does NOT project a current value (it exposes the
   * `sequences` shape but no current-value column -- TODO(oracle-W3)), so this
   * arrives null on the Sybase path and the cutover Finding is marked
   * value-unavailable. null/undefined when the engine / sidecar does not report
   * it.
   */
  currentValue?: string | null;
  /**
   * The table.column this sequence is owned-by / backs, when discoverable
   * (e.g. a serial column's implicit sequence). null when standalone.
   */
  ownedByTable?: string | null;
  ownedByColumn?: string | null;
  /**
   * Raw, verbatim definition string (pre-redaction) where the engine can
   * report one (Sybase numbered/sequence DDL). The Group B
   * `sequence_definition` finding redacts + size-caps this before persistence.
   */
  definition?: string | null;
}

/**
 * Database-resident scheduled-job / agent metadata (Spec 2026-05-30 Data-Layer
 * Fidelity 2, Group F).
 *
 * Captures a job/agent that lives INSIDE the database -- a Postgres pg_cron /
 * pgAgent job, or a Sybase Job-Scheduler / `sp_add_job`-style agent -- so the
 * book-of-work knows the source database has scheduled procedural reality that
 * does NOT travel with a static schema migration (PostgreSQL core ships no
 * built-in scheduler; pg_cron is an extension that must be provisioned + the
 * jobs recreated on the target). This is procedural REALITY captured as a
 * Finding, NOT a new architecture meta-model entity TYPE (architecture !=
 * reality). All detail is VERBATIM.
 */
export interface ScheduledJobMetadata {
  /** Schema / owner of the job where the engine exposes one (else ''). */
  schemaName: string;
  /** The job / agent name. */
  jobName: string;
  /**
   * The scheduler mechanism this job belongs to (VERBATIM engine label, e.g.
   * `pg_cron` / `pgagent` / `sybase_job_scheduler`). Lets the book-of-work
   * pick the right target-side recreation strategy.
   */
  scheduler?: string | null;
  /**
   * The schedule expression VERBATIM (e.g. a cron string `0 3 * * *`, or a
   * Sybase frequency descriptor). NO normalization. null when not reported.
   */
  schedule?: string | null;
  /**
   * The command / SQL / procedure the job runs VERBATIM (e.g. the pg_cron
   * `command` text, or the Sybase job step command). The finding builder
   * redacts + size-caps this before persistence. null when not reported.
   */
  command?: string | null;
  /**
   * Whether the job is currently enabled / active, where the engine reports it.
   * undefined when unknown / not introspected.
   */
  enabled?: boolean;
}

/**
 * An object that has no row in the six classic introspection arrays
 * (schemas / tables / columns / keys / views / procedures / triggers) but
 * whose existence changes the migration: a queue, a table type, a synonym, a
 * full-text catalog, an assembly, a partition scheme, a change-tracking
 * registration, a row-level-security policy, ...
 *
 * SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11). The
 * carrier is deliberately ENGINE-NEUTRAL: `kind` is a free string owned by
 * the producing pack's vocabulary (the sidecar wire contract lists the values
 * the SQL Server pack emits), and `detail` is a free map. Packs that have no
 * such objects simply never populate the array, so the Sybase and Postgres
 * paths are untouched.
 *
 * Like sequences and scheduled jobs, an extended object is IR + Findings
 * reality -- it NEVER mints a new architecture meta-model entity type.
 */
export interface ExtendedObjectMetadata {
  /**
   * The object's kind, VERBATIM from the producing pack's vocabulary (e.g.
   * `service_broker_queue`, `user_defined_table_type`, `synonym`,
   * `fulltext_catalog`, `assembly`, `xml_schema_collection`,
   * `partition_scheme`, `partition_function`, `cdc_capture_instance`,
   * `change_tracking`, `filestream_filegroup`, `database_trigger`,
   * `rowlevel_security_policy`, `external_table`, `temporal_history_link`).
   */
  kind: string;
  /** Schema / owner where the engine exposes one; '' otherwise. */
  schemaName: string;
  /** The object name. */
  name: string;
  /**
   * The object's verbatim definition / body where the engine exposes one
   * (e.g. an assembly's permission set, a partition function's boundary
   * list, a policy's predicate). Finding builders redact + size-cap this
   * before persistence. null when the catalog reports no body.
   */
  definition?: string | null;
  /**
   * Free-form per-kind detail map, VERBATIM (e.g. a table type's columns, a
   * synonym's base object, a queue's activation procedure). No normalization.
   */
  detail?: Record<string, unknown> | null;
}

/**
 * Three-state applicability for an enrichment metadata group (Spec 2026-05-31
 * sybase-metadata-enrichment, decision 2). Lets a downstream reviewer /
 * reconciliation distinguish a genuine capture failure from a deliberate
 * engine-structural absence, so a Sybase ASE structural N/A is never misread as
 * a read gap.
 *
 * - `present`                   -- the group value was captured.
 * - `not_applicable_for_engine` -- the engine STRUCTURALLY lacks the construct
 *   (e.g. Sybase ASE has no filtered/partial indexes -> no index predicate;
 *   native SEQUENCE objects pre-ASE16). A DELIBERATE N/A: NO `TODO(oracle-W3)`
 *   evidence-gap Finding is emitted (optionally a benign N/A note).
 * - `unavailable`               -- the engine SUPPORTS the construct and/or the
 *   sidecar advertised the capability, but the value could not be read. This is
 *   the genuine read gap that still emits the `TODO(oracle-W3)` evidence-gap
 *   Finding. An ABSENT capability from an OLDER sidecar resolves HERE (a read
 *   gap), NOT to a structural N/A.
 */
export type MetadataApplicability =
  | 'present'
  | 'not_applicable_for_engine'
  | 'unavailable';

/**
 * Canonical enrichment-metadata group keys (Spec 2026-05-31). These are the
 * vocabulary discovery resolves applicability against AND the exact verbatim
 * strings the sidecar advertises in its `capabilities[]` array. Keep this
 * union, the sidecar `capabilities` keys, and the resolver group list in
 * lock-step. `index_predicate` and `native_sequence` are discovery-internal
 * structural markers (ASE lacks both constructs) -- the sidecar never
 * advertises them; discovery resolves them from engine knowledge + version.
 */
export type MetadataGroupKey =
  | 'collation'
  | 'computed_columns'
  | 'sequence_current_value'
  | 'fk_actions'
  | 'index_clustering'
  | 'index_predicate'
  | 'native_sequence'
  | 'db_jobs';

/**
 * Per-group applicability map (Spec 2026-05-31). Optional on the IR
 * ({@link IntrospectionResult.metadataApplicability}); a producer that does not
 * resolve applicability simply omits it and the finding emitters fall back to
 * their pre-existing always-emit behaviour. A group key may be absent from the
 * map, which the consumers treat the same as `unavailable` (conservative read
 * gap).
 */
export type MetadataApplicabilityMap = Partial<
  Record<MetadataGroupKey, MetadataApplicability>
>;

/**
 * Key / index metadata returned by `introspectKeysAndIndexes`.
 */
export interface KeyOrIndexMetadata {
  schemaName: string;
  tableName: string;
  /**
   * `primary_key | unique_constraint | foreign_key | index | check_constraint`
   * -- engine-normalised.
   */
  kind:
    | 'primary_key'
    | 'unique_constraint'
    | 'foreign_key'
    | 'index'
    | 'check_constraint';
  name: string;
  columns: string[];
  /** Populated for foreign keys only. */
  referencedSchema?: string | null;
  referencedTable?: string | null;
  referencedColumns?: string[] | null;
  /**
   * FK referential ACTION on delete / on update (verbatim engine string, e.g.
   * `CASCADE` / `SET NULL` / `NO ACTION` / `RESTRICT` / `SET DEFAULT`). Only
   * populated for `kind === 'foreign_key'`; these change cross-engine
   * (Sybase->Postgres) behaviour and feed the relationship
   * `fk_columns.on_delete` / `fk_columns.on_update` JSONB keys. null/undefined
   * when the engine / sidecar does not report them (Oracle-W3). NO
   * normalization -- the value is the engine's own string.
   */
  onDelete?: string | null;
  onUpdate?: string | null;
  /** TRUE for non-unique index. */
  isUnique?: boolean;
  /**
   * Check-constraint expression (verbatim) where the engine reports one. Only
   * populated for `kind === 'check_constraint'`; feeds the Group A entity
   * `constraints_metadata.check_constraints[].expression`. null/undefined for
   * all other kinds.
   */
  checkExpression?: string | null;
  /**
   * Index ordering / clustering / partial-predicate metadata (Oracle-W3). All
   * fields are VERBATIM from the engine catalog (no normalization) and feed the
   * Group A entity `constraints_metadata.indexes[]` JSONB. Populated mainly for
   * `kind === 'index'` (and may be present on constraint-backed indexes where
   * the engine exposes it). null/undefined when not derivable / not
   * introspected.
   */
  /** The full verbatim index DDL (Postgres `pg_indexes.indexdef`). */
  indexDefinition?: string | null;
  /** Access method / index type (e.g. `btree` / `gin` / `hash`). */
  indexMethod?: string | null;
  /**
   * TRUE when the index is clustered, FALSE when explicitly non-clustered,
   * null when the engine reports the index but its clustered status is unknown
   * (the Sybase wire is three-valued -- the Postgres path always sets a concrete
   * boolean). The `constraints_metadata.indexes[]` reshaper only sets the JSONB
   * key on an explicit TRUE, so null/false round-trip cleanly.
   */
  isClustered?: boolean | null;
  /** Partial-index predicate (the `WHERE ...` clause), verbatim. */
  indexPredicate?: string | null;
  /**
   * Per-column ordering directives parsed from the index DDL, positionally
   * aligned with `columns[]` -- e.g. `ASC` / `DESC NULLS FIRST`. Verbatim.
   */
  columnDirections?: string[] | null;
}

/**
 * View definition returned by `introspectViews`. The `definition` field
 * MUST go through `snippetRedaction.redactSnippet` before persistence.
 */
export interface ViewMetadata {
  schemaName: string;
  viewName: string;
  /** Raw view definition string (pre-redaction). */
  definition: string;
  isMaterialized: boolean;
}

/**
 * Stored procedure / function metadata returned by `introspectProcedures`.
 * `body` MUST go through `snippetRedaction.redactSnippet` before persistence.
 *
 * Spec 2026-05-30 Data-Layer Fidelity 2 (Group G) adds fuller-capture fields
 * (`fullDefinition` / `arguments` / `returnType` / `volatility` /
 * `securityDefiner`) ALONGSIDE the existing `body` -- additive, optional,
 * verbatim -- so overloaded and security-context functions are recreatable.
 * The `body` (`prosrc`) still flows to its existing
 * `stored_procedure_logic` Finding unchanged.
 */
export interface ProcedureMetadata {
  schemaName: string;
  procedureName: string;
  /** `'procedure' | 'function'` -- engine-normalised. */
  routineKind: 'procedure' | 'function';
  /** Raw routine body (pre-redaction). */
  body: string;
  /** Language tag if available (e.g. `'plpgsql'`, `'sql'`, `'TSQL'`). */
  language?: string | null;
  /**
   * The FULL verbatim `CREATE FUNCTION ...` / `CREATE PROCEDURE ...` envelope
   * (Postgres `pg_get_functiondef(p.oid)`) -- the complete recreatable
   * definition, including the argument list, return type, language, volatility,
   * `SECURITY DEFINER`, and the body. Captured VERBATIM (no normalization).
   * null/undefined when the engine / sidecar does not expose a full-definition
   * helper (e.g. the current Sybase sidecar -- TODO(oracle-W3)).
   */
  fullDefinition?: string | null;
  /**
   * The VERBATIM argument signature where the engine reports it (Postgres
   * `pg_get_function_arguments(p.oid)`, e.g.
   * `customer_id integer, as_of date DEFAULT CURRENT_DATE`). This is what makes
   * an OVERLOADED function distinguishable from its siblings. null/undefined
   * when unavailable.
   */
  arguments?: string | null;
  /**
   * The VERBATIM return type where the engine reports it (Postgres
   * `pg_get_function_result(p.oid)`, e.g. `TABLE(id integer, total numeric)` /
   * `integer`). null/undefined when unavailable.
   */
  returnType?: string | null;
  /**
   * Volatility classification where the engine reports it. VERBATIM engine
   * token mapped from Postgres `pg_proc.provolatile`
   * (`i` -> `IMMUTABLE`, `s` -> `STABLE`, `v` -> `VOLATILE`). Affects planning /
   * caching semantics and must be reproduced on the target. null/undefined when
   * unavailable.
   */
  volatility?: string | null;
  /**
   * TRUE when the routine runs with the privileges of its DEFINER (Postgres
   * `pg_proc.prosecdef` / `SECURITY DEFINER`) rather than the invoker. A
   * security-context concern that MUST be reproduced on the target.
   * undefined when unknown / not introspected; false when explicitly
   * `SECURITY INVOKER`.
   */
  securityDefiner?: boolean;
}

/**
 * Trigger metadata returned by `introspectTriggers`. `actionStatement` is
 * the body and MUST be redacted before persistence.
 */
export interface TriggerMetadata {
  schemaName: string;
  triggerName: string;
  tableSchema: string;
  tableName: string;
  /** `'before' | 'after' | 'instead_of'` -- engine-normalised. */
  timing: 'before' | 'after' | 'instead_of';
  /** `'insert' | 'update' | 'delete' | 'truncate'` -- one or more. */
  events: Array<'insert' | 'update' | 'delete' | 'truncate'>;
  /** Raw trigger body (pre-redaction). */
  actionStatement: string;
}

/**
 * Result envelope for the introspection phase.
 *
 * `sequences` was added by Spec 2026-05-29 (DB Structural Fidelity); it is the
 * IR source for the Group B `sequence_definition` finding and the attribute
 * identity/sequence fields. Pre-existing producers that omit it are tolerated
 * (callers default to `[]`).
 *
 * `databaseCollation` (Spec 2026-05-30 Data-Layer Fidelity 2, Group B) is the
 * DB-level default collation carrier: the VERBATIM database-wide collation
 * string against which a per-column `collation` is compared. Optional for
 * back-compat (older producers omit it).
 *
 * `scheduledJobs` (Spec 2026-05-30 Data-Layer Fidelity 2, Group F) carries
 * database-resident scheduled jobs / agents (pg_cron / pgAgent on Postgres; the
 * Sybase Job Scheduler where the sidecar exposes it). Optional for back-compat;
 * feeds the DB-resident jobs/agents Finding (procedural reality, NOT a new
 * entity type).
 */
export interface IntrospectionResult {
  schemas: SchemaMetadata[];
  tables: TableMetadata[];
  columns: ColumnMetadata[];
  keysAndIndexes: KeyOrIndexMetadata[];
  views: ViewMetadata[];
  procedures: ProcedureMetadata[];
  triggers: TriggerMetadata[];
  /** Sequences / auto-increment generators (Spec 2026-05-29). Optional for back-compat. */
  sequences?: SequenceMetadata[];
  /**
   * Database-level default collation (Spec 2026-05-30 Data-Layer Fidelity 2,
   * Group B). VERBATIM engine string (Postgres `datcollate` for the connected
   * database; a Sybase server/database sort order where the sidecar exposes
   * it). null/undefined when not introspected. Feeds the collation
   * cross-engine hazard reasoning (a Sybase case-insensitive default vs a
   * Postgres case-sensitive default).
   */
  databaseCollation?: string | null;
  /**
   * Database-resident scheduled jobs / agents (Spec 2026-05-30 Data-Layer
   * Fidelity 2, Group F). Optional for back-compat; defaults to `[]` when the
   * pack does not introspect them. Feeds the DB-resident jobs/agents Finding.
   */
  scheduledJobs?: ScheduledJobMetadata[];
  /**
   * Objects with no row in the six classic arrays (SQL Server pair programme,
   * Spec 2, 2026-09-11). OPTIONAL: a pack that does not introspect them omits
   * the array entirely and every existing consumer is unaffected. Feeds the
   * per-kind unsupported-feature / decision Findings.
   */
  extendedObjects?: ExtendedObjectMetadata[];
  /**
   * Per-group enrichment-metadata applicability (Spec 2026-05-31
   * sybase-metadata-enrichment, decision 2). Resolved discovery-side from the
   * sidecar `capabilities[]` array + engine-structural knowledge + value
   * presence; consumed by the finding emitters so a structurally-absent
   * construct (`not_applicable_for_engine`) SUPPRESSES the `TODO(oracle-W3)`
   * evidence-gap Finding that an `unavailable` group still emits. Optional for
   * back-compat: a producer that does not resolve it omits it and the emitters
   * fall back to their pre-existing behaviour.
   */
  metadataApplicability?: MetadataApplicabilityMap;
}

/**
 * Profile statistics for a single column. Populated subset depends on
 * `profilingMode`:
 *   - `none`     -- (no profile call)
 *   - `basic`    -- nullRate populated; rest undefined
 *   - `standard` -- nullRate + min/max + sample values
 *   - `deep`     -- everything (including distinctCount)
 */
export interface ColumnProfile {
  schemaName: string;
  tableName: string;
  columnName: string;
  nullRate?: number | null;
  distinctCount?: number | null;
  minValue?: string | null;
  maxValue?: string | null;
  /** Top-N value/count tuples, post-redaction on value text. */
  topValues?: Array<{ value: string; count: number }> | null;
  /** Redacted sample row values (each entry already through `redactSnippet`). */
  sampleValues?: string[] | null;
  /** TRUE when the profile run hit a known sentinel value (e.g. `9999-12-31`). */
  sentinelDetected?: boolean;
}

/**
 * Profile statistics for a single table.
 */
export interface TableProfile {
  schemaName: string;
  tableName: string;
  rowCount?: number | null;
  columnProfiles: ColumnProfile[];
}

/**
 * Result envelope for the profiling phase.
 */
export interface ProfileResult {
  tables: TableProfile[];
  /**
   * Soft-fail tables -- profile attempt failed (timeout, lock contention,
   * unreadable). Each entry becomes an `evidence_gap` finding with
   * `gapType='db_profile_skipped'` or `gapType='db_unreadable_object'`.
   */
  skippedTables: Array<{
    schemaName: string;
    tableName: string;
    reason: string;
  }>;
}

/**
 * Inferred or declared relationship returned by `inferRelationships`.
 */
export interface RelationshipInference {
  fromSchema: string;
  fromTable: string;
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  toColumns: string[];
  /**
   * - `declared_fk`         -- a real FK exists in the catalog (`enforced`).
   * - `unenforced_relationship` -- FK metadata exists but enforcement is off.
   * - `inferred`            -- discovered by naming / value-overlap heuristics.
   * - `ambiguous`           -- multiple plausible parents matched equally.
   */
  kind:
    | 'declared_fk'
    | 'unenforced_relationship'
    | 'inferred'
    | 'ambiguous';
  /** 0..1 confidence; 1.0 for `declared_fk`. */
  confidence: number;
  /** Optional explanation for the Findings tab. */
  rationale?: string | null;
  /** Competing target tables when `kind='ambiguous'`. */
  competingTargets?: Array<{ schemaName: string; tableName: string }>;
  /**
   * FK referential actions threaded from the declared FK's catalog row
   * (Oracle-W3). Verbatim engine strings (e.g. `CASCADE` / `SET NULL` /
   * `NO ACTION`). Only meaningful for `kind === 'declared_fk'` /
   * `unenforced_relationship`; null/undefined for inferred / ambiguous
   * relationships (which have no declared action) or when the engine does not
   * report them. Feed the `fk_columns.on_delete` / `on_update` JSONB keys.
   */
  onDelete?: string | null;
  onUpdate?: string | null;
}

/**
 * Normalized actual-schema snapshot returned by the VERIFICATION-ONLY scan
 * mode (Spec 2026-06-11 DB Schema + Data Migration Pack -- Task 4.2).
 *
 * The snapshot is the structural subset of {@link IntrospectionResult} the
 * gateway's expected-vs-actual schema diff consumes (the SAME shape family --
 * `ColumnMetadata` / `KeyOrIndexMetadata` / `SequenceMetadata` -- so the
 * generator manifest and the diff speak one vocabulary).
 *
 * CONTRACT: a verification-only scan WRITES NOTHING to the model -- no
 * candidates, no findings, no discovery-run rows. The snapshot is returned to
 * the caller (the gateway) and discarded; credentials are per-invocation via
 * `secretsStore` and purged at completion.
 */
export interface ActualSchemaSnapshot {
  scanMode: 'verification_only';
  engine: DatabaseEngine;
  schemas: SchemaMetadata[];
  tables: TableMetadata[];
  columns: ColumnMetadata[];
  keysAndIndexes: KeyOrIndexMetadata[];
  sequences: SequenceMetadata[];
}
