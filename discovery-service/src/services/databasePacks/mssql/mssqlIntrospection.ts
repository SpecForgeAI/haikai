/**
 * SQL Server introspection -- sidecar wire -> engine-neutral IR.
 *
 * Spec: SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11),
 * task 2.1. Binding wire contract:
 * `agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/WIRE-CONTRACT.md`.
 *
 * Discovery-service is a pure Node process. ALL JDBC I/O happens inside the
 * db-discovery sidecar; this module transforms the sidecar's structured
 * `/introspect` response (engine `mssql`) into the engine-neutral
 * {@link IntrospectionResult} the orchestrator + shared finding builders
 * expect, PLUS a pack-private {@link MssqlEngineExtras} carrier for the
 * SQL-Server-only facts the neutral IR deliberately has no slot for
 * (temporal versioning, memory-optimized storage, FILESTREAM, indexed views,
 * columnstore, CLR routine metadata, trigger ordering).
 *
 * The sidecar already walks `sys.schemas`, `sys.tables`, `sys.columns`,
 * `sys.indexes`, `sys.foreign_keys`, `sys.check_constraints`,
 * `sys.sql_modules`, `sys.triggers`, `sys.trigger_events`, `sys.sequences`,
 * `sys.service_queues`, `sys.synonyms`, `sys.assemblies`, `msdb.dbo.sysjobs`;
 * this module's job is MAPPING + NORMALISING, never SQL.
 *
 * Applicability (three-state, same model as the Sybase mapper):
 *   - `index_predicate`  -- SUPPORTED. SQL Server has filtered indexes
 *     (`sys.indexes.filter_definition`), so this resolves on the capability +
 *     value, NEVER to `not_applicable_for_engine`.
 *   - `native_sequence`  -- SUPPORTED. `CREATE SEQUENCE` is SQL Server 2012+
 *     and the pair's floor is SQL Server 2016, so again it resolves on the
 *     capability + value.
 * Both are the deliberate INVERSE of the ASE mapper, where the engine
 * structurally lacks the construct.
 */

import type {
  ColumnMetadata,
  ExtendedObjectMetadata,
  IntrospectionResult,
  KeyOrIndexMetadata,
  MetadataApplicability,
  MetadataApplicabilityMap,
  MetadataGroupKey,
  ProcedureMetadata,
  ScheduledJobMetadata,
  SchemaMetadata,
  SequenceMetadata,
  TableMetadata,
  TriggerMetadata,
  ViewMetadata,
} from '../types';
import type {
  SidecarIntrospectionResponse,
  SidecarRoutineParameterRow,
} from '../sidecarClient';

/**
 * Canonical sidecar capability keys this pack resolves against. These MUST
 * match the verbatim group keys the sidecar appends to `capabilities[]` AND
 * the {@link MetadataGroupKey} union in `types.ts`.
 *
 * Unlike ASE, SQL Server structurally HAS filtered indexes and native
 * sequences, so `index_predicate` and `native_sequence` are advertised
 * capabilities here rather than discovery-internal structural markers.
 */
export const MSSQL_METADATA_CAPABILITY = {
  collation: 'collation',
  computedColumns: 'computed_columns',
  sequenceCurrentValue: 'sequence_current_value',
  fkActions: 'fk_actions',
  indexClustering: 'index_clustering',
  indexPredicate: 'index_predicate',
  nativeSequence: 'native_sequence',
  dbJobs: 'db_jobs',
} as const;

/**
 * The minimum SQL Server MAJOR version the pair supports. SQL Server 2016 is
 * `13`; the pair's SOURCE floor is 2022 (`16`) but the mapper does not gate
 * on it -- an older instance still maps, and the version only informs the
 * native-sequence resolution below (sequences arrived in 2012 = `11`).
 */
const MSSQL_NATIVE_SEQUENCE_MIN_MAJOR = 11;

/**
 * Parse the MAJOR version out of a verbatim SQL Server `@@VERSION` banner.
 * The banner looks like
 * `Microsoft SQL Server 2022 (RTM) - 16.0.1000.6 (X64) ...`; a bare
 * `16.0.1000.6` is also accepted. Returns just the integer major, or null
 * when nothing version-shaped is recognisable (an older sidecar that omits
 * `serverVersion`). A null version is NOT read as "the engine lacks the
 * construct" -- the resolver falls back to the capability.
 */
export function parseMssqlMajorVersion(
  serverVersion: string | null | undefined,
): number | null {
  if (!serverVersion) return null;
  // Prefer a `<major>.<minor>.<build>` token (the product version); fall back
  // to any `<major>.<minor>` pair. The marketing year (`SQL Server 2022`) is
  // deliberately NOT matched -- `\d{4}` alone is not a version token here.
  const productMatch = serverVersion.match(/(?:^|[^\d.])(\d{1,2})\.(\d+)\.(\d+)/);
  const anyMatch = serverVersion.match(/(?:^|[^\d.])(\d{1,2})\.(\d+)/);
  const m = productMatch ?? anyMatch;
  if (!m) return null;
  const major = Number.parseInt(m[1], 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * Resolve the three-state applicability for a single engine-SUPPORTED
 * metadata group. Identical semantics to the Sybase mapper:
 *
 *  - capability advertised AND a value captured -> `present`
 *  - capability advertised AND no value         -> `unavailable`
 *  - capability NOT advertised (older sidecar)  -> `unavailable`
 *
 * On SQL Server EVERY group is engine-supported, so no group ever resolves
 * to `not_applicable_for_engine`.
 */
function resolveSupportedGroup(
  capabilitySet: ReadonlySet<string>,
  capabilityKey: string,
  valuePresent: boolean,
): MetadataApplicability {
  if (!capabilitySet.has(capabilityKey)) return 'unavailable';
  return valuePresent ? 'present' : 'unavailable';
}

/**
 * Resolve the full {@link MetadataApplicabilityMap} for a SQL Server
 * introspection. Every group is engine-supported; `index_predicate` and
 * `native_sequence` -- the two ASE structural absences -- are ordinary
 * capability-resolved groups here.
 */
function resolveMssqlMetadataApplicability(args: {
  capabilities: string[] | null | undefined;
  serverVersion: string | null | undefined;
  hasAnyColumnCollation: boolean;
  hasDatabaseCollation: boolean;
  hasAnyComputedColumn: boolean;
  hasAnySequenceCurrentValue: boolean;
  hasAnyNativeSequence: boolean;
  hasAnyFkAction: boolean;
  hasAnyIndexClustering: boolean;
  hasAnyIndexPredicate: boolean;
  hasAnyJob: boolean;
}): MetadataApplicabilityMap {
  const caps = new Set<string>(
    (args.capabilities ?? []).filter((c) => typeof c === 'string'),
  );
  const major = parseMssqlMajorVersion(args.serverVersion);

  const map: Record<MetadataGroupKey, MetadataApplicability> = {
    collation: resolveSupportedGroup(
      caps,
      MSSQL_METADATA_CAPABILITY.collation,
      args.hasAnyColumnCollation || args.hasDatabaseCollation,
    ),
    computed_columns: resolveSupportedGroup(
      caps,
      MSSQL_METADATA_CAPABILITY.computedColumns,
      args.hasAnyComputedColumn,
    ),
    sequence_current_value: resolveSupportedGroup(
      caps,
      MSSQL_METADATA_CAPABILITY.sequenceCurrentValue,
      args.hasAnySequenceCurrentValue,
    ),
    fk_actions: resolveSupportedGroup(
      caps,
      MSSQL_METADATA_CAPABILITY.fkActions,
      args.hasAnyFkAction,
    ),
    index_clustering: resolveSupportedGroup(
      caps,
      MSSQL_METADATA_CAPABILITY.indexClustering,
      args.hasAnyIndexClustering,
    ),
    db_jobs: resolveSupportedGroup(
      caps,
      MSSQL_METADATA_CAPABILITY.dbJobs,
      args.hasAnyJob,
    ),
    // SUPPORTED on SQL Server: `sys.indexes.filter_definition` carries the
    // filtered-index predicate. The deliberate INVERSE of the ASE mapper,
    // where the engine has no filtered indexes at all.
    index_predicate: resolveSupportedGroup(
      caps,
      MSSQL_METADATA_CAPABILITY.indexPredicate,
      args.hasAnyIndexPredicate,
    ),
    // SUPPORTED on SQL Server 2012+ (`sys.sequences`). A KNOWN pre-2012
    // instance structurally lacks the catalog; every version this pair
    // supports is far past that, so in practice this always resolves on the
    // capability.
    native_sequence:
      major !== null && major < MSSQL_NATIVE_SEQUENCE_MIN_MAJOR
        ? 'not_applicable_for_engine'
        : resolveSupportedGroup(
            caps,
            MSSQL_METADATA_CAPABILITY.nativeSequence,
            args.hasAnyNativeSequence,
          ),
  };
  return map;
}

// ---------------------------------------------------------------------------
// Pack-private engine extras
// ---------------------------------------------------------------------------

/** System-versioning role a table plays. */
export type MssqlTemporalType = 'system_versioned' | 'history';

/** Per-table SQL-Server-only facts the neutral IR has no slot for. */
export interface MssqlTableExtras {
  schemaName: string;
  tableName: string;
  /** `system_versioned` for the current table, `history` for its twin. */
  temporalType: MssqlTemporalType | null;
  /** `"schema.name"` of the history table, for a system-versioned table. */
  historyTable: string | null;
  periodStartColumn: string | null;
  periodEndColumn: string | null;
  isMemoryOptimized: boolean;
  isFiletable: boolean;
}

/** Per-column SQL-Server-only facts. */
export interface MssqlColumnExtras {
  schemaName: string;
  tableName: string;
  columnName: string;
  /** The BASE data type (lower-cased) -- `dataType` on the neutral IR. */
  dataType: string;
  /** Alias / user-defined type name when the column uses one. */
  userTypeName: string | null;
  /** `as_row_start` / `as_row_end` on a system-versioning period column. */
  generatedAlwaysType: string | null;
  isHidden: boolean;
  isFilestream: boolean;
  isSparse: boolean;
  isRowGuidCol: boolean;
  /** TRUE when a computed column is PERSISTED (physically stored). */
  isPersistedComputed: boolean;
  xmlSchemaCollection: string | null;
  identitySeed: string | null;
  identityIncrement: string | null;
  defaultConstraintName: string | null;
}

/** Per-index / per-constraint SQL-Server-only facts. */
export interface MssqlIndexExtras {
  schemaName: string;
  tableName: string;
  name: string;
  /**
   * `clustered` | `nonclustered` | `clustered_columnstore` |
   * `nonclustered_columnstore` | `xml` | `spatial` | `fulltext` | `heap`.
   */
  indexType: string | null;
  includeColumns: string[];
  isDisabled: boolean;
  isNotTrusted: boolean;
  isUniqueConstraint: boolean;
  fulltextCatalog: string | null;
}

/** Per-view SQL-Server-only facts. */
export interface MssqlViewExtras {
  schemaName: string;
  viewName: string;
  isSchemaBound: boolean;
  /** A view with a unique clustered index -- an INDEXED VIEW. */
  isIndexedView: boolean;
}

/** A routine parameter as the SQL Server catalog reports it. */
export interface MssqlRoutineParameter {
  name: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isOutput: boolean;
  hasDefault: boolean;
  /** TRUE for a table-valued parameter, which SQL Server forces READONLY. */
  isReadonly: boolean;
  ordinal: number | null;
  userTypeName: string | null;
}

/** Per-routine SQL-Server-only facts. */
export interface MssqlRoutineExtras {
  schemaName: string;
  routineName: string;
  /** VERBATIM wire kind: `procedure` | `function` | `clr_procedure` | `clr_function`. */
  wireKind: string;
  /** TRUE for `clr_procedure` / `clr_function`. */
  isClr: boolean;
  /** `scalar` | `inline_table` | `multi_statement_table` | `aggregate`. */
  functionKind: string | null;
  parameters: MssqlRoutineParameter[];
  returnsType: string | null;
  executeAs: string | null;
  assemblyName: string | null;
  language: string;
}

/** Per-trigger SQL-Server-only facts. */
export interface MssqlTriggerExtras {
  schemaName: string;
  triggerName: string;
  isDisabled: boolean;
  /** `table` | `view` -- an INSTEAD OF trigger on a view is a distinct hazard. */
  parentKind: string | null;
  /** `sp_settriggerorder` FIRST / LAST registrations, by event. */
  orderFirstEvents: string[];
  orderLastEvents: string[];
  isDatabaseTrigger: boolean;
}

/** Per-scheduled-job SQL-Server-only facts (SQL Server Agent / msdb). */
export interface MssqlScheduledJobExtras {
  jobName: string;
  steps: Array<{
    ordinal: number | null;
    subsystem: string | null;
    command: string | null;
    databaseName: string | null;
  }>;
  scheduleText: string | null;
  scheduleFrequency: Record<string, unknown> | null;
}

/**
 * The SQL-Server-only side-car of the introspection. Lives ONLY inside this
 * pack folder: the orchestrator, the shared builders and the other packs
 * never see it, so the "generic core never names an engine" doctrine holds.
 */
export interface MssqlEngineExtras {
  serverVersion: string | null;
  serverEdition: string | null;
  serverCollation: string | null;
  tables: MssqlTableExtras[];
  columns: MssqlColumnExtras[];
  indexes: MssqlIndexExtras[];
  views: MssqlViewExtras[];
  routines: MssqlRoutineExtras[];
  triggers: MssqlTriggerExtras[];
  scheduledJobs: MssqlScheduledJobExtras[];
}

/** An empty extras carrier -- used when a caller has no cached response. */
export const EMPTY_MSSQL_EXTRAS: MssqlEngineExtras = {
  serverVersion: null,
  serverEdition: null,
  serverCollation: null,
  tables: [],
  columns: [],
  indexes: [],
  views: [],
  routines: [],
  triggers: [],
  scheduledJobs: [],
};

/**
 * The engine-neutral IR plus the pack-private extras. The pack hands this to
 * `mssqlFindings`; every other consumer sees only the
 * {@link IntrospectionResult} half.
 */
export interface MssqlIntrospectionResult extends IntrospectionResult {
  mssql: MssqlEngineExtras;
}

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  return v === undefined || v === null ? null : String(v);
}

function bool(v: unknown): boolean {
  return v === true;
}

/**
 * Normalise a SQL Server trigger timing to the engine-neutral form. Unlike
 * ASE (whose catalog cannot distinguish them and where the mapper defaults to
 * `after`), SQL Server reports the timing for real: `sys.triggers.is_instead_of_trigger`
 * separates AFTER from INSTEAD OF. SQL Server has no BEFORE triggers at all,
 * so an unrecognised value maps to `after`.
 */
function normaliseTriggerTiming(raw: string | null): TriggerMetadata['timing'] {
  const v = (raw ?? '').toLowerCase().replace(/\s+/g, '_');
  if (v === 'instead_of' || v === 'insteadof') return 'instead_of';
  if (v === 'before') return 'before';
  return 'after';
}

/**
 * Normalise the sidecar's `sys.trigger_events`-derived event list to the
 * canonical vocabulary. Unknown values are dropped; duplicates collapse.
 */
function normaliseEvents(
  raw: string[] | null | undefined,
): Array<'insert' | 'update' | 'delete' | 'truncate'> {
  const out: Array<'insert' | 'update' | 'delete' | 'truncate'> = [];
  const seen = new Set<string>();
  for (const e of raw ?? []) {
    const v = (e ?? '').toLowerCase();
    if (seen.has(v)) continue;
    seen.add(v);
    if (v === 'insert' || v === 'update' || v === 'delete' || v === 'truncate') {
      out.push(v);
    }
  }
  return out;
}

/**
 * Map a sidecar key kind to the engine-neutral {@link KeyOrIndexMetadata}
 * kind. `check_constraint` is a first-class kind on the SQL Server wire
 * (WIRE-CONTRACT v2 §2 adds it), so it is recognised here explicitly.
 */
function normaliseKeyKind(raw: string): KeyOrIndexMetadata['kind'] {
  switch ((raw ?? '').toLowerCase()) {
    case 'primary_key':
      return 'primary_key';
    case 'unique_constraint':
    case 'unique':
      return 'unique_constraint';
    case 'foreign_key':
    case 'fk':
      return 'foreign_key';
    case 'check_constraint':
    case 'check':
      return 'check_constraint';
    default:
      return 'index';
  }
}

/**
 * Normalise a wire `routineKind` onto the engine-neutral two-value union.
 * CLR routines keep their procedure / function nature on the neutral IR --
 * the fact that the body is managed code is carried in the extras
 * (`isClr` + `assemblyName`) and surfaces as its own Finding.
 */
function neutralRoutineKind(raw: string): ProcedureMetadata['routineKind'] {
  const v = (raw ?? '').toLowerCase();
  if (v === 'function' || v === 'clr_function') return 'function';
  return 'procedure';
}

function mapParameters(
  raw: SidecarRoutineParameterRow[] | null | undefined,
): MssqlRoutineParameter[] {
  return (raw ?? []).map((p, i) => ({
    name: String(p.name ?? ''),
    dataType: String(p.dataType ?? ''),
    maxLength:
      p.maxLength !== undefined && p.maxLength !== null
        ? Number(p.maxLength)
        : null,
    precision:
      p.precision !== undefined && p.precision !== null
        ? Number(p.precision)
        : null,
    scale: p.scale !== undefined && p.scale !== null ? Number(p.scale) : null,
    isOutput: bool(p.isOutput),
    hasDefault: bool(p.hasDefault),
    isReadonly: bool(p.isReadonly),
    ordinal:
      p.ordinal !== undefined && p.ordinal !== null ? Number(p.ordinal) : i + 1,
    userTypeName: str(p.userTypeName),
  }));
}

/**
 * Compose the VERBATIM argument signature from the catalog parameter rows,
 * so an MSSQL routine carries the same `arguments` evidence the Postgres path
 * gets from `pg_get_function_arguments`. Example:
 * `@CustomerID int, @Orders Website.OrderList READONLY, @Total decimal(18,2) OUTPUT`.
 */
function composeArgumentSignature(
  params: MssqlRoutineParameter[],
): string | null {
  if (params.length === 0) return null;
  return params
    .map((p) => {
      const type = p.userTypeName ?? p.dataType;
      const parts = [p.name, type];
      if (p.isReadonly) parts.push('READONLY');
      if (p.isOutput) parts.push('OUTPUT');
      return parts.join(' ');
    })
    .join(', ');
}

/**
 * Transform a `mssql`-engine {@link SidecarIntrospectionResponse} into the
 * engine-neutral {@link IntrospectionResult} plus the pack-private extras.
 *
 * Bodies (views, routines, triggers, extended objects) are forwarded
 * unchanged -- the pack's `emitFindings` layer applies snippet redaction +
 * the size cap before any finding payload is built.
 */
export function transformMssqlIntrospection(
  resp: SidecarIntrospectionResponse,
): MssqlIntrospectionResult {
  const schemas: SchemaMetadata[] = (resp.schemas ?? []).map((s) => ({
    schemaName: s.schemaName,
    owner: s.owner ?? null,
  }));

  const tableExtras: MssqlTableExtras[] = [];
  const tables: TableMetadata[] = (resp.tables ?? []).map((t) => {
    const temporalRaw = (t.temporalType ?? '').toLowerCase();
    tableExtras.push({
      schemaName: t.schemaName,
      tableName: t.tableName,
      temporalType:
        temporalRaw === 'system_versioned'
          ? 'system_versioned'
          : temporalRaw === 'history'
          ? 'history'
          : null,
      historyTable: str(t.historyTable),
      periodStartColumn: str(t.periodStartColumn),
      periodEndColumn: str(t.periodEndColumn),
      isMemoryOptimized: bool(t.isMemoryOptimized),
      isFiletable: bool(t.isFiletable),
    });
    return {
      schemaName: t.schemaName,
      tableName: t.tableName,
      objectType: 'table' as const,
      estimatedRowCount: null,
      comment: null,
    };
  });

  const columnExtras: MssqlColumnExtras[] = [];
  const columns: ColumnMetadata[] = (resp.columns ?? []).map((c) => {
    columnExtras.push({
      schemaName: c.schemaName,
      tableName: c.tableName,
      columnName: c.columnName,
      dataType: (c.dataType ?? '').toLowerCase(),
      userTypeName: str(c.userTypeName),
      generatedAlwaysType: str(c.generatedAlwaysType),
      isHidden: bool(c.isHidden),
      isFilestream: bool(c.isFilestream),
      isSparse: bool(c.isSparse),
      isRowGuidCol: bool(c.isRowGuidCol),
      isPersistedComputed: bool(c.isPersistedComputed),
      xmlSchemaCollection: str(c.xmlSchemaCollection),
      identitySeed: str(c.identitySeed),
      identityIncrement: str(c.identityIncrement),
      defaultConstraintName: str(c.defaultConstraintName),
    });
    return {
      schemaName: c.schemaName,
      tableName: c.tableName,
      columnName: c.columnName,
      dataType: c.dataType,
      isNullable: c.isNullable,
      ordinalPosition: c.ordinalPosition,
      maxLength: c.maxLength > 0 ? c.maxLength : null,
      defaultExpression: str(c.defaultExpression),
      scale: c.scale !== undefined && c.scale !== null ? Number(c.scale) : null,
      precision:
        c.precision !== undefined && c.precision !== null
          ? Number(c.precision)
          : null,
      isIdentity: c.isIdentity === true,
      sequenceName: str(c.sequenceName),
      collation: str(c.collation),
      // A SQL Server computed column is `isGenerated`; whether it is PERSISTED
      // (physically stored, the only form Postgres `GENERATED ... STORED` can
      // reproduce) is carried in the extras and drives its own Finding.
      isGenerated: c.isComputed === true,
      generationExpression: str(c.computedExpression),
    };
  });

  const indexExtras: MssqlIndexExtras[] = [];
  const keysAndIndexes: KeyOrIndexMetadata[] = (resp.keys ?? []).map((k) => {
    const indexType = str(k.indexType);
    indexExtras.push({
      schemaName: k.schemaName,
      tableName: k.tableName,
      name: k.name,
      indexType: indexType === null ? null : indexType.toLowerCase(),
      includeColumns: (k.includeColumns ?? []).map((c) => String(c)),
      isDisabled: bool(k.isDisabled),
      isNotTrusted: bool(k.isNotTrusted),
      isUniqueConstraint: bool(k.isUniqueConstraint),
      fulltextCatalog: str(k.fulltextCatalog),
    });
    // `checkDefinition` is the WIRE-CONTRACT v2 spelling; `checkExpression`
    // is the classic one. Accept either, prefer the explicit v2 field.
    const check = str(k.checkDefinition) ?? str(k.checkExpression);
    // `filterDefinition` is the WIRE-CONTRACT v2 spelling of the filtered
    // predicate; `indexPredicate` is the IR spelling the sidecar may also use.
    const predicate = str(k.filterDefinition) ?? str(k.indexPredicate);
    // A clustered flag is derivable from the index type even when the sidecar
    // leaves `isClustered` null: `clustered` / `clustered_columnstore` are
    // clustered, every other named type is not.
    const typeLower = indexType === null ? null : indexType.toLowerCase();
    const clusteredFromType =
      typeLower === null
        ? null
        : typeLower === 'clustered' || typeLower === 'clustered_columnstore';
    return {
      schemaName: k.schemaName,
      tableName: k.tableName,
      kind: normaliseKeyKind(k.kind),
      name: k.name,
      columns: k.columns ?? [],
      referencedSchema: k.referencedSchema ?? null,
      referencedTable: k.referencedTable ?? null,
      // SQL Server's `sys.foreign_key_columns` always resolves both sides, so
      // unlike the ASE path an FK arrives with its columns POPULATED.
      referencedColumns: k.referencedColumns ?? null,
      isUnique: k.isUnique,
      checkExpression: check,
      onDelete: str(k.deleteRule),
      onUpdate: str(k.updateRule),
      indexDefinition: str(k.indexDefinition),
      // Prefer an explicit access method; otherwise the index type token is
      // the closest verbatim equivalent SQL Server reports.
      indexMethod: str(k.indexMethod) ?? typeLower,
      isClustered:
        k.isClustered !== undefined && k.isClustered !== null
          ? k.isClustered === true
          : clusteredFromType,
      indexPredicate: predicate,
      columnDirections:
        k.columnDirections !== undefined &&
        k.columnDirections !== null &&
        k.columnDirections.length > 0
          ? k.columnDirections.map((d) => String(d))
          : null,
      // Covering columns + the enforcement flags are engine-NEUTRAL facts
      // (PostgreSQL has INCLUDE and NOT VALID too), so they ride the shared
      // IR into `constraints_metadata` / `fk_columns` rather than the
      // pack-private extras: the pack generator needs them to emit
      // `INCLUDE (...)` and `NOT VALID`.
      includeColumns:
        (k.includeColumns ?? []).length > 0
          ? (k.includeColumns ?? []).map((c) => String(c))
          : null,
      isDisabled: bool(k.isDisabled),
      isNotTrusted: bool(k.isNotTrusted),
    };
  });

  const viewExtras: MssqlViewExtras[] = [];
  const views: ViewMetadata[] = (resp.views ?? []).map((v) => {
    viewExtras.push({
      schemaName: v.schemaName,
      viewName: v.viewName,
      isSchemaBound: bool(v.isSchemaBound),
      isIndexedView: bool(v.isIndexedView),
    });
    return {
      schemaName: v.schemaName,
      viewName: v.viewName,
      definition: v.definition ?? '',
      // SQL Server has no materialized views. An INDEXED VIEW is the nearest
      // construct and it is an OUT item by owner ruling, so it is flagged as
      // its own named-reason Finding rather than pretended to be a matview.
      isMaterialized: false,
    };
  });

  const routineExtras: MssqlRoutineExtras[] = [];
  const procedures: ProcedureMetadata[] = (resp.procedures ?? []).map((p) => {
    const wireKind = (p.routineKind ?? '').toLowerCase();
    const isClr = wireKind === 'clr_procedure' || wireKind === 'clr_function';
    const params = mapParameters(p.parameters);
    routineExtras.push({
      schemaName: p.schemaName,
      routineName: p.procedureName,
      wireKind,
      isClr,
      functionKind: str(p.functionKind),
      parameters: params,
      returnsType: str(p.returnsType),
      executeAs: str(p.executeAs),
      assemblyName: str(p.assemblyName),
      language: p.language ?? (isClr ? 'CLR' : 'TSQL'),
    });
    return {
      schemaName: p.schemaName,
      procedureName: p.procedureName,
      routineKind: neutralRoutineKind(wireKind),
      // `sys.sql_modules.definition` returns the COMPLETE body -- there is no
      // 4096-char reassembly cap on this path, so `body` is already the full
      // recreatable text and doubles as `fullDefinition`.
      body: p.body ?? '',
      language: p.language ?? (isClr ? 'CLR' : 'TSQL'),
      fullDefinition: p.body ? p.body : null,
      arguments: composeArgumentSignature(params),
      returnType: str(p.returnsType),
      // SQL Server has no volatility classification; EXECUTE AS OWNER is its
      // SECURITY DEFINER equivalent.
      securityDefiner: (p.executeAs ?? '').toLowerCase() === 'owner',
    };
  });

  const triggerExtras: MssqlTriggerExtras[] = [];
  const triggers: TriggerMetadata[] = (resp.triggers ?? []).map((t) => {
    triggerExtras.push({
      schemaName: t.schemaName,
      triggerName: t.triggerName,
      isDisabled: bool(t.isDisabled),
      parentKind: str(t.parentKind),
      orderFirstEvents: (t.orderFirstEvents ?? []).map((e) => String(e)),
      orderLastEvents: (t.orderLastEvents ?? []).map((e) => String(e)),
      isDatabaseTrigger: bool(t.isDatabaseTrigger),
    });
    return {
      schemaName: t.schemaName,
      triggerName: t.triggerName,
      tableSchema: t.tableSchema || t.schemaName,
      tableName: t.tableName || '',
      timing: normaliseTriggerTiming(t.timing),
      events: normaliseEvents(t.events),
      actionStatement: t.actionStatement ?? '',
    };
  });

  const sequences: SequenceMetadata[] = (resp.sequences ?? []).map((q) => ({
    schemaName: q.schemaName,
    sequenceName: q.sequenceName,
    dataType: q.dataType ?? null,
    startValue: q.startValue ?? null,
    increment: q.increment ?? null,
    minValue: q.minValue ?? null,
    maxValue: q.maxValue ?? null,
    // `isCycling` is the native-sequence wire spelling; `cycle` is the classic
    // one. Either arriving true means the sequence wraps.
    cycle: q.isCycling === true || q.cycle === true,
    currentValue: str(q.currentValue),
    ownedByTable: q.ownedByTable ?? null,
    ownedByColumn: q.ownedByColumn ?? null,
    definition: q.definition ?? null,
  }));

  const jobExtras: MssqlScheduledJobExtras[] = [];
  const scheduledJobs: ScheduledJobMetadata[] = (resp.scheduledJobs ?? []).map(
    (j) => {
      jobExtras.push({
        jobName: j.jobName,
        steps: (j.steps ?? []).map((s, i) => ({
          ordinal:
            s.ordinal !== undefined && s.ordinal !== null
              ? Number(s.ordinal)
              : i + 1,
          subsystem: str(s.subsystem),
          command: str(s.command),
          databaseName: str(s.databaseName),
        })),
        scheduleText: str(j.scheduleText),
        scheduleFrequency: j.scheduleFrequency ?? null,
      });
      return {
        schemaName: str(j.schemaName) ?? '',
        jobName: j.jobName,
        scheduler: j.scheduler ?? 'sql_server_agent',
        // The human schedule text is the more useful carrier when present;
        // both are VERBATIM, neither is synthesised.
        schedule: str(j.scheduleText) ?? str(j.schedule),
        command:
          str(j.command) ??
          // A multi-step Agent job has no single command; the first step's is
          // the representative one and every step is carried in the extras.
          ((j.steps ?? [])[0] ? str((j.steps ?? [])[0].command) : null),
        enabled: j.enabled === true,
      };
    },
  );

  const extendedObjects: ExtendedObjectMetadata[] = (
    resp.extendedObjects ?? []
  ).map((e) => ({
    kind: String(e.kind ?? '').toLowerCase(),
    schemaName: str(e.schema) ?? '',
    name: String(e.name ?? ''),
    definition: str(e.definition),
    detail: e.detail ?? null,
  }));

  const databaseCollation: string | null = str(resp.databaseCollation);

  const metadataApplicability = resolveMssqlMetadataApplicability({
    capabilities: resp.capabilities,
    serverVersion: resp.serverVersion,
    hasAnyColumnCollation: columns.some(
      (c) => c.collation !== null && c.collation !== undefined,
    ),
    hasDatabaseCollation: databaseCollation !== null,
    hasAnyComputedColumn: columns.some((c) => c.isGenerated === true),
    hasAnySequenceCurrentValue: sequences.some(
      (q) => q.currentValue !== null && q.currentValue !== undefined,
    ),
    hasAnyNativeSequence: sequences.some(
      (q) => q.ownedByTable === null || q.ownedByTable === undefined,
    ),
    hasAnyFkAction: keysAndIndexes.some(
      (k) =>
        (k.onDelete !== null && k.onDelete !== undefined) ||
        (k.onUpdate !== null && k.onUpdate !== undefined),
    ),
    hasAnyIndexClustering: keysAndIndexes.some(
      (k) =>
        (k.isClustered !== null && k.isClustered !== undefined) ||
        (k.indexDefinition !== null && k.indexDefinition !== undefined) ||
        (k.indexMethod !== null && k.indexMethod !== undefined) ||
        (k.columnDirections !== null && k.columnDirections !== undefined),
    ),
    hasAnyIndexPredicate: keysAndIndexes.some(
      (k) => k.indexPredicate !== null && k.indexPredicate !== undefined,
    ),
    hasAnyJob: scheduledJobs.length > 0,
  });

  return {
    schemas,
    tables,
    columns,
    keysAndIndexes,
    views,
    procedures,
    triggers,
    sequences,
    scheduledJobs,
    extendedObjects,
    databaseCollation,
    metadataApplicability,
    mssql: {
      serverVersion: str(resp.serverVersion),
      serverEdition: str(resp.serverEdition),
      serverCollation: str(resp.serverCollation),
      tables: tableExtras,
      columns: columnExtras,
      indexes: indexExtras,
      views: viewExtras,
      routines: routineExtras,
      triggers: triggerExtras,
      scheduledJobs: jobExtras,
    },
  };
}
