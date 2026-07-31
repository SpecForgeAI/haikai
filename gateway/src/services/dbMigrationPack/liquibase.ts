/**
 * Liquibase formatted-SQL emission for the DB schema migration pack.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack — Task 2.4.
 *
 * LAYOUT (settled Q3):
 *   liquibase/db.changelog-master.xml             — include list, ordered
 *   liquibase/changesets/000-schemas.sql          — CREATE SCHEMA prologue
 *   liquibase/changesets/010-tables/<s>.<t>.sql   — ONE changeset per table
 *   liquibase/changesets/020-foreign-keys.sql    — consolidated FKs
 *   liquibase/changesets/030-indexes.sql          — consolidated indexes
 *   liquibase/changesets/040-sequences-seed.sql   — consolidated seed
 *
 * CHECKSUM STABILITY: changeset ids and logicalFilePath are stable functions
 * of object identity (`table-dbo.orders`); NO timestamps, NO generated-at
 * markers in any file — regeneration over identical inputs is byte-identical.
 * Ids NEVER contain `--` (2026-07-31: `table--dbo.X` broke Liquibase's
 * formatted-SQL parser on the live run — `--` reads as a comment opener).
 *
 * IDENTIFIER CASING (2026-07-31, the live 53-of-65-tables load failure):
 * EVERY emitted identifier is double-quoted with the source case preserved
 * (`"dbo"."ARM_VERSION"`). Unquoted DDL folds to lowercase in Postgres while
 * the bulk loader (AMVS targetLoader) emits quoted case-exact statements —
 * the two can never be allowed to diverge again. One canonical strategy:
 * quote everything, preserve source case. Unquoted `qualifiedName` remains
 * ONLY for ids / file paths / map keys / prose — never for SQL.
 *
 * PHASES are expressed as Liquibase contexts: the structural per-table
 * changesets carry `context:structural`; the consolidated sequences-seed /
 * foreign-keys / indexes changesets carry `context:post-load` so FK + index
 * application happens ONCE after the bulk load (settled Q4).
 *
 * NO LLM — pure deterministic code.
 */

import { IrForeignKey, IrTable } from './types';

export const CHANGESET_AUTHOR = 'db-migration-pack';
export const MASTER_CHANGELOG_PATH = 'liquibase/db.changelog-master.xml';
export const SCHEMAS_CHANGESET_PATH = 'liquibase/changesets/000-schemas.sql';
export const FOREIGN_KEYS_CHANGESET_PATH =
  'liquibase/changesets/020-foreign-keys.sql';
export const INDEXES_CHANGESET_PATH = 'liquibase/changesets/030-indexes.sql';
export const SEQUENCES_SEED_CHANGESET_PATH =
  'liquibase/changesets/040-sequences-seed.sql';

export function tableChangesetPath(table: IrTable): string {
  return `liquibase/changesets/010-tables/${table.schemaName}.${table.tableName}.sql`;
}

export function qualifiedName(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

/**
 * Quote ONE identifier for Postgres, preserving source case exactly.
 * Sybase names are case-insensitive but case-PRESERVING; quoting keeps the
 * target byte-identical to the source and matches the bulk loader's quoted
 * INSERT/COPY statements (`targetLoader.quoteIdent`).
 */
export function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** `"schema"."table"` — the quoted form EVERY emitted SQL statement uses. */
export function quotedQualifiedName(schemaName: string, tableName: string): string {
  return `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
}

// ---------------------------------------------------------------------------
// FK-topological table ordering (deterministic; cycles broken + noted)
// ---------------------------------------------------------------------------

/**
 * Order tables parents-first by declared FKs (children after the tables they
 * reference). Deterministic: ties resolve lexicographically by qualified
 * name; cycles break by emitting the lexicographically-smallest remaining
 * table and recording the break for the manifest. Self-referencing FKs do
 * not contribute edges (they are appliable post-load regardless).
 */
export function topologicalTableOrder(
  tables: IrTable[],
  foreignKeys: IrForeignKey[]
): { ordered: IrTable[]; cycleBreaks: string[] } {
  const byName = new Map<string, IrTable>();
  for (const t of tables) byName.set(qualifiedName(t.schemaName, t.tableName), t);

  // child -> set of parents it depends on
  const dependsOn = new Map<string, Set<string>>();
  for (const t of byName.keys()) dependsOn.set(t, new Set());
  for (const fk of foreignKeys) {
    const child = qualifiedName(fk.fromSchema, fk.fromTable);
    const parent = qualifiedName(fk.toSchema, fk.toTable);
    if (child === parent) continue; // self-reference: no ordering edge
    if (dependsOn.has(child) && byName.has(parent)) {
      dependsOn.get(child)!.add(parent);
    }
  }

  const ordered: IrTable[] = [];
  const emitted = new Set<string>();
  const cycleBreaks: string[] = [];
  const remaining = new Set(byName.keys());

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((name) => [...dependsOn.get(name)!].every((p) => emitted.has(p) || !remaining.has(p)))
      .sort();
    if (ready.length > 0) {
      const next = ready[0];
      ordered.push(byName.get(next)!);
      emitted.add(next);
      remaining.delete(next);
      continue;
    }
    // Cycle: break deterministically at the lexicographically-smallest node.
    const breakAt = [...remaining].sort()[0];
    cycleBreaks.push(
      `FK cycle broken at ${breakAt}: emitted before its referenced parent(s) ` +
        `${[...dependsOn.get(breakAt)!].filter((p) => remaining.has(p)).sort().join(', ')} ` +
        `(FKs apply post-load, so structural ordering is unaffected at runtime).`
    );
    ordered.push(byName.get(breakAt)!);
    emitted.add(breakAt);
    remaining.delete(breakAt);
  }

  return { ordered, cycleBreaks };
}

// ---------------------------------------------------------------------------
// Formatted-SQL helpers
// ---------------------------------------------------------------------------

export function formattedSqlHeader(logicalFilePath: string): string {
  return `--liquibase formatted sql logicalFilePath:${logicalFilePath}\n`;
}

export function changesetHeader(id: string, context: 'structural' | 'post-load'): string {
  return `\n--changeset ${CHANGESET_AUTHOR}:${id} context:${context} splitStatements:false\n`;
}

// ---------------------------------------------------------------------------
// Per-table structural changeset
// ---------------------------------------------------------------------------

/** One translated column ready for DDL emission. */
export interface EmittableColumn {
  columnName: string;
  postgresType: string;
  isNullable: boolean;
  isIdentity: boolean;
  /** Translated default expression (already rewritten where safe). */
  defaultExpression: string | null;
  /** Translated generation expression for a generated column. */
  generationExpression: string | null;
}

/** A column omitted from the DDL pending an open decision. */
export interface OmittedColumnNote {
  columnName: string;
  decisionKey: string;
  category: string;
  sourceType: string;
}

/** A column explicitly skipped (e.g. dropped by a resolved decision). */
export interface SkippedColumnNote {
  columnName: string;
  reason: string;
}

/**
 * Emit the ONE structural changeset for a table: CREATE TABLE with columns,
 * PK, unique + check constraints, and comments. FKs and non-PK indexes are
 * NOT here — they land in the consolidated post-load changesets.
 */
export function emitTableChangeset(args: {
  table: IrTable;
  columns: EmittableColumn[];
  omitted: OmittedColumnNote[];
  skipped: SkippedColumnNote[];
}): string {
  const { table, columns, omitted, skipped } = args;
  const qn = qualifiedName(table.schemaName, table.tableName);
  const qq = quotedQualifiedName(table.schemaName, table.tableName);
  const path = tableChangesetPath(table);

  const lines: string[] = [];
  lines.push(formattedSqlHeader(path).trimEnd());
  lines.push(changesetHeader(`table-${qn}`, 'structural').trimEnd().replace(/^\n/, ''));

  const columnDefs: string[] = [];
  for (const c of columns) {
    let def = `    ${quoteIdent(c.columnName)} ${c.postgresType}`;
    if (c.generationExpression) {
      def += ` GENERATED ALWAYS AS (${c.generationExpression}) STORED`;
    } else if (c.isIdentity) {
      def += ' GENERATED ALWAYS AS IDENTITY';
    }
    if (!c.isNullable) def += ' NOT NULL';
    if (c.defaultExpression && !c.generationExpression) {
      def += ` DEFAULT ${c.defaultExpression}`;
    }
    columnDefs.push(def);
  }

  const constraintDefs: string[] = [];
  const presentColumns = new Set(columns.map((c) => c.columnName));
  if (table.primaryKey && table.primaryKey.columns.every((c) => presentColumns.has(c))) {
    constraintDefs.push(
      `    CONSTRAINT ${quoteIdent(table.primaryKey.name)} PRIMARY KEY ` +
        `(${table.primaryKey.columns.map(quoteIdent).join(', ')})`
    );
  }
  for (const u of [...table.uniqueConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!u.columns.every((c) => presentColumns.has(c))) continue;
    constraintDefs.push(
      `    CONSTRAINT ${quoteIdent(u.name)} UNIQUE (${u.columns.map(quoteIdent).join(', ')})`
    );
  }
  for (const ck of [...table.checkConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ck.expression) continue;
    // Check expressions are reproduced VERBATIM from constraints_metadata.
    constraintDefs.push(`    CONSTRAINT ${quoteIdent(ck.name)} CHECK (${ck.expression})`);
  }

  lines.push(`CREATE TABLE ${qq} (`);
  lines.push([...columnDefs, ...constraintDefs].join(',\n'));
  lines.push(');');

  for (const o of omitted) {
    lines.push(
      `-- NEEDS DECISION (${o.category}): column ${qn}.${o.columnName} ` +
        `(source type: ${o.sourceType}) is OMITTED pending decision '${o.decisionKey}'. ` +
        `Resolve the decision and regenerate — the generator never guesses.`
    );
  }
  for (const s of skipped) {
    lines.push(`-- SKIPPED column ${qn}.${s.columnName}: ${s.reason}`);
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Consolidated changesets
// ---------------------------------------------------------------------------

export interface SequenceSeedStatement {
  /** Human-readable target (e.g. `dbo.orders.order_id`). */
  objectRef: string;
  sql: string | null;
  /** Comment emitted when no statement can be produced (open decision). */
  note: string | null;
}

export function emitSequencesSeedChangeset(args: {
  statements: SequenceSeedStatement[];
  seedMargin: number;
}): string {
  const lines: string[] = [];
  lines.push(formattedSqlHeader(SEQUENCES_SEED_CHANGESET_PATH).trimEnd());
  lines.push(changesetHeader('sequences-seed', 'post-load').trimEnd().replace(/^\n/, ''));
  lines.push(
    `-- Phase 4 of 5: reseed sequences/identities AFTER the bulk load.` +
      ` Restart values = captured source high-water mark + seed margin (${args.seedMargin}).`
  );
  const sorted = [...args.statements].sort((a, b) => a.objectRef.localeCompare(b.objectRef));
  for (const s of sorted) {
    if (s.sql) lines.push(s.sql);
    if (s.note) lines.push(`-- ${s.note}`);
  }
  return lines.join('\n') + '\n';
}

export function emitForeignKeysChangeset(args: {
  foreignKeys: IrForeignKey[];
  /** Qualified names of tables actually emitted (FKs to skipped tables are dropped with a note). */
  emittedTables: Set<string>;
}): string {
  const lines: string[] = [];
  lines.push(formattedSqlHeader(FOREIGN_KEYS_CHANGESET_PATH).trimEnd());
  lines.push(changesetHeader('foreign-keys', 'post-load').trimEnd().replace(/^\n/, ''));
  lines.push(
    '-- Phase 3 of 5: ALL foreign keys apply ONCE after the bulk load, then stay' +
      ' enforced through every incremental run. Referential actions are verbatim from discovery.'
  );
  const sorted = [...args.foreignKeys].sort((a, b) =>
    foreignKeyName(a).localeCompare(foreignKeyName(b))
  );
  for (const fk of sorted) {
    const child = qualifiedName(fk.fromSchema, fk.fromTable);
    const parent = qualifiedName(fk.toSchema, fk.toTable);
    if (!args.emittedTables.has(child) || !args.emittedTables.has(parent)) {
      lines.push(
        `-- SKIPPED FK ${foreignKeyName(fk)} (${child} -> ${parent}): one side was not emitted as a table.`
      );
      continue;
    }
    let sql =
      `ALTER TABLE ${quotedQualifiedName(fk.fromSchema, fk.fromTable)} ` +
      `ADD CONSTRAINT ${quoteIdent(foreignKeyName(fk))} ` +
      `FOREIGN KEY (${fk.joinColumns.map(quoteIdent).join(', ')}) ` +
      `REFERENCES ${quotedQualifiedName(fk.toSchema, fk.toTable)} ` +
      `(${fk.referencedColumns.map(quoteIdent).join(', ')})`;
    if (fk.onDelete) sql += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
    if (fk.onUpdate) sql += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
    sql += ';';
    lines.push(sql);
  }
  return lines.join('\n') + '\n';
}

/** Deterministic FK constraint name from object identity. */
export function foreignKeyName(fk: IrForeignKey): string {
  return `fk_${fk.fromTable}__${fk.toTable}__${fk.joinColumns.join('_')}`.toLowerCase();
}

export function emitIndexesChangeset(args: {
  tables: IrTable[];
  emittedTables: Set<string>;
}): { content: string; clusterNotes: string[] } {
  const lines: string[] = [];
  const clusterNotes: string[] = [];
  lines.push(formattedSqlHeader(INDEXES_CHANGESET_PATH).trimEnd());
  lines.push(changesetHeader('indexes', 'post-load').trimEnd().replace(/^\n/, ''));
  lines.push(
    '-- Phase 3 of 5: ALL non-PK indexes apply ONCE after the bulk load, then stay' +
      ' in place through every incremental run.'
  );
  const sortedTables = [...args.tables].sort((a, b) =>
    qualifiedName(a.schemaName, a.tableName).localeCompare(qualifiedName(b.schemaName, b.tableName))
  );
  for (const table of sortedTables) {
    const qn = qualifiedName(table.schemaName, table.tableName);
    if (!args.emittedTables.has(qn)) continue;
    const qq = quotedQualifiedName(table.schemaName, table.tableName);
    const sortedIndexes = [...table.indexes].sort((a, b) => a.name.localeCompare(b.name));
    for (const idx of sortedIndexes) {
      // Column ordering/direction verbatim from constraints_metadata.indexes[].
      const cols = idx.columns
        .map((c, i) => {
          const dir = idx.columnDirections?.[i];
          return dir ? `${quoteIdent(c)} ${dir}` : quoteIdent(c);
        })
        .join(', ');
      let sql = `CREATE ${idx.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(idx.name)} ON ${qq} (${cols});`;
      if (idx.isClustered) {
        // Sybase clustered -> plain btree + explicit note (Postgres keeps no
        // maintained clustering).
        sql +=
          `\n-- CLUSTER: source index ${idx.name} was CLUSTERED on Sybase. Postgres does not` +
          ` maintain clustering; this is a plain btree index. Optionally run` +
          ` \`CLUSTER ${qq} USING ${quoteIdent(idx.name)};\` once after load.`;
        clusterNotes.push(
          `${qn}.${idx.name}: clustered on source; emitted as plain btree (see indexes changeset).`
        );
      }
      lines.push(sql);
    }
  }
  return { content: lines.join('\n') + '\n', clusterNotes };
}

export function emitSchemasChangeset(schemas: string[]): string {
  const lines: string[] = [];
  lines.push(formattedSqlHeader(SCHEMAS_CHANGESET_PATH).trimEnd());
  lines.push(changesetHeader('schemas', 'structural').trimEnd().replace(/^\n/, ''));
  for (const s of [...schemas].sort()) {
    lines.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(s)};`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Master changelog
// ---------------------------------------------------------------------------

export function emitMasterChangelog(orderedChangesetPaths: string[]): string {
  const includes = orderedChangesetPaths
    .map((p) => {
      const rel = p.replace(/^liquibase\//, '');
      return `  <include file="${rel}" relativeToChangelogFile="true"/>`;
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<databaseChangeLog\n` +
    `    xmlns="http://www.liquibase.org/xml/ns/dbchangelog"\n` +
    `    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n` +
    `    xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog\n` +
    `        http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-latest.xsd">\n` +
    // XML comments must NEVER contain a double-dash (illegal XML — the live
    // 2026-07-30 parse failure): say "contexts=structural", not the CLI flag.
    `  <!-- Structural phase: run with contexts=structural (tables/PKs/constraints; no FKs, no non-PK indexes). -->\n` +
    `  <!-- Post-load phase: run with contexts=post-load AFTER the bulk load (FKs + indexes ONCE, then sequence reseed). -->\n` +
    includes +
    `\n</databaseChangeLog>\n`
  );
}
