/**
 * Shared types for the deterministic DB schema + data migration pack
 * generator (Sybase ASE -> PostgreSQL).
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Groups 2 (schema generation core) + 3 (data migration pack).
 *
 * VOCABULARY ALIGNMENT (spec 2.2 / tasks.md "One IR/schema vocabulary"):
 * the IR below speaks the `discovery-service/src/services/databasePacks/types.ts`
 * shape family — `ColumnMetadata`-style column facts (scale / precision /
 * isIdentity / collation / isGenerated / generationExpression),
 * `SequenceMetadata.currentValue` (string high-water), and
 * `KeyOrIndexMetadata`-style key/index facts (onDelete / onUpdate /
 * isClustered / columnDirections) — so the Group 5 diff consumes the same
 * vocabulary. The gateway cannot import across services, so the shapes are
 * mirrored here field-for-field.
 *
 * NO LLM ANYWHERE in this module family — pure deterministic code.
 */

// ---------------------------------------------------------------------------
// Source-schema IR (stage 2) — committed model + findings merged by identity
// ---------------------------------------------------------------------------

/**
 * One column of the source schema, merged from the committed
 * `physical_data_attributes` row AND the schema-metadata findings that carry
 * the facts the committed model does not (collation, computed-column
 * generation expressions, non-portable defaults). Field names follow the
 * discovery `ColumnMetadata` vocabulary.
 */
export interface IrColumn {
  schemaName: string;
  tableName: string;
  columnName: string;
  /** Verbatim source engine type (e.g. `money`, `varchar(50)`, `numeric`). */
  dataType: string;
  /** Character length parsed from an inline `(n)` when present. */
  maxLength: number | null;
  scale: number | null;
  precision: number | null;
  isNullable: boolean;
  isPrimaryKey: boolean;
  /** Verbatim source default expression (e.g. `getdate()`). */
  defaultExpression: string | null;
  ordinalPosition: number | null;
  isIdentity: boolean;
  // --- findings-merged facts (exist ONLY in findings, never on attributes) ---
  /** Verbatim source collation; set from `collation_case_sensitivity_hazard`. */
  collation: string | null;
  /** TRUE when a collation hazard finding marks the column case-insensitive. */
  collationCaseInsensitive: boolean;
  /** TRUE when a finding carries a computed-column generation expression. */
  isGenerated: boolean;
  /** Verbatim Sybase generation expression for a computed column. */
  generationExpression: string | null;
  /** Set from a `non_portable_default` finding (verbatim token + note). */
  nonPortableDefault: { token: string; note: string } | null;
  // --- provenance ---
  /** Committed `physical_data_attributes.id`. */
  attributeId: string;
  /** Owning committed `physical_data_entities.id`. */
  entityId: string;
  /** Finding ids that contributed merged facts to this column. */
  findingIds: string[];
}

/** Index entry mirrored from `constraints_metadata.indexes[]` (verbatim). */
export interface IrIndex {
  name: string;
  columns: string[];
  isUnique: boolean;
  isClustered: boolean;
  /** Per-column ordering directives, positionally aligned with `columns`. */
  columnDirections: string[] | null;
  method: string | null;
  predicate: string | null;
}

export interface IrTable {
  schemaName: string;
  tableName: string;
  /** Committed `physical_data_entities.id`. */
  entityId: string;
  /** Verbatim `physical_type` from the committed entity (may be null). */
  physicalType: string | null;
  /** Normalised object type: views are skipped (requires translation spec 2). */
  objectType: 'table' | 'view';
  columns: IrColumn[];
  primaryKey: { name: string; columns: string[] } | null;
  uniqueConstraints: Array<{ name: string; columns: string[] }>;
  checkConstraints: Array<{ name: string; expression: string | null }>;
  indexes: IrIndex[];
  /** Best-effort source row count from discovery profiling findings. */
  estimatedRowCount: number | null;
  /** Finding ids that contributed table-level facts. */
  findingIds: string[];
}

/** A declared FK between two tables (from relationship `fk_columns`). */
export interface IrForeignKey {
  /** Relationship id in the committed model (provenance). */
  relationshipId: string;
  /** Child (FK-owning) table. */
  fromSchema: string;
  fromTable: string;
  /** Parent (referenced) table. */
  toSchema: string;
  toTable: string;
  joinColumns: string[];
  referencedColumns: string[];
  /** Verbatim referential actions from `fk_columns.on_delete` / `on_update`. */
  onDelete: string | null;
  onUpdate: string | null;
}

/**
 * Sequence / identity high-water carrier merged from `sequence_definition` /
 * `sequence_cutover_hazard` findings (the committed model never carries the
 * current value — Group C of Data-Layer Fidelity 2).
 */
export interface IrSequence {
  schemaName: string;
  sequenceName: string;
  /** Verbatim high-water mark (string — bigint-safe). null = unavailable. */
  currentValue: string | null;
  currentValueAvailable: boolean;
  startValue: string | null;
  /** Owning table/column when the sequence backs an identity column. */
  ownedByTable: string | null;
  ownedByColumn: string | null;
  findingIds: string[];
}

/** Proc/trigger/view/scheduled-job objects listed in the manifest, never translated. */
export interface IrUntranslatedObject {
  kind: 'stored_procedure' | 'trigger' | 'view' | 'scheduled_job';
  objectRef: string;
  findingIds: string[];
}

/** A captured `db.*` decision (code + answer). */
export interface IrDbDecision {
  decisionCode: string;
  answerValue: string;
}

/** The full source-schema IR the translator consumes. */
export interface SourceSchemaIr {
  sourceEngine: string;
  targetEngine: string;
  tables: IrTable[];
  foreignKeys: IrForeignKey[];
  sequences: IrSequence[];
  untranslated: IrUntranslatedObject[];
  /**
   * Sybase ASE system-catalog objects EXCLUDED from the pack (2026-08-07):
   * harvested system tables/views/procs (sysobjects, sysquerymetrics, ...)
   * are engine infrastructure, never migrated app schema — a translated
   * system view failed the live run's final post-load changeset because its
   * sysqueryplans source can never exist on the target. Optional so IR
   * literals in tests stay valid.
   */
  sybaseSystemExclusions?: Array<{ kind: string; objectRef: string }>;
  dbDecisions: IrDbDecision[];
  /**
   * Resolved pack decisions keyed by `decision_key` — a MANDATORY generation
   * input (the regeneration loop): a resolved decision converts a flagged
   * object back into translated/skipped per its resolution.
   */
  resolvedDecisions: Record<string, Record<string, unknown>>;
  /**
   * Structural completeness accounting (WS3 P1, 2026-07-31). Set by
   * buildSourceSchemaIr; optional so IR literals in tests stay valid — the
   * handler falls back to an IR-derived approximation when absent.
   */
  structuralAccounting?: StructuralAccounting;
}

/**
 * Structural completeness accounting (WS3 P1, 2026-07-31).
 *
 * The live 2026-07-30 pack shipped 0 PKs / 0 FKs / 0 indexes and NO
 * stored-procedure/view/default coverage — all silently, because the IR
 * builder defaults absent metadata to empty (`constraints_metadata ?? {}`,
 * fk_columns-less relationships skipped, code objects only present when a
 * finding exists). These counts make the drop VISIBLE: they land in the
 * manifest, drive count-tied acceptance criteria on the constraints story,
 * and convert suspicious zeros into explicit prerequisite items in the plan.
 */
/**
 * One structured structural finding (Spec 2026-08-04-2). Identity for the
 * disposition store is `${kind}:${subject}` — counts live only in `message`
 * so count drift never orphans a recorded disposition.
 */
export interface StructuralFinding {
  /**
   * Stable machine kind: constraints_metadata_absent | no_primary_keys |
   * no_indexes | relationships_without_fk_columns | no_code_objects.
   */
  kind: string;
  /** Stable scope token (today always an aggregate like `all_tables`). */
  subject: string;
  /** The human warning text (same string as `structural_warnings`). */
  message: string;
  /**
   * The affected items behind the aggregate count (2026-08-04 partial-
   * coverage follow-up): e.g. the join-less relationship pairs or the
   * PK-less tables. Rendered as an expander on the findings panel so the
   * human dispositions a VISIBLE list, never a bare number. Optional —
   * aggregate-by-nature findings (no_indexes, no_code_objects) omit it.
   */
  details?: string[];
}

/** The disposition store key for a finding. */
export function structuralFindingKey(f: { kind: string; subject: string }): string {
  return `${f.kind}:${f.subject}`;
}

export interface StructuralAccounting {
  tables_total: number;
  view_entities_total: number;
  tables_with_constraints_metadata: number;
  tables_with_primary_key: number;
  unique_constraints_total: number;
  check_constraints_total: number;
  indexes_total: number;
  relationships_total: number;
  relationships_with_fk_columns: number;
  /**
   * Per-item detail lists behind the counts (2026-08-04 partial-coverage
   * follow-up): which tables lack a PK, and which relationships lack join
   * metadata ("from -> to" pairs). Feed the findings' `details` so partial
   * drops are itemised, never just counted. Optional — absent on packs
   * generated earlier and on the IR-only fixture path.
   */
  tables_without_primary_key?: string[];
  relationships_without_fk_details?: string[];
  /**
   * FINDINGS-channel visibility (2026-08-01): collation hazards, computed
   * columns and sequences reach the IR ONLY via discovery findings (never
   * committed attributes). These counts make that channel's health visible
   * in the manifest — zero can be legit (no such objects), so they carry
   * NO warnings, just numbers a reviewer can question.
   */
  collation_hazard_columns: number;
  generated_columns: number;
  sequences_captured: number;
  code_objects_captured: {
    stored_procedure: number;
    trigger: number;
    view: number;
    scheduled_job: number;
  };
}

// ---------------------------------------------------------------------------
// Generator outputs
// ---------------------------------------------------------------------------

export type PackFileKind =
  | 'liquibase_master'
  | 'liquibase_changeset'
  | 'bulk_load_script'
  | 'incremental_script'
  | 'manifest'
  | 'readme'
  /** Emitted APPROVED-translation file rows ONLY (Spec 2026-06-11, Group 4). */
  | 'translation'
  /**
   * Side-by-side operation kinds (Spec 2026-07-02-d): the rerunnable daily
   * sync runner + state DDL, the per-run reconciliation queries + report
   * builder, and the swap-over runbook. AMS chk_dmpf_file_kind extended by
   * changeset 204.
   */
  | 'sync_runner'
  | 'reconciliation_script'
  | 'cutover_runbook';

export interface PackFile {
  filePath: string;
  fileKind: PackFileKind;
  content: string;
  sortOrder: number;
}

export type PackDecisionCategory =
  | 'type_mapping'
  | 'computed_column'
  | 'collation'
  | 'delta_key'
  | 'other';

export interface PackDecision {
  /** Stable: `<kind>--<object_ref>` so regeneration re-links resolutions. */
  decisionKey: string;
  objectRef: string;
  category: PackDecisionCategory;
  question: string;
  options: string[];
}

export type CoverageDisposition = 'translated' | 'skipped' | 'flagged';

export interface CoverageEntry {
  objectType: 'table' | 'column';
  objectRef: string;
  disposition: CoverageDisposition;
  /** Mandatory for `skipped`; the explicit reason. */
  reason?: string;
  /** Decision keys raised against this object (for `flagged`). */
  decisionKeys?: string[];
  provenance: {
    entityId: string;
    attributeId?: string;
    findingIds: string[];
  };
}

/** Per-table delta strategy recorded in the manifest (Group 3 / 3.5). */
export interface DeltaStrategy {
  table: string;
  strategy:
    | 'insert_only'
    | 'insert_update'
    | 'full_reload'
    | 'skipped'
    | 'needs_decision';
  deltaKey: string | null;
  /** How the key was chosen: detection heuristic or a resolved decision. */
  source:
    | 'identity_column'
    | 'timestamp_name_heuristic'
    | 'resolved_decision'
    | 'none';
}

export interface PackManifest {
  manifest_version: 1;
  source_engine: string;
  target_engine: string;
  type_mapping_version: string;
  seed_margin: number;
  seed_margin_note: string;
  phase_ordering: string[];
  delete_propagation: string;
  coverage: {
    translated_count: number;
    skipped_count: number;
    flagged_count: number;
    objects: CoverageEntry[];
  };
  requires_translation_spec_2: Array<{
    kind: string;
    object_ref: string;
    finding_ids: string[];
  }>;
  manual_recreation: Array<{
    kind: string;
    object_ref: string;
    finding_ids: string[];
  }>;
  /**
   * Sybase system-catalog objects excluded from the pack entirely
   * (2026-08-07): engine infrastructure, never migrated — not emitted, not
   * translated, not loaded. Visible accounting so an exclusion is never a
   * silent drop. Absent on packs generated earlier.
   */
  sybase_system_exclusions?: Array<{ kind: string; object_ref: string }>;
  cycle_breaks: string[];
  cluster_notes: string[];
  /**
   * Schema-scoped relation renames (2026-08-06): Sybase scopes constraint and
   * index names per TABLE; Postgres backs PK/UNIQUE with indexes — per-SCHEMA
   * relations — so source-verbatim names on copied tables (temp_*, load_*)
   * collide at schema-apply (`relation "hir_book_ak1" already exists`).
   * Colliders rename deterministically to <table>_<name>; this is the
   * old->new provenance for constraints_metadata consumers. Absent on packs
   * generated earlier.
   */
  relation_name_renames?: Array<{
    schema: string;
    table: string;
    kind: 'primary_key' | 'unique_constraint' | 'index';
    from: string;
    to: string;
  }>;
  collation_notes: string[];
  delta_strategies: DeltaStrategy[];
  bulk_load: {
    table_order: string[];
    expected_row_counts: Record<string, number>;
    cast_notes: Record<string, string[]>;
  };
  /** The Group 5 diff baseline — emitted at generation time (spec 2.5). */
  expected_schema: ExpectedSchema;
  /**
   * Structural completeness accounting + explicit warnings (WS3 P1,
   * 2026-07-31): visible counts of what generation actually received, and
   * one warning per suspicious zero (no PKs / no indexes / join-less
   * relationships / no code objects captured). The planner converts each
   * warning into a prerequisite item. Absent on packs generated earlier.
   */
  structural_accounting?: StructuralAccounting;
  structural_warnings?: string[];
  /**
   * STRUCTURED twins of `structural_warnings` (Spec 2026-08-04-2): each
   * warning carries a stable identity (`kind` + `subject`, key `kind:subject`)
   * so human dispositions (accepted / fix_upstream / known_gap) persist across
   * pack regenerations even when counts inside the message drift. The legacy
   * string list is kept for wire back-compat; both are derived from the same
   * accounting pass. Absent on packs generated earlier.
   */
  structural_findings?: StructuralFinding[];
  /**
   * The DECLARED target-database binding (2026-07-20): the plan CREATES the
   * target DB, so the plan states its coordinates — the operator confirms
   * them and supplies only SECRETS, never re-types what the tool decided.
   * Local-machine defaults (data parity runs locally); override at apply
   * time when reality differs. NEVER carries credentials. Absent on packs
   * generated before this field.
   */
  target_db?: {
    engine: 'postgresql';
    host: string;
    port: number;
    database: string;
    schema: string;
    username: string;
    note: string;
  };
  /**
   * Side-by-side operation section (Spec 2026-07-02-d): daily one-way sync
   * runner + state table, reconciliation artefacts, swap-over runbook, and
   * the per-table sync posture. Absent on packs generated before the spec.
   */
  sync?: {
    cadence_default: 'daily';
    state_table: string;
    runner_path: string;
    state_ddl_path: string;
    reconciliation_paths: string[];
    runbook_path: string;
    tables: Array<{
      table: string;
      strategy: DeltaStrategy['strategy'];
      delta_key: string | null;
    }>;
  };
  /**
   * Approved-only translation emission provenance (Spec 2026-06-11 DB Object
   * Translation Drafts, Task 4.2/4.3). Written by the emission pass — absent
   * until the first emission runs; only APPROVED objects ever appear here.
   */
  translations?: {
    approved_count: number;
    approved_objects: Array<{
      kind: string;
      object_ref: string;
      translation_key: string;
      file_path: string;
      changeset_id: string;
      source_body_hash: string | null;
      reviewed_at: string | null;
    }>;
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Expected-schema JSON — the discovery `types.ts` vocabulary, normalised to
// the TARGET (PostgreSQL) shape. Group 5 diffs this against the verification
// scan snapshot.
// ---------------------------------------------------------------------------

export interface ExpectedSchemaColumn {
  schemaName: string;
  tableName: string;
  columnName: string;
  /** The TARGET (PostgreSQL) type produced by the v1 mapping. */
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultExpression: string | null;
  isIdentity: boolean;
  isGenerated: boolean;
  generationExpression: string | null;
}

export interface ExpectedSchemaKeyOrIndex {
  schemaName: string;
  tableName: string;
  kind:
    | 'primary_key'
    | 'unique_constraint'
    | 'foreign_key'
    | 'index'
    | 'check_constraint';
  name: string;
  columns: string[];
  referencedSchema: string | null;
  referencedTable: string | null;
  referencedColumns: string[] | null;
  onDelete: string | null;
  onUpdate: string | null;
  isUnique: boolean;
  columnDirections: string[] | null;
}

export interface ExpectedSchemaSequence {
  schemaName: string;
  sequenceName: string;
  /** Restart value = high-water + margin (string — bigint-safe). */
  restartWith: string | null;
  ownedByTable: string | null;
  ownedByColumn: string | null;
}

export interface ExpectedSchema {
  tables: Array<{ schemaName: string; tableName: string }>;
  columns: ExpectedSchemaColumn[];
  keysAndIndexes: ExpectedSchemaKeyOrIndex[];
  sequences: ExpectedSchemaSequence[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the source/target pair is anything but Sybase ASE -> PostgreSQL. */
export class UnsupportedEnginePairError extends Error {
  public readonly sourceEngine: string;
  public readonly targetEngine: string;
  constructor(sourceEngine: string, targetEngine: string, detail?: string) {
    super(
      `Unsupported engine pair: ${sourceEngine} -> ${targetEngine}. ` +
        `Sybase ASE -> PostgreSQL is the only supported combination in v1.` +
        (detail ? ` ${detail}` : '')
    );
    this.name = 'UnsupportedEnginePairError';
    this.sourceEngine = sourceEngine;
    this.targetEngine = targetEngine;
  }
}

/**
 * Thrown by the post-generation coverage assertion when any discovered
 * table/column is NOT in exactly one of translated | skipped | flagged.
 * Coverage is a CODE guarantee — an unaccounted object FAILS the run, it
 * never passes silently.
 */
export class CoverageAssertionError extends Error {
  public readonly unaccounted: string[];
  public readonly duplicated: string[];
  public readonly unknown: string[];
  constructor(args: {
    unaccounted?: string[];
    duplicated?: string[];
    unknown?: string[];
  }) {
    const parts: string[] = [];
    if (args.unaccounted?.length) {
      parts.push(`unaccounted objects: ${args.unaccounted.join(', ')}`);
    }
    if (args.duplicated?.length) {
      parts.push(`objects in more than one bucket: ${args.duplicated.join(', ')}`);
    }
    if (args.unknown?.length) {
      parts.push(`ledger entries for unknown objects: ${args.unknown.join(', ')}`);
    }
    super(`DB migration pack coverage assertion FAILED — ${parts.join('; ')}`);
    this.name = 'CoverageAssertionError';
    this.unaccounted = args.unaccounted ?? [];
    this.duplicated = args.duplicated ?? [];
    this.unknown = args.unknown ?? [];
  }
}
