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

import { createHash } from 'crypto';

import { IrForeignKey, IrTable } from './types';
import { translateCheckExpression } from './typeMapping';

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
// Schema-scoped relation-name resolution (Sybase -> Postgres name scoping)
// ---------------------------------------------------------------------------

/** One PK/UNIQUE/index name renamed to fit Postgres's per-schema scoping. */
export interface RelationRename {
  schemaName: string;
  tableName: string;
  kind: 'primary_key' | 'unique_constraint' | 'index';
  from: string;
  to: string;
}

/** The resolved (collision-free) relation names for a table set. */
export interface ResolvedRelationNames {
  renames: RelationRename[];
  /** The name to EMIT for (schema, table, original name); identity when unrenamed. */
  nameFor(schemaName: string, tableName: string, originalName: string): string;
}

/**
 * Postgres truncates identifiers at 63 BYTES (NAMEDATALEN-1) — quoted or not —
 * so a rename that overflows must be clamped OURSELVES with a stable hash
 * suffix, or two long renames could silently truncate to the same relation.
 */
function clampIdent(name: string): string {
  if (Buffer.byteLength(name, 'utf8') <= 63) return name;
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  let head = name;
  while (Buffer.byteLength(head, 'utf8') > 54) head = head.slice(0, -1);
  return `${head}_${hash}`;
}

/**
 * Resolve every PK / UNIQUE-constraint / index name to be unique within its
 * schema's RELATION namespace (2026-08-06, the live `deal_book_ak1` failure).
 *
 * Sybase scopes constraint/index names PER TABLE, so a copied table
 * (`temp_deal_book`) legitimately carries the same auto-generated names as its
 * original. Postgres backs PK/UNIQUE constraints with indexes, and indexes
 * are RELATIONS — one per-schema namespace shared with tables and other
 * indexes — so the verbatim copy fails `relation "deal_book_ak1" already
 * exists` on the first clean apply. FK and CHECK constraint names stay
 * verbatim: `pg_constraint` scopes them per table, exactly like Sybase.
 *
 * Deterministic: tables walk in lexicographic qualified-name order, names
 * within a table in sorted order, so the lexicographically-first table keeps
 * its source name verbatim (the `temp_*`/`load_*` copies sort after their
 * originals and take the rename). The registry is seeded with the TABLE
 * names themselves — a constraint named like a table collides identically.
 * Renames are `<table>_<name>`, clamped to Postgres's 63-byte limit.
 */
export function resolveRelationNames(tables: IrTable[]): ResolvedRelationNames {
  const bySchema = new Map<string, Set<string>>();
  const claimed = (schema: string): Set<string> => {
    let set = bySchema.get(schema);
    if (!set) {
      set = new Set();
      bySchema.set(schema, set);
    }
    return set;
  };

  const sorted = [...tables].sort((a, b) =>
    qualifiedName(a.schemaName, a.tableName).localeCompare(qualifiedName(b.schemaName, b.tableName))
  );
  for (const t of sorted) claimed(t.schemaName).add(t.tableName);

  const renames: RelationRename[] = [];
  const resolved = new Map<string, string>(); // "schema\0table\0name" -> emitted name
  const key = (s: string, t: string, n: string): string => `${s}\0${t}\0${n}`;

  const claim = (
    table: IrTable,
    kind: RelationRename['kind'],
    originalName: string
  ): void => {
    const names = claimed(table.schemaName);
    let candidate = originalName;
    if (names.has(candidate)) {
      candidate = clampIdent(`${table.tableName}_${originalName}`);
      let n = 2;
      while (names.has(candidate)) {
        candidate = clampIdent(`${table.tableName}_${originalName}_${n}`);
        n += 1;
      }
      renames.push({
        schemaName: table.schemaName,
        tableName: table.tableName,
        kind,
        from: originalName,
        to: candidate,
      });
    }
    names.add(candidate);
    resolved.set(key(table.schemaName, table.tableName, originalName), candidate);
  };

  for (const t of sorted) {
    if (t.primaryKey) claim(t, 'primary_key', t.primaryKey.name);
    for (const u of [...t.uniqueConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
      claim(t, 'unique_constraint', u.name);
    }
    for (const idx of [...t.indexes].sort((a, b) => a.name.localeCompare(b.name))) {
      claim(t, 'index', idx.name);
    }
  }

  return {
    renames,
    nameFor: (schemaName, tableName, originalName) =>
      resolved.get(key(schemaName, tableName, originalName)) ?? originalName,
  };
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
 * A PK/UNIQUE constraint that cannot be emitted whole because member
 * column(s) are omitted/dropped (gold standard 2026-08-07). Detected purely
 * so the handler can raise the matching `pk_composition` pack decision and
 * flag the table's coverage; the emitter uses the same detection to write
 * the loud NEEDS DECISION comment (or honour the resolution).
 */
export interface DroppedKeyConstraint {
  kind: 'primary_key' | 'unique';
  name: string;
  columns: string[];
  missingColumns: string[];
}

/** The resolution options for a `pk_composition` decision. */
export const PK_COMPOSITION_OPTIONS = [
  'resolve_member_columns_first',
  'emit_over_present_members',
  'drop_constraint',
];

export function detectDroppedKeyConstraints(
  table: IrTable,
  presentColumns: Set<string>
): DroppedKeyConstraint[] {
  const out: DroppedKeyConstraint[] = [];
  if (table.primaryKey && !table.primaryKey.columns.every((c) => presentColumns.has(c))) {
    out.push({
      kind: 'primary_key',
      name: table.primaryKey.name,
      columns: [...table.primaryKey.columns],
      missingColumns: table.primaryKey.columns.filter((c) => !presentColumns.has(c)),
    });
  }
  for (const u of [...table.uniqueConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!u.columns.every((c) => presentColumns.has(c))) {
      out.push({
        kind: 'unique',
        name: u.name,
        columns: [...u.columns],
        missingColumns: u.columns.filter((c) => !presentColumns.has(c)),
      });
    }
  }
  return out;
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
  /**
   * Schema-scoped relation-name resolution (2026-08-06). Omitted = names emit
   * verbatim (legacy behaviour, safe only for single-table use in tests).
   */
  relationNames?: ResolvedRelationNames;
  /**
   * Resolved pack decisions (2026-08-07) — consulted for `pk_composition`
   * resolutions (`pk_composition--<schema.table>--<constraint>`). Omitted =
   * every dropped key constraint stays a NEEDS DECISION comment.
   */
  resolvedDecisions?: Record<string, Record<string, unknown> | undefined>;
}): string {
  const { table, columns, omitted, skipped } = args;
  const qn = qualifiedName(table.schemaName, table.tableName);
  const qq = quotedQualifiedName(table.schemaName, table.tableName);
  const path = tableChangesetPath(table);
  const relName = (original: string): string =>
    args.relationNames?.nameFor(table.schemaName, table.tableName, original) ?? original;

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
  // PK/UNIQUE member-drop (gold standard 2026-08-07): a key constraint whose
  // member column is omitted/dropped used to VANISH silently — uniqueness /
  // identity semantics disappeared from the target with zero signal. Every
  // dropped key now raises a `pk_composition` pack decision (the handler
  // persists it; an open decision blocks Migrate via the db-pack gate) and
  // leaves a loud NEEDS DECISION comment here. A resolved decision either
  // emits the constraint over the PRESENT members only or drops it on record.
  const droppedKeys = detectDroppedKeyConstraints(table, presentColumns);
  const keyResolution = (name: string): string | null => {
    const key = `pk_composition--${qn}--${name}`;
    const res = args.resolvedDecisions?.[key];
    const option = res && typeof res['option'] === 'string' ? (res['option'] as string) : null;
    return option;
  };
  if (table.primaryKey) {
    const pkDropped = droppedKeys.find(
      (d) => d.kind === 'primary_key' && d.name === table.primaryKey!.name
    );
    if (!pkDropped) {
      constraintDefs.push(
        `    CONSTRAINT ${quoteIdent(relName(table.primaryKey.name))} PRIMARY KEY ` +
          `(${table.primaryKey.columns.map(quoteIdent).join(', ')})`
      );
    } else if (keyResolution(table.primaryKey.name) === 'emit_over_present_members') {
      const kept = table.primaryKey.columns.filter((c) => presentColumns.has(c));
      if (kept.length > 0) {
        constraintDefs.push(
          `    CONSTRAINT ${quoteIdent(relName(table.primaryKey.name))} PRIMARY KEY ` +
            `(${kept.map(quoteIdent).join(', ')})`
        );
      }
    }
  }
  for (const u of [...table.uniqueConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
    const uDropped = droppedKeys.find((d) => d.kind === 'unique' && d.name === u.name);
    if (!uDropped) {
      constraintDefs.push(
        `    CONSTRAINT ${quoteIdent(relName(u.name))} UNIQUE (${u.columns.map(quoteIdent).join(', ')})`
      );
      continue;
    }
    if (keyResolution(u.name) === 'emit_over_present_members') {
      const kept = u.columns.filter((c) => presentColumns.has(c));
      if (kept.length > 0) {
        constraintDefs.push(
          `    CONSTRAINT ${quoteIdent(relName(u.name))} UNIQUE (${kept.map(quoteIdent).join(', ')})`
        );
      }
    }
  }
  // Check expressions are TRANSLATED deterministically (2026-08-01) --
  // mirroring the default/computed-column pipelines. The previous verbatim
  // copy shipped T-SQL built-ins (getdate(), datalength(), ...) PostgreSQL
  // rejects at schema-apply time. Portable expressions emit (with safe
  // renames like getdate()->now()); non-portable ones are SKIPPED with a
  // loud comment carrying the verbatim source below the CREATE TABLE.
  const rewrittenChecks: Array<{ name: string; from: string; to: string }> = [];
  const skippedChecks: Array<{ name: string; expression: string; reason: string }> = [];
  for (const ck of [...table.checkConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ck.expression) continue;
    const t = translateCheckExpression(ck.expression);
    if (t.kind === 'translated') {
      constraintDefs.push(`    CONSTRAINT ${quoteIdent(ck.name)} CHECK (${t.expression})`);
      if (t.changed) {
        rewrittenChecks.push({ name: ck.name, from: ck.expression, to: t.expression });
      }
    } else {
      skippedChecks.push({ name: ck.name, expression: ck.expression, reason: t.reason });
    }
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
  for (const dk of droppedKeys) {
    const resolution = keyResolution(dk.name);
    const label = dk.kind === 'primary_key' ? 'PRIMARY KEY' : 'UNIQUE';
    if (resolution === 'emit_over_present_members') {
      lines.push(
        `-- ${label} '${dk.name}': emitted over PRESENT members only per resolved decision ` +
          `'pk_composition--${qn}--${dk.name}' (missing: ${dk.missingColumns.join(', ')}).`
      );
    } else if (resolution === 'drop_constraint') {
      lines.push(
        `-- ${label} '${dk.name}' DROPPED per resolved decision ` +
          `'pk_composition--${qn}--${dk.name}' (members missing: ${dk.missingColumns.join(', ')}).`
      );
    } else {
      lines.push(
        `-- NEEDS DECISION (pk_composition): ${label} '${dk.name}' ` +
          `(${dk.columns.join(', ')}) NOT emitted — member column(s) ` +
          `${dk.missingColumns.join(', ')} are omitted/dropped. Resolve decision ` +
          `'pk_composition--${qn}--${dk.name}' and regenerate — the generator never ` +
          `silently drops a key constraint.`
      );
    }
  }
  for (const rc of rewrittenChecks) {
    lines.push(
      `-- CHECK ${qn}.${rc.name}: expression rewritten deterministically from Sybase ` +
        `('${oneLine(rc.from)}' -> '${oneLine(rc.to)}').`
    );
  }
  for (const sc of skippedChecks) {
    lines.push(
      `-- CHECK ${qn}.${sc.name}: non-portable expression (${sc.reason}) — routed to the ` +
        `translation queue (kind check_constraint, object ${qn}.${sc.name}). ` +
        `Source (Sybase, verbatim): CHECK (${oneLine(sc.expression)}). ` +
        `Approve its translation in the Translation Reviewer; the approved ALTER TABLE ` +
        `emits in the 050-translations changeset — nothing is left to manual work.`
    );
  }
  for (const r of (args.relationNames?.renames ?? []).filter(
    (r) =>
      r.schemaName === table.schemaName &&
      r.tableName === table.tableName &&
      r.kind !== 'index'
  )) {
    lines.push(
      `-- RENAMED ${r.kind === 'primary_key' ? 'PK' : 'UNIQUE'} constraint ` +
        `'${r.from}' -> '${r.to}': Postgres scopes PK/UNIQUE names per SCHEMA ` +
        `(index-backed relations), Sybase per table — the source name is ` +
        `already taken in "${table.schemaName}".`
    );
  }

  return lines.join('\n') + '\n';
}

/** Flatten an expression for safe embedding in a single SQL comment line. */
function oneLine(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, ' ');
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

/**
 * Deterministic FK constraint name from object identity (2026-08-07 rev).
 *
 * Postgres scopes constraint names per TABLE, so two FKs on ONE child table
 * must never derive the same name. The previous shape
 * (`fk_<fromTable>__<toTable>__<joinCols>`) omitted the schemas — two FKs
 * from one table to same-named parents in DIFFERENT schemas (`dbo.customer`
 * vs `arch.customer`, common in estates full of temp_ and copy tables)
 * collided, and the second `ADD CONSTRAINT` failed `constraint already
 * exists`. Both schemas
 * are now folded in; the referenced columns are appended ONLY when they
 * differ from the join columns (disambiguating same-table same-join-column
 * FK variants without bloating every name); the result is clamped to
 * Postgres's 63-byte identifier limit with a stable hash suffix. Stateless
 * per FK — identical output for identical FK identity, no cross-FK
 * emission-order dependence. The pack-validation gate independently refuses
 * any residual per-table duplicate.
 */
export function foreignKeyName(fk: IrForeignKey): string {
  const joins = fk.joinColumns.join('_');
  const refs = fk.referencedColumns.join('_');
  const refSuffix =
    refs !== '' && refs.toLowerCase() !== joins.toLowerCase() ? `__ref_${refs}` : '';
  const base =
    `fk_${fk.fromSchema}_${fk.fromTable}__${fk.toSchema}_${fk.toTable}` +
    `__${joins}${refSuffix}`;
  return clampIdent(base.toLowerCase());
}

export function emitIndexesChangeset(args: {
  tables: IrTable[];
  emittedTables: Set<string>;
  /** Schema-scoped relation-name resolution (2026-08-06); omitted = verbatim. */
  relationNames?: ResolvedRelationNames;
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
      // Filtered/exotic index guard (gold standard 2026-08-07): Sybase ASE 15
      // has NO filtered (partial) indexes and no non-btree access-method
      // vocabulary beyond clustered/nonclustered — a predicate or unknown
      // method in the IR means the upstream data is corrupt or hand-edited.
      // Emitting the index WITHOUT its predicate would silently change
      // uniqueness/coverage semantics, so generation FAILS loudly instead.
      const predicate = (idx.predicate ?? '').trim();
      if (predicate !== '') {
        throw new Error(
          `index ${qn}.${idx.name} carries a filter predicate (${predicate}) — ` +
            `Sybase ASE 15 has no filtered indexes, so this IR is not trustworthy. ` +
            `Fix the constraints_metadata at source and regenerate; the generator ` +
            `never drops a predicate silently.`
        );
      }
      const method = (idx.method ?? '').trim().toLowerCase();
      if (method !== '' && !['clustered', 'nonclustered', 'btree'].includes(method)) {
        throw new Error(
          `index ${qn}.${idx.name} declares unknown access method '${idx.method}' — ` +
            `not in the Sybase ASE 15 vocabulary (clustered|nonclustered). Fix the ` +
            `constraints_metadata at source and regenerate; the generator never ` +
            `guesses an access method.`
        );
      }
      // Column ordering from constraints_metadata.indexes[]; directions are
      // guarded to the portable ASC/DESC pair (2026-08-01) -- any other
      // directive from the source engine is dropped with a note instead of
      // shipping DDL PostgreSQL would reject.
      const droppedDirections: string[] = [];
      const cols = idx.columns
        .map((c, i) => {
          const dir = idx.columnDirections?.[i];
          const normalized = dir ? dir.trim().toUpperCase() : null;
          if (normalized === 'ASC' || normalized === 'DESC') {
            return `${quoteIdent(c)} ${normalized}`;
          }
          if (dir && dir.trim() !== '') {
            droppedDirections.push(`'${dir.trim()}' on ${c}`);
          }
          return quoteIdent(c);
        })
        .join(', ');
      const emittedName =
        args.relationNames?.nameFor(table.schemaName, table.tableName, idx.name) ?? idx.name;
      let sql = `CREATE ${idx.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(emittedName)} ON ${qq} (${cols});`;
      if (emittedName !== idx.name) {
        sql +=
          `\n-- RENAMED index '${idx.name}' -> '${emittedName}': Postgres scopes index` +
          ` names per SCHEMA (they are relations), Sybase per table — the source` +
          ` name is already taken in "${table.schemaName}".`;
      }
      if (droppedDirections.length > 0) {
        sql += `\n-- NOTE: index ${idx.name}: dropped non-portable column direction(s) ${droppedDirections.join(', ')}.`;
      }
      if (idx.isClustered) {
        // Sybase clustered -> plain btree + explicit note (Postgres keeps no
        // maintained clustering).
        sql +=
          `\n-- CLUSTER: source index ${idx.name} was CLUSTERED on Sybase. Postgres does not` +
          ` maintain clustering; this is a plain btree index. Optionally run` +
          ` \`CLUSTER ${qq} USING ${quoteIdent(emittedName)};\` once after load.`;
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
