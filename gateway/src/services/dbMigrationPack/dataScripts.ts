/**
 * Data migration pack generator — bulk load scripts, bulk-load manifest,
 * delta-key detection, and incremental top-up scripts.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 3 (generated in the SAME pipeline run as the Group 2 schema
 * pack; persisted as additional `db_migration_pack_files` rows).
 *
 * Settled decisions baked in:
 *   - Q4: FK constraints AND non-PK indexes apply ONCE after the BULK load,
 *     then stay enforced through every incremental run; non-PK indexes are
 *     deferred to post-bulk for fast load. Stated in the manifest.
 *   - Q5a: delta key detection — monotonic identity column -> insert-only;
 *     name-heuristic timestamp column (`updated_at`-family with a
 *     datetime-family type) -> insert+update (upsert); identity preferred
 *     when both exist; neither -> `delta_key` needs_decision (full reload |
 *     skip | manual key).
 *   - Q5b: DELETE propagation is OUT OF SCOPE for incremental v1 — stated
 *     plainly in the manifest; full-reload tables are the delete-catching
 *     mechanism.
 *
 * NO LLM — pure deterministic code. NO timestamps in any emitted file
 * (checksum/byte stability across regenerations).
 */

import { mapSourceType, parseSourceType } from './typeMapping';
import { qualifiedName, quotedQualifiedName, quoteIdent } from './liquibase';
import { DeltaStrategy, IrColumn, IrTable, PackDecision } from './types';

export const FIVE_PHASE_ORDERING: string[] = [
  'Phase 1: apply structural changesets (tables, PKs, unique/check constraints) — NO foreign keys, NO non-PK indexes (run liquibase with --contexts=structural).',
  'Phase 2: bulk load ALL tables in the FK-topological order listed in this manifest.',
  'Phase 3: apply foreign keys + non-PK indexes ONCE (the consolidated foreign-keys and indexes changesets; --contexts=post-load).',
  'Phase 4: reseed sequences/identities (the consolidated sequences-seed changeset; restart = captured high-water + seed margin).',
  'Phase 5: all subsequent incremental runs execute WITH foreign keys and indexes enforced.',
];

export const DELETE_PROPAGATION_STATEMENT =
  'DELETE propagation is OUT OF SCOPE for incremental v1: incremental scripts insert and/or update only. ' +
  'Rows deleted at source after the bulk load are NOT removed by increments — tables configured for ' +
  'full reload each increment are the mechanism that catches deletes.';

export const DELTA_KEY_OPTIONS = [
  'full_reload_each_increment',
  'skip_from_incremental',
  'manually_specified_key',
];

// ---------------------------------------------------------------------------
// Delta-key detection (Q5a)
// ---------------------------------------------------------------------------

/**
 * `updated_at`-family column names (normalised: lowercased, underscores
 * removed) that the timestamp-name heuristic accepts.
 */
const TIMESTAMP_NAME_FAMILY = new Set([
  'updatedat',
  'updatedate',
  'updatedon',
  'updatets',
  'updatetimestamp',
  'modifieddate',
  'modifiedat',
  'modifiedon',
  'modts',
  'moddate',
  'moddate',
  'lastmodified',
  'lastmodifiedat',
  'lastmodifieddate',
  'lastupdated',
  'lastupdatedat',
  'lastupdate',
  'lastchanged',
  'lastchangedat',
  'rowupdatets',
]);

const DATETIME_FAMILY_BASES = new Set(['datetime', 'smalldatetime', 'bigdatetime']);

function isDatetimeFamily(column: IrColumn): boolean {
  return DATETIME_FAMILY_BASES.has(parseSourceType(column.dataType).base);
}

function isTimestampNameMatch(column: IrColumn): boolean {
  const normalised = column.columnName.toLowerCase().replace(/_/g, '');
  return TIMESTAMP_NAME_FAMILY.has(normalised);
}

export interface DeltaKeyDetection {
  strategy: 'insert_only' | 'insert_update' | 'needs_decision';
  deltaKey: string | null;
  source: 'identity_column' | 'timestamp_name_heuristic' | 'none';
}

/**
 * Deterministic delta-key detection. Identity is preferred over the
 * timestamp-name heuristic when both exist. Ties inside a class resolve by
 * ordinal position then name (deterministic).
 */
export function detectDeltaKey(table: IrTable): DeltaKeyDetection {
  const sorted = [...table.columns].sort(
    (a, b) => (a.ordinalPosition ?? 0) - (b.ordinalPosition ?? 0) ||
      a.columnName.localeCompare(b.columnName)
  );
  const identity = sorted.find((c) => c.isIdentity);
  if (identity) {
    return { strategy: 'insert_only', deltaKey: identity.columnName, source: 'identity_column' };
  }
  const timestamp = sorted.find((c) => isTimestampNameMatch(c) && isDatetimeFamily(c));
  if (timestamp) {
    return {
      strategy: 'insert_update',
      deltaKey: timestamp.columnName,
      source: 'timestamp_name_heuristic',
    };
  }
  return { strategy: 'needs_decision', deltaKey: null, source: 'none' };
}

/**
 * Apply a resolved `delta_key` pack decision over (or instead of) detection.
 * Resolution shapes:
 *   { option: 'full_reload_each_increment' }
 *   { option: 'skip_from_incremental' }
 *   { option: 'manually_specified_key', column: '<name>', strategy?: 'insert_only'|'insert_update' }
 */
export function resolveDeltaStrategy(
  table: IrTable,
  detection: DeltaKeyDetection,
  resolution: Record<string, unknown> | undefined
): DeltaStrategy {
  const tableRef = qualifiedName(table.schemaName, table.tableName);
  if (resolution) {
    const option = typeof resolution['option'] === 'string' ? (resolution['option'] as string) : '';
    if (option === 'full_reload_each_increment') {
      return { table: tableRef, strategy: 'full_reload', deltaKey: null, source: 'resolved_decision' };
    }
    if (option === 'skip_from_incremental') {
      return { table: tableRef, strategy: 'skipped', deltaKey: null, source: 'resolved_decision' };
    }
    if (option === 'manually_specified_key') {
      const column = typeof resolution['column'] === 'string' ? (resolution['column'] as string) : null;
      const strategy =
        resolution['strategy'] === 'insert_only' ? 'insert_only' : 'insert_update';
      if (column) {
        return { table: tableRef, strategy, deltaKey: column, source: 'resolved_decision' };
      }
    }
  }
  if (detection.strategy === 'needs_decision') {
    return { table: tableRef, strategy: 'needs_decision', deltaKey: null, source: 'none' };
  }
  return {
    table: tableRef,
    strategy: detection.strategy,
    deltaKey: detection.deltaKey,
    source: detection.source,
  };
}

export function deltaKeyDecision(table: IrTable): PackDecision {
  const tableRef = qualifiedName(table.schemaName, table.tableName);
  return {
    decisionKey: `delta_key--${tableRef}`,
    objectRef: tableRef,
    category: 'delta_key',
    question:
      `Table ${tableRef} has no usable delta key: no identity column and no ` +
      `updated_at-family timestamp column. Choose the incremental strategy: ` +
      `full_reload_each_increment (also catches deletes), skip_from_incremental, ` +
      `or manually_specified_key (resolution_json.column + optional resolution_json.strategy).`,
    options: DELTA_KEY_OPTIONS,
  };
}

// ---------------------------------------------------------------------------
// Bulk load scripts (3.2)
// ---------------------------------------------------------------------------

export function bulkScriptPath(table: IrTable, position: number): string {
  const seq = String(position + 1).padStart(3, '0');
  return `data/bulk/${seq}-${table.schemaName}.${table.tableName}.sql`;
}

export interface BulkColumnPlan {
  columnName: string;
  /** The Sybase-side extract expression (cast-aligned to the v1 mapping). */
  extractExpression: string;
  /** Excluded from the COPY column list (Postgres computes generated columns). */
  excludedAsGenerated: boolean;
  isIdentity: boolean;
  castNote: string | null;
}

/**
 * Plan the per-column extract expressions for a table. Cast expressions are
 * aligned to the v1 type mapping; columns whose type mapping is unresolved
 * (open needs_decision) or dropped never reach the plan — the caller passes
 * only the columns that were actually emitted in the DDL.
 */
export function planBulkColumns(columns: IrColumn[]): BulkColumnPlan[] {
  return columns.map((c) => {
    const mapping = mapSourceType(c);
    const base = parseSourceType(c.dataType).base;
    let extractExpression = c.columnName;
    let castNote: string | null = null;
    if (mapping.kind === 'mapped') {
      castNote = mapping.castNote;
      if (base === 'money' || base === 'smallmoney') {
        extractExpression = `convert(${mapping.postgresType}, ${c.columnName}) AS ${c.columnName}`;
      } else if (DATETIME_FAMILY_BASES.has(base)) {
        extractExpression = `convert(char(23), ${c.columnName}, 23) AS ${c.columnName}`;
      } else if (base === 'bit') {
        extractExpression = `${c.columnName} /* 0/1 -> boolean */`;
      }
    }
    return {
      columnName: c.columnName,
      extractExpression,
      excludedAsGenerated: c.isGenerated === true,
      isIdentity: c.isIdentity === true,
      castNote,
    };
  });
}

/**
 * Emit one per-table bulk load script: the Sybase extract SELECT (cast
 * expressions aligned to the mapping table) + the Postgres
 * `COPY ... FROM STDIN` template. The pack DOCUMENTS the pipe; it never
 * executes it. Generated columns are excluded from the COPY column list;
 * identity loading is documented with OVERRIDING SYSTEM VALUE semantics in
 * the header.
 */
export function emitBulkLoadScript(args: {
  table: IrTable;
  columns: BulkColumnPlan[];
  positionInOrder: number;
  totalTables: number;
}): string {
  const { table, columns } = args;
  const qn = qualifiedName(table.schemaName, table.tableName);
  const copyColumns = columns.filter((c) => !c.excludedAsGenerated);
  const identityColumns = columns.filter((c) => c.isIdentity).map((c) => c.columnName);
  const generatedColumns = columns.filter((c) => c.excludedAsGenerated).map((c) => c.columnName);

  const lines: string[] = [];
  lines.push(`-- Bulk load: ${qn} (table ${args.positionInOrder + 1} of ${args.totalTables}, FK-topological order)`);
  lines.push(`-- Phase 2 of 5 — run AFTER the structural changesets, BEFORE foreign keys / indexes / reseed.`);
  if (identityColumns.length > 0) {
    lines.push(
      `-- Identity columns (${identityColumns.join(', ')}): source values are PRESERVED. ` +
        `COPY writes identity columns directly; if you load via INSERT instead, use ` +
        `INSERT ... OVERRIDING SYSTEM VALUE to keep the source ids (the columns are ` +
        `GENERATED ALWAYS AS IDENTITY on the target).`
    );
  }
  if (generatedColumns.length > 0) {
    lines.push(
      `-- Generated columns (${generatedColumns.join(', ')}): EXCLUDED from the COPY column list — Postgres computes them.`
    );
  }
  lines.push(`-- This pack documents the extract -> COPY pipe; it does NOT execute it.`);
  lines.push('');
  lines.push(`-- 1) Sybase extract (run against the source; casts aligned to the v1 type mapping):`);
  lines.push(`SELECT`);
  lines.push(copyColumns.map((c) => `    ${c.extractExpression}`).join(',\n'));
  lines.push(`FROM ${qn};`);
  const castNotes = copyColumns.filter((c) => c.castNote);
  for (const c of castNotes) {
    lines.push(`-- cast note [${c.columnName}]: ${c.castNote}`);
  }
  lines.push('');
  lines.push(`-- 2) PostgreSQL load (pipe the extract as CSV into):`);
  // Target-side statements quote every identifier (source case preserved) —
  // matching the quoted DDL; the Sybase extract above stays unquoted (source
  // engine semantics).
  lines.push(
    `COPY ${quotedQualifiedName(table.schemaName, table.tableName)} ` +
      `(${copyColumns.map((c) => quoteIdent(c.columnName)).join(', ')}) FROM STDIN WITH (FORMAT csv, NULL '\\N');`
  );
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Bulk-load manifest (3.3)
// ---------------------------------------------------------------------------

export const BULK_LOAD_MANIFEST_PATH = 'data/bulk-load-manifest.json';

export function emitBulkLoadManifest(args: {
  tableOrder: string[];
  expectedRowCounts: Record<string, number>;
  castNotes: Record<string, string[]>;
  seedMargin: number;
}): string {
  const manifest = {
    phase_ordering: FIVE_PHASE_ORDERING,
    delete_propagation: DELETE_PROPAGATION_STATEMENT,
    seed_margin: args.seedMargin,
    table_order: args.tableOrder,
    expected_source_row_counts: args.expectedRowCounts,
    cast_notes: args.castNotes,
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Incremental top-up scripts (3.4)
// ---------------------------------------------------------------------------

export function incrementalScriptPath(table: IrTable): string {
  return `data/incremental/${table.schemaName}.${table.tableName}.sql`;
}

/**
 * Emit one per-table incremental script, parameterised by `:last_high_water`
 * (the prior run's max delta-key value). The header states the delta key and
 * strategy. Increments run WITH FKs and indexes enforced (phase 5).
 */
export function emitIncrementalScript(args: {
  table: IrTable;
  strategy: DeltaStrategy;
  /** Columns actually emitted on the target (DDL-aligned). */
  columns: BulkColumnPlan[];
}): string | null {
  const { table, strategy, columns } = args;
  const qn = qualifiedName(table.schemaName, table.tableName);
  if (strategy.strategy === 'needs_decision' || strategy.strategy === 'skipped') {
    return null;
  }

  const copyColumns = columns.filter((c) => !c.excludedAsGenerated);
  const lines: string[] = [];
  lines.push(`-- Incremental top-up: ${qn}`);
  lines.push(
    `-- Delta key: ${strategy.deltaKey ?? 'n/a (full reload)'} | strategy: ${strategy.strategy} | chosen by: ${strategy.source}`
  );
  lines.push(`-- Parameterised by :last_high_water — the prior run's max ${strategy.deltaKey ?? 'load marker'} value.`);
  lines.push(`-- Phase 5 of 5: increments execute WITH foreign keys and indexes enforced.`);
  lines.push(`-- ${DELETE_PROPAGATION_STATEMENT}`);
  lines.push('');

  // Target-side (Postgres) statements quote every identifier, source case
  // preserved — matching the quoted DDL. Sybase extract stays unquoted.
  const qq = quotedQualifiedName(table.schemaName, table.tableName);
  const quotedColumnList = copyColumns.map((c) => quoteIdent(c.columnName)).join(', ');

  if (strategy.strategy === 'full_reload') {
    lines.push(`-- Full reload each increment (this is the delete-catching mechanism for this table):`);
    lines.push(`TRUNCATE TABLE ${qq} CASCADE;`);
    lines.push(`-- Re-run the bulk extract + COPY for ${qn} (see the bulk script).`);
    return lines.join('\n') + '\n';
  }

  lines.push(`-- 1) Sybase delta extract:`);
  lines.push(`SELECT`);
  lines.push(copyColumns.map((c) => `    ${c.extractExpression}`).join(',\n'));
  lines.push(`FROM ${qn}`);
  lines.push(`WHERE ${strategy.deltaKey} > :last_high_water;`);
  lines.push('');

  if (strategy.strategy === 'insert_only') {
    lines.push(`-- 2) PostgreSQL insert-only load (identity delta keys only ever append):`);
    lines.push(`INSERT INTO ${qq} (${quotedColumnList})`);
    lines.push(`OVERRIDING SYSTEM VALUE`);
    lines.push(`SELECT ${quotedColumnList} FROM ${quoteIdent(`staging_${table.tableName}`)}`);
    lines.push(`WHERE ${quoteIdent(strategy.deltaKey ?? '')} > :last_high_water;`);
  } else {
    const pkColumns = table.primaryKey?.columns ?? [];
    const conflictTarget =
      pkColumns.length > 0
        ? pkColumns.map(quoteIdent).join(', ')
        : quoteIdent(strategy.deltaKey ?? '');
    const updates = copyColumns
      .filter((c) => !pkColumns.includes(c.columnName))
      .map((c) => `${quoteIdent(c.columnName)} = EXCLUDED.${quoteIdent(c.columnName)}`)
      .join(',\n    ');
    lines.push(`-- 2) PostgreSQL insert+update (upsert) load:`);
    lines.push(`INSERT INTO ${qq} (${quotedColumnList})`);
    lines.push(`SELECT ${quotedColumnList} FROM ${quoteIdent(`staging_${table.tableName}`)}`);
    lines.push(`WHERE ${quoteIdent(strategy.deltaKey ?? '')} > :last_high_water`);
    lines.push(`ON CONFLICT (${conflictTarget}) DO UPDATE SET`);
    lines.push(`    ${updates};`);
  }
  return lines.join('\n') + '\n';
}
