/**
 * Gateway orchestration handler for the deterministic DB schema + data
 * migration pack generator (Sybase ASE -> PostgreSQL).
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Groups 2 (schema generation core) + 3 (data migration pack).
 *
 * Pipeline (spec "Deterministic generation pipeline"):
 *   1. snapshot — fetch ALL mandatory inputs (committed physical model +
 *      persisted findings + captured db.* decisions + resolved pack
 *      decisions) and canonically serialize -> SHA-256 input_snapshot_hash.
 *   2. ir       — build the source-schema IR; merge findings by object
 *      identity (collation / computed expressions / sequence high-water /
 *      non-portable defaults exist ONLY in findings).
 *   3. mapping  — deterministic v1 type mapping + object translation;
 *      ambiguity is NEVER guessed (needs_decision instead).
 *   4. emit     — Liquibase formatted-SQL changelogs (checksum-stable ids)
 *      + bulk/incremental data scripts in the SAME run.
 *   5. coverage — the coverage ledger; a post-generation assertion FAILS the
 *      run if any discovered table/column is unaccounted for.
 *   6. persist  — one logical AMS upsert (pack -> files replace -> decisions
 *      upsert by decision_key).
 *
 * Stage markers (migrationBookOfWorkHandler.ts convention):
 *   [diag-gateway] db_migration_pack stage=snapshot projectId=<id>
 *   [diag-gateway] db_migration_pack stage=ir       ...
 *   [diag-gateway] db_migration_pack stage=mapping  ...
 *   [diag-gateway] db_migration_pack stage=emit     ...
 *   [diag-gateway] db_migration_pack stage=coverage ...
 *   [diag-gateway] db_migration_pack stage=persist  ...
 *
 * NO LLM CLIENT IMPORT anywhere in this module family — the structural
 * generation path is pure deterministic code (a hard spec constraint).
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  accountingFromIr,
  buildSourceSchemaIr,
  canonicalSerialize,
  computeInputSnapshotHash,
  defaultInputFetchDeps,
  deriveStructuralFindings,
  fetchGenerationInputs,
  GenerationInputs,
  InputFetchDeps,
} from './dbMigrationPack/inputs';
import {
  COLLATION_OPTIONS,
  collationDecisionQuestion,
  mapSourceType,
  translateComputedExpression,
  translateDefault,
  TYPE_MAPPING_VERSION,
} from './dbMigrationPack/typeMapping';
import {
  emitForeignKeysChangeset,
  emitIndexesChangeset,
  emitMasterChangelog,
  emitSchemasChangeset,
  emitSequencesSeedChangeset,
  emitTableChangeset,
  EmittableColumn,
  FOREIGN_KEYS_CHANGESET_PATH,
  foreignKeyName,
  INDEXES_CHANGESET_PATH,
  MASTER_CHANGELOG_PATH,
  OmittedColumnNote,
  qualifiedName,
  quotedQualifiedName,
  quoteIdent,
  SCHEMAS_CHANGESET_PATH,
  SEQUENCES_SEED_CHANGESET_PATH,
  SequenceSeedStatement,
  SkippedColumnNote,
  tableChangesetPath,
  topologicalTableOrder,
} from './dbMigrationPack/liquibase';
import { assertPackFilesValid } from './dbMigrationPack/packValidation';
import {
  BULK_LOAD_MANIFEST_PATH,
  bulkScriptPath,
  DELETE_PROPAGATION_STATEMENT,
  deltaKeyDecision,
  detectDeltaKey,
  emitBulkLoadManifest,
  emitBulkLoadScript,
  emitIncrementalScript,
  FIVE_PHASE_ORDERING,
  incrementalScriptPath,
  planBulkColumns,
  resolveDeltaStrategy,
} from './dbMigrationPack/dataScripts';
import {
  RECONCILIATION_REPORT_PATH,
  RECONCILIATION_SQL_PATH,
  SWAP_OVER_RUNBOOK_PATH,
  SYNC_RUNNER_PATH,
  SYNC_STATE_PATH,
  buildSyncManifestSection,
  emitReconciliationReportBuilder,
  emitReconciliationSql,
  emitSwapOverRunbook,
  emitSyncRunner,
  emitSyncStateDdl,
} from './dbMigrationPack/syncPack';
import {
  RequiresTranslationEntry,
  syncPackTranslations,
  TranslationSyncSummary,
} from './dbMigrationPack/translations';
import { runTranslationEmission } from './dbMigrationPack/translationEmission';
import {
  CoverageAssertionError,
  CoverageEntry,
  DeltaStrategy,
  ExpectedSchema,
  ExpectedSchemaColumn,
  ExpectedSchemaKeyOrIndex,
  ExpectedSchemaSequence,
  IrColumn,
  IrTable,
  PackDecision,
  PackFile,
  PackManifest,
  SourceSchemaIr,
  UnsupportedEnginePairError,
} from './dbMigrationPack/types';

export {
  buildSourceSchemaIr,
  canonicalSerialize,
  computeInputSnapshotHash,
  CoverageAssertionError,
  UnsupportedEnginePairError,
};
export type { GenerationInputs, SourceSchemaIr };

export const DEFAULT_SEED_MARGIN = 1000;

export const SEQUENCE_SEED_OPTIONS = [
  'provide_restart_value',
  'derive_from_table_max_at_cutover',
];

// ---------------------------------------------------------------------------
// Coverage assertion (2.5) — the CODE guarantee
// ---------------------------------------------------------------------------

/**
 * Every discovered table and column MUST land in exactly one of
 * translated | skipped | flagged. An unaccounted object, a double-bucketed
 * object, or a ledger entry for an unknown object each FAIL the run — the
 * guarantee is enforced in code, never by diligence.
 */
export function assertCoverage(ir: SourceSchemaIr, ledger: CoverageEntry[]): void {
  const expected = new Set<string>();
  for (const t of ir.tables) {
    expected.add(`table--${qualifiedName(t.schemaName, t.tableName)}`);
    for (const c of t.columns) {
      expected.add(`column--${qualifiedName(t.schemaName, t.tableName)}.${c.columnName}`);
    }
  }
  const seen = new Map<string, number>();
  for (const entry of ledger) {
    const key = `${entry.objectType}--${entry.objectRef}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (entry.disposition === 'skipped' && !entry.reason) {
      throw new CoverageAssertionError({
        unaccounted: [`${key} (skipped without an explicit reason)`],
      });
    }
  }
  const unaccounted = [...expected].filter((k) => !seen.has(k)).sort();
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
  const unknown = [...seen.keys()].filter((k) => !expected.has(k)).sort();
  if (unaccounted.length > 0 || duplicated.length > 0 || unknown.length > 0) {
    throw new CoverageAssertionError({ unaccounted, duplicated, unknown });
  }
}

// ---------------------------------------------------------------------------
// The pure deterministic translation core (stages 3-5)
// ---------------------------------------------------------------------------

export interface PackArtifacts {
  files: PackFile[];
  decisions: PackDecision[];
  manifest: PackManifest;
  coverage: CoverageEntry[];
  counts: { translated: number; skipped: number; flagged: number };
}

interface TranslatedColumn {
  column: IrColumn;
  emitted: EmittableColumn | null;
  omitted: OmittedColumnNote | null;
  skippedNote: SkippedColumnNote | null;
  coverage: CoverageEntry;
}

/**
 * Translate one column: v1 type mapping, computed-column handling, collation
 * hazard, default rewriting, resolved-decision application. NEVER guesses —
 * every ambiguity becomes (or consults) a needs_decision.
 */
function translateColumn(
  table: IrTable,
  column: IrColumn,
  ir: SourceSchemaIr,
  decisions: PackDecision[],
  collationNotes: string[],
  seedDecisionKeysByColumn: Map<string, string[]>
): TranslatedColumn {
  const tableRef = qualifiedName(table.schemaName, table.tableName);
  const colRef = `${tableRef}.${column.columnName}`;
  const decisionKeys: string[] = [];
  const raise = (d: PackDecision): void => {
    decisionKeys.push(d.decisionKey);
    decisions.push(d);
  };
  const coverage = (
    disposition: 'translated' | 'skipped' | 'flagged',
    reason?: string
  ): CoverageEntry => ({
    objectType: 'column',
    objectRef: colRef,
    disposition,
    ...(reason ? { reason } : {}),
    ...(decisionKeys.length > 0 ? { decisionKeys: [...decisionKeys] } : {}),
    provenance: {
      entityId: column.entityId,
      attributeId: column.attributeId,
      findingIds: [...column.findingIds],
    },
  });
  const skippedResult = (reason: string): TranslatedColumn => ({
    column,
    emitted: null,
    omitted: null,
    skippedNote: { columnName: column.columnName, reason },
    coverage: coverage('skipped', reason),
  });

  // --- 1) Type mapping (v1, deterministic; resolutions consulted first) ----
  let postgresType: string | null = null;
  const typeKey = `type_mapping--${colRef}`;
  const typeMapping = mapSourceType(column);
  if (typeMapping.kind === 'mapped') {
    postgresType = typeMapping.postgresType;
  } else {
    const resolution = ir.resolvedDecisions[typeKey];
    const option = typeof resolution?.['option'] === 'string' ? (resolution['option'] as string) : null;
    if (option === 'map_to_bytea') {
      postgresType = 'bytea';
    } else if (option === 'specify_target_type' && typeof resolution?.['target_type'] === 'string') {
      postgresType = resolution['target_type'] as string;
    } else if (option === 'drop_column') {
      return skippedResult(`dropped by resolved decision '${typeKey}'`);
    } else if (option === 'application_managed') {
      return skippedResult(`application-managed per resolved decision '${typeKey}'`);
    } else {
      raise({
        decisionKey: typeKey,
        objectRef: colRef,
        category: 'type_mapping',
        question: typeMapping.question,
        options: typeMapping.options,
      });
      return {
        column,
        emitted: null,
        omitted: {
          columnName: column.columnName,
          decisionKey: typeKey,
          category: 'type_mapping',
          sourceType: column.dataType,
        },
        skippedNote: null,
        coverage: coverage('flagged'),
      };
    }
  }

  // --- 2) Collation hazard — a decision, never a silent default -----------
  let flagged = false;
  if (column.collationCaseInsensitive) {
    const collationKey = `collation--${colRef}`;
    const resolution = ir.resolvedDecisions[collationKey];
    const option = typeof resolution?.['option'] === 'string' ? (resolution['option'] as string) : null;
    if (option === 'citext') {
      postgresType = 'citext';
      collationNotes.push(
        `${colRef}: citext per resolved decision (requires the citext extension on the target).`
      );
    } else if (option === 'expression_indexes_app_discipline') {
      collationNotes.push(
        `${colRef}: kept ${postgresType}; case-insensitivity reproduced via lower() expression indexes + application discipline (resolved decision).`
      );
    } else if (option === 'accept_case_sensitive_change') {
      collationNotes.push(`${colRef}: case-sensitive change ACCEPTED by resolved decision.`);
    } else {
      raise({
        decisionKey: collationKey,
        objectRef: colRef,
        category: 'collation',
        question: collationDecisionQuestion(column),
        options: COLLATION_OPTIONS,
      });
      flagged = true;
    }
  }

  // --- 3) Computed column — deterministic token translation only ----------
  let generationExpression: string | null = null;
  if (column.isGenerated && column.generationExpression) {
    const computedKey = `computed_column--${colRef}`;
    const resolution = ir.resolvedDecisions[computedKey];
    const option = typeof resolution?.['option'] === 'string' ? (resolution['option'] as string) : null;
    if (option === 'provide_target_expression' && typeof resolution?.['expression'] === 'string') {
      generationExpression = resolution['expression'] as string;
    } else if (option === 'plain_column_populated_by_load') {
      generationExpression = null;
    } else if (option === 'drop_column') {
      return skippedResult(`computed column dropped by resolved decision '${computedKey}'`);
    } else {
      const translated = translateComputedExpression(column.generationExpression);
      if (translated.kind === 'translated') {
        generationExpression = translated.expression;
      } else {
        raise({
          decisionKey: computedKey,
          objectRef: colRef,
          category: 'computed_column',
          question: translated.question,
          options: translated.options,
        });
        return {
          column,
          emitted: null,
          omitted: {
            columnName: column.columnName,
            decisionKey: computedKey,
            category: 'computed_column',
            sourceType: `${column.dataType} AS (${column.generationExpression})`,
          },
          skippedNote: null,
          coverage: coverage('flagged'),
        };
      }
    }
  }

  // --- 4) Defaults — safe rewrites only, else flagged ---------------------
  let defaultExpression: string | null = null;
  const defaultResult = translateDefault(column);
  if (defaultResult.kind === 'unchanged' || defaultResult.kind === 'rewritten') {
    defaultExpression = defaultResult.expression;
  } else {
    const defaultKey = `non_portable_default--${colRef}`;
    const resolution = ir.resolvedDecisions[defaultKey];
    const option = typeof resolution?.['option'] === 'string' ? (resolution['option'] as string) : null;
    if (option === 'use_expression' && typeof resolution?.['expression'] === 'string') {
      defaultExpression = resolution['expression'] as string;
    } else if (option === 'drop_default') {
      defaultExpression = null;
    } else {
      raise({
        decisionKey: defaultKey,
        objectRef: colRef,
        category: 'other',
        question: defaultResult.question,
        options: defaultResult.options,
      });
      defaultExpression = null; // emitted WITHOUT the default, flagged below
      flagged = true;
    }
  }

  // --- 5) Identity seed decisions raised elsewhere flag this column too ---
  const seedKeys = seedDecisionKeysByColumn.get(colRef.toLowerCase()) ?? [];
  for (const k of seedKeys) decisionKeys.push(k);
  if (seedKeys.length > 0) flagged = true;

  return {
    column,
    emitted: {
      columnName: column.columnName,
      postgresType: postgresType!,
      isNullable: column.isNullable,
      isIdentity: column.isIdentity,
      defaultExpression,
      generationExpression,
    },
    omitted: null,
    skippedNote: null,
    coverage: coverage(flagged ? 'flagged' : 'translated'),
  };
}

/**
 * Build the sequences-seed statements + any sequence_seed decisions.
 * Seeding uses captured high-water + the pack-level margin; a
 * value-unavailable high-water becomes a needs_decision — NEVER a silent
 * restart-at-1.
 */
export function buildSequenceSeeds(
  ir: SourceSchemaIr,
  seedMargin: number,
  decisions: PackDecision[]
): {
  statements: SequenceSeedStatement[];
  seedDecisionKeysByColumn: Map<string, string[]>;
} {
  const statements: SequenceSeedStatement[] = [];
  const seedDecisionKeysByColumn = new Map<string, string[]>();

  const findSequenceForColumn = (table: IrTable, column: IrColumn) =>
    ir.sequences.find((s) => {
      if (!s.ownedByColumn || s.ownedByColumn.toLowerCase() !== column.columnName.toLowerCase()) {
        return false;
      }
      const owned = (s.ownedByTable ?? '').toLowerCase();
      const bare = table.tableName.toLowerCase();
      const qualified = `${table.schemaName}.${table.tableName}`.toLowerCase();
      return owned === bare || owned === qualified;
    });

  const restartValue = (highWater: string): string =>
    (BigInt(highWater) + BigInt(seedMargin)).toString();

  for (const table of ir.tables) {
    if (table.objectType !== 'table') continue;
    const qn = qualifiedName(table.schemaName, table.tableName);
    const qq = quotedQualifiedName(table.schemaName, table.tableName);
    for (const column of table.columns) {
      if (!column.isIdentity) continue;
      const colRef = `${qn}.${column.columnName}`;
      const seq = findSequenceForColumn(table, column);
      const seedKey = `sequence_seed--${colRef}`;
      const resolution = ir.resolvedDecisions[seedKey];
      const option = typeof resolution?.['option'] === 'string' ? (resolution['option'] as string) : null;
      if (option === 'provide_restart_value' && typeof resolution?.['restart_with'] === 'string') {
        statements.push({
          objectRef: colRef,
          sql: `ALTER TABLE ${qq} ALTER COLUMN ${quoteIdent(column.columnName)} RESTART WITH ${resolution['restart_with']};`,
          note: `restart value provided by resolved decision '${seedKey}'.`,
        });
        continue;
      }
      if (option === 'derive_from_table_max_at_cutover') {
        statements.push({
          objectRef: colRef,
          sql:
            // pg_get_serial_sequence parses its table arg as identifiers —
            // the QUOTED text form keeps the case-exact lookup; the column
            // arg is matched literally, so raw source case is correct.
            `SELECT setval(pg_get_serial_sequence('${qq}', '${column.columnName}'), ` +
            `(SELECT COALESCE(MAX(${quoteIdent(column.columnName)}), 0) + ${seedMargin} FROM ${qq}));`,
          note: `restart derived from table max at cutover (resolved decision '${seedKey}').`,
        });
        continue;
      }
      if (seq && seq.currentValueAvailable && seq.currentValue !== null) {
        statements.push({
          objectRef: colRef,
          sql: `ALTER TABLE ${qq} ALTER COLUMN ${quoteIdent(column.columnName)} RESTART WITH ${restartValue(seq.currentValue)};`,
          note: null,
        });
        continue;
      }
      // Value unavailable (no finding, or the finding says unavailable):
      // a decision, NEVER a silent restart-at-1.
      decisions.push({
        decisionKey: seedKey,
        objectRef: colRef,
        category: 'other',
        question:
          `Identity column ${colRef} has no captured sequence high-water mark ` +
          `(${seq ? 'the source engine could not report the current value' : 'no sequence finding was captured'}). ` +
          `Restarting at 1 would collide with existing ids — choose: provide_restart_value ` +
          `(resolution_json.restart_with = the exact restart value) or ` +
          `derive_from_table_max_at_cutover (a setval from MAX(${column.columnName}) + the seed margin).`,
        options: SEQUENCE_SEED_OPTIONS,
      });
      const list = seedDecisionKeysByColumn.get(colRef.toLowerCase()) ?? [];
      list.push(seedKey);
      seedDecisionKeysByColumn.set(colRef.toLowerCase(), list);
      statements.push({
        objectRef: colRef,
        sql: null,
        note:
          `NEEDS DECISION (${seedKey}): identity ${colRef} high-water unavailable — ` +
          `no restart emitted (never a silent restart-at-1).`,
      });
    }
  }

  // Standalone sequences (not column-backed) — recreate + restart.
  for (const seq of ir.sequences) {
    if (seq.ownedByTable || seq.ownedByColumn) continue;
    const seqRef = `${seq.schemaName}.${seq.sequenceName}`;
    if (seq.currentValueAvailable && seq.currentValue !== null) {
      statements.push({
        objectRef: seqRef,
        sql:
          `CREATE SEQUENCE IF NOT EXISTS ${seqRef};\n` +
          `ALTER SEQUENCE ${seqRef} RESTART WITH ${restartValue(seq.currentValue)};`,
        note: null,
      });
    } else {
      const seedKey = `sequence_seed--${seqRef}`;
      if (ir.resolvedDecisions[seedKey]?.['restart_with']) {
        statements.push({
          objectRef: seqRef,
          sql:
            `CREATE SEQUENCE IF NOT EXISTS ${seqRef};\n` +
            `ALTER SEQUENCE ${seqRef} RESTART WITH ${ir.resolvedDecisions[seedKey]['restart_with']};`,
          note: `restart value provided by resolved decision '${seedKey}'.`,
        });
      } else {
        decisions.push({
          decisionKey: seedKey,
          objectRef: seqRef,
          category: 'other',
          question:
            `Standalone sequence ${seqRef} has no captured high-water mark. ` +
            `Provide the restart value (provide_restart_value with resolution_json.restart_with).`,
          options: ['provide_restart_value'],
        });
        statements.push({
          objectRef: seqRef,
          sql: null,
          note: `NEEDS DECISION (${seedKey}): sequence ${seqRef} high-water unavailable — no restart emitted.`,
        });
      }
    }
  }

  return { statements, seedDecisionKeysByColumn };
}

/**
 * The pure deterministic generation core: IR in, full pack artifact set out
 * (Liquibase changelogs + data scripts + manifest + readme + decisions +
 * coverage ledger). Ends with the coverage assertion — an unaccounted object
 * throws, it never passes silently.
 */
export function buildDbMigrationPackArtifacts(
  ir: SourceSchemaIr,
  options?: { seedMargin?: number }
): PackArtifacts {
  const seedMargin = options?.seedMargin ?? DEFAULT_SEED_MARGIN;
  const decisions: PackDecision[] = [];
  const coverage: CoverageEntry[] = [];
  const collationNotes: string[] = [];

  // --- sequences-seed first: identity seed decisions flag their columns ---
  const { statements: seedStatements, seedDecisionKeysByColumn } = buildSequenceSeeds(
    ir,
    seedMargin,
    decisions
  );

  // --- FK-topological table order ------------------------------------------
  const realTables = ir.tables.filter((t) => t.objectType === 'table');
  const { ordered: orderedTables, cycleBreaks } = topologicalTableOrder(
    realTables,
    ir.foreignKeys
  );

  // --- per-table translation + structural changesets ----------------------
  const files: PackFile[] = [];
  let sortOrder = 0;
  const push = (filePath: string, fileKind: PackFile['fileKind'], content: string): void => {
    files.push({ filePath, fileKind, content, sortOrder: sortOrder++ });
  };

  const emittedTableNames = new Set<string>();
  const emittedColumnsByTable = new Map<string, EmittableColumn[]>();
  const translatedByTable = new Map<string, TranslatedColumn[]>();
  const tableChangesets: Array<{ path: string; content: string }> = [];
  const requiresTranslation: PackManifest['requires_translation_spec_2'] = [];
  const manualRecreation: PackManifest['manual_recreation'] = [];

  // Views in the committed model are NOT translated — requires translation (spec 2).
  for (const table of ir.tables) {
    if (table.objectType !== 'view') continue;
    const qn = qualifiedName(table.schemaName, table.tableName);
    const reason = 'view — requires translation (spec 2); listed in the manifest, no changeset emitted';
    coverage.push({
      objectType: 'table',
      objectRef: qn,
      disposition: 'skipped',
      reason,
      provenance: { entityId: table.entityId, findingIds: [...table.findingIds] },
    });
    for (const c of table.columns) {
      coverage.push({
        objectType: 'column',
        objectRef: `${qn}.${c.columnName}`,
        disposition: 'skipped',
        reason: `parent object skipped: ${reason}`,
        provenance: {
          entityId: c.entityId,
          attributeId: c.attributeId,
          findingIds: [...c.findingIds],
        },
      });
    }
    requiresTranslation.push({ kind: 'view', object_ref: qn, finding_ids: [...table.findingIds] });
  }

  const deltaStrategies: DeltaStrategy[] = [];

  for (const table of orderedTables) {
    const qn = qualifiedName(table.schemaName, table.tableName);
    const translated = table.columns.map((c) =>
      translateColumn(table, c, ir, decisions, collationNotes, seedDecisionKeysByColumn)
    );
    translatedByTable.set(qn, translated);
    for (const t of translated) coverage.push(t.coverage);

    const emittedColumns = translated
      .filter((t) => t.emitted !== null)
      .map((t) => t.emitted!) as EmittableColumn[];
    emittedColumnsByTable.set(qn, emittedColumns);
    emittedTableNames.add(qn);

    tableChangesets.push({
      path: tableChangesetPath(table),
      content: emitTableChangeset({
        table,
        columns: emittedColumns,
        omitted: translated.filter((t) => t.omitted !== null).map((t) => t.omitted!),
        skipped: translated.filter((t) => t.skippedNote !== null).map((t) => t.skippedNote!),
      }),
    });

    // --- delta-key detection (Q5a) + table-level coverage ------------------
    const deltaKey = `delta_key--${qn}`;
    const detection = detectDeltaKey(table);
    const strategy = resolveDeltaStrategy(table, detection, ir.resolvedDecisions[deltaKey]);
    deltaStrategies.push(strategy);
    const tableDecisionKeys: string[] = [];
    if (strategy.strategy === 'needs_decision') {
      decisions.push(deltaKeyDecision(table));
      tableDecisionKeys.push(deltaKey);
    }
    coverage.push({
      objectType: 'table',
      objectRef: qn,
      disposition: tableDecisionKeys.length > 0 ? 'flagged' : 'translated',
      ...(tableDecisionKeys.length > 0 ? { decisionKeys: tableDecisionKeys } : {}),
      provenance: { entityId: table.entityId, findingIds: [...table.findingIds] },
    });
  }

  // --- untranslated objects from findings (procs/triggers/views/jobs) -----
  for (const u of ir.untranslated) {
    if (u.kind === 'scheduled_job') {
      manualRecreation.push({
        kind: 'scheduled_job',
        object_ref: u.objectRef,
        finding_ids: [...u.findingIds],
      });
    } else {
      const existing = requiresTranslation.find(
        (r) => r.kind === u.kind && r.object_ref === u.objectRef
      );
      if (existing) {
        existing.finding_ids.push(...u.findingIds);
      } else {
        requiresTranslation.push({
          kind: u.kind,
          object_ref: u.objectRef,
          finding_ids: [...u.findingIds],
        });
      }
    }
  }

  // --- consolidated changesets ---------------------------------------------
  const schemas = [...new Set(orderedTables.map((t) => t.schemaName))];
  const schemasContent = emitSchemasChangeset(schemas);
  const fkContent = emitForeignKeysChangeset({
    foreignKeys: ir.foreignKeys,
    emittedTables: emittedTableNames,
  });
  const indexResult = emitIndexesChangeset({
    tables: orderedTables,
    emittedTables: emittedTableNames,
  });
  const seedContent = emitSequencesSeedChangeset({ statements: seedStatements, seedMargin });

  const orderedChangesetPaths = [
    SCHEMAS_CHANGESET_PATH,
    ...tableChangesets.map((t) => t.path),
    FOREIGN_KEYS_CHANGESET_PATH,
    INDEXES_CHANGESET_PATH,
    SEQUENCES_SEED_CHANGESET_PATH,
  ];

  push(MASTER_CHANGELOG_PATH, 'liquibase_master', emitMasterChangelog(orderedChangesetPaths));
  push(SCHEMAS_CHANGESET_PATH, 'liquibase_changeset', schemasContent);
  for (const t of tableChangesets) push(t.path, 'liquibase_changeset', t.content);
  push(FOREIGN_KEYS_CHANGESET_PATH, 'liquibase_changeset', fkContent);
  push(INDEXES_CHANGESET_PATH, 'liquibase_changeset', indexResult.content);
  push(SEQUENCES_SEED_CHANGESET_PATH, 'liquibase_changeset', seedContent);

  // --- data migration pack (Group 3 — same pipeline run) -------------------
  const tableOrder = orderedTables.map((t) => qualifiedName(t.schemaName, t.tableName));
  const expectedRowCounts: Record<string, number> = {};
  const castNotes: Record<string, string[]> = {};

  push(
    BULK_LOAD_MANIFEST_PATH,
    'manifest',
    '' // placeholder — replaced below once cast notes are gathered (kept here for sort order)
  );
  const bulkManifestIndex = files.length - 1;

  orderedTables.forEach((table, position) => {
    const qn = qualifiedName(table.schemaName, table.tableName);
    const translated = translatedByTable.get(qn) ?? [];
    const loadableColumns = translated.filter((t) => t.emitted !== null).map((t) => t.column);
    const plans = planBulkColumns(loadableColumns);
    if (table.estimatedRowCount !== null) expectedRowCounts[qn] = table.estimatedRowCount;
    const notes = plans.filter((p) => p.castNote).map((p) => `${p.columnName}: ${p.castNote}`);
    if (notes.length > 0) castNotes[qn] = notes;
    push(
      bulkScriptPath(table, position),
      'bulk_load_script',
      emitBulkLoadScript({
        table,
        columns: plans,
        positionInOrder: position,
        totalTables: orderedTables.length,
      })
    );
  });

  files[bulkManifestIndex] = {
    ...files[bulkManifestIndex],
    content: emitBulkLoadManifest({ tableOrder, expectedRowCounts, castNotes, seedMargin }),
  };

  for (const table of [...orderedTables].sort((a, b) =>
    qualifiedName(a.schemaName, a.tableName).localeCompare(qualifiedName(b.schemaName, b.tableName))
  )) {
    const qn = qualifiedName(table.schemaName, table.tableName);
    const strategy = deltaStrategies.find((d) => d.table === qn)!;
    const translated = translatedByTable.get(qn) ?? [];
    const plans = planBulkColumns(
      translated.filter((t) => t.emitted !== null).map((t) => t.column)
    );
    const script = emitIncrementalScript({ table, strategy, columns: plans });
    if (script !== null) {
      push(incrementalScriptPath(table), 'incremental_script', script);
    }
  }

  // --- side-by-side sync + reconciliation + swap-over (Spec 2026-07-02-d) --
  //
  // The daily one-way sync is an OPERABLE capability (rerunnable runner +
  // high-water state + per-run reconciliation report), and sequence seeding
  // moves to SWAP-OVER via the runbook — the source keeps advancing during
  // side-by-side running.
  push(SYNC_STATE_PATH, 'sync_runner', emitSyncStateDdl());
  push(SYNC_RUNNER_PATH, 'sync_runner', emitSyncRunner({ strategies: deltaStrategies }));
  push(
    RECONCILIATION_SQL_PATH,
    'reconciliation_script',
    emitReconciliationSql({ tableOrder, strategies: deltaStrategies })
  );
  push(RECONCILIATION_REPORT_PATH, 'reconciliation_script', emitReconciliationReportBuilder());
  push(
    SWAP_OVER_RUNBOOK_PATH,
    'cutover_runbook',
    emitSwapOverRunbook({
      sourceEngine: ir.sourceEngine,
      targetEngine: ir.targetEngine,
      sequences: ir.sequences,
      scheduledJobs: manualRecreation.map((m) => m.object_ref),
      pendingDecisionTables: deltaStrategies
        .filter((s) => s.strategy === 'needs_decision')
        .map((s) => s.table),
    })
  );

  // --- expected schema (the Group 5 diff baseline) -------------------------
  const expectedSchema = buildExpectedSchema(
    orderedTables,
    translatedByTable,
    ir,
    emittedTableNames,
    seedStatements
  );

  // --- counts + manifest ----------------------------------------------------
  const counts = {
    translated: coverage.filter((c) => c.disposition === 'translated').length,
    skipped: coverage.filter((c) => c.disposition === 'skipped').length,
    flagged: coverage.filter((c) => c.disposition === 'flagged').length,
  };

  const structuralAccounting = ir.structuralAccounting ?? accountingFromIr(ir);
  const structuralFindings = deriveStructuralFindings(structuralAccounting);
  const structuralWarnings = structuralFindings.map((f) => f.message);

  const manifest: PackManifest = {
    manifest_version: 1,
    source_engine: ir.sourceEngine,
    target_engine: ir.targetEngine,
    type_mapping_version: TYPE_MAPPING_VERSION,
    seed_margin: seedMargin,
    seed_margin_note:
      `Sequence/identity restart values = captured source high-water mark + ${seedMargin} ` +
      `(pack-level seed margin; default ${DEFAULT_SEED_MARGIN}).`,
    phase_ordering: FIVE_PHASE_ORDERING,
    delete_propagation: DELETE_PROPAGATION_STATEMENT,
    coverage: {
      translated_count: counts.translated,
      skipped_count: counts.skipped,
      flagged_count: counts.flagged,
      objects: coverage,
    },
    requires_translation_spec_2: requiresTranslation,
    manual_recreation: manualRecreation,
    cycle_breaks: cycleBreaks,
    cluster_notes: indexResult.clusterNotes,
    collation_notes: collationNotes,
    delta_strategies: deltaStrategies,
    bulk_load: {
      table_order: tableOrder,
      expected_row_counts: expectedRowCounts,
      cast_notes: castNotes,
    },
    expected_schema: expectedSchema,
    // Structural completeness (WS3 P1, 2026-07-31): visible counts + one
    // explicit warning per suspicious zero — the planner converts each into
    // a prerequisite item. Kills the silent 0-PK/0-FK/0-index/no-code pack.
    structural_accounting: structuralAccounting,
    structural_warnings: structuralWarnings,
    // Structured twins (Spec 2026-08-04-2): stable kind:subject identities so
    // per-project dispositions survive regeneration; the findings gate blocks
    // plan generation / Migrate while any current finding is undispositioned.
    structural_findings: structuralFindings,
    // The DECLARED target-DB binding (2026-07-20): the plan creates the target
    // database, so the plan states its coordinates — local-machine defaults
    // (data parity runs locally). The seed story's spec text confirms this
    // binding; the Start-stage dialog prefills from it, so the operator
    // supplies SECRETS only, never re-types what the tool decided.
    target_db: {
      engine: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'haikai_target',
      schema: 'public',
      username: 'postgres',
      note:
        'Declared by the migration plan — the schema-apply seed CREATES this ' +
        'database at these coordinates. Confirm in the seed story spec; ' +
        'override at apply time only when reality differs. Credentials are ' +
        'NEVER stored here.',
    },
    sync: buildSyncManifestSection(deltaStrategies),
  };

  push('manifest.json', 'manifest', JSON.stringify(manifest, null, 2) + '\n');
  push('README.md', 'readme', buildReadme());

  // --- dedupe decisions by decision_key (stable: first raise wins) ---------
  const dedupedDecisions: PackDecision[] = [];
  const seenKeys = new Set<string>();
  for (const d of decisions) {
    if (seenKeys.has(d.decisionKey)) continue;
    seenKeys.add(d.decisionKey);
    dedupedDecisions.push(d);
  }

  // --- the coverage CODE guarantee (2.5) -----------------------------------
  assertCoverage(ir, coverage);

  // --- runnable-pack validation gate (WS3 P0, 2026-07-31) ------------------
  // XML well-formed comments, includes resolve, changeset ids parser-safe,
  // JSON BOM-free: a pack that cannot parse at apply time FAILS generation
  // loudly instead (the live 2026-07-30 pack shipped all three defects).
  assertPackFilesValid(files, 'generation');

  return { files, decisions: dedupedDecisions, manifest, coverage, counts };
}

function buildExpectedSchema(
  orderedTables: IrTable[],
  translatedByTable: Map<string, TranslatedColumn[]>,
  ir: SourceSchemaIr,
  emittedTables: Set<string>,
  seedStatements: SequenceSeedStatement[]
): ExpectedSchema {
  const tables = orderedTables.map((t) => ({
    schemaName: t.schemaName,
    tableName: t.tableName,
  }));
  const columns: ExpectedSchemaColumn[] = [];
  const keysAndIndexes: ExpectedSchemaKeyOrIndex[] = [];
  const sequences: ExpectedSchemaSequence[] = [];

  for (const table of orderedTables) {
    const qn = qualifiedName(table.schemaName, table.tableName);
    const translated = translatedByTable.get(qn) ?? [];
    const presentColumns = new Set(
      translated.filter((t) => t.emitted !== null).map((t) => t.emitted!.columnName)
    );
    for (const t of translated) {
      if (!t.emitted) continue;
      columns.push({
        schemaName: table.schemaName,
        tableName: table.tableName,
        columnName: t.emitted.columnName,
        dataType: t.emitted.postgresType,
        isNullable: t.emitted.isNullable,
        isPrimaryKey: table.primaryKey?.columns.includes(t.emitted.columnName) === true,
        defaultExpression: t.emitted.defaultExpression,
        isIdentity: t.emitted.isIdentity,
        isGenerated: t.emitted.generationExpression !== null,
        generationExpression: t.emitted.generationExpression,
      });
    }
    if (table.primaryKey && table.primaryKey.columns.every((c) => presentColumns.has(c))) {
      keysAndIndexes.push(keyEntry(table, 'primary_key', table.primaryKey.name, table.primaryKey.columns, { isUnique: true }));
    }
    for (const u of table.uniqueConstraints) {
      if (!u.columns.every((c) => presentColumns.has(c))) continue;
      keysAndIndexes.push(keyEntry(table, 'unique_constraint', u.name, u.columns, { isUnique: true }));
    }
    for (const idx of table.indexes) {
      keysAndIndexes.push(
        keyEntry(table, 'index', idx.name, idx.columns, {
          isUnique: idx.isUnique,
          columnDirections: idx.columnDirections,
        })
      );
    }
  }

  for (const fk of ir.foreignKeys) {
    const child = qualifiedName(fk.fromSchema, fk.fromTable);
    const parent = qualifiedName(fk.toSchema, fk.toTable);
    if (!emittedTables.has(child) || !emittedTables.has(parent)) continue;
    keysAndIndexes.push({
      schemaName: fk.fromSchema,
      tableName: fk.fromTable,
      kind: 'foreign_key',
      name: foreignKeyName(fk),
      columns: fk.joinColumns,
      referencedSchema: fk.toSchema,
      referencedTable: fk.toTable,
      referencedColumns: fk.referencedColumns,
      onDelete: fk.onDelete ? fk.onDelete.toUpperCase() : null,
      onUpdate: fk.onUpdate ? fk.onUpdate.toUpperCase() : null,
      isUnique: false,
      columnDirections: null,
    });
  }

  for (const s of seedStatements) {
    const m = s.sql?.match(/RESTART WITH (\d+)/);
    const parts = s.objectRef.split('.');
    if (parts.length >= 3) {
      // Identity column seed (`schema.table.column`) — Postgres implicit
      // identity sequence naming.
      sequences.push({
        schemaName: parts[0],
        sequenceName: `${parts[1]}_${parts[2]}_seq`,
        restartWith: m ? m[1] : null,
        ownedByTable: parts[1],
        ownedByColumn: parts[2],
      });
    } else {
      sequences.push({
        schemaName: parts[0],
        sequenceName: parts.slice(1).join('.'),
        restartWith: m ? m[1] : null,
        ownedByTable: null,
        ownedByColumn: null,
      });
    }
  }

  return { tables, columns, keysAndIndexes, sequences };

  function keyEntry(
    table: IrTable,
    kind: ExpectedSchemaKeyOrIndex['kind'],
    name: string,
    cols: string[],
    extra: { isUnique?: boolean; columnDirections?: string[] | null }
  ): ExpectedSchemaKeyOrIndex {
    return {
      schemaName: table.schemaName,
      tableName: table.tableName,
      kind,
      name,
      columns: cols,
      referencedSchema: null,
      referencedTable: null,
      referencedColumns: null,
      onDelete: null,
      onUpdate: null,
      isUnique: extra.isUnique === true,
      columnDirections: extra.columnDirections ?? null,
    };
  }
}

export function buildReadme(): string {
  return (
    `# DB Schema + Data Migration Pack (Sybase ASE -> PostgreSQL)\n\n` +
    `Generated deterministically from the committed physical model, the persisted\n` +
    `schema-metadata findings, and the captured db.* decisions — NO LLM is involved\n` +
    `in this pack's structural content.\n\n` +
    `## Contents\n\n` +
    `- \`liquibase/db.changelog-master.xml\` — the ordered master changelog.\n` +
    `- \`liquibase/changesets/010-tables/\` — ONE structural changeset per table\n` +
    `  (table + PK + unique/check constraints), FK-topological order.\n` +
    `- \`liquibase/changesets/020-foreign-keys.sql\` — ALL FKs, applied post-load.\n` +
    `- \`liquibase/changesets/030-indexes.sql\` — ALL non-PK indexes, post-load.\n` +
    `- \`liquibase/changesets/040-sequences-seed.sql\` — identity/sequence restarts\n` +
    `  (captured high-water + seed margin).\n` +
    `- \`data/bulk/\` — per-table bulk extract + COPY templates (FK-topological).\n` +
    `- \`data/incremental/\` — per-table incremental top-up scripts, parameterised\n` +
    `  by :last_high_water.\n` +
    `- \`liquibase/changesets/050-translations.sql\` — APPROVED DB object\n` +
    `  translations (procs/triggers/views) ONLY; present when at least one\n` +
    `  translation is approved. Unapproved drafts NEVER appear here.\n` +
    `- \`translations/\` — one file per APPROVED translation\n` +
    `  (\`<kind>.<schema>.<object>.sql\`); per-object approval provenance is\n` +
    `  recorded in \`manifest.json\` under \`translations\`.\n` +
    `- \`manifest.json\` — coverage ledger, provenance, delta strategies, the\n` +
    `  expected-schema JSON (verification baseline), the approved-translations\n` +
    `  section, and all notes.\n\n` +
    `## Run order (five phases)\n\n` +
    FIVE_PHASE_ORDERING.map((p, i) => `${i + 1}. ${p.replace(/^Phase \d+: /, '')}`).join('\n') +
    `\n\n## Deletes\n\n${DELETE_PROPAGATION_STATEMENT}\n\n` +
    `## Decisions\n\n` +
    `Objects the generator could not translate deterministically are OMITTED and\n` +
    `flagged as decisions in the tool's pack decision queue — resolve them and\n` +
    `regenerate. The generator never guesses.\n`
  );
}

// ---------------------------------------------------------------------------
// Persistence seam + production default (stage 6)
// ---------------------------------------------------------------------------

export interface UpsertPackBody {
  architecture_id: string;
  status: 'generated';
  stale_reason: null;
  input_snapshot_hash: string;
  translated_count: number;
  skipped_count: number;
  flagged_count: number;
  seed_margin: number;
  manifest_json: Record<string, unknown>;
  files: Array<{
    file_path: string;
    file_kind: string;
    content: string;
    sort_order: number;
  }>;
  decisions: Array<{
    decision_key: string;
    object_ref: string;
    category: string;
    question: string;
    options_json: string[];
  }>;
}

export interface PersistedPack {
  id: string;
  project_id: string;
  architecture_id: string;
  status: string;
  input_snapshot_hash: string | null;
  translated_count: number | null;
  skipped_count: number | null;
  flagged_count: number | null;
  seed_margin: number | null;
  [key: string]: unknown;
}

export type PersistPackFn = (projectId: string, body: UpsertPackBody) => Promise<PersistedPack>;

export class AmsRoundTripError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string) {
    super(`AMS db-migration-pack upsert failed: HTTP ${status} ${body}`);
    this.name = 'AmsRoundTripError';
    this.status = status;
    this.body = body;
  }
}

const defaultPersistPack: PersistPackFn = async (projectId, body) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new AmsRoundTripError(response.status, text);
  }
  return JSON.parse(text) as PersistedPack;
};

// ---------------------------------------------------------------------------
// The end-to-end handler (stages 1-6)
// ---------------------------------------------------------------------------

export interface GenerateDbMigrationPackRequest {
  projectId: string;
  architectureId: string;
  /**
   * The target architecture to bind `db.*` captured decisions to
   * (Spec 2026-07-02-a). The migration plan can target a saved DRAFT that is
   * not the project's active target; the pack must read the SAME target's
   * decisions as the plan. Absent → legacy active-target fallback.
   */
  targetArchitectureId?: string | null;
  /** Pack-level sequence-seed margin; default {@link DEFAULT_SEED_MARGIN}. */
  seedMargin?: number;
}

/**
 * The ONE pack-generation translation hook (Spec 2026-06-11 DB Object
 * Translation Drafts, Task 3.2 + 4.3): seeding/re-link (re-link/demote pass
 * BEFORE re-seeding) THEN the approved-only re-emission, as ordered steps of
 * the regenerate flow — so pack files and translation rows can never disagree
 * once the hook completes. Injectable for tests; the default talks to AMS.
 */
export type TranslationHookFn = (args: {
  projectId: string;
  packId: string;
  manifest: PackManifest;
  findings: GenerationInputs['findings'];
}) => Promise<TranslationHookResult | null>;

export interface TranslationHookResult {
  sync: TranslationSyncSummary;
  emission: { approved_count: number; changed: boolean };
}

const defaultTranslationHook: TranslationHookFn = async ({
  projectId,
  packId,
  manifest,
  findings,
}) => {
  const entries = (manifest.requires_translation_spec_2 ?? []) as RequiresTranslationEntry[];
  const sync = await syncPackTranslations({ projectId, packId, entries, findings });
  const emission = await runTranslationEmission(projectId, packId);
  return {
    sync: sync.summary,
    emission: { approved_count: emission.approvedCount, changed: emission.changed },
  };
};

export interface DbMigrationPackHandlerDeps extends Partial<InputFetchDeps> {
  persistPack?: PersistPackFn;
  /** Test seam for the post-persist translation seed/re-link + emission hook. */
  translationHook?: TranslationHookFn;
}

export interface GenerateDbMigrationPackResult {
  pack: PersistedPack;
  inputSnapshotHash: string;
  counts: { translated: number; skipped: number; flagged: number };
  fileCount: number;
  decisionCount: number;
  /** Summary of the translation seed/re-link + emission hook (Spec 2). */
  translationSync: TranslationHookResult | null;
}

export async function generateDbMigrationPack(
  request: GenerateDbMigrationPackRequest,
  deps: DbMigrationPackHandlerDeps = {}
): Promise<GenerateDbMigrationPackResult> {
  const { projectId, architectureId } = request;
  const fetchDeps: InputFetchDeps = {
    fetchModel: deps.fetchModel ?? defaultInputFetchDeps.fetchModel,
    fetchFindings: deps.fetchFindings ?? defaultInputFetchDeps.fetchFindings,
    fetchDbDecisions: deps.fetchDbDecisions ?? defaultInputFetchDeps.fetchDbDecisions,
    fetchResolvedPackDecisions:
      deps.fetchResolvedPackDecisions ?? defaultInputFetchDeps.fetchResolvedPackDecisions,
  };
  const persistPack = deps.persistPack ?? defaultPersistPack;

  // Stage 1 — snapshot.
  logger.info(`[diag-gateway] db_migration_pack stage=snapshot projectId=${projectId}`);
  const inputs = await fetchGenerationInputs(
    projectId,
    architectureId,
    fetchDeps,
    request.targetArchitectureId ?? null
  );
  const inputSnapshotHash = computeInputSnapshotHash(inputs);

  // Stage 2 — IR (merges findings; rejects unsupported engine pairs).
  logger.info(`[diag-gateway] db_migration_pack stage=ir projectId=${projectId}`);
  const ir = buildSourceSchemaIr(inputs);

  // Stages 3-4 — deterministic mapping + emission (one pure call).
  logger.info(`[diag-gateway] db_migration_pack stage=mapping projectId=${projectId}`);
  const artifacts = buildDbMigrationPackArtifacts(ir, { seedMargin: request.seedMargin });
  logger.info(
    `[diag-gateway] db_migration_pack stage=emit projectId=${projectId} files=${artifacts.files.length} decisions=${artifacts.decisions.length}`
  );

  // Stage 5 — coverage (already asserted inside the pure core; re-assert at
  // the pipeline boundary so the guarantee is visible in the handler too).
  logger.info(`[diag-gateway] db_migration_pack stage=coverage projectId=${projectId}`);
  assertCoverage(ir, artifacts.coverage);

  // Stage 6 — persist atomically (pack upsert -> files replace -> decisions
  // upsert by decision_key, one AMS operation).
  logger.info(`[diag-gateway] db_migration_pack stage=persist projectId=${projectId}`);
  const body: UpsertPackBody = {
    architecture_id: architectureId,
    status: 'generated',
    stale_reason: null,
    input_snapshot_hash: inputSnapshotHash,
    translated_count: artifacts.counts.translated,
    skipped_count: artifacts.counts.skipped,
    flagged_count: artifacts.counts.flagged,
    seed_margin: request.seedMargin ?? DEFAULT_SEED_MARGIN,
    // The persisted manifest carries the decision-binding target so the
    // staleness recompute (and any later regenerate) reads decisions from the
    // SAME target the pack was generated for. Persistence metadata only — the
    // zip's manifest.json file documents the transform, not the binding.
    manifest_json: {
      ...(artifacts.manifest as unknown as Record<string, unknown>),
      target_architecture_id: request.targetArchitectureId ?? null,
    },
    files: artifacts.files.map((f) => ({
      file_path: f.filePath,
      file_kind: f.fileKind,
      content: f.content,
      sort_order: f.sortOrder,
    })),
    decisions: artifacts.decisions.map((d) => ({
      decision_key: d.decisionKey,
      object_ref: d.objectRef,
      category: d.category,
      question: d.question,
      options_json: d.options,
    })),
  };
  const pack = await persistPack(projectId, body);

  // Stage 7 — translations (Spec 2026-06-11 DB Object Translation Drafts):
  // seed/re-link the per-object translation rows (the re-link/demote pass
  // runs BEFORE re-seeding inside the hook), then re-run the approved-only
  // emission so demoted approvals drop out of the executable path.
  logger.info(`[diag-gateway] db_migration_pack stage=translations projectId=${projectId}`);
  const translationHook = deps.translationHook ?? defaultTranslationHook;
  const translationSync = await translationHook({
    projectId,
    packId: pack.id,
    manifest: artifacts.manifest,
    findings: inputs.findings,
  });

  logger.info(
    `[diag-gateway] db_migration_pack stage=complete projectId=${projectId} packId=${pack.id}`
  );
  return {
    pack,
    inputSnapshotHash,
    counts: artifacts.counts,
    fileCount: artifacts.files.length,
    decisionCount: artifacts.decisions.length,
    translationSync,
  };
}

// ---------------------------------------------------------------------------
// Refresh seeds (Task 4.4): regenerate ONLY the sequences-seed changeset
// ---------------------------------------------------------------------------

/** One sequence/identity high-water value from the refresh-seeds scan. */
export interface SeedScanSequence {
  schemaName?: string | null;
  sequenceName: string;
  /** Verbatim engine high-water (string — bigint-safe). null = unavailable. */
  currentValue?: string | null;
  startValue?: string | null;
  ownedByTable?: string | null;
  ownedByColumn?: string | null;
}

interface PackRowDto {
  id: string;
  architecture_id: string;
  status: string;
  stale_reason: string | null;
  input_snapshot_hash: string | null;
  work_item_id?: string | null;
  translated_count: number | null;
  skipped_count: number | null;
  flagged_count: number | null;
  seed_margin: number | null;
  manifest_json: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface PackFileRowDto {
  file_path: string;
  file_kind: string;
  content: string;
  sort_order: number;
}

export interface RefreshSeedsDeps extends Partial<InputFetchDeps> {
  fetchPack?: (projectId: string, packId: string) => Promise<PackRowDto>;
  fetchPackFiles?: (projectId: string, packId: string) => Promise<PackFileRowDto[]>;
  putPack?: (projectId: string, body: Record<string, unknown>) => Promise<PersistedPack>;
}

async function amsGetJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new AmsRoundTripError(response.status, text);
  return JSON.parse(text) as T;
}

const defaultFetchPack: NonNullable<RefreshSeedsDeps['fetchPack']> = (projectId, packId) =>
  amsGetJson(
    `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}`
  );

const defaultFetchPackFiles: NonNullable<RefreshSeedsDeps['fetchPackFiles']> = (
  projectId,
  packId
) =>
  amsGetJson(
    `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}/files`
  );

const defaultPutPack: NonNullable<RefreshSeedsDeps['putPack']> = async (projectId, body) => {
  const url =
    `${getConfig().architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-migration-packs`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new AmsRoundTripError(response.status, text);
  return JSON.parse(text) as PersistedPack;
};

export interface RefreshDbMigrationPackSeedsRequest {
  projectId: string;
  packId: string;
  /** Fresh sequence/identity values from the discovery refresh-seeds scan. */
  scanSequences: SeedScanSequence[];
}

export interface RefreshDbMigrationPackSeedsResult {
  pack: PersistedPack;
  updatedFilePath: string;
  /** TRUE when the seed changeset content actually changed. */
  seedChangesetChanged: boolean;
  scanSequenceCount: number;
}

/**
 * Refresh-seeds (spec "Refresh seeds (sequence/identity re-scan only)"):
 * regenerate ONLY the `sequences-seed` changeset from freshly scanned
 * sequence/identity current values. NOTHING else in the pack changes — every
 * other file row, the manifest, the coverage counts, the snapshot hash, the
 * status, and the decisions are passed through byte-identically. The
 * incremental scripts are parameterised by `:last_high_water` at run time, so
 * no embedded values need rewriting there.
 *
 * Writes NOTHING to the model — the fresh values flow only into the
 * regenerated seed changeset.
 */
export async function refreshDbMigrationPackSeeds(
  request: RefreshDbMigrationPackSeedsRequest,
  deps: RefreshSeedsDeps = {}
): Promise<RefreshDbMigrationPackSeedsResult> {
  const { projectId, packId, scanSequences } = request;
  const fetchPack = deps.fetchPack ?? defaultFetchPack;
  const fetchPackFiles = deps.fetchPackFiles ?? defaultFetchPackFiles;
  const putPack = deps.putPack ?? defaultPutPack;
  const fetchDeps: InputFetchDeps = {
    fetchModel: deps.fetchModel ?? defaultInputFetchDeps.fetchModel,
    fetchFindings: deps.fetchFindings ?? defaultInputFetchDeps.fetchFindings,
    fetchDbDecisions: deps.fetchDbDecisions ?? defaultInputFetchDeps.fetchDbDecisions,
    fetchResolvedPackDecisions:
      deps.fetchResolvedPackDecisions ?? defaultInputFetchDeps.fetchResolvedPackDecisions,
  };

  logger.info(
    `[diag-gateway] db_migration_pack_refresh_seeds stage=load projectId=${projectId} packId=${packId}`
  );
  const pack = await fetchPack(projectId, packId);
  const files = await fetchPackFiles(projectId, packId);
  const seedMargin = Number(pack.seed_margin ?? DEFAULT_SEED_MARGIN);

  // Rebuild the IR from current inputs, then OVERRIDE sequence current values
  // with the fresh scan results (upsert by schema.sequence identity).
  logger.info(
    `[diag-gateway] db_migration_pack_refresh_seeds stage=ir projectId=${projectId} packId=${packId}`
  );
  const inputs = await fetchGenerationInputs(projectId, pack.architecture_id, fetchDeps);
  const ir = buildSourceSchemaIr(inputs);
  const byKey = new Map(
    ir.sequences.map((seq) => [`${seq.schemaName}.${seq.sequenceName}`.toLowerCase(), seq])
  );
  for (const scan of scanSequences ?? []) {
    if (!scan || typeof scan.sequenceName !== 'string' || scan.sequenceName.length === 0) {
      continue;
    }
    const schemaName = scan.schemaName && scan.schemaName.length > 0 ? scan.schemaName : 'dbo';
    const key = `${schemaName}.${scan.sequenceName}`.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      if (scan.currentValue !== null && scan.currentValue !== undefined) {
        existing.currentValue = String(scan.currentValue);
        existing.currentValueAvailable = true;
      }
      existing.ownedByTable = existing.ownedByTable ?? scan.ownedByTable ?? null;
      existing.ownedByColumn = existing.ownedByColumn ?? scan.ownedByColumn ?? null;
    } else {
      const fresh = {
        schemaName,
        sequenceName: scan.sequenceName,
        currentValue:
          scan.currentValue !== null && scan.currentValue !== undefined
            ? String(scan.currentValue)
            : null,
        currentValueAvailable: scan.currentValue !== null && scan.currentValue !== undefined,
        startValue: scan.startValue ?? null,
        ownedByTable: scan.ownedByTable ?? null,
        ownedByColumn: scan.ownedByColumn ?? null,
        findingIds: [],
      };
      ir.sequences.push(fresh);
      byKey.set(key, fresh);
    }
  }

  // Regenerate ONLY the sequences-seed changeset content. Decisions raised
  // by the seed builder are discarded here — refresh-seeds never mutates the
  // decision queue (the generate/regenerate pipeline owns that).
  logger.info(
    `[diag-gateway] db_migration_pack_refresh_seeds stage=emit projectId=${projectId} packId=${packId}`
  );
  const throwawayDecisions: PackDecision[] = [];
  const { statements } = buildSequenceSeeds(ir, seedMargin, throwawayDecisions);
  const newSeedContent = emitSequencesSeedChangeset({ statements, seedMargin });

  let seedChangesetChanged = false;
  const updatedFiles = files.map((f) => {
    if (f.file_path !== SEQUENCES_SEED_CHANGESET_PATH) return f;
    seedChangesetChanged = f.content !== newSeedContent;
    return { ...f, content: newSeedContent };
  });
  if (!updatedFiles.some((f) => f.file_path === SEQUENCES_SEED_CHANGESET_PATH)) {
    throw new Error(
      `Pack ${packId} has no '${SEQUENCES_SEED_CHANGESET_PATH}' file row — cannot refresh seeds.`
    );
  }

  // Persist: full file replacement with every OTHER row byte-identical;
  // pack-level fields passed through verbatim; decisions intentionally
  // OMITTED (null => AMS leaves the decision queue untouched).
  logger.info(
    `[diag-gateway] db_migration_pack_refresh_seeds stage=persist projectId=${projectId} packId=${packId} changed=${seedChangesetChanged}`
  );
  const persisted = await putPack(projectId, {
    architecture_id: pack.architecture_id,
    status: pack.status,
    stale_reason: pack.stale_reason ?? null,
    input_snapshot_hash: pack.input_snapshot_hash ?? null,
    translated_count: pack.translated_count ?? null,
    skipped_count: pack.skipped_count ?? null,
    flagged_count: pack.flagged_count ?? null,
    seed_margin: pack.seed_margin ?? null,
    manifest_json: pack.manifest_json ?? null,
    files: updatedFiles.map((f) => ({
      file_path: f.file_path,
      file_kind: f.file_kind,
      content: f.content,
      sort_order: f.sort_order,
    })),
  });

  return {
    pack: persisted,
    updatedFilePath: SEQUENCES_SEED_CHANGESET_PATH,
    seedChangesetChanged,
    scanSequenceCount: (scanSequences ?? []).length,
  };
}
