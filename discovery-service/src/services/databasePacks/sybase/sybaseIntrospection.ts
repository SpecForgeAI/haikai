/**
 * Sybase introspection helpers.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4.
 * Enriched: 2026-05-29 DB Structural Fidelity -- Task Group 2 (column default
 * extraction, scale/precision/identity/sequence mapping, check-constraint
 * expression, sequence records).
 * Enriched: 2026-05-30 Data-Layer Fidelity 2 -- column collation (Group B),
 * computed-column flag/expression (Group E), sequence current value (Group C),
 * database-resident scheduled jobs (Group F) -- all consumed from the sidecar
 * shape where exposed; defaulted otherwise.
 * Enriched: 2026-05-31 Sybase metadata enrichment -- group-5 index
 * ordering/clustering fields onto `KeyOrIndexMetadata`, the top-level
 * `databaseCollation`, and the NEW three-state applicability resolution
 * (`present` / `not_applicable_for_engine` / `unavailable`) from the sidecar's
 * `capabilities[]` + `serverVersion` + value presence.
 *
 * Discovery-service is a pure Node process. All Sybase JDBC I/O happens
 * inside the sidecar; this module transforms the sidecar's structured
 * introspection response into the engine-neutral
 * {@link IntrospectionResult} shape that the orchestrator + finding
 * builders expect.
 *
 * The sidecar already does the catalog walk against {@code sysusers},
 * {@code sysobjects}, {@code syscolumns}, {@code sysindexes},
 * {@code sysreferences}, {@code syscomments}; our job is mapping +
 * normalising (e.g. Sybase timing strings -> {@code 'before' | 'after' |
 * 'instead_of'}).
 */

import type {
  ColumnMetadata,
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
import type { SidecarIntrospectionResponse } from './sybaseSidecarClient';

/**
 * Canonical sidecar capability keys (Spec 2026-05-31, decision 3). These MUST
 * match the verbatim group keys the sidecar appends to its `capabilities[]`
 * array AND the {@link MetadataGroupKey} union in `types.ts`. Discovery reads a
 * group it does NOT find here as `unavailable` (an absent capability from an
 * older sidecar is a read gap, NOT a structural N/A).
 *
 * The five sidecar-advertised groups are listed; `index_predicate` /
 * `native_sequence` are discovery-internal structural markers (ASE lacks the
 * construct) resolved from engine knowledge + version, so the sidecar never
 * advertises them and they are intentionally NOT in this object.
 */
export const SYBASE_METADATA_CAPABILITY = {
  collation: 'collation',
  computedColumns: 'computed_columns',
  sequenceCurrentValue: 'sequence_current_value',
  fkActions: 'fk_actions',
  indexClustering: 'index_clustering',
  dbJobs: 'db_jobs',
} as const;

/**
 * The minimum ASE MAJOR version that ships native SEQUENCE objects. Pre-ASE16
 * has no SEQUENCE catalog at all, so the native-sequence construct resolves to
 * `not_applicable_for_engine` (a deliberate structural N/A, decision 2/4) -- NOT
 * an evidence gap. Identity columns (synthesized into the `sequences[]` shape on
 * the sidecar) are a separate group and are unaffected by this.
 */
const ASE_NATIVE_SEQUENCE_MIN_MAJOR = 16;

/**
 * Parse the MAJOR ASE version out of a verbatim `@@version` / serverVersion
 * string. ASE reports things like
 * `Adaptive Server Enterprise/16.0/EBF .../P/...` or a bare `15.7`. We pull the
 * first `<major>.<minor>`-shaped token (preferring one after a `/`), and return
 * just the integer major. Returns null when no version token is recognisable
 * (an OLDER sidecar that omits `serverVersion` -> null -> we do NOT assume the
 * engine lacks the construct; the resolver treats an unknown version as
 * "could support it", so native sequence then resolves on the capability, not on
 * a structural N/A).
 */
export function parseAseMajorVersion(
  serverVersion: string | null | undefined,
): number | null {
  if (!serverVersion) return null;
  // Prefer a version token that follows a slash (the ASE banner shape), else
  // fall back to the first version-looking token anywhere in the string.
  const slashMatch = serverVersion.match(/\/\s*(\d+)\.(\d+)/);
  const anyMatch = serverVersion.match(/(?:^|[^\d.])(\d+)\.(\d+)/);
  const m = slashMatch ?? anyMatch;
  if (!m) return null;
  const major = Number.parseInt(m[1], 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * Resolve the three-state applicability for a single engine-SUPPORTED metadata
 * group (collation / computed columns / sequence current value / FK actions /
 * index clustering / DB jobs). Decision 2/3:
 *
 *  - capability advertised AND a value was captured -> `present`.
 *  - capability advertised AND no value captured    -> `unavailable`
 *    (the engine supports it / the sidecar surfaced the group, but the value
 *    could not be read -> the `TODO(oracle-W3)` evidence-gap Finding).
 *  - capability NOT advertised (older sidecar)       -> `unavailable`
 *    (a read gap, explicitly NOT a structural N/A).
 *
 * This helper is ONLY for engine-supported groups. ASE structural absences
 * (`index_predicate`, `native_sequence`) are resolved separately by
 * {@link resolveSybaseMetadataApplicability} and never pass through here.
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
 * Resolve the full {@link MetadataApplicabilityMap} for a Sybase introspection
 * (Spec 2026-05-31, decision 2). Inputs:
 *  - `capabilities[]` -- which groups THIS sidecar build surfaced.
 *  - `serverVersion`  -- the ASE `@@version` (gates the native-sequence
 *    structural N/A: pre-ASE16 has no SEQUENCE catalog).
 *  - value presence   -- derived from the already-mapped IR slots.
 *
 * Two groups are ALWAYS structurally `not_applicable_for_engine` for ASE
 * regardless of capability/value, because the engine lacks the construct:
 *  - `index_predicate`  -- ASE has no filtered / partial indexes.
 *  - `native_sequence`  -- native SEQUENCE objects are ASE16+; a pre-ASE16
 *    engine structurally lacks them. When the version is unknown (older
 *    sidecar omitted `serverVersion`) we do NOT assert the structural N/A and
 *    fall back to resolving the surfaced sequence-current-value capability.
 */
function resolveSybaseMetadataApplicability(args: {
  capabilities: string[] | null | undefined;
  serverVersion: string | null | undefined;
  hasAnyColumnCollation: boolean;
  hasDatabaseCollation: boolean;
  hasAnyComputedColumn: boolean;
  hasAnySequenceCurrentValue: boolean;
  hasAnyFkAction: boolean;
  hasAnyIndexClustering: boolean;
  hasAnyJob: boolean;
}): MetadataApplicabilityMap {
  const caps = new Set<string>(
    (args.capabilities ?? []).filter((c) => typeof c === 'string'),
  );
  const major = parseAseMajorVersion(args.serverVersion);

  const map: Record<MetadataGroupKey, MetadataApplicability> = {
    // Engine-supported groups: capability + value presence drive the state.
    collation: resolveSupportedGroup(
      caps,
      SYBASE_METADATA_CAPABILITY.collation,
      args.hasAnyColumnCollation || args.hasDatabaseCollation,
    ),
    computed_columns: resolveSupportedGroup(
      caps,
      SYBASE_METADATA_CAPABILITY.computedColumns,
      args.hasAnyComputedColumn,
    ),
    sequence_current_value: resolveSupportedGroup(
      caps,
      SYBASE_METADATA_CAPABILITY.sequenceCurrentValue,
      args.hasAnySequenceCurrentValue,
    ),
    fk_actions: resolveSupportedGroup(
      caps,
      SYBASE_METADATA_CAPABILITY.fkActions,
      args.hasAnyFkAction,
    ),
    index_clustering: resolveSupportedGroup(
      caps,
      SYBASE_METADATA_CAPABILITY.indexClustering,
      args.hasAnyIndexClustering,
    ),
    db_jobs: resolveSupportedGroup(
      caps,
      SYBASE_METADATA_CAPABILITY.dbJobs,
      args.hasAnyJob,
    ),
    // Structural N/A for ASE: no filtered / partial indexes -> no predicate.
    // Deliberate N/A, never an evidence gap.
    index_predicate: 'not_applicable_for_engine',
    // Native SEQUENCE objects are ASE16+. A KNOWN pre-ASE16 engine structurally
    // lacks them (N/A). When the version is unknown (older sidecar omitted it),
    // do NOT assert the structural N/A -- resolve on the surfaced
    // sequence-current-value capability instead (a read gap, not a structural
    // N/A).
    native_sequence:
      major !== null && major < ASE_NATIVE_SEQUENCE_MIN_MAJOR
        ? 'not_applicable_for_engine'
        : resolveSupportedGroup(
            caps,
            SYBASE_METADATA_CAPABILITY.sequenceCurrentValue,
            args.hasAnySequenceCurrentValue,
          ),
  };
  return map;
}

/**
 * Normalise a sidecar trigger timing string to the engine-neutral form.
 */
function normaliseTriggerTiming(
  raw: string,
): TriggerMetadata['timing'] {
  const upper = (raw ?? '').toLowerCase();
  if (upper === 'before') return 'before';
  if (upper === 'instead_of' || upper === 'instead of') return 'instead_of';
  return 'after';
}

/**
 * Normalise an event string from the sidecar to one of the canonical
 * event values. Unknown values are dropped.
 */
function normaliseEvents(
  raw: string[],
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
 * Map a sidecar introspection key kind to the engine-neutral
 * {@link KeyOrIndexMetadata} kind.
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
 * Transform a {@link SidecarIntrospectionResponse} into the
 * engine-neutral {@link IntrospectionResult} shape.
 *
 * Snippet bodies (views, procedures, triggers, sequences) are forwarded
 * unchanged -- the sidecar already pre-trimmed them. The pack's
 * {@code emitFindings} layer applies {@code snippetRedaction} (full-body +
 * size-cap) before any finding payload is built.
 */
export function transformSidecarIntrospection(
  resp: SidecarIntrospectionResponse,
): IntrospectionResult {
  const schemas: SchemaMetadata[] = (resp.schemas ?? []).map((s) => ({
    schemaName: s.schemaName,
    owner: s.owner ?? null,
  }));

  const tables: TableMetadata[] = (resp.tables ?? []).map((t) => ({
    schemaName: t.schemaName,
    tableName: t.tableName,
    objectType: 'table' as const,
    estimatedRowCount: null,
    comment: null,
  }));

  const columns: ColumnMetadata[] = (resp.columns ?? []).map((c) => ({
    schemaName: c.schemaName,
    tableName: c.tableName,
    columnName: c.columnName,
    dataType: c.dataType,
    isNullable: c.isNullable,
    ordinalPosition: c.ordinalPosition,
    maxLength: c.maxLength > 0 ? c.maxLength : null,
    // Spec 2026-05-29: extract the column default instead of hardcoding null;
    // the sidecar now reports it (optional -> null when absent / older build).
    defaultExpression:
      c.defaultExpression !== undefined && c.defaultExpression !== null
        ? String(c.defaultExpression)
        : null,
    scale: c.scale !== undefined && c.scale !== null ? Number(c.scale) : null,
    precision:
      c.precision !== undefined && c.precision !== null
        ? Number(c.precision)
        : null,
    isIdentity: c.isIdentity === true,
    sequenceName:
      c.sequenceName !== undefined && c.sequenceName !== null
        ? String(c.sequenceName)
        : null,
    // Group 1 (collation): per-column collation, read from the sidecar where it
    // surfaces it (Spec 2026-05-31). Null-tolerant: an older sidecar build that
    // does not project it defaults to null (the collation group then resolves
    // to `unavailable`).
    collation:
      c.collation !== undefined && c.collation !== null
        ? String(c.collation)
        : null,
    // Group 2 (computed columns): computed-column flag + VERBATIM expression,
    // read from the sidecar where it surfaces them (Spec 2026-05-31).
    // Null-tolerant: older build -> false/null.
    isGenerated: c.isComputed === true,
    generationExpression:
      c.computedExpression !== undefined && c.computedExpression !== null
        ? String(c.computedExpression)
        : null,
  }));

  const keysAndIndexes: KeyOrIndexMetadata[] = (resp.keys ?? []).map((k) => ({
    schemaName: k.schemaName,
    tableName: k.tableName,
    kind: normaliseKeyKind(k.kind),
    name: k.name,
    columns: k.columns ?? [],
    referencedSchema: k.referencedSchema ?? null,
    referencedTable: k.referencedTable ?? null,
    referencedColumns: k.referencedColumns ?? null,
    isUnique: k.isUnique,
    checkExpression:
      k.checkExpression !== undefined && k.checkExpression !== null
        ? String(k.checkExpression)
        : null,
    // Group 4 (FK referential actions): capture on_delete / on_update where the
    // sidecar surfaces them (Spec 2026-05-31). Null-tolerant: classic ASE FKs
    // are often RESTRICT / NO ACTION and an older catalog null-outs.
    onDelete:
      k.deleteRule !== undefined && k.deleteRule !== null
        ? String(k.deleteRule)
        : null,
    onUpdate:
      k.updateRule !== undefined && k.updateRule !== null
        ? String(k.updateRule)
        : null,
    // Group 5 (index ordering / clustering / partial-predicate) -- NEW on both
    // sides (Spec 2026-05-31). Copy the five sidecar index fields onto the IR
    // null-tolerantly, mirroring the onDelete/onUpdate style above and the
    // Postgres path (`postgresIntrospection.parsePostgresIndexDef` + the
    // is_clustered decode). The `candidateStructuralFidelity` reshaper folds
    // these into `constraints_metadata.indexes[]`. `indexPredicate` is ALWAYS
    // null for ASE (no filtered / partial indexes -> resolves to
    // `not_applicable_for_engine`, never an evidence gap).
    indexDefinition:
      k.indexDefinition !== undefined && k.indexDefinition !== null
        ? String(k.indexDefinition)
        : null,
    indexMethod:
      k.indexMethod !== undefined && k.indexMethod !== null
        ? String(k.indexMethod)
        : null,
    isClustered:
      k.isClustered !== undefined && k.isClustered !== null
        ? k.isClustered === true
        : null,
    indexPredicate:
      k.indexPredicate !== undefined && k.indexPredicate !== null
        ? String(k.indexPredicate)
        : null,
    columnDirections:
      k.columnDirections !== undefined &&
      k.columnDirections !== null &&
      k.columnDirections.length > 0
        ? k.columnDirections.map((d) => String(d))
        : null,
  }));

  const views: ViewMetadata[] = (resp.views ?? []).map((v) => ({
    schemaName: v.schemaName,
    viewName: v.viewName,
    definition: v.definition ?? '',
    isMaterialized: v.isMaterialized,
  }));

  const procedures: ProcedureMetadata[] = (resp.procedures ?? []).map((p) => ({
    schemaName: p.schemaName,
    procedureName: p.procedureName,
    routineKind:
      (p.routineKind ?? '').toLowerCase() === 'function'
        ? ('function' as const)
        : ('procedure' as const),
    body: p.body ?? '',
    language: p.language ?? 'TSQL',
    // Spec 2026-05-30 Data-Layer Fidelity 2 (Group G) fuller-capture fields are
    // Postgres-specific (pg_get_functiondef / provolatile / prosecdef). The
    // Sybase sidecar's /introspect does not project a full-definition envelope,
    // signature, volatility, or a SECURITY-DEFINER flag, so these stay
    // undefined on the Sybase path.
    // TODO(oracle-W3): have the external Sybase sidecar project the routine's
    // full CREATE text + parameter signature (ASE: syscomments / sp_helptext /
    // syscolumns for params) so overloaded / security-context routines are
    // recreatable here too. (Do NOT modify the sidecar -- consume only.)
  }));

  const triggers: TriggerMetadata[] = (resp.triggers ?? []).map((t) => ({
    schemaName: t.schemaName,
    triggerName: t.triggerName,
    tableSchema: t.tableSchema || t.schemaName,
    tableName: t.tableName || '',
    timing: normaliseTriggerTiming(t.timing),
    events: normaliseEvents(t.events ?? []),
    actionStatement: t.actionStatement ?? '',
  }));

  const sequences: SequenceMetadata[] = (resp.sequences ?? []).map((q) => ({
    schemaName: q.schemaName,
    sequenceName: q.sequenceName,
    dataType: q.dataType ?? null,
    startValue: q.startValue ?? null,
    increment: q.increment ?? null,
    minValue: q.minValue ?? null,
    maxValue: q.maxValue ?? null,
    cycle: q.cycle === true,
    // Group 3 (sequence / identity current value): the sequence's current value
    // (high-water mark), read from the sidecar where it surfaces it (Spec
    // 2026-05-31 -- cheap path then `MAX(col)` fallback on the sidecar; identity
    // columns are synthesized into this same shape). Null-tolerant: an older
    // sidecar that exposes the shape but no current-value column defaults to
    // null and the cutover-hazard finding is marked value-unavailable.
    currentValue:
      q.currentValue !== undefined && q.currentValue !== null
        ? String(q.currentValue)
        : null,
    ownedByTable: q.ownedByTable ?? null,
    ownedByColumn: q.ownedByColumn ?? null,
    definition: q.definition ?? null,
  }));

  // Group 6 (DB-resident jobs): the Sybase Job Scheduler, read from the sidecar
  // where it surfaces them (Spec 2026-05-31 -- via the narrow read-only
  // Job-Scheduler proc allowlist). Null-tolerant: an older sidecar that does not
  // project a jobs array defaults to [] and no jobs/agents finding is emitted.
  // Detail (schedule + command) is kept VERBATIM.
  const scheduledJobs: ScheduledJobMetadata[] = (resp.scheduledJobs ?? []).map(
    (j) => ({
      schemaName:
        j.schemaName !== undefined && j.schemaName !== null
          ? String(j.schemaName)
          : '',
      jobName: j.jobName,
      scheduler: j.scheduler ?? 'sybase_job_scheduler',
      schedule:
        j.schedule !== undefined && j.schedule !== null
          ? String(j.schedule)
          : null,
      command:
        j.command !== undefined && j.command !== null
          ? String(j.command)
          : null,
      enabled: j.enabled === true,
    }),
  );

  // Spec 2026-05-31 Group 1: set the DB-level default collation from the new
  // top-level wire field (the IR carries `databaseCollation` but the Sybase
  // mapper did not set it before). `collation_case_sensitivity_hazard` reads it
  // via `emitCollationHazardFindings`. Null-tolerant (older sidecar omits it).
  const databaseCollation: string | null =
    resp.databaseCollation !== undefined && resp.databaseCollation !== null
      ? String(resp.databaseCollation)
      : null;

  // Spec 2026-05-31 decision 2: resolve the three-state applicability map from
  // the sidecar `capabilities[]` + `serverVersion` + the value presence we just
  // mapped. Consumed by the Sybase finding emitters so a structurally-absent
  // construct (`not_applicable_for_engine`) suppresses the evidence-gap Finding
  // that an `unavailable` group still emits.
  const metadataApplicability = resolveSybaseMetadataApplicability({
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
    databaseCollation,
    metadataApplicability,
  };
}
