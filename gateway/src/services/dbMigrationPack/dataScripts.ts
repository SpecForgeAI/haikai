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

/**
 * Datetime-family base types PER ENGINE (Spec 5.6). The delta-key heuristic
 * and the extract-expression planner both read this, so an engine whose
 * `updated_at` column is a `datetime2` must list it or the column would not
 * be recognised as a timestamp at all.
 */
const DATETIME_FAMILY_BASES_BY_ENGINE: Record<string, ReadonlySet<string>> = {
  sybase: new Set(['datetime', 'smalldatetime', 'bigdatetime']),
  mssql: new Set(['datetime', 'smalldatetime', 'datetime2', 'datetimeoffset']),
};

/** The ASE family stays the default for any engine without its own row. */
const DATETIME_FAMILY_BASES = DATETIME_FAMILY_BASES_BY_ENGINE.sybase;

export function datetimeFamilyBases(engine?: string): ReadonlySet<string> {
  return (
    DATETIME_FAMILY_BASES_BY_ENGINE[String(engine ?? '').toLowerCase()] ?? DATETIME_FAMILY_BASES
  );
}

function isDatetimeFamily(column: IrColumn, engine?: string): boolean {
  return datetimeFamilyBases(engine).has(parseSourceType(column.dataType).base);
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
export function detectDeltaKey(table: IrTable, engine?: string): DeltaKeyDetection {
  const sorted = [...table.columns].sort(
    (a, b) => (a.ordinalPosition ?? 0) - (b.ordinalPosition ?? 0) ||
      a.columnName.localeCompare(b.columnName)
  );
  // Surrogate identity columns (2026-08-08) are TARGET-only: the source has
  // no such column, so a delta read `WHERE <surrogate> > high-water` would
  // fail at the source. Never a delta key.
  const identity = sorted.find((c) => c.isIdentity && c.isSurrogate !== true);
  if (identity) {
    return { strategy: 'insert_only', deltaKey: identity.columnName, source: 'identity_column' };
  }
  const timestamp = sorted.find((c) => isTimestampNameMatch(c) && isDatetimeFamily(c, engine));
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
  /** The SOURCE-side extract expression (cast-aligned to the type mapping). */
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
export function planBulkColumns(columns: IrColumn[], engine?: string): BulkColumnPlan[] {
  const engineKey = String(engine ?? 'sybase').toLowerCase();
  const datetimeBases = datetimeFamilyBases(engineKey);
  return columns.map((c) => {
    const mapping = mapSourceType(engineKey, c);
    const base = parseSourceType(c.dataType).base;
    let extractExpression = c.columnName;
    let castNote: string | null = null;
    if (mapping.kind === 'mapped') {
      castNote = mapping.castNote;
      if (engineKey === 'mssql') {
        extractExpression = mssqlExtractExpression(c, base, mapping.postgresType, datetimeBases);
      } else if (base === 'money' || base === 'smallmoney') {
        extractExpression = `convert(${mapping.postgresType}, ${c.columnName}) AS ${c.columnName}`;
      } else if (datetimeBases.has(base)) {
        extractExpression = `convert(char(23), ${c.columnName}, 23) AS ${c.columnName}`;
      } else if (base === 'bit') {
        extractExpression = `${c.columnName} /* 0/1 -> boolean */`;
      } else if (base === 'binary' || base === 'varbinary' || base === 'image') {
        // bytea alignment (2026-08-07): the AMVS-driven load carries binary as
        // '\x'-prefixed lowercase hex (the PG bytea text form — the sidecar
        // wire renders byte[] that way). A manual bcp extract must match:
        // bigint-safe hex via bintostr(), prefixed for the COPY.
        extractExpression =
          `'\\x' + lower(bintostr(${c.columnName})) AS ${c.columnName} ` +
          `/* bytea hex form: matches the AMVS wire ('\\x' + lowercase hex) */`;
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
 * SQL Server extract expressions (Spec 5.6). Every one of these renders the
 * value in EXACTLY the canonical text form the AMVS sidecar wire produces, so
 * a manual bcp/sqlcmd extract and the tool-driven load are byte-identical:
 *
 *   money/smallmoney  CONVERT(numeric(19,4), c)       fixed 4-decimal scale
 *   datetime family   CONVERT(varchar(27), c, 121)    ODBC canonical, full fraction
 *   datetimeoffset    CONVERT(varchar(34), c, 127)    ISO 8601 with the offset
 *   binary family     '\x' + LOWER(CONVERT(varchar(max), c, 2))   PG bytea hex
 *   bit               CAST(c AS int)                  0/1 COPY literals
 *   uniqueidentifier  LOWER(CONVERT(char(36), c))     PG renders uuid lowercase
 *   xml               CONVERT(nvarchar(max), c)       the document as text
 *   geography/geometry c.STAsText() + c.STSrid        WKT + SRID for ST_GeomFromText
 *   hierarchyid       c.ToString()                    the '/1/2/' path form
 */
function mssqlExtractExpression(
  c: IrColumn,
  base: string,
  postgresType: string,
  datetimeBases: ReadonlySet<string>,
): string {
  const col = c.columnName;
  if (base === 'money' || base === 'smallmoney') {
    return `CONVERT(${postgresType}, ${col}) AS ${col}`;
  }
  if (base === 'datetimeoffset') {
    return `CONVERT(varchar(34), ${col}, 127) AS ${col}`;
  }
  if (datetimeBases.has(base) || base === 'time') {
    return `CONVERT(varchar(27), ${col}, 121) AS ${col}`;
  }
  if (base === 'bit') {
    return `CAST(${col} AS int) AS ${col} /* 0/1 -> boolean */`;
  }
  if (base === 'uniqueidentifier') {
    return `LOWER(CONVERT(char(36), ${col})) AS ${col}`;
  }
  if (base === 'xml') {
    return `CONVERT(nvarchar(max), ${col}) AS ${col}`;
  }
  if (base === 'geography' || base === 'geometry') {
    return (
      `${col}.STAsText() AS ${col}, ${col}.STSrid AS ${col}_srid ` +
      `/* load with ST_GeomFromText(${col}, ${col}_srid) */`
    );
  }
  if (base === 'hierarchyid') {
    return `${col}.ToString() AS ${col} /* '/1/2/' path form -> ltree '1.2' */`;
  }
  if (base === 'binary' || base === 'varbinary' || base === 'image' || base === 'rowversion') {
    return (
      `'\\x' + LOWER(CONVERT(varchar(max), ${col}, 2)) AS ${col} ` +
      `/* bytea hex form: matches the AMVS wire ('\\x' + lowercase hex) */`
    );
  }
  return col;
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
  /** Source engine (Spec 5.6) — names the extract heading + the CLI guidance. */
  engine?: string;
  /** Display name for the source engine (from the pair ruleset). */
  sourceDisplay?: string | null;
}): string {
  const { table, columns } = args;
  const engineKey = String(args.engine ?? 'sybase').toLowerCase();
  const sourceLabel =
    args.sourceDisplay ?? (engineKey === 'mssql' ? 'SQL Server' : 'Sybase');
  const extractTool =
    engineKey === 'mssql'
      ? 'bcp (queryout, -c -t, -r\\n) or sqlcmd -W -s, — bcp is the bulk path; sqlcmd is fine for small tables'
      : 'isql / bcp';
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
  lines.push(`-- Source-side extract tool: ${extractTool}.`);
  lines.push('');
  lines.push(
    `-- 1) ${sourceLabel} extract (run against the source; casts aligned to the type mapping):`
  );
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
  sourceCharset?: {
    charset: string | null;
    sortorderName: string | null;
    caseSensitive: boolean | null;
  } | null;
}): string {
  const manifest = {
    source_charset: args.sourceCharset ?? null,
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
  /** Source engine (Spec 5.6) — names the extract heading. */
  engine?: string;
  /** Display name for the source engine (from the pair ruleset). */
  sourceDisplay?: string | null;
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

  lines.push(`-- 1) ${args.sourceDisplay ?? (String(args.engine ?? 'sybase').toLowerCase() === 'mssql' ? 'SQL Server' : 'Sybase')} delta extract:`);
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
