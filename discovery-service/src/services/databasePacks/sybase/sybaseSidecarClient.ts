/**
 * HTTP client for the Sybase Discovery Sidecar.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4.
 *
 * The discovery-service NEVER touches a JDBC driver directly. All Sybase
 * I/O routes through the JVM sidecar via this client. The sidecar's
 * default location is {@code http://localhost:8093}; the URL can be
 * overridden at runtime via the {@code SYBASE_SIDECAR_URL} env var.
 *
 * Defense-in-depth note: every call to {@link callSidecarQuery} runs the
 * SQL through {@link assertReadonlySelect} BEFORE the HTTP request leaves
 * the TS process. The sidecar re-applies its own JVM-layer guard; this
 * client's guard is the FIRST layer.
 *
 * Metadata-enrichment additions (Spec 2026-05-31 sybase-metadata-enrichment):
 * the sidecar's {@code IntrospectionResponse} now optionally carries six
 * metadata groups (collation, computed columns, sequence/identity current
 * value, FK referential actions, index ordering/clustering, DB-resident jobs).
 * The wire shape below mirrors the sidecar Java record names verbatim
 * (`IntrospectionResponse.KeyRow` / `ColumnRow` + the new top-level
 * `capabilities` / `serverVersion` / `databaseCollation`). All additions are
 * OPTIONAL: an older sidecar omits them (the TS mapper is per-field
 * null-tolerant), and discovery resolves a group it does NOT find in
 * `capabilities` to `unavailable` (NOT a structural N/A).
 */

import { assertReadonlySelect } from '../../db/sqlGuard';

/**
 * Default sidecar base URL when the env var isn't set. Loopback only.
 */
const DEFAULT_SIDECAR_URL = 'http://localhost:8093';

/**
 * Resolve the sidecar base URL. Reads the env vars lazily (per call, not at
 * module load) so tests can mutate them per-test.
 *
 * Resolution order (SQL Server pair programme, SPEC-1 / wire contract §6):
 * `DB_SIDECAR_URL` -> `SYBASE_SIDECAR_URL` (the pre-rename alias, still
 * honoured so an existing deployment keeps working) -> `http://localhost:8093`.
 */
export function resolveSidecarBaseUrl(): string {
  const preferred = process.env.DB_SIDECAR_URL;
  if (preferred && preferred.trim().length > 0) return preferred.trim();
  const alias = process.env.SYBASE_SIDECAR_URL;
  if (alias && alias.trim().length > 0) return alias.trim();
  return DEFAULT_SIDECAR_URL;
}

/**
 * Per-request driver-flavour choice. Mirrors the sidecar's
 * `SybaseDriverChoice` enum. `auto` is the default and recommended setting;
 * `jtds` and `jconnect` force a specific driver (useful when a particular
 * Sybase server build is known to need one or the other).
 */
export type SybaseDriverChoice = 'auto' | 'jtds' | 'jconnect';

/**
 * Per-request connection credentials. NEVER persisted; passed in the
 * request body for the duration of the call only.
 *
 * `driver` is optional; when omitted the sidecar defaults to `auto`.
 */
export interface SidecarCredentials {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  driver?: SybaseDriverChoice;
  /** DETECTED server charset (e.g. iso_1), declared on every JDBC
   *  connection so single-byte data decodes byte-correctly (2026-08-23). */
  charset?: string;
}

/** Response shape for {@code POST /test-connection}. */
export interface SidecarTestConnectionResponse {
  ok: boolean;
  error?: string | null;
  serverVersion?: string | null;
  /**
   * Which driver actually opened (or last attempted) the connection. Set by
   * the sidecar on every response so the discovery-service can surface it in
   * UI / diag lines.
   */
  driverUsed?: string | null;
}

/** Response shape for {@code POST /introspect}. */
export interface SidecarIntrospectionResponse {
  ok: boolean;
  error?: string | null;
  schemas: Array<{ schemaName: string; owner: string }>;
  tables: Array<{ schemaName: string; tableName: string }>;
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
     * syscolumns/syscomments walk now reports the default; the TS mapper wires
     * it through instead of hardcoding null. Optional for back-compat.
     */
    defaultExpression?: string | null;
    /** Numeric scale where the engine reports one. Optional. */
    scale?: number | null;
    /** Numeric precision where the engine reports one. Optional. */
    precision?: number | null;
    /** TRUE when the column carries the Sybase identity property. Optional. */
    isIdentity?: boolean;
    /** Sequence name backing the column where applicable. Optional. */
    sequenceName?: string | null;
    /**
     * Column-level collation / sort-order (VERBATIM). Group 1 (collation /
     * case-sensitivity / sort-order). Spec 2026-05-31 has the sidecar's
     * syscolumns walk project the per-column collation so a Sybase
     * case-insensitive sort order can be flagged against Postgres's
     * case-sensitive default. Optional / nullable: an older sidecar build that
     * does NOT project it arrives undefined and the TS mapper defaults it to
     * null (discovery then resolves the collation group to `unavailable`).
     */
    collation?: string | null;
    /**
     * TRUE when the column is a Sybase COMPUTED column. Group 2 (computed
     * columns). Spec 2026-05-31: the sidecar projects the computed flag + text
     * from syscolumns.status / syscomments. Consumed when present so a computed
     * column is re-declared as computed rather than recreated as a plain
     * writable column. Optional / nullable (older build -> undefined ->
     * false/null).
     */
    isComputed?: boolean;
    /** VERBATIM computed-column expression where the sidecar exposes it (group 2). */
    computedExpression?: string | null;
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
     * FK referential actions (verbatim engine strings, e.g. `CASCADE` /
     * `SET NULL` / `NO ACTION`). Group 4 (FK referential actions). Spec
     * 2026-05-31: the sidecar's sysreferences / sysconstraints walk projects
     * the on_update / on_delete actions. The discovery-service consumes them
     * when present so the FK on_delete / on_update reach the `fk_columns` JSONB.
     * Optional / nullable: classic ASE FKs are often RESTRICT / NO ACTION and
     * CASCADE is ASE15.7+, so an older catalog null-outs and the TS mapper
     * defaults these to null.
     */
    updateRule?: string | null;
    deleteRule?: string | null;
    /**
     * Index ordering / clustering metadata. Group 5 (index ordering /
     * clustering / partial-predicate) -- the single group that is NEW on both
     * sides in Spec 2026-05-31. These mirror the discovery IR
     * `KeyOrIndexMetadata` index fields verbatim; the TS mapper copies them onto
     * `KeyOrIndexMetadata` and the `candidateStructuralFidelity` reshaper folds
     * them into `constraints_metadata.indexes[]`. All optional / nullable.
     */
    /** Full verbatim index definition / DDL where derivable (group 5). */
    indexDefinition?: string | null;
    /** Access method / index type where derivable (group 5). */
    indexMethod?: string | null;
    /** TRUE when the index is clustered (group 5). Nullable -> unknown. */
    isClustered?: boolean | null;
    /**
     * Partial-index predicate. ALWAYS null for ASE -- Sybase ASE has no
     * filtered / partial indexes, so discovery resolves this to
     * `not_applicable_for_engine` (NOT an evidence gap). Present on the wire for
     * symmetry with the IR / Postgres path only.
     */
    indexPredicate?: string | null;
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
  }>;
  procedures: Array<{
    schemaName: string;
    procedureName: string;
    routineKind: string;
    body: string;
    language: string;
  }>;
  triggers: Array<{
    schemaName: string;
    triggerName: string;
    tableSchema: string;
    tableName: string;
    timing: string;
    events: string[];
    actionStatement: string;
  }>;
  /**
   * Sequences / identity generators (Spec 2026-05-29). Optional for
   * back-compat with an older sidecar build that does not report them.
   *
   * Group 3 (sequence / identity current value): Spec 2026-05-31 has the
   * sidecar (a) synthesize a row per IDENTITY column
   * (`sequenceName = "<table>.<col> (identity)"`, `ownedByTable` /
   * `ownedByColumn` set) and (b) populate `currentValue` (cheap path, then a
   * `MAX(col)` scan fallback) so the `sequence_cutover_hazard` Finding carries
   * the high-water mark.
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
    /**
     * The sequence's CURRENT value (allocation high-water mark), VERBATIM
     * (group 3). The discovery-service consumes this when present so the
     * sequence cutover-hazard finding can carry the value. Optional / nullable:
     * an older sidecar build exposes the `sequences` shape but NO current-value
     * column, so this arrives undefined and the TS mapper defaults it to null
     * (the cutover finding is then marked value-unavailable).
     */
    currentValue?: string | null;
    ownedByTable?: string | null;
    ownedByColumn?: string | null;
    definition?: string | null;
  }>;
  /**
   * Database-resident scheduled jobs / agents. Group 6 (DB-resident jobs):
   * the Sybase Job Scheduler, read via the sidecar's narrow read-only
   * Job-Scheduler proc allowlist (Spec 2026-05-31). Optional: the
   * discovery-service consumes these when present so each becomes a
   * `db_resident_scheduled_job` Finding. An older sidecar build that does NOT
   * project a jobs array arrives undefined and the TS mapper defaults it to []
   * (no jobs emitted).
   */
  scheduledJobs?: Array<{
    schemaName?: string | null;
    jobName: string;
    scheduler?: string | null;
    schedule?: string | null;
    command?: string | null;
    enabled?: boolean;
  }>;
  /**
   * Metadata groups THIS sidecar build surfaces (decision 3). Verbatim group
   * keys (see `sybaseIntrospection.SYBASE_METADATA_GROUP` for the canonical
   * vocabulary discovery resolves against). Lets discovery distinguish "this
   * sidecar build does not surface group X" from "group X surfaced but
   * genuinely null". OPTIONAL: an older sidecar omits it, which discovery reads
   * as `unavailable` for every engine-supported group (NOT a structural N/A).
   */
  capabilities?: string[];
  /**
   * Engine version string -- ASE {@code @@version} (decision 4). Mirrors the
   * sidecar `IntrospectionResponse.serverVersion` (NOTE: `serverVersion`, not
   * `engineVersion`) and the existing `SidecarTestConnectionResponse`
   * `serverVersion`. Discovery branches its three-state applicability on this
   * (e.g. native SEQUENCE is ASE16+). OPTIONAL / nullable.
   */
  serverVersion?: string | null;
  /**
   * Database-level default collation / sort order (group 1). VERBATIM engine
   * string; discovery sets `IntrospectionResult.databaseCollation` from it so
   * the `collation_case_sensitivity_hazard` reasoning has the DB-level default
   * to compare against. OPTIONAL / nullable.
   */
  databaseCollation?: string | null;
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
      `Sybase sidecar at ${url} returned HTTP ${resp.status}: ${detail}`,
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
  return postJson<SidecarTestConnectionResponse>('/test-connection', {
    host: creds.host,
    port: creds.port,
    database: creds.database,
    username: creds.username,
    password: creds.password,
    charset: creds.charset ?? null,
    driver: creds.driver ?? 'auto',
  });
}

/**
 * Call the sidecar's {@code /introspect} endpoint. The sidecar composes
 * the actual catalog queries against Sybase {@code sysusers},
 * {@code sysobjects}, {@code syscolumns}, etc.; we just supply filters.
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
    host: creds.host,
    port: creds.port,
    database: creds.database,
    username: creds.username,
    password: creds.password,
    charset: creds.charset ?? null,
    driver: creds.driver ?? 'auto',
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
    host: creds.host,
    port: creds.port,
    database: creds.database,
    username: creds.username,
    password: creds.password,
    charset: creds.charset ?? null,
    driver: creds.driver ?? 'auto',
    sql: query.sql,
    queryTimeoutSeconds: query.queryTimeoutSeconds ?? 30,
    maxRows: query.maxRows ?? 1000,
  });
}
