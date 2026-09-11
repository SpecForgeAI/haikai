/**
 * Per-finding-type builders for the v1 Database Discovery finding emission
 * points. Mirrors the per-source builder pattern in
 * `findings/emissionSources.ts`.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 *
 * Each builder returns a `FindingEmitInput` (no I/O). Group 2 SCAFFOLDS the
 * builders so Groups 3 (Postgres pack) and 4 (Sybase pack) can call them
 * directly without re-inventing the shape per engine.
 *
 * SHAPE CONTRACT
 * --------------
 *  - Every builder forwards `engineKey` so finding titles distinguish
 *    cross-engine duplicates (same table name in two engines produces two
 *    findings, not one).
 *  - Every builder threads `objectIdentity` (schema.table[.column]) into the
 *    title so the per-run dedupe key (see `FindingEmitter.computeDedupeKey`)
 *    naturally separates findings for distinct objects.
 *  - Every builder forwards `source = 'db_discovery_pack'` and a stage
 *    string (`createdByStage`) for traceability. Categories follow the
 *    spec.md taxonomy:
 *      * `schema_quality` -- structural defects (missing PK, unenforced FK)
 *      * `data_quality`   -- profile-driven (null rate, sentinels)
 *      * `hidden_logic`   -- SP / view / trigger bodies
 *      * `migration_risk` -- consolidated risk finding (D6)
 *      * `evidence_gap`   -- existing finding type extended w/ db_* gapType
 *      * `pack_warning`   -- soft-fail surface
 *
 * REDACTION
 * ---------
 *  - All snippet payloads (`bodySnippet`, `viewDefinition`, `sampleValue`)
 *    MUST go through `snippetRedaction.redactSnippet` before being passed
 *    to these builders. Builders accept the already-redacted string and do
 *    NOT re-redact (no double-truncation surprises).
 */

import type { FindingEmitInput } from '../FindingEmitter';
import type { DiscoveryFindingLinkPayload } from '../../archModelClient';
import { redactSnippet, redactFullBody } from '../../../utils/snippetRedaction';

/**
 * Engine discriminator for cross-engine title separation.
 */
export type DbFindingEngineKey = 'postgres' | 'sybase' | 'mssql' | 'unknown';

/**
 * `db_migration_risk` riskCategory payload (D6 consolidation). Consumes
 * legacy `view_dependency` + `complex_view_logic` + generic `migration_risk`.
 */
export type DbMigrationRiskCategory =
  | 'complex_view_logic'
  | 'view_dependency'
  | 'stored_procedure_complexity'
  | 'trigger_side_effect'
  | 'cross_schema_dependency'
  | 'engine_specific_feature'
  | 'large_object_count';

/**
 * `hidden_business_logic` sourceObjectType payload (D6 consolidation).
 * Consumes the per-object-type variants into one finding type.
 */
export type HiddenLogicSourceObjectType =
  | 'stored_procedure'
  | 'trigger'
  | 'function'
  | 'view';

/**
 * `evidence_gap` gapType discriminator values for db_* gaps. Extends the
 * existing `evidence_gap` finding (no new type) per D6 consolidation #2.
 */
export type DbEvidenceGapType =
  | 'db_schema_metadata_gap'
  | 'db_object_definition_missing'
  | 'db_relationship_inference_low_confidence'
  | 'db_profile_skipped'
  | 'db_profile_timeout'
  | 'db_unreadable_object'
  | 'db_no_sample_data';

// -----------------------------------------------------------------------------
// 1) Structural -- missing_primary_key
// -----------------------------------------------------------------------------

export function buildMissingPrimaryKeyFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  tableName: string;
  candidateId?: string;
  estimatedRowCount?: number | null;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.tableName}`;
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  return {
    findingType: 'missing_primary_key',
    category: 'schema_quality',
    severity: 'high',
    title: `Missing primary key [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Table '${objectIdentity}' has no primary key constraint. ` +
      `Row identity, replication, and downstream change-data-capture rely on a PK.`,
    detailJson: {
      engineKey: args.engineKey,
      schemaName: args.schemaName,
      tableName: args.tableName,
      estimatedRowCount: args.estimatedRowCount ?? null,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.structuralFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 2) Structural -- no_foreign_keys_declared
// -----------------------------------------------------------------------------

export function buildNoForeignKeysDeclaredFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  tableName: string;
  candidateId?: string;
  columnCount?: number;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.tableName}`;
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  return {
    findingType: 'no_foreign_keys_declared',
    category: 'schema_quality',
    severity: 'medium',
    title: `No foreign keys declared [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Table '${objectIdentity}' declares zero foreign keys. ` +
      `Relationships may exist by convention only -- run relationship inference to confirm.`,
    detailJson: {
      engineKey: args.engineKey,
      schemaName: args.schemaName,
      tableName: args.tableName,
      columnCount: args.columnCount ?? null,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.structuralFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 3) Relationship inference -- inferred_relationship
// -----------------------------------------------------------------------------

export function buildInferredRelationshipFinding(args: {
  engineKey: DbFindingEngineKey;
  fromSchema: string;
  fromTable: string;
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  toColumns: string[];
  confidence: number;
  rationale?: string;
  fromCandidateId?: string;
  toCandidateId?: string;
}): FindingEmitInput {
  const fromIdentity = `${args.fromSchema}.${args.fromTable}(${args.fromColumns.join(',')})`;
  const toIdentity = `${args.toSchema}.${args.toTable}(${args.toColumns.join(',')})`;
  const severity = args.confidence < 0.5 ? 'low' : 'medium';
  const links: DiscoveryFindingLinkPayload[] = [];
  if (args.fromCandidateId) {
    links.push({
      linkType: 'related_to',
      targetType: 'discovery_candidate',
      targetId: args.fromCandidateId,
    });
  }
  if (args.toCandidateId) {
    links.push({
      linkType: 'related_to',
      targetType: 'discovery_candidate',
      targetId: args.toCandidateId,
    });
  }
  return {
    findingType: 'inferred_relationship',
    category: 'schema_quality',
    severity,
    title: `Inferred relationship [${args.engineKey}]: ${fromIdentity} -> ${toIdentity}`,
    summary:
      args.rationale ??
      `Heuristic relationship inferred from column naming + value-overlap sampling. ` +
        `Confidence ${args.confidence.toFixed(2)}; review before treating as a real FK.`,
    confidence: args.confidence,
    detailJson: {
      engineKey: args.engineKey,
      from: {
        schemaName: args.fromSchema,
        tableName: args.fromTable,
        columns: args.fromColumns,
      },
      to: {
        schemaName: args.toSchema,
        tableName: args.toTable,
        columns: args.toColumns,
      },
      rationale: args.rationale ?? null,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.relationshipInference',
    links,
  };
}

// -----------------------------------------------------------------------------
// 4) Data quality -- high_null_rate
// -----------------------------------------------------------------------------

export function buildHighNullRateFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  tableName: string;
  columnName: string;
  nullRate: number;
  rowsObserved?: number;
  attributeCandidateId?: string;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.tableName}.${args.columnName}`;
  const severity = args.nullRate >= 0.9 ? 'medium' : 'low';
  const links: DiscoveryFindingLinkPayload[] = args.attributeCandidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.attributeCandidateId,
        },
      ]
    : [];
  return {
    findingType: 'high_null_rate',
    category: 'data_quality',
    severity,
    title: `High null rate [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Column '${objectIdentity}' is null in ${(args.nullRate * 100).toFixed(1)}% of ` +
      `${args.rowsObserved ?? 'sampled'} rows. May indicate optional usage, dead column, or migration cleanup target.`,
    detailJson: {
      engineKey: args.engineKey,
      schemaName: args.schemaName,
      tableName: args.tableName,
      columnName: args.columnName,
      nullRate: args.nullRate,
      rowsObserved: args.rowsObserved ?? null,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.dataQualityFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 5) Consolidated migration risk -- db_migration_risk (D6)
// -----------------------------------------------------------------------------

export function buildDbMigrationRiskFinding(args: {
  engineKey: DbFindingEngineKey;
  riskCategory: DbMigrationRiskCategory;
  /** Free-form object identifier ('schema.table', 'schema.view_name', etc.). */
  objectName: string;
  /** Object kind for the finding payload. */
  objectKind: 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'schema';
  rationale: string;
  /** Severity laddered per-call; defaults to 'medium'. */
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Optional pre-redacted snippet from the offending object body. */
  bodySnippet?: string;
  candidateId?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  return {
    findingType: 'db_migration_risk',
    category: 'migration_risk',
    severity: args.severity ?? 'medium',
    title: `Migration risk [${args.engineKey}][${args.riskCategory}]: ${args.objectName}`,
    summary: args.rationale,
    detailJson: {
      engineKey: args.engineKey,
      riskCategory: args.riskCategory,
      objectName: args.objectName,
      objectKind: args.objectKind,
      // Defensive double-redact: callers should pre-redact, but if a
      // bodySnippet slipped through raw we redact here as a safety net. Spec
      // 2026-05-29: use the FULL-BODY path so this no longer re-truncates a
      // complete proc/trigger/view body at 200 chars.
      bodySnippet:
        args.bodySnippet !== undefined
          ? redactFullBody(args.bodySnippet).body
          : null,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.migrationRiskFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 6) SP-body finding -- stored_procedure_logic
// -----------------------------------------------------------------------------

/**
 * Stored procedure logic finding. The orchestrator emits ONE per discovered
 * procedure. Body MUST be pre-redacted (this builder applies `redactSnippet`
 * defensively as a safety net).
 */
export function buildStoredProcedureLogicFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  procedureName: string;
  routineKind: 'procedure' | 'function';
  bodySnippet: string;
  language?: string;
  /**
   * Group G (Spec 2026-05-30 Data-Layer Fidelity 2) fuller-capture metadata,
   * captured ALONGSIDE the existing body. All VERBATIM, all optional -- omitted
   * when the engine / sidecar does not expose them (e.g. the Sybase path).
   * `prosrc` (`bodySnippet`) is UNCHANGED; these make overloaded +
   * security-context functions recreatable.
   */
  fullDefinition?: string | null;
  arguments?: string | null;
  returnType?: string | null;
  volatility?: string | null;
  securityDefiner?: boolean | null;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.procedureName}`;
  // Spec 2026-06-11 (DB Object Translation Drafts, TG1): the body runs through
  // the TARGETED full-body redaction; the result's `literal_policy` marker is
  // threaded into detail_json (with the redacted/truncated fidelity flags) so
  // newly captured bodies self-identify and legacy blanket-collapsed bodies
  // are detectable downstream by the marker's ABSENCE.
  const redactedBody = redactFullBody(args.bodySnippet);
  // The fuller-capture detail is added ALONGSIDE the existing body keys; the
  // full CREATE envelope is run through the same full-body redaction + size cap
  // as the body so a secret in a DEFAULT literal is not leaked. A null/absent
  // field is simply omitted so the existing Spec-3 payload round-trips
  // unchanged for engines that do not report the richer metadata.
  const fullerCapture: Record<string, unknown> = {};
  if (args.fullDefinition !== undefined && args.fullDefinition !== null) {
    fullerCapture.fullDefinition = redactFullBody(args.fullDefinition).body;
  }
  if (args.arguments !== undefined && args.arguments !== null) {
    fullerCapture.signatureArguments = args.arguments;
  }
  if (args.returnType !== undefined && args.returnType !== null) {
    fullerCapture.returnType = args.returnType;
  }
  if (args.volatility !== undefined && args.volatility !== null) {
    fullerCapture.volatility = args.volatility;
  }
  if (args.securityDefiner !== undefined && args.securityDefiner !== null) {
    fullerCapture.securityDefiner = args.securityDefiner === true;
  }
  return {
    findingType: 'stored_procedure_logic',
    category: 'hidden_logic',
    severity: 'medium',
    title: `Stored procedure logic [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `${args.routineKind === 'function' ? 'Function' : 'Procedure'} '${objectIdentity}' ` +
      `contains logic that lives in the database, not application code. Capture as candidate ` +
      `business logic before migration.`,
    detailJson: {
      engineKey: args.engineKey,
      schemaName: args.schemaName,
      procedureName: args.procedureName,
      routineKind: args.routineKind,
      language: args.language ?? null,
      bodySnippet: redactedBody.body,
      redacted: redactedBody.redacted,
      truncated: redactedBody.truncated,
      literal_policy: redactedBody.literal_policy,
      // Group G fuller capture (omitted keys when unavailable).
      ...fullerCapture,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.hiddenLogicFindings',
    links: [],
  };
}

// -----------------------------------------------------------------------------
// 7) Consolidated hidden_business_logic (D6)
// -----------------------------------------------------------------------------

export function buildHiddenBusinessLogicFinding(args: {
  engineKey: DbFindingEngineKey;
  sourceObjectType: HiddenLogicSourceObjectType;
  schemaName: string;
  objectName: string;
  bodySnippet: string;
  /** Optional summary override; defaults to a generic per-objectType sentence. */
  summary?: string;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.objectName}`;
  const defaultSummary =
    args.sourceObjectType === 'view'
      ? `View '${objectIdentity}' contains derived-data logic that may be doing implicit ETL.`
      : args.sourceObjectType === 'trigger'
      ? `Trigger '${objectIdentity}' executes side-effects on DML. Audit before migration.`
      : args.sourceObjectType === 'function'
      ? `Function '${objectIdentity}' contains scalar/table-valued logic embedded in the database.`
      : `Procedure '${objectIdentity}' contains business logic embedded in the database.`;
  return {
    findingType: 'hidden_business_logic',
    category: 'hidden_logic',
    severity: 'medium',
    title: `Hidden business logic [${args.engineKey}][${args.sourceObjectType}]: ${objectIdentity}`,
    summary: args.summary ?? defaultSummary,
    detailJson: {
      engineKey: args.engineKey,
      sourceObjectType: args.sourceObjectType,
      schemaName: args.schemaName,
      objectName: args.objectName,
      bodySnippet: redactFullBody(args.bodySnippet).body,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.hiddenLogicFindings',
    links: [],
  };
}

// -----------------------------------------------------------------------------
// 7a) Trigger body -- trigger_logic (Spec 2026-05-29 DB Structural Fidelity)
// -----------------------------------------------------------------------------

/**
 * Trigger-logic finding. Captures the COMPLETE verbatim trigger body (redacted
 * + size-capped) plus metadata: the table the trigger fires on, its timing,
 * and the DML events. Category `hidden_logic`.
 *
 * Risk-weighting (migration concern, NOT blanket INFO): a trigger whose body
 * performs DML (cascading writes / audit inserts) is `medium`; a read-only /
 * validation-only trigger is `info`.
 */
export function buildTriggerLogicFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  triggerName: string;
  /** The schema.table the trigger fires on. */
  tableSchema: string;
  tableName: string;
  timing: 'before' | 'after' | 'instead_of';
  events: Array<'insert' | 'update' | 'delete' | 'truncate'>;
  /** RAW trigger body -- redacted + size-capped inside this builder. */
  body: string;
  /** Whether the body writes data (DML). Drives the severity ladder. */
  bodyHasDml?: boolean;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.triggerName}`;
  const firesOn = `${args.tableSchema}.${args.tableName}`;
  const redacted = redactFullBody(args.body);
  const severity = args.bodyHasDml ? 'medium' : 'info';
  return {
    findingType: 'trigger_logic',
    category: 'hidden_logic',
    severity,
    title: `Trigger logic [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Trigger '${objectIdentity}' fires ${args.timing.toUpperCase()} ` +
      `${args.events.join('/').toUpperCase() || 'DML'} on '${firesOn}'. ` +
      `Its body executes database-side logic that must be re-expressed in the ` +
      `migration target. Captured verbatim for migration planning.`,
    detailJson: {
      engineKey: args.engineKey,
      objectKind: 'trigger',
      schemaName: args.schemaName,
      triggerName: args.triggerName,
      firesOnSchema: args.tableSchema,
      firesOnTable: args.tableName,
      timing: args.timing,
      events: args.events,
      migrationConcern: args.bodyHasDml
        ? 'trigger_writes_data'
        : 'trigger_logic_review',
      body: redacted.body,
      redacted: redacted.redacted,
      truncated: redacted.truncated,
      literal_policy: redacted.literal_policy,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.hiddenLogicFindings',
    links: [],
  };
}

// -----------------------------------------------------------------------------
// 7b) View definition -- view_definition (Spec 2026-05-29)
// -----------------------------------------------------------------------------

/**
 * View-definition finding. Captures the COMPLETE verbatim defining SQL
 * (redacted + size-capped). The view itself stays a `physical_data_entities`
 * row (`physical_type='View'`); only its defining SQL lands here as a Finding.
 * Category `hidden_logic`.
 *
 * Risk-weighting: a "complex" view (many joins / windows / lines) is `medium`;
 * a plain projection view is `info`.
 */
export function buildViewDefinitionFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  viewName: string;
  isMaterialized: boolean;
  /** RAW view definition -- redacted + size-capped inside this builder. */
  definition: string;
  /** Whether the view is "complex"; drives the severity ladder. */
  isComplex?: boolean;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.viewName}`;
  const redacted = redactFullBody(args.definition);
  const severity = args.isComplex ? 'medium' : 'info';
  const kindLabel = args.isMaterialized ? 'Materialized view' : 'View';
  return {
    findingType: 'view_definition',
    category: 'hidden_logic',
    severity,
    title: `View definition [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `${kindLabel} '${objectIdentity}' carries a defining query that may ` +
      `encode implicit ETL / derived-data logic. Captured verbatim so the ` +
      `migration can reproduce it.`,
    detailJson: {
      engineKey: args.engineKey,
      objectKind: args.isMaterialized ? 'materialized_view' : 'view',
      schemaName: args.schemaName,
      viewName: args.viewName,
      isMaterialized: args.isMaterialized,
      migrationConcern: args.isComplex
        ? 'complex_view_logic'
        : 'view_definition_review',
      body: redacted.body,
      redacted: redacted.redacted,
      truncated: redacted.truncated,
      literal_policy: redacted.literal_policy,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.hiddenLogicFindings',
    links: [],
  };
}

// -----------------------------------------------------------------------------
// 7c) Sequence definition -- sequence_definition (Spec 2026-05-29)
// -----------------------------------------------------------------------------

/**
 * Sequence-definition finding. Captures the sequence metadata (start /
 * increment / min / max / cycle / owned-by) plus any verbatim DDL the engine
 * reports (redacted + size-capped). Category `hidden_logic`. Severity `info`
 * by default (a sequence is rarely a migration risk on its own), bumped to
 * `low` when it is NOT owned by a column (a standalone sequence the migration
 * must recreate independently).
 *
 * Spec 2026-05-30 Data-Layer Fidelity 2 (Group C): the current value (the
 * allocation high-water mark) is now ALSO carried in the payload alongside the
 * generation parameters. The dedicated cutover-hazard finding
 * ({@link buildSequenceCutoverHazardFinding}) is what flags the migration risk;
 * this finding just records the value as part of the full sequence picture.
 */
export function buildSequenceDefinitionFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  sequenceName: string;
  dataType?: string | null;
  startValue?: string | null;
  increment?: string | null;
  minValue?: string | null;
  maxValue?: string | null;
  cycle?: boolean;
  /** The current allocation high-water mark, VERBATIM (Group C). */
  currentValue?: string | null;
  ownedByTable?: string | null;
  ownedByColumn?: string | null;
  /** Optional RAW DDL -- redacted + size-capped inside this builder. */
  definition?: string | null;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.sequenceName}`;
  const redacted = redactFullBody(args.definition ?? '');
  const isStandalone = !args.ownedByTable;
  const ownedBy =
    args.ownedByTable && args.ownedByColumn
      ? `${args.ownedByTable}.${args.ownedByColumn}`
      : args.ownedByTable ?? null;
  return {
    findingType: 'sequence_definition',
    category: 'hidden_logic',
    severity: isStandalone ? 'low' : 'info',
    title: `Sequence definition [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Sequence '${objectIdentity}'` +
      (ownedBy ? ` backs '${ownedBy}'` : ` is standalone`) +
      `. Its generation parameters (start / increment / min / max / cycle) must ` +
      `be reproduced in the migration target.`,
    detailJson: {
      engineKey: args.engineKey,
      objectKind: 'sequence',
      schemaName: args.schemaName,
      sequenceName: args.sequenceName,
      dataType: args.dataType ?? null,
      startValue: args.startValue ?? null,
      increment: args.increment ?? null,
      minValue: args.minValue ?? null,
      maxValue: args.maxValue ?? null,
      cycle: args.cycle === true,
      // Group C: the current high-water mark, VERBATIM (null when unavailable).
      currentValue: args.currentValue ?? null,
      ownedByTable: args.ownedByTable ?? null,
      ownedByColumn: args.ownedByColumn ?? null,
      migrationConcern: isStandalone
        ? 'standalone_sequence'
        : 'column_backed_sequence',
      body: redacted.body,
      redacted: redacted.redacted,
      truncated: redacted.truncated,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.hiddenLogicFindings',
    links: [],
  };
}

// -----------------------------------------------------------------------------
// 7d) Sequence cutover hazard -- sequence_cutover_hazard
//     (Spec 2026-05-30 Data-Layer Fidelity 2, Group C)
// -----------------------------------------------------------------------------

/**
 * Cross-engine sequence cutover-hazard finding (Spec 2026-05-30 Data-Layer
 * Fidelity 2, Group C). Emitted for a sequence whose CURRENT value (the
 * allocation high-water mark) must be carried to the target -- recreating the
 * sequence at its START rather than its current value means the FIRST
 * post-cutover INSERT re-allocates an already-used id and COLLIDES with an
 * existing primary key. Category `migration_risk` (a book-of-work item, not a
 * structural defect). The VERBATIM current value is carried in the payload; the
 * stored value on `SequenceMetadata` is never mutated.
 *
 * When the engine / sidecar does NOT expose a current value (e.g. the current
 * Sybase sidecar -- it surfaces the sequence shape but no current-value column,
 * TODO(oracle-W3)), the finding is still emitted with the value marked
 * UNAVAILABLE so the book-of-work knows the high-water mark must be obtained
 * out-of-band before cutover.
 */
export function buildSequenceCutoverHazardFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  sequenceName: string;
  /** The VERBATIM current value (high-water mark), or null when unavailable. */
  currentValue?: string | null;
  /** The sequence start value, for the "would re-allocate from here" reasoning. */
  startValue?: string | null;
  ownedByTable?: string | null;
  ownedByColumn?: string | null;
  candidateId?: string;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.sequenceName}`;
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  const valueAvailable =
    args.currentValue !== undefined && args.currentValue !== null;
  const ownedBy =
    args.ownedByTable && args.ownedByColumn
      ? `${args.ownedByTable}.${args.ownedByColumn}`
      : args.ownedByTable ?? null;
  const valuePhrase = valueAvailable
    ? `Its current high-water mark is ${args.currentValue}`
    : `Its current high-water mark could NOT be read from this engine (value unavailable -- TODO(oracle-W3))`;
  return {
    findingType: 'sequence_cutover_hazard',
    category: 'migration_risk',
    severity: 'medium',
    title: `Sequence cutover hazard [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Sequence '${objectIdentity}'` +
      (ownedBy ? ` backs '${ownedBy}'` : ` is standalone`) +
      `. ${valuePhrase}. If the target sequence is recreated at its START value ` +
      `(${args.startValue ?? 'unknown'}) rather than advanced past this high-water ` +
      `mark, the FIRST post-cutover INSERT will re-allocate an already-used id and ` +
      `COLLIDE with an existing primary key. Advance the target sequence (setval / ` +
      `ALTER SEQUENCE RESTART) past the captured value during cutover.`,
    detailJson: {
      engineKey: args.engineKey,
      objectKind: 'sequence',
      schemaName: args.schemaName,
      sequenceName: args.sequenceName,
      // VERBATIM -- captured value, never normalized. null => unavailable.
      currentValue: valueAvailable ? args.currentValue : null,
      currentValueAvailable: valueAvailable,
      startValue: args.startValue ?? null,
      ownedByTable: args.ownedByTable ?? null,
      ownedByColumn: args.ownedByColumn ?? null,
      migrationConcern: 'sequence_restart_collision',
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.sequenceCutoverFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 8) Extended evidence_gap with db_* gapType (D6 consolidation #2)
// -----------------------------------------------------------------------------

export function buildDbEvidenceGapFinding(args: {
  engineKey: DbFindingEngineKey;
  gapType: DbEvidenceGapType;
  /**
   * Human-readable object identifier (`schema.table`, `schema.proc_name`,
   * etc.). Empty string when the gap is run-level rather than object-level.
   */
  objectName: string;
  gapDescription: string;
  candidateId?: string;
}): FindingEmitInput {
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  // The existing `evidence_gap` finding type is shared with the code-pack
  // emission sources (`emissionSources.buildEvidenceGapFinding`). We use the
  // SAME finding_type string so the Findings tab groups them together; the
  // `gapType` payload discriminates DB-origin gaps from code-origin ones.
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'medium',
    title: `Evidence gap [${args.engineKey}][${args.gapType}]: ${args.objectName || 'run-level'}`,
    summary: args.gapDescription,
    detailJson: {
      engineKey: args.engineKey,
      gapType: args.gapType,
      objectName: args.objectName,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.evidenceGap',
    links,
  };
}

// -----------------------------------------------------------------------------
// 8a) Cross-engine collation hazard -- collation_case_sensitivity_hazard
//     (Spec 2026-05-30 Data-Layer Fidelity 2, Group B)
// -----------------------------------------------------------------------------

/**
 * Best-effort heuristic: does this VERBATIM collation string imply
 * case-INSENSITIVE matching? This is the cross-engine hazard signal -- a
 * Sybase case-insensitive collation/sort-order whose semantics Postgres's
 * case-SENSITIVE default would not reproduce (e.g. `WHERE name='smith'` would
 * silently stop matching `'Smith'` after a like-for-like migration).
 *
 * NO normalization of the captured value -- this only INSPECTS the string to
 * decide whether to FLAG. Recognises:
 *   - SQL-Server/Sybase-style `..._CI_..` (case-insensitive) collation names
 *     (and the inverse `_CS_` is explicitly NOT case-insensitive).
 *   - Common Sybase case-insensitive sort orders by name
 *     (`nocase`, `case_insensitive`, `..._ci`).
 *   - ICU case-level folding (`...-ks-level1` / `level2`, `colstrength=...`)
 *     and an explicit `ci` accent/case token.
 * Returns false for an unknown / clearly case-sensitive collation so the
 * finding is only emitted on a genuine hazard.
 */
export function collationImpliesCaseInsensitive(
  collation: string | null | undefined,
): boolean {
  if (!collation) return false;
  const c = collation.toLowerCase();
  // Explicit case-SENSITIVE markers short-circuit to "no hazard".
  if (/_cs(_|$)/.test(c) || /\bcase[_-]?sensitive\b/.test(c)) return false;
  if (/_ci(_|$)/.test(c)) return true;
  if (/\bnocase\b/.test(c) || /\bcase[_-]?insensitive\b/.test(c)) return true;
  // ICU level-1 / level-2 strength folds case (level-3+ is case-sensitive).
  if (/ks-level1\b/.test(c) || /ks-level2\b/.test(c)) return true;
  if (/colstrength=(primary|secondary)/.test(c)) return true;
  return false;
}

/**
 * Cross-engine collation hazard finding (Spec 2026-05-30 Data-Layer Fidelity 2,
 * Group B). Emitted when a captured column / database collation implies
 * case-insensitive matching that the target engine's default (Postgres is
 * case-SENSITIVE) would NOT reproduce. Category `migration_risk` -- this is a
 * book-of-work item, not a structural defect. The VERBATIM collation string is
 * carried in the payload; the value on the attribute is never mutated.
 */
export function buildCollationHazardFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  tableName: string;
  columnName: string;
  /** The VERBATIM source collation string that implies case-insensitivity. */
  collation: string;
  /** The VERBATIM source DB-level collation, when known. */
  databaseCollation?: string | null;
  candidateId?: string;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.tableName}.${args.columnName}`;
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  return {
    findingType: 'collation_case_sensitivity_hazard',
    category: 'migration_risk',
    severity: 'medium',
    title: `Collation case-sensitivity hazard [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Column '${objectIdentity}' uses collation '${args.collation}', which implies ` +
      `case-INSENSITIVE matching. PostgreSQL collates case-SENSITIVELY by default, ` +
      `so a like-for-like migration would silently change equality / ORDER BY / ` +
      `unique-key semantics (e.g. WHERE name='smith' would stop matching 'Smith'). ` +
      `Reproduce a case-insensitive collation (e.g. a non-deterministic ICU collation ` +
      `or CITEXT) on the target, or confirm the change is intended.`,
    detailJson: {
      engineKey: args.engineKey,
      schemaName: args.schemaName,
      tableName: args.tableName,
      columnName: args.columnName,
      // VERBATIM -- captured value, never normalized.
      collation: args.collation,
      databaseCollation: args.databaseCollation ?? null,
      migrationConcern: 'case_insensitive_to_case_sensitive',
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.collationHazardFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 8b) Engine-specific default-expression hazard -- non_portable_default
//     (Spec 2026-05-30 Data-Layer Fidelity 2, Group D)
// -----------------------------------------------------------------------------

/**
 * Engine-specific server-default functions that have NO identical Postgres
 * equivalent (or whose Postgres spelling differs), keyed by a lowercase
 * function-name token. The VALUE is the human-readable note appended to the
 * finding so the book-of-work knows the closest target-side construct. This is
 * a DETECTION table only -- the captured `column_default` is NEVER rewritten.
 *
 * Sources: SQL-Server / Sybase ASE T-SQL built-ins (getdate, newid,
 * suser_name, host_name, db_name, newsequentialid, etc.). Postgres's own
 * `now()` / `current_timestamp` / `gen_random_uuid()` are intentionally NOT
 * listed -- those ARE portable and must not be flagged.
 */
export const NON_PORTABLE_DEFAULT_FUNCTIONS: ReadonlyArray<{
  token: string;
  note: string;
}> = [
  { token: 'getdate', note: 'T-SQL getdate() -> Postgres now() / CURRENT_TIMESTAMP' },
  { token: 'getutcdate', note: 'T-SQL getutcdate() -> Postgres (now() AT TIME ZONE \'UTC\')' },
  { token: 'sysdatetime', note: 'T-SQL sysdatetime() -> Postgres now() / clock_timestamp()' },
  { token: 'newid', note: 'T-SQL newid() -> Postgres gen_random_uuid() (uuid-ossp / pgcrypto)' },
  { token: 'newsequentialid', note: 'T-SQL newsequentialid() -> no exact Postgres equivalent (sequential UUID)' },
  { token: 'suser_name', note: 'T-SQL suser_name() -> Postgres current_user / session_user' },
  { token: 'suser_sname', note: 'T-SQL suser_sname() -> Postgres current_user / session_user' },
  { token: 'user_name', note: 'T-SQL user_name() -> Postgres current_user' },
  { token: 'host_name', note: 'T-SQL host_name() -> Postgres inet_client_addr() / application_name (no exact match)' },
  { token: 'db_name', note: 'T-SQL db_name() -> Postgres current_database()' },
  { token: 'app_name', note: 'T-SQL app_name() -> Postgres current_setting(\'application_name\')' },
  { token: '@@spid', note: 'T-SQL @@spid -> Postgres pg_backend_pid()' },
  { token: '@@servername', note: 'T-SQL @@servername -> no exact Postgres equivalent' },
];

/**
 * Detect whether a captured `column_default` expression uses an engine-specific
 * server default that is NOT portable to Postgres. Returns the matched token +
 * note when non-portable, else null. INSPECTS only -- never mutates the input.
 *
 * The match is a word-boundary-ish contains check on the lowercased expression
 * (defaults are commonly wrapped, e.g. `(getdate())` / `(newid())`), so a
 * column whose name merely contains the token (the value is the EXPRESSION, not
 * a name) is not a concern here. A `@@`-prefixed global is matched literally.
 */
export function detectNonPortableDefault(
  columnDefault: string | null | undefined,
): { token: string; note: string } | null {
  if (!columnDefault) return null;
  const expr = columnDefault.toLowerCase();
  for (const entry of NON_PORTABLE_DEFAULT_FUNCTIONS) {
    if (entry.token.startsWith('@@')) {
      // Global variable token -- literal substring match.
      if (expr.includes(entry.token)) return entry;
      continue;
    }
    // Function-style token: match `token` not preceded/followed by an
    // identifier char so `getdate` matches `getdate()` / `(getdate())` but a
    // longer identifier that merely contains it does not.
    const re = new RegExp(`(^|[^a-z0-9_])${entry.token}([^a-z0-9_]|$)`, 'i');
    if (re.test(expr)) return entry;
  }
  return null;
}

/**
 * Non-portable default-expression finding (Spec 2026-05-30 Data-Layer Fidelity
 * 2, Group D). Emitted for a column whose VERBATIM `column_default` uses an
 * engine-specific server default (`getdate()` / `newid()` / `suser_name()` /
 * `host_name()` and the like) that Postgres does not reproduce identically.
 * Category `migration_risk` (book-of-work). FLAG-ONLY: the captured
 * `column_default` is carried VERBATIM in the payload and is NEVER rewritten --
 * the hazard lives only in the finding.
 */
export function buildNonPortableDefaultFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  tableName: string;
  columnName: string;
  /** The VERBATIM captured column default expression (never mutated). */
  columnDefault: string;
  /** The matched engine-specific token (e.g. `getdate`). */
  detectedToken: string;
  /** A human-readable portability note for the book-of-work. */
  portabilityNote?: string | null;
  candidateId?: string;
}): FindingEmitInput {
  const objectIdentity = `${args.schemaName}.${args.tableName}.${args.columnName}`;
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  return {
    findingType: 'non_portable_default',
    category: 'migration_risk',
    severity: 'medium',
    title: `Non-portable column default [${args.engineKey}]: ${objectIdentity}`,
    summary:
      `Column '${objectIdentity}' has the server default '${args.columnDefault}', which uses ` +
      `the engine-specific built-in '${args.detectedToken}'. This has no identical PostgreSQL ` +
      `equivalent, so a like-for-like migration must map it to the closest target construct` +
      (args.portabilityNote ? ` (${args.portabilityNote})` : ``) +
      `. The default is captured verbatim for the book-of-work; it is NOT rewritten here.`,
    detailJson: {
      engineKey: args.engineKey,
      schemaName: args.schemaName,
      tableName: args.tableName,
      columnName: args.columnName,
      // VERBATIM -- captured value, never normalized / rewritten.
      columnDefault: args.columnDefault,
      detectedToken: args.detectedToken,
      portabilityNote: args.portabilityNote ?? null,
      migrationConcern: 'engine_specific_default_expression',
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.nonPortableDefaultFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 8c) Database-resident scheduled job / agent -- db_resident_scheduled_job
//     (Spec 2026-05-30 Data-Layer Fidelity 2, Group F)
// -----------------------------------------------------------------------------

/**
 * Database-resident scheduled-job / agent finding (Spec 2026-05-30 Data-Layer
 * Fidelity 2, Group F). Emitted for a job/agent that lives INSIDE the source
 * database -- a Postgres pg_cron / pgAgent job, or a Sybase Job-Scheduler /
 * `sp_add_job`-style agent. PostgreSQL core ships NO built-in scheduler, so a
 * source-side scheduled job is a genuinely-unsupported / non-portable
 * DB-resident feature: the target must provision the equivalent mechanism
 * (pg_cron extension, an external scheduler, etc.) and recreate the job. This
 * is procedural REALITY captured as a Finding (category `migration_risk`), NOT
 * a new architecture meta-model entity TYPE. The schedule + command are carried
 * VERBATIM (the command is redacted + size-capped as a body snippet).
 */
export function buildScheduledJobFinding(args: {
  engineKey: DbFindingEngineKey;
  schemaName: string;
  jobName: string;
  /** The scheduler mechanism label (e.g. `pg_cron` / `pgagent` / `sybase_job_scheduler`). */
  scheduler?: string | null;
  /** The schedule expression VERBATIM (e.g. a cron string), null when unknown. */
  schedule?: string | null;
  /** RAW job command / SQL -- redacted + size-capped inside this builder. */
  command?: string | null;
  /** Whether the job is enabled, where the engine reports it. */
  enabled?: boolean | null;
  candidateId?: string;
}): FindingEmitInput {
  const objectIdentity = args.schemaName
    ? `${args.schemaName}.${args.jobName}`
    : args.jobName;
  const links: DiscoveryFindingLinkPayload[] = args.candidateId
    ? [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: args.candidateId,
        },
      ]
    : [];
  const schedulerLabel = args.scheduler ?? 'database scheduler';
  const redacted = redactFullBody(args.command ?? '');
  return {
    findingType: 'db_resident_scheduled_job',
    category: 'migration_risk',
    severity: 'medium',
    title: `Database-resident scheduled job [${args.engineKey}][${schedulerLabel}]: ${objectIdentity}`,
    summary:
      `Job '${objectIdentity}' is a database-resident scheduled job/agent (${schedulerLabel})` +
      (args.schedule ? ` running on schedule '${args.schedule}'` : ``) +
      `. PostgreSQL core ships no built-in scheduler, so this procedural reality does NOT ` +
      `travel with a static schema migration -- the target must provision an equivalent ` +
      `scheduler (e.g. the pg_cron extension or an external scheduler) and recreate the job. ` +
      `Captured verbatim for the book-of-work.`,
    detailJson: {
      engineKey: args.engineKey,
      objectKind: 'scheduled_job',
      schemaName: args.schemaName,
      jobName: args.jobName,
      scheduler: args.scheduler ?? null,
      // VERBATIM -- captured schedule expression, never normalized.
      schedule: args.schedule ?? null,
      enabled: args.enabled ?? null,
      migrationConcern: 'db_resident_scheduled_job',
      // The command body, redacted + size-capped (verbatim within the cap).
      command: redacted.body,
      redacted: redacted.redacted,
      truncated: redacted.truncated,
    },
    source: 'db_discovery_pack',
    createdByStage: 'databasePackOrchestrator.unsupportedFeatureFindings',
    links,
  };
}

// -----------------------------------------------------------------------------
// 9) Pack warning -- soft-fail surface
// -----------------------------------------------------------------------------

/**
 * Emitted by the soft-fail wrapper when a pack stage throws. The orchestrator
 * collects these and forwards them through the singleton `FindingEmitter`.
 * Severity is fixed at 'low' -- these are warnings, not defects.
 */
export function buildDbPackWarningFinding(args: {
  engineKey: DbFindingEngineKey;
  stage: string;
  errorMessage: string;
}): FindingEmitInput {
  return {
    findingType: 'db_pack_warning',
    category: 'pack_warning',
    severity: 'low',
    title: `DB pack warning [${args.engineKey}]: ${args.stage}`,
    summary:
      `Stage '${args.stage}' failed during DB discovery. The run continued with ` +
      `partial data. Error: ${args.errorMessage}`,
    detailJson: {
      engineKey: args.engineKey,
      stage: args.stage,
      errorMessage: args.errorMessage,
    },
    source: 'db_discovery_pack',
    createdByStage: `databasePackOrchestrator.softFail.${args.stage}`,
    links: [],
  };
}
