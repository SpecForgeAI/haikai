/**
 * HTTP client for the multi-engine DB discovery sidecar.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4 (original,
 * Sybase-only). Generalised by the SQL Server 16 -> PostgreSQL 18 pair
 * programme, Spec 2 (2026-09-11): ONE sidecar serves every JDBC engine and
 * every request carries an `engine` discriminator (WIRE-CONTRACT v2 §1).
 *
 * The discovery-service NEVER touches a JDBC driver directly. All catalog /
 * query I/O routes through the JVM sidecar via this client. The sidecar's
 * default location is {@code http://localhost:8093}; the URL can be
 * overridden at runtime via {@code DB_SIDECAR_URL}, with the legacy
 * {@code SYBASE_SIDECAR_URL} honoured as an alias (WIRE-CONTRACT v2 §6).
 *
 * Defense-in-depth note: every call to {@link callSidecarQuery} runs the
 * SQL through {@link assertReadonlySelect} BEFORE the HTTP request leaves
 * the TS process. The sidecar re-applies its own JVM-layer guard; this
 * client's guard is the FIRST layer.
 *
 * Engine neutrality: this module names engines ONLY as wire vocabulary
 * (the `engine` field's value union). No engine-specific catalog knowledge,
 * SQL, or behaviour lives here -- that stays in the per-engine pack folders
 * (`sybase/`, `mssql/`).
 *
 * Metadata-enrichment additions (Spec 2026-05-31 sybase-metadata-enrichment):
 * the sidecar's {@code IntrospectionResponse} optionally carries six metadata
 * groups (collation, computed columns, sequence/identity current value, FK
 * referential actions, index ordering/clustering, DB-resident jobs). The
 * SQL Server pair programme adds the WIRE-CONTRACT v2 §2 fields on top. The
 * wire shape below mirrors the sidecar Java record names verbatim. EVERY
 * addition is OPTIONAL and nullable: a Sybase response leaves the new fields
 * `null` / absent and the per-engine TS mappers are field-by-field
 * null-tolerant, so existing consumers are unaffected.
 */

import { assertReadonlySelect } from '../db/sqlGuard';

/**
 * Default sidecar base URL when neither env var is set. Loopback only.
 */
const DEFAULT_SIDECAR_URL = 'http://localhost:8093';

/**
 * Resolve the sidecar base URL. Reads the env vars lazily so tests can
 * mutate them per-test. Precedence (WIRE-CONTRACT v2 §6):
 * `DB_SIDECAR_URL` -> `SYBASE_SIDECAR_URL` (legacy alias) -> the loopback
 * default.
 */
export function resolveSidecarBaseUrl(): string {
  const preferred = process.env.DB_SIDECAR_URL;
  if (preferred && preferred.trim().length > 0) return preferred.trim();
  const legacy = process.env.SYBASE_SIDECAR_URL;
  if (legacy && legacy.trim().length > 0) return legacy.trim();
  return DEFAULT_SIDECAR_URL;
}

/**
 * Engines the sidecar can open a JDBC connection to. This is WIRE vocabulary
 * only (the `engine` request field); a missing value is read by the sidecar
 * as `sybase` for back-compat.
 */
export type SidecarEngine = 'sybase' | 'mssql';

/**
 * Per-request driver-flavour choice for the Sybase path. Mirrors the
 * sidecar's `SybaseDriverChoice` enum. `auto` is the default and recommended
 * setting; `jtds` and `jconnect` force a specific driver. Ignored for other
 * engines.
 */
export type SybaseDriverChoice = 'auto' | 'jtds' | 'jconnect';

/**
 * SQL Server authentication scheme (WIRE-CONTRACT v2 §1). `sql` is a SQL
 * login (username + password against the instance); `ntlm` is a Windows
 * domain login carried out in pure Java by `mssql-jdbc`
 * (`authenticationScheme=NTLM;domain=...`). Kerberos SSO is deliberately out
 * of scope (it needs a native DLL).
 */
export type MssqlAuthScheme = 'sql' | 'ntlm';

/**
 * SQL-Server-only connection extras (WIRE-CONTRACT v2 §1). Every field is
 * ignored by the sidecar for non-`mssql` engines.
 */
export interface MssqlConnectionExtras {
  /** `sql` (default) or `ntlm`. */
  scheme: MssqlAuthScheme;
  /** Windows domain; REQUIRED by the sidecar when `scheme === 'ntlm'`. */
  domain?: string | null;
  /** TLS on the wire. `mssql-jdbc` 12.x encrypts by default, so this is true by default. */
  encrypt: boolean;
  /** Accept a self-signed / non-CA-trusted server certificate. */
  trustServerCertificate: boolean;
  /** Named instance; the port is still honoured when supplied alongside. */
  instanceName?: string | null;
}

/**
 * Per-request connection credentials. NEVER persisted; passed in the
 * request body for the duration of the call only.
 *
 * `engine` is optional on this TS type for source back-compat; every call
 * helper defaults it to `'sybase'` exactly as the sidecar does, so an
 * un-migrated caller keeps its behaviour.
 */
export interface SidecarCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** Wire engine discriminator. Defaults to `'sybase'` when omitted. */
  engine?: SidecarEngine;
  /** Sybase-only driver flavour. Ignored for other engines. */
  driver?: SybaseDriverChoice;
  /** DETECTED server charset (e.g. iso_1), declared on every JDBC
   *  connection so single-byte data decodes byte-correctly (2026-08-23). */
  charset?: string;
  /** SQL-Server-only connection extras (auth scheme / domain / TLS / instance). */
  mssql?: MssqlConnectionExtras | null;
}

/** Response shape for {@code POST /test-connection}. */
export interface SidecarTestConnectionResponse {
  ok: boolean;
  error?: string | null;
  serverVersion?: string | null;
  /** Echoed engine (WIRE-CONTRACT v2 §1). Optional for back-compat. */
  engine?: string | null;
  /** SQL Server `SERVERPROPERTY('Edition')`; null elsewhere. */
  serverEdition?: string | null;
  /**
   * Which driver actually opened (or last attempted) the connection. Set by
   * the sidecar on every response so the discovery-service can surface it in
   * UI / diag lines.
   */
  driverUsed?: string | null;
}

/** A `parameters[]` entry on a routine row (WIRE-CONTRACT v2 §2). */
export interface SidecarRoutineParameterRow {
  name: string;
  dataType: string;
  maxLength?: number | null;
  precision?: number | null;
  scale?: number | null;
  isOutput?: boolean;
  hasDefault?: boolean;
  isReadonly?: boolean;
  ordinal?: number | null;
  userTypeName?: string | null;
}

/**
 * An `extendedObjects[]` entry (WIRE-CONTRACT v2 §2). Engine-neutral carrier
 * for objects that have no row in the six classic catalog arrays. `detail`
 * is a free map (e.g. table-type columns, synonym base object, assembly
 * permission set).
 */
export interface SidecarExtendedObjectRow {
  kind: string;
  schema?: string | null;
  name: string;
  definition?: string | null;
  detail?: Record<string, unknown> | null;
}

/** Response shape for {@code POST /introspect}. */
export interface SidecarIntrospectionResponse {
  ok: boolean;
  error?: string | null;
  schemas: Array<{ schemaName: string; owner: string }>;
  tables: Array<{
    schemaName: string;
    tableName: string;
    /** WIRE-CONTRACT v2: `system_versioned` | `history` | null. */
    temporalType?: string | null;
    /** WIRE-CONTRACT v2: `"schema.name"` of the history table, or null. */
    historyTable?: string | null;
    periodStartColumn?: string | null;
    periodEndColumn?: string | null;
    isMemoryOptimized?: boolean | null;
    isFiletable?: boolean | null;
  }>;
  columns: Array<{
    schemaName: string;
    tableName: string;
    columnName: string;
    dataType: string;
    maxLength: number;
    isNullable: boolean;
    ordinalPosition: number;
    /**
     * Column default expression (verbatim). Spec 2026-05-29: the sidecar's
     * catalog walk reports the default; the TS mapper wires it through
     * instead of hardcoding null. Optional for back-compat.
     */
    defaultExpression?: string | null;
    /** WIRE-CONTRACT v2: the DEFAULT constraint's own name where named. */
    defaultConstraintName?: string | null;
    /** Numeric scale where the engine reports one. Optional. */
    scale?: number | null;
    /** Numeric precision where the engine reports one. Optional. */
    precision?: number | null;
    /** TRUE when the column carries the identity property. Optional. */
    isIdentity?: boolean;
    /** WIRE-CONTRACT v2: identity seed / increment as STRINGS (bigint-safe). */
    identitySeed?: string | null;
    identityIncrement?: string | null;
    /** Sequence name backing the column where applicable. Optional. */
    sequenceName?: string | null;
    /**
     * Column-level collation / sort-order (VERBATIM). Group 1 (collation /
     * case-sensitivity / sort-order).
     */
    collation?: string | null;
    /**
     * TRUE when the column is a COMPUTED column. Group 2 (computed columns).
     */
    isComputed?: boolean;
    /** VERBATIM computed-column expression where the sidecar exposes it (group 2). */
    computedExpression?: string | null;
    /** WIRE-CONTRACT v2: TRUE when a computed column is PERSISTED (stored). */
    isPersistedComputed?: boolean | null;
    /** WIRE-CONTRACT v2: ROWGUIDCOL / SPARSE / FILESTREAM storage markers. */
    isRowGuidCol?: boolean | null;
    isSparse?: boolean | null;
    isFilestream?: boolean | null;
    /**
     * WIRE-CONTRACT v2: alias / user-defined type NAME when the column uses
     * one. `dataType` is then the BASE type.
     */
    userTypeName?: string | null;
    /**
     * WIRE-CONTRACT v2: `as_row_start` | `as_row_end` | null -- the
     * system-versioning period columns.
     */
    generatedAlwaysType?: string | null;
    /** WIRE-CONTRACT v2: TRUE for a HIDDEN period column. */
    isHidden?: boolean | null;
    /** WIRE-CONTRACT v2: the XML SCHEMA COLLECTION a typed-xml column binds. */
    xmlSchemaCollection?: string | null;
  }>;
  keys: Array<{
    schemaName: string;
    tableName: string;
    kind: string;
    name: string;
    columns: string[];
    referencedSchema: string | null;
    referencedTable: string | null;
    referencedColumns: string[] | null;
    isUnique: boolean;
    /** Check-constraint expression (verbatim) where applicable. Optional. */
    checkExpression?: string | null;
    /**
     * WIRE-CONTRACT v2: the check-constraint definition on rows whose
     * `kind = "check_constraint"`. Treated as an alias of `checkExpression`
     * by the mappers.
     */
    checkDefinition?: string | null;
    /**
     * FK referential actions (verbatim engine strings, e.g. `CASCADE` /
     * `SET NULL` / `NO ACTION`). Group 4 (FK referential actions).
     */
    updateRule?: string | null;
    deleteRule?: string | null;
    /** Full verbatim index definition / DDL where derivable (group 5). */
    indexDefinition?: string | null;
    /** Access method / index type where derivable (group 5). */
    indexMethod?: string | null;
    /** TRUE when the index is clustered (group 5). Nullable -> unknown. */
    isClustered?: boolean | null;
    /**
     * Partial-index predicate. ALWAYS null for ASE (no filtered indexes);
     * POPULATED on SQL Server from `sys.indexes.filter_definition`.
     */
    indexPredicate?: string | null;
    /**
     * WIRE-CONTRACT v2 spelling of the filtered-index predicate. Treated as
     * an alias of `indexPredicate` by the mappers.
     */
    filterDefinition?: string | null;
    /** WIRE-CONTRACT v2: INCLUDE-d (non-key) index columns. */
    includeColumns?: string[] | null;
    /**
     * WIRE-CONTRACT v2 index type token: `clustered` | `nonclustered` |
     * `clustered_columnstore` | `nonclustered_columnstore` | `xml` |
     * `spatial` | `fulltext` | `heap` | null.
     */
    indexType?: string | null;
    /** WIRE-CONTRACT v2: the index / constraint is disabled. */
    isDisabled?: boolean | null;
    /** WIRE-CONTRACT v2: an FK / CHECK constraint that is NOT TRUSTED. */
    isNotTrusted?: boolean | null;
    /** WIRE-CONTRACT v2: the unique index is backed by a UNIQUE CONSTRAINT. */
    isUniqueConstraint?: boolean | null;
    /** WIRE-CONTRACT v2: full-text catalog backing a `fulltext` index row. */
    fulltextCatalog?: string | null;
    /**
     * Per-column ordering directives (ASC / DESC), positionally aligned with
     * `columns[]` (group 5). VERBATIM.
     */
    columnDirections?: string[] | null;
  }>;
  views: Array<{
    schemaName: string;
    viewName: string;
    definition: string;
    isMaterialized: boolean;
    /** WIRE-CONTRACT v2: WITH SCHEMABINDING. */
    isSchemaBound?: boolean | null;
    /** WIRE-CONTRACT v2: the view carries a clustered index (an INDEXED VIEW). */
    isIndexedView?: boolean | null;
  }>;
  procedures: Array<{
    schemaName: string;
    procedureName: string;
    /**
     * WIRE-CONTRACT v2: `procedure` | `function` | `clr_procedure` |
     * `clr_function`.
     */
    routineKind: string;
    body: string;
    language: string;
    /** TRUE when the Sybase path had to cap the reassembled body. */
    truncated?: boolean | null;
    /**
     * WIRE-CONTRACT v2: `scalar` | `inline_table` | `multi_statement_table` |
     * `aggregate` | null.
     */
    functionKind?: string | null;
    parameters?: SidecarRoutineParameterRow[] | null;
    returnsType?: string | null;
    executeAs?: string | null;
    assemblyName?: string | null;
  }>;
  triggers: Array<{
    schemaName: string;
    triggerName: string;
    tableSchema: string;
    tableName: string;
    timing: string;
    events: string[];
    actionStatement: string;
    /** WIRE-CONTRACT v2: the trigger is disabled. */
    isDisabled?: boolean | null;
    /** WIRE-CONTRACT v2: `table` | `view`. */
    parentKind?: string | null;
    /** WIRE-CONTRACT v2: `sp_settriggerorder` FIRST / LAST registrations. */
    orderFirstEvents?: string[] | null;
    orderLastEvents?: string[] | null;
    /** WIRE-CONTRACT v2: a DDL (database-scoped) trigger. */
    isDatabaseTrigger?: boolean | null;
  }>;
  /**
   * Sequences / identity generators (Spec 2026-05-29). Optional for
   * back-compat with an older sidecar build that does not report them.
   */
  sequences?: Array<{
    schemaName: string;
    sequenceName: string;
    dataType?: string | null;
    startValue?: string | null;
    increment?: string | null;
    minValue?: string | null;
    maxValue?: string | null;
    cycle?: boolean;
    /** WIRE-CONTRACT v2 spelling on the native SQL Server sequence catalog. */
    isCycling?: boolean | null;
    cacheSize?: string | null;
    /**
     * The sequence's CURRENT value (allocation high-water mark), VERBATIM
     * (group 3).
     */
    currentValue?: string | null;
    ownedByTable?: string | null;
    ownedByColumn?: string | null;
    definition?: string | null;
  }>;
  /**
   * Database-resident scheduled jobs / agents. Group 6 (DB-resident jobs):
   * the Sybase Job Scheduler, or the SQL Server Agent via msdb.
   */
  scheduledJobs?: Array<{
    schemaName?: string | null;
    jobName: string;
    scheduler?: string | null;
    schedule?: string | null;
    command?: string | null;
    enabled?: boolean;
    /** WIRE-CONTRACT v2: the job's ordered steps. */
    steps?: Array<{
      ordinal?: number | null;
      subsystem?: string | null;
      command?: string | null;
      databaseName?: string | null;
    }> | null;
    /** WIRE-CONTRACT v2: human-readable schedule text. */
    scheduleText?: string | null;
    /** WIRE-CONTRACT v2: the raw msdb frequency fields as a map. */
    scheduleFrequency?: Record<string, unknown> | null;
  }>;
  /**
   * WIRE-CONTRACT v2: objects with no row in the classic six arrays
   * (Service Broker, table types, synonyms, full-text catalogs, assemblies,
   * partitioning, CDC / change tracking, RLS policies, ...).
   */
  extendedObjects?: SidecarExtendedObjectRow[] | null;
  /**
   * Metadata groups THIS sidecar build surfaces (decision 3). Verbatim group
   * keys. Lets discovery distinguish "this sidecar build does not surface
   * group X" from "group X surfaced but genuinely null".
   */
  capabilities?: string[];
  /** Echoed engine (WIRE-CONTRACT v2 §2). Optional for back-compat. */
  engine?: string | null;
  /**
   * Engine version string -- ASE `@@version` / SQL Server `@@VERSION`.
   * Discovery branches its three-state applicability on this.
   */
  serverVersion?: string | null;
  /** SQL Server `SERVERPROPERTY('Edition')`; null on other engines. */
  serverEdition?: string | null;
  /**
   * Database-level default collation / sort order (group 1). VERBATIM engine
   * string.
   */
  databaseCollation?: string | null;
  /** WIRE-CONTRACT v2: the SERVER-level default collation, where distinct. */
  serverCollation?: string | null;
}

/** Response shape for {@code POST /query}. */
export interface SidecarQueryResponse {
  ok: boolean;
  error?: string | null;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
}

/**
 * Build the shared connection block every endpoint repeats (WIRE-CONTRACT
 * v2 §1). The MSSQL extras are only emitted when the engine is `mssql`, so
 * a Sybase request body is byte-for-byte what it was before this module was
 * generalised (apart from the new `engine` field, which the sidecar defaults
 * to `sybase` anyway).
 */
function connectionBlock(creds: SidecarCredentials): Record<string, unknown> {
  const engine: SidecarEngine = creds.engine ?? 'sybase';
  const block: Record<string, unknown> = {
    engine,
    host: creds.host,
    port: creds.port,
    database: creds.database,
    username: creds.username,
    password: creds.password,
    charset: creds.charset ?? null,
    driver: creds.driver ?? 'auto',
  };
  if (engine === 'mssql') {
    const extras = creds.mssql ?? null;
    block.authScheme = extras?.scheme ?? 'sql';
    block.domain = extras?.domain ?? null;
    block.encrypt = extras ? extras.encrypt !== false : true;
    block.trustServerCertificate = extras
      ? extras.trustServerCertificate === true
      : false;
    block.instanceName = extras?.instanceName ?? null;
  }
  return block;
}

/**
 * Internal helper -- POST a JSON body to the sidecar and parse the JSON
 * response. Throws on transport-level failure (network down, sidecar
 * unreachable, malformed JSON). Returns the parsed body untouched.
 *
 * The caller's `withDbPackSoftFail` wrapper converts thrown errors into
 * `db_pack_warning` findings, so this function intentionally does NOT
 * swallow errors.
 */
async function postJson<TResp>(
  pathSuffix: string,
  body: Record<string, unknown>,
): Promise<TResp> {
  const url = `${resolveSidecarBaseUrl()}${pathSuffix}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // The sidecar returns 200 for "we processed the request" -- success/
  // failure is on the body's ok field. 400 is reserved for guard
  // rejections; we surface those as thrown errors so the orchestrator's
  // soft-fail wrapper sees a clean failure.
  if (!resp.ok) {
    let detail: string;
    try {
      const text = await resp.text();
      detail = text.substring(0, 500);
    } catch {
      detail = '';
    }
    throw new Error(
      `DB discovery sidecar at ${url} returned HTTP ${resp.status}: ${detail}`,
    );
  }
  const parsed = (await resp.json()) as TResp;
  return parsed;
}

/**
 * Call the sidecar's {@code /test-connection} endpoint. Returns the
 * sidecar's response verbatim.
 */
export async function callSidecarTestConnection(
  creds: SidecarCredentials,
): Promise<SidecarTestConnectionResponse> {
  return postJson<SidecarTestConnectionResponse>(
    '/test-connection',
    connectionBlock(creds),
  );
}

/**
 * Call the sidecar's {@code /introspect} endpoint. The sidecar composes the
 * actual catalog queries against the engine's own catalog (ASE
 * `sysobjects` / `syscolumns` ...; SQL Server `sys.*`); we just supply
 * filters.
 */
export async function callSidecarIntrospect(
  creds: SidecarCredentials,
  filters: {
    includeSchemas?: string[] | null;
    includeTables?: string[] | null;
    queryTimeoutSeconds?: number;
  },
): Promise<SidecarIntrospectionResponse> {
  return postJson<SidecarIntrospectionResponse>('/introspect', {
    ...connectionBlock(creds),
    includeSchemas: filters.includeSchemas ?? null,
    includeTables: filters.includeTables ?? null,
    queryTimeoutSeconds: filters.queryTimeoutSeconds ?? 30,
  });
}

/**
 * Call the sidecar's {@code /query} endpoint. The SQL is guarded
 * client-side BEFORE the HTTP request -- this is the first layer of the
 * spec-mandated three-layer SELECT-only enforcement. Sidecar applies its
 * own guard at the JVM layer as the second layer; the DB user's GRANT
 * profile is the third.
 */
export async function callSidecarQuery(
  creds: SidecarCredentials,
  query: { sql: string; queryTimeoutSeconds?: number; maxRows?: number },
): Promise<SidecarQueryResponse> {
  // TS-side guard. Throws SqlGuardError on violation; the orchestrator's
  // soft-fail wrapper converts the throw into a db_pack_warning.
  assertReadonlySelect(query.sql);
  return postJson<SidecarQueryResponse>('/query', {
    ...connectionBlock(creds),
    sql: query.sql,
    queryTimeoutSeconds: query.queryTimeoutSeconds ?? 30,
    maxRows: query.maxRows ?? 1000,
  });
}
