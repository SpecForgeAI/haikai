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

import { IrForeignKey, IrTable, PackDecision } from './types';
import { translateCheckExpression } from './typeMapping';

export const CHANGESET_AUTHOR = 'db-migration-pack';
export const MASTER_CHANGELOG_PATH = 'liquibase/db.changelog-master.xml';
export const SCHEMAS_CHANGESET_PATH = 'liquibase/changesets/000-schemas.sql';
export const FOREIGN_KEYS_CHANGESET_PATH =
  'liquibase/changesets/020-foreign-keys.sql';
export const INDEXES_CHANGESET_PATH = 'liquibase/changesets/030-indexes.sql';
export const SEQUENCES_SEED_CHANGESET_PATH =
  'liquibase/changesets/040-sequences-seed.sql';
/**
 * Item-5 emulations (SQL Server pair programme, Spec 5.5): the DDL the pack
 * BUILDS for source shapes with no like-for-like target form. Structural
 * (history tables, generated tsvector columns) so it applies with the tables;
 * the triggers that maintain them ride the same file because a history table
 * without its trigger is worse than neither.
 */
export const EMULATIONS_CHANGESET_PATH = 'liquibase/changesets/015-emulations.sql';

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
export function resolveRelationNames(
  tables: IrTable[],
  engine?: string,
): ResolvedRelationNames {
  // NAME SCOPING is per engine (Spec 5.1/5.3). Sybase scopes constraint AND
  // index names per TABLE, so a copied table legitimately carries its
  // original's names and BOTH classes can collide in the target's per-schema
  // relation namespace. SQL Server already scopes PK/UNIQUE/FK/CHECK names
  // per SCHEMA — a collision there is impossible at source — and only INDEX
  // names are per table. So on `mssql` the constraint names are claimed
  // (they still occupy the namespace an index could collide with) but never
  // renamed; only index collisions rename.
  const constraintsRenameable = String(engine ?? '').toLowerCase() !== 'mssql';
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
    if (names.has(candidate) && kind !== 'index' && !constraintsRenameable) {
      // The source engine already guarantees per-schema uniqueness for this
      // class: keep the name verbatim (a rename here would break the
      // manifest/diff identity for no gain) and let the index pass rename.
      resolved.set(key(table.schemaName, table.tableName, originalName), candidate);
      return;
    }
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
  /**
   * Storage for a generated column (Spec 5.3). `STORED` reproduces a
   * PERSISTED source computed column exactly; `VIRTUAL` (PostgreSQL 18)
   * reproduces a NON-persisted one, which is evaluated on read at source.
   * Absent = `STORED` (the historical behaviour).
   */
  generationStorage?: 'STORED' | 'VIRTUAL';
  /**
   * The full identity clause when the source carries seed/increment detail
   * (Spec 5.3: `GENERATED BY DEFAULT AS IDENTITY (START WITH s INCREMENT BY
   * i)`). Absent = the historical `GENERATED ALWAYS AS IDENTITY`.
   */
  identityClause?: string | null;
  /** Collation to append (`COLLATE "haikai_ci"`) — the ICU posture only. */
  collate?: string | null;
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
  /**
   * Table-level constraint lines appended verbatim inside CREATE TABLE
   * (Spec 5.4: the length CHECK a `char(n)` column needs once it becomes the
   * variable-length `citext`). Already rendered + indented by the caller.
   */
  extraConstraints?: string[];
  /** Loud provenance comments appended below the CREATE TABLE (item 5). */
  extraNotes?: string[];
  /**
   * Statements appended AFTER the CREATE TABLE in the SAME changeset — the
   * `NOT VALID` CHECK constraints (PostgreSQL accepts NOT VALID only on
   * ALTER TABLE, never inside CREATE TABLE).
   */
  trailingStatements?: string[];
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
    if (c.collate) def += ` COLLATE ${quoteIdent(c.collate)}`;
    if (c.generationExpression) {
      def += ` GENERATED ALWAYS AS (${c.generationExpression}) ${c.generationStorage ?? 'STORED'}`;
    } else if (c.identityClause) {
      def += ` ${c.identityClause}`;
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
  // C5 (2026-08-30): remember exactly which columns the PK was emitted over
  // so an identical UNIQUE can be suppressed as provably redundant (below).
  let emittedPkColumns: string[] | null = null;
  let emittedPkName: string | null = null;
  if (table.primaryKey) {
    const pkDropped = droppedKeys.find(
      (d) => d.kind === 'primary_key' && d.name === table.primaryKey!.name
    );
    if (!pkDropped) {
      constraintDefs.push(
        `    CONSTRAINT ${quoteIdent(relName(table.primaryKey.name))} PRIMARY KEY ` +
          `(${table.primaryKey.columns.map(quoteIdent).join(', ')})`
      );
      emittedPkColumns = [...table.primaryKey.columns];
      emittedPkName = relName(table.primaryKey.name);
    } else if (keyResolution(table.primaryKey.name) === 'emit_over_present_members') {
      const kept = table.primaryKey.columns.filter((c) => presentColumns.has(c));
      if (kept.length > 0) {
        constraintDefs.push(
          `    CONSTRAINT ${quoteIdent(relName(table.primaryKey.name))} PRIMARY KEY ` +
            `(${kept.map(quoteIdent).join(', ')})`
        );
        emittedPkColumns = kept;
        emittedPkName = relName(table.primaryKey.name);
      }
    }
  }
  /**
   * True when the UNIQUE covers EXACTLY the PK's columns in EXACTLY the same
   * order. Postgres backs both a PK and a UNIQUE with its own btree index, so
   * that pair is two identical indexes — double the write cost and storage on
   * the busiest tables, with no added guarantee. Order is part of the test on
   * purpose: a different column ORDER is still a distinct (and potentially
   * useful) index prefix, so those are left alone.
   */
  const isRedundantWithPk = (cols: readonly string[]): boolean =>
    emittedPkColumns !== null &&
    emittedPkColumns.length === cols.length &&
    emittedPkColumns.every((c, i) => c.toLowerCase() === cols[i].toLowerCase());
  const redundantUniques: Array<{ name: string; columns: string[] }> = [];
  for (const u of [...table.uniqueConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
    const uDropped = droppedKeys.find((d) => d.kind === 'unique' && d.name === u.name);
    if (!uDropped) {
      if (isRedundantWithPk(u.columns)) {
        redundantUniques.push({ name: relName(u.name), columns: [...u.columns] });
        continue;
      }
      constraintDefs.push(
        `    CONSTRAINT ${quoteIdent(relName(u.name))} UNIQUE (${u.columns.map(quoteIdent).join(', ')})`
      );
      continue;
    }
    if (keyResolution(u.name) === 'emit_over_present_members') {
      const kept = u.columns.filter((c) => presentColumns.has(c));
      if (kept.length > 0) {
        if (isRedundantWithPk(kept)) {
          redundantUniques.push({ name: relName(u.name), columns: kept });
          continue;
        }
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
  // A CHECK the source is NOT enforcing (disabled) or has never validated
  // against the existing rows (SQL Server WITH NOCHECK) emits as a separate
  // `ALTER TABLE ... NOT VALID` statement: PostgreSQL accepts NOT VALID only
  // on ALTER TABLE, and a plain CREATE TABLE CHECK would fail the apply on
  // data the source itself never checked (Spec 5.3).
  const notValidChecks: Array<{ name: string; expression: string; why: string }> = [];
  for (const ck of [...table.checkConstraints].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ck.expression) continue;
    const t = translateCheckExpression(ck.expression);
    if (t.kind === 'translated') {
      if (ck.isDisabled === true || ck.isNotTrusted === true) {
        notValidChecks.push({
          name: ck.name,
          expression: t.expression,
          why: ck.isDisabled === true ? 'DISABLED at source' : 'NOT TRUSTED at source (WITH NOCHECK)',
        });
      } else {
        constraintDefs.push(`    CONSTRAINT ${quoteIdent(ck.name)} CHECK (${t.expression})`);
      }
      if (t.changed) {
        rewrittenChecks.push({ name: ck.name, from: ck.expression, to: t.expression });
      }
    } else {
      skippedChecks.push({ name: ck.name, expression: ck.expression, reason: t.reason });
    }
  }
  for (const extra of args.extraConstraints ?? []) constraintDefs.push(extra);

  lines.push(`CREATE TABLE ${qq} (`);
  lines.push([...columnDefs, ...constraintDefs].join(',\n'));
  lines.push(');');

  for (const nv of notValidChecks) {
    lines.push(
      `ALTER TABLE ${qq} ADD CONSTRAINT ${quoteIdent(nv.name)} ` +
        `CHECK (${nv.expression}) NOT VALID;`
    );
    lines.push(
      `-- CHECK ${qn}.${nv.name} emitted NOT VALID: the constraint was ${nv.why}, so the ` +
        `EXISTING rows were never validated against it. New and updated rows ARE checked; run ` +
        `\`ALTER TABLE ${qq} VALIDATE CONSTRAINT ${quoteIdent(nv.name)};\` once the legacy rows ` +
        `have been cleaned to promote it to a fully enforced constraint.`
    );
  }
  for (const s of args.trailingStatements ?? []) lines.push(s);
  for (const n of args.extraNotes ?? []) lines.push(n);

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
  for (const ru of redundantUniques) {
    lines.push(
      `-- REDUNDANT UNIQUE ${qn}.${ru.name} (${ru.columns.join(', ')}) NOT emitted: ` +
        `identical to PRIMARY KEY ${emittedPkName} on the same columns in the same ` +
        `order. Postgres backs a PK and a UNIQUE with SEPARATE btree indexes, so ` +
        `emitting both doubles index write cost and storage while adding no ` +
        `guarantee. The uniqueness the source declared is fully preserved by the ` +
        `primary key. (A different column ORDER would have been kept — that is a ` +
        `distinct index prefix, not a duplicate.)`
    );
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
  /**
   * Relationships present in the model that carry NO `fk_columns` join
   * metadata, so no constraint could be generated from them. Drives the
   * loud empty-file banner below. Optional — omitted means "unknown".
   */
  relationshipsWithoutJoinMetadata?: number;
}): string {
  const lines: string[] = [];
  lines.push(formattedSqlHeader(FOREIGN_KEYS_CHANGESET_PATH).trimEnd());
  lines.push(changesetHeader('foreign-keys', 'post-load').trimEnd().replace(/^\n/, ''));
  lines.push(
    '-- Phase 3 of 5: ALL foreign keys apply ONCE after the bulk load, then stay' +
      ' enforced through every incremental run. Referential actions are verbatim from discovery.'
  );
  let emittedCount = 0;
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
    const onDelete = normalizeReferentialAction(fk.onDelete);
    const onUpdate = normalizeReferentialAction(fk.onUpdate);
    if (onDelete.action) sql += ` ON DELETE ${onDelete.action}`;
    if (onUpdate.action) sql += ` ON UPDATE ${onUpdate.action}`;
    // A NOT TRUSTED source FK (created / re-enabled WITH NOCHECK) has never
    // been validated against the existing rows. Emitting it enforced would
    // fail the apply on data the SOURCE itself never checked; NOT VALID
    // enforces it for every new row and leaves a named promotion step.
    if (fk.isNotTrusted === true) sql += ' NOT VALID';
    sql += ';';
    lines.push(sql);
    if (fk.isNotTrusted === true) {
      lines.push(
        `-- FK ${foreignKeyName(fk)} emitted NOT VALID: the source constraint is NOT TRUSTED ` +
          `(created or re-enabled WITH NOCHECK), so its existing rows were never validated. ` +
          `New rows ARE enforced; run \`ALTER TABLE ` +
          `${quotedQualifiedName(fk.fromSchema, fk.fromTable)} VALIDATE CONSTRAINT ` +
          `${quoteIdent(foreignKeyName(fk))};\` after the legacy rows are cleaned.`
      );
    }
    for (const dropped of [onDelete, onUpdate]) {
      if (dropped.droppedNote) {
        lines.push(`-- NOTE: FK ${foreignKeyName(fk)}: ${dropped.droppedNote}`);
      }
    }
    emittedCount++;
  }
  // C2 (2026-08-30): an EMPTY foreign-keys changeset used to be
  // indistinguishable from a source genuinely without FKs — header, one
  // cheerful comment, nothing else. A live pack shipped exactly that while
  // the source catalogue counted five declared FKs, and because the DB-tier
  // acceptance is "the files match the pack content exactly", the empty file
  // passed GREEN and every FK was silently dropped. The artifact must now
  // incriminate itself. Fires even when every FK was skipped for an
  // unemitted side — the case most likely to be mistaken for done.
  if (emittedCount === 0) {
    const n = args.relationshipsWithoutJoinMetadata;
    lines.push('');
    lines.push('-- ######################################################################');
    lines.push('-- NO FOREIGN KEYS WERE EMITTED.');
    lines.push('--');
    lines.push('-- This is NOT evidence that the source database declares none.');
    if (typeof n === 'number' && n > 0) {
      lines.push(
        `-- ${n} relationship(s) in the model carry no fk_columns join metadata,` +
          ' so no ALTER TABLE ... ADD CONSTRAINT could be generated from them.'
      );
    } else {
      lines.push(
        '-- The model supplied no relationship carrying fk_columns join metadata,' +
          ' so no ALTER TABLE ... ADD CONSTRAINT could be generated.'
      );
    }
    lines.push("-- See the 'relationships_without_fk_columns' pack finding.");
    lines.push('--');
    lines.push('-- DO NOT accept this changeset as complete on the strength of a');
    lines.push("-- 'files match the pack' check. Verify against the source catalogue:");
    lines.push('--   Sybase ASE: SELECT count(*) FROM sysreferences;  Postgres:');
    lines.push("--   SELECT count(*) FROM pg_constraint WHERE contype = 'f';");
    lines.push('-- A non-zero source count means referential integrity is being lost.');
    lines.push('-- ######################################################################');
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

/** Options for `index_predicate` when a filter predicate is non-portable. */
export const INDEX_PREDICATE_OPTIONS = [
  'provide_predicate',
  'emit_without_predicate',
  'drop_index',
];
/** Options for a columnstore index (no PostgreSQL core equivalent). */
export const COLUMNSTORE_INDEX_OPTIONS = ['btree', 'skip'];
/** Options for a typed (XML / spatial) index. */
export const TYPED_INDEX_OPTIONS = ['gin_gist', 'skip'];

/** SQL Server index-type tokens that are ordinary b-tree indexes on the target. */
const BTREE_INDEX_TYPES = new Set(['', 'clustered', 'nonclustered', 'btree', 'heap']);
const COLUMNSTORE_INDEX_TYPES = new Set(['columnstore', 'clustered_columnstore', 'nonclustered_columnstore']);

export function emitIndexesChangeset(args: {
  tables: IrTable[];
  emittedTables: Set<string>;
  /** Schema-scoped relation-name resolution (2026-08-06); omitted = verbatim. */
  relationNames?: ResolvedRelationNames;
  /**
   * Source engine (Spec 5.3). `sybase` keeps the ASE posture EXACTLY: a
   * filter predicate or a non-btree access method means the upstream data is
   * corrupt (ASE 15 has neither), so generation THROWS. `mssql` has both as
   * first-class constructs, so each becomes DDL or a named decision.
   */
  engine?: string;
  /** Resolved pack decisions, consulted for index-shaped resolutions. */
  resolvedDecisions?: Record<string, Record<string, unknown> | undefined>;
  /** Rule-id citation by ruleset divergence_class (never a hardcoded prefix). */
  ruleCite?: (divergenceClass: string) => string | null;
}): {
  content: string;
  clusterNotes: string[];
  decisions: PackDecision[];
  notes: string[];
} {
  const lines: string[] = [];
  const clusterNotes: string[] = [];
  const decisions: PackDecision[] = [];
  const notes: string[] = [];
  const engine = String(args.engine ?? 'sybase').toLowerCase();
  const isMssql = engine === 'mssql';
  const resolutionOf = (key: string): Record<string, unknown> | undefined =>
    args.resolvedDecisions?.[key];
  const optionOf = (key: string): string | null => {
    const r = resolutionOf(key);
    return r && typeof r['option'] === 'string' ? (r['option'] as string) : null;
  };
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
      const method = (idx.method ?? '').trim().toLowerCase();
      if (!isMssql) {
        if (predicate !== '') {
          throw new Error(
            `index ${qn}.${idx.name} carries a filter predicate (${predicate}) — ` +
              `Sybase ASE 15 has no filtered indexes, so this IR is not trustworthy. ` +
              `Fix the constraints_metadata at source and regenerate; the generator ` +
              `never drops a predicate silently.`
          );
        }
        if (method !== '' && !['clustered', 'nonclustered', 'btree'].includes(method)) {
          throw new Error(
            `index ${qn}.${idx.name} declares unknown access method '${idx.method}' — ` +
              `not in the Sybase ASE 15 vocabulary (clustered|nonclustered). Fix the ` +
              `constraints_metadata at source and regenerate; the generator never ` +
              `guesses an access method.`
          );
        }
      }
      // --- SQL Server access-method vocabulary (Spec 5.3) -----------------
      // A FULL-TEXT index is NOT an index on the target at all: it is the
      // tsvector + GIN emulation the pack builds in the emulations changeset
      // (5.5), so it is skipped here with a pointer rather than guessed at.
      let methodSuffix = '';
      if (isMssql) {
        if (method === 'fulltext') {
          lines.push(
            `-- FULL-TEXT index ${qn}.${idx.name}: not emitted here — it is emulated by the ` +
              `generated tsvector column + GIN index in ${EMULATIONS_CHANGESET_PATH} ` +
              `(decision fulltext_index--${qn}).`
          );
          continue;
        }
        if (COLUMNSTORE_INDEX_TYPES.has(method)) {
          const key = `columnstore_index--${qn}--${idx.name}`;
          const option = optionOf(key) ?? 'btree';
          if (!resolutionOf(key)) {
            decisions.push({
              decisionKey: key,
              objectRef: `${qn}.${idx.name}`,
              category: 'columnstore_index',
              question:
                `Index ${qn}.${idx.name} is a ${method.replace(/_/g, ' ')} index. PostgreSQL ` +
                `core has NO columnstore, so the analytic scan profile this index serves cannot ` +
                `be reproduced by it. Choose btree (RECOMMENDED — the key columns become an ` +
                `ordinary b-tree index so point and range lookups keep working; the analytic ` +
                `plan must be re-tuned, optionally with BRIN or a deliberately provisioned ` +
                `column-store extension) or skip (no target index at all, on record).`,
              options: COLUMNSTORE_INDEX_OPTIONS,
            });
          }
          const cite = args.ruleCite?.('columnstore');
          if (option === 'skip') {
            lines.push(
              `-- COLUMNSTORE index ${qn}.${idx.name} NOT emitted per resolved decision ` +
                `'${key}' (option skip).`
            );
            notes.push(`${qn}.${idx.name}: columnstore index skipped by decision.`);
            continue;
          }
          notes.push(
            `${qn}.${idx.name}: columnstore_dropped_to_btree — the source ` +
              `${method.replace(/_/g, ' ')} index is emitted as a plain b-tree over its key ` +
              `columns; the analytic query profile it served must be re-planned` +
              (cite ? ` (${cite})` : '') + '.'
          );
        } else if (method === 'xml' || method === 'spatial') {
          const key = `${method === 'xml' ? 'xml_method' : 'spatial_column'}--${qn}--${idx.name}`;
          const option = optionOf(key) ?? 'gin_gist';
          const targetMethod = method === 'xml' ? 'gin' : 'gist';
          if (!resolutionOf(key)) {
            decisions.push({
              decisionKey: key,
              objectRef: `${qn}.${idx.name}`,
              category: method === 'xml' ? 'xml_method' : 'spatial_column',
              question:
                `Index ${qn}.${idx.name} is a SQL Server ${method.toUpperCase()} index. The ` +
                `closest PostgreSQL form is a ${targetMethod.toUpperCase()} index over the same ` +
                `column, which serves the same access shape but is NOT the same structure ` +
                `(different operator class, different selectivity). Choose gin_gist ` +
                `(RECOMMENDED — emit ` +
                `\`USING ${targetMethod}\`` +
                `) or skip (no target index, on record).` +
                (args.ruleCite?.(method === 'xml' ? 'xml_methods' : 'spatial')
                  ? ` See ${args.ruleCite(method === 'xml' ? 'xml_methods' : 'spatial')}.`
                  : ''),
              options: TYPED_INDEX_OPTIONS,
            });
          }
          if (option === 'skip') {
            lines.push(
              `-- ${method.toUpperCase()} index ${qn}.${idx.name} NOT emitted per resolved ` +
                `decision '${key}' (option skip).`
            );
            continue;
          }
          methodSuffix = ` USING ${targetMethod}`;
        } else if (!BTREE_INDEX_TYPES.has(method)) {
          throw new Error(
            `index ${qn}.${idx.name} declares unknown access method '${idx.method}' — not in ` +
              `the SQL Server vocabulary (clustered|nonclustered|columnstore|xml|spatial|` +
              `fulltext|heap). Fix the constraints_metadata at source and regenerate; the ` +
              `generator never guesses an access method.`
          );
        }
      }
      // --- Filtered index -> partial index (Spec 5.3) ----------------------
      let whereClause = '';
      if (isMssql && predicate !== '') {
        const key = `index_predicate--${qn}--${idx.name}`;
        const resolution = resolutionOf(key);
        const option = optionOf(key);
        const translated = translateCheckExpression(predicate);
        if (translated.kind === 'translated') {
          whereClause = ` WHERE ${translated.expression}`;
        } else if (option === 'provide_predicate' && typeof resolution?.['predicate'] === 'string') {
          whereClause = ` WHERE ${resolution['predicate'] as string}`;
          lines.push(
            `-- Filtered index ${qn}.${idx.name}: predicate supplied by resolved decision ` +
              `'${key}'. Source (verbatim): WHERE ${oneLine(predicate)}`
          );
        } else if (option === 'emit_without_predicate') {
          lines.push(
            `-- Filtered index ${qn}.${idx.name}: emitted WITHOUT its predicate per resolved ` +
              `decision '${key}' — the index now covers EVERY row, so it is larger and, if ` +
              `UNIQUE, enforces uniqueness over rows the source excluded. Source (verbatim): ` +
              `WHERE ${oneLine(predicate)}`
          );
        } else if (option === 'drop_index') {
          lines.push(
            `-- Filtered index ${qn}.${idx.name} DROPPED per resolved decision '${key}'. ` +
              `Source (verbatim): WHERE ${oneLine(predicate)}`
          );
          continue;
        } else {
          decisions.push({
            decisionKey: key,
            objectRef: `${qn}.${idx.name}`,
            category: 'index_predicate',
            question:
              `Filtered index ${qn}.${idx.name} carries the predicate ` +
              `\`${oneLine(predicate)}\`, which the deterministic expression translator refuses ` +
              `(${translated.reason}). PostgreSQL partial indexes exist, so the index CAN be ` +
              `reproduced — it just needs a portable predicate. Choose provide_predicate ` +
              `(resolution_json.predicate = the PostgreSQL boolean expression — RECOMMENDED, it ` +
              `preserves coverage and, for a UNIQUE index, the exact uniqueness scope), ` +
              `emit_without_predicate (the index covers EVERY row — a UNIQUE index would then ` +
              `enforce uniqueness the source did not), or drop_index.`,
            options: INDEX_PREDICATE_OPTIONS,
          });
          lines.push(
            `-- NEEDS DECISION (index_predicate): filtered index ${qn}.${idx.name} NOT emitted ` +
              `— its predicate is not portable (${translated.reason}). Resolve '${key}' and ` +
              `regenerate; the generator never drops a predicate silently. Source (verbatim): ` +
              `CREATE ${idx.isUnique ? 'UNIQUE ' : ''}INDEX ${idx.name} ON ${qn} ` +
              `(${idx.columns.join(', ')}) WHERE ${oneLine(predicate)}`
          );
          continue;
        }
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
      // Non-key covering columns: PostgreSQL has had INCLUDE since 11, so a
      // SQL Server covering index reproduces exactly (Spec 5.3).
      const includeColumns = (idx.includeColumns ?? []).filter(
        (c) => typeof c === 'string' && c.length > 0
      );
      const includeClause =
        includeColumns.length > 0 ? ` INCLUDE (${includeColumns.map(quoteIdent).join(', ')})` : '';
      let sql =
        `CREATE ${idx.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(emittedName)} ON ${qq}` +
        `${methodSuffix} (${cols})${includeClause}${whereClause};`;
      if (whereClause !== '') {
        sql +=
          `\n-- PARTIAL index: the source filtered index's predicate is reproduced verbatim` +
          ` as a PostgreSQL partial-index WHERE clause, so coverage (and, for a UNIQUE index,` +
          ` the uniqueness SCOPE) is preserved exactly.`;
      }
      if (idx.isDisabled === true) {
        sql +=
          `\n-- NOTE: source index ${idx.name} is DISABLED — it enforces and serves nothing at` +
          ` source. It is emitted here because dropping it would silently lose a declared` +
          ` structure; drop it deliberately on the target if it is genuinely dead.`;
        notes.push(`${qn}.${idx.name}: DISABLED at source; emitted as an enabled target index.`);
      }
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
  return { content: lines.join('\n') + '\n', clusterNotes, decisions, notes };
}

export function emitSchemasChangeset(
  schemas: string[],
  prologue?: {
    /**
     * Target extensions the pack's chosen mappings REQUIRE (citext / ltree /
     * postgis / pg_cron). Emitted as `CREATE EXTENSION IF NOT EXISTS` so the
     * apply FAILS loudly and namedly when the target role cannot install one
     * — a silently-absent extension would fail later, on a column definition,
     * with a far less useful message (Spec 5.4/5.5).
     */
    extensions?: string[];
    /** Extra prologue statements (the ICU collation for the ICU posture). */
    statements?: string[];
    /** Loud comment lines emitted above the statements. */
    notes?: string[];
    /**
     * Statements emitted AFTER the `CREATE SCHEMA` lines — native standalone
     * sequences, which must exist before any DDL that references them but
     * cannot be created before their schema (Spec 5.3).
     */
    trailingStatements?: string[];
  },
): string {
  const lines: string[] = [];
  lines.push(formattedSqlHeader(SCHEMAS_CHANGESET_PATH).trimEnd());
  lines.push(changesetHeader('schemas', 'structural').trimEnd().replace(/^\n/, ''));
  for (const n of prologue?.notes ?? []) lines.push(`-- ${n}`);
  for (const ext of [...new Set(prologue?.extensions ?? [])].sort()) {
    lines.push(
      `-- PREREQUISITE: the '${ext}' extension is REQUIRED by this pack's type mappings.`
    );
    lines.push(`CREATE EXTENSION IF NOT EXISTS ${quoteIdent(ext)};`);
  }
  for (const s of prologue?.statements ?? []) lines.push(s);
  for (const s of [...schemas].sort()) {
    lines.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(s)};`);
  }
  for (const s of prologue?.trailingStatements ?? []) lines.push(s);
  return lines.join('\n') + '\n';
}

/**
 * A NATIVE standalone sequence — one the source declares in its own right
 * rather than behind an identity column (Spec 5.3, "sequences with full
 * detail"). Every generation parameter the catalog reported is reproduced;
 * an unreported one is simply omitted so PostgreSQL applies its own default
 * rather than the generator inventing a bound.
 */
export function emitStandaloneSequenceDdl(sequence: {
  schemaName: string;
  sequenceName: string;
  dataType?: string | null;
  startValue?: string | null;
  increment?: string | null;
  minValue?: string | null;
  maxValue?: string | null;
  cycle?: boolean;
}): string {
  const parts = [
    `CREATE SEQUENCE IF NOT EXISTS ${quotedQualifiedName(sequence.schemaName, sequence.sequenceName)}`,
  ];
  const dataType = (sequence.dataType ?? '').trim();
  // Only the exact integer families PostgreSQL accepts for a sequence; any
  // other spelling (numeric(18,0), a decimal sequence) falls back to the
  // default bigint rather than emitting DDL the target would reject.
  if (['smallint', 'int', 'integer', 'bigint'].includes(dataType.toLowerCase())) {
    parts.push(`AS ${dataType.toLowerCase() === 'int' ? 'integer' : dataType.toLowerCase()}`);
  }
  if (sequence.increment) parts.push(`INCREMENT BY ${sequence.increment}`);
  if (sequence.minValue) parts.push(`MINVALUE ${sequence.minValue}`);
  if (sequence.maxValue) parts.push(`MAXVALUE ${sequence.maxValue}`);
  if (sequence.startValue) parts.push(`START WITH ${sequence.startValue}`);
  parts.push(sequence.cycle === true ? 'CYCLE' : 'NO CYCLE');
  return `${parts.join(' ')};`;
}

// ---------------------------------------------------------------------------
// Referential actions
// ---------------------------------------------------------------------------

/**
 * The referential actions PostgreSQL accepts. Source engines spell them with
 * either a space or an underscore (`SET_NULL` on the SQL Server catalog,
 * `SET NULL` through INFORMATION_SCHEMA); both normalise to the portable
 * spelling. Anything outside the set is DROPPED with a note rather than
 * shipped as DDL PostgreSQL would reject at apply time.
 */
const PORTABLE_REFERENTIAL_ACTIONS = new Set([
  'NO ACTION',
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
]);

export function normalizeReferentialAction(
  raw: string | null | undefined
): { action: string | null; droppedNote: string | null } {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') return { action: null, droppedNote: null };
  const normalised = trimmed.replace(/_/g, ' ').replace(/\s+/g, ' ').toUpperCase();
  if (PORTABLE_REFERENTIAL_ACTIONS.has(normalised)) {
    return { action: normalised, droppedNote: null };
  }
  return {
    action: null,
    droppedNote:
      `dropped non-portable referential action '${trimmed}' — PostgreSQL accepts only ` +
      `${[...PORTABLE_REFERENTIAL_ACTIONS].sort().join(' | ')}`,
  };
}

// ---------------------------------------------------------------------------
// Item-5 emulations: temporal tables + full-text indexes (Spec 5.5)
// ---------------------------------------------------------------------------

/** The shared versioning trigger functions the temporal emulation installs. */
export const TEMPORAL_VERSIONING_FUNCTION = 'haikai_temporal_versioning';
export const TEMPORAL_ROW_START_FUNCTION = 'haikai_temporal_row_start';

/** One system-versioned table the pack emulates with a history table + triggers. */
export interface TemporalEmulation {
  schemaName: string;
  tableName: string;
  /** The history table (the SOURCE one when the pair's history half migrated). */
  historySchema: string;
  historyTable: string;
  /** TRUE when the history table is an ordinary migrated table (no CREATE here). */
  historyTableMigrated: boolean;
  /** Period columns — the SOURCE names when the scan reported them. */
  periodStartColumn: string;
  periodEndColumn: string;
  /** Column definitions for a history table the pack must CREATE itself. */
  historyColumns: EmittableColumn[];
  /** The decision this emulation honours (for the provenance comment). */
  decisionKey: string;
}

/** One full-text index the pack emulates with a generated tsvector + GIN. */
export interface FullTextEmulation {
  schemaName: string;
  tableName: string;
  indexName: string;
  /** The generated tsvector column the emulation adds. */
  tsvColumn: string;
  /** Source indexed columns (text-typed on the target). */
  columns: string[];
  /** PostgreSQL text-search configuration (default `english`). */
  textSearchConfig: string;
  decisionKey: string;
}

/**
 * The consolidated item-5 emulations changeset. STRUCTURAL context: the
 * history tables and generated columns must exist before the bulk load, and
 * the versioning triggers must exist before the first incremental run.
 *
 * The emulation is built from the pair ruleset's own convention text
 * (MSPG.TEMPORAL.001 / MSPG.FULLTEXT.001 — cited by `ruleCite`, never by a
 * hardcoded rule id here), so the DDL and the rewrite guidance the
 * translation prompts carry cannot drift apart.
 */
export function emitEmulationsChangeset(args: {
  temporal: TemporalEmulation[];
  fullText: FullTextEmulation[];
  ruleCite?: (divergenceClass: string) => string | null;
}): string {
  const lines: string[] = [];
  lines.push(formattedSqlHeader(EMULATIONS_CHANGESET_PATH).trimEnd());
  lines.push(changesetHeader('emulations', 'structural').trimEnd().replace(/^\n/, ''));
  lines.push(
    '-- Source object shapes with NO like-for-like PostgreSQL form, EMULATED by the pack.'
  );
  lines.push(
    '-- Each emulation honours a pack decision (named per statement below); nothing here is'
  );
  lines.push('-- manual residue and nothing here is silent.');

  const temporal = [...args.temporal].sort((a, b) =>
    qualifiedName(a.schemaName, a.tableName).localeCompare(qualifiedName(b.schemaName, b.tableName))
  );
  const fullText = [...args.fullText].sort(
    (a, b) =>
      qualifiedName(a.schemaName, a.tableName).localeCompare(
        qualifiedName(b.schemaName, b.tableName)
      ) || a.indexName.localeCompare(b.indexName)
  );

  if (temporal.length > 0) {
    const cite = args.ruleCite?.('temporal_table');
    lines.push('');
    lines.push(
      `-- ===== System-versioned (temporal) tables${cite ? ` — ${cite}` : ''} =====`
    );
    lines.push(
      '-- The source engine maintains SYSTEM_VERSIONING itself. PostgreSQL has no such clause,'
    );
    lines.push(
      '-- so versioning is reproduced by two triggers over an ordinary history table:'
    );
    lines.push(
      `--   ${TEMPORAL_ROW_START_FUNCTION}()  BEFORE INSERT OR UPDATE — stamps the period columns`
    );
    lines.push(
      `--   ${TEMPORAL_VERSIONING_FUNCTION}() AFTER  UPDATE OR DELETE — copies the OLD row to history`
    );
    lines.push(
      '-- Both are generic (the table, history table and period columns arrive as trigger'
    );
    lines.push(
      '-- arguments), so one pair of functions serves every versioned table in the pack.'
    );
    lines.push('');
    lines.push(
      `CREATE OR REPLACE FUNCTION ${quoteIdent(TEMPORAL_ROW_START_FUNCTION)}() RETURNS trigger LANGUAGE plpgsql AS $haikai$`
    );
    lines.push('DECLARE');
    lines.push('  v_start text := TG_ARGV[0];');
    lines.push('  v_end   text := TG_ARGV[1];');
    lines.push('BEGIN');
    lines.push('  -- A row that is CURRENT runs from now until the end of time, exactly like');
    lines.push('  -- GENERATED ALWAYS AS ROW START / ROW END on the source.');
    lines.push('  NEW := jsonb_populate_record(');
    lines.push('    NEW,');
    lines.push('    jsonb_build_object(');
    lines.push("      v_start, to_jsonb(clock_timestamp()),");
    lines.push("      v_end,   to_jsonb('infinity'::timestamptz)");
    lines.push('    )');
    lines.push('  );');
    lines.push('  RETURN NEW;');
    lines.push('END;');
    lines.push('$haikai$;');
    lines.push('');
    lines.push(
      `CREATE OR REPLACE FUNCTION ${quoteIdent(TEMPORAL_VERSIONING_FUNCTION)}() RETURNS trigger LANGUAGE plpgsql AS $haikai$`
    );
    lines.push('DECLARE');
    lines.push('  v_history text := TG_ARGV[0];');
    lines.push('  v_end     text := TG_ARGV[1];');
    lines.push('BEGIN');
    lines.push('  -- The superseded version is closed at clock_timestamp() and archived. The');
    lines.push('  -- jsonb round-trip makes this generic over ANY table shape: the history');
    lines.push('  -- table carries the same columns as its base table.');
    lines.push('  EXECUTE format(');
    lines.push("    'INSERT INTO %s SELECT (jsonb_populate_record(NULL::%s, $1)).*',");
    lines.push('    v_history, v_history');
    lines.push('  )');
    lines.push('  USING to_jsonb(OLD) || jsonb_build_object(v_end, to_jsonb(clock_timestamp()));');
    lines.push('  RETURN NULL;');
    lines.push('END;');
    lines.push('$haikai$;');
    for (const t of temporal) {
      const qn = qualifiedName(t.schemaName, t.tableName);
      const qq = quotedQualifiedName(t.schemaName, t.tableName);
      const hq = quotedQualifiedName(t.historySchema, t.historyTable);
      lines.push('');
      lines.push(
        `-- ${qn}: SYSTEM_VERSIONED at source; emulated per resolved decision '${t.decisionKey}'.`
      );
      if (!t.historyTableMigrated) {
        lines.push(
          `-- The source history table was not part of the migrated model, so the pack CREATES ` +
            `one with the base table's column shape plus the period columns.`
        );
        lines.push(`CREATE TABLE ${hq} (`);
        const defs = t.historyColumns.map(
          (c) => `    ${quoteIdent(c.columnName)} ${c.postgresType}`
        );
        lines.push(defs.join(',\n'));
        lines.push(');');
      } else {
        lines.push(
          `-- History rows land in ${qualifiedName(t.historySchema, t.historyTable)}, the source ` +
            `history table, which migrates as an ordinary table (its rows are loaded, never ` +
            `re-derived).`
        );
      }
      lines.push(
        `CREATE INDEX ${quoteIdent(clampIdent(`${t.historyTable}_period_idx`))} ON ${hq} ` +
          `(${quoteIdent(t.periodEndColumn)}, ${quoteIdent(t.periodStartColumn)});`
      );
      lines.push(
        `CREATE TRIGGER ${quoteIdent(clampIdent(`${t.tableName}_row_start`))} ` +
          `BEFORE INSERT OR UPDATE ON ${qq} FOR EACH ROW EXECUTE FUNCTION ` +
          `${quoteIdent(TEMPORAL_ROW_START_FUNCTION)}(` +
          `${sqlLiteral(t.periodStartColumn)}, ${sqlLiteral(t.periodEndColumn)});`
      );
      lines.push(
        `CREATE TRIGGER ${quoteIdent(clampIdent(`${t.tableName}_versioning`))} ` +
          `AFTER UPDATE OR DELETE ON ${qq} FOR EACH ROW EXECUTE FUNCTION ` +
          `${quoteIdent(TEMPORAL_VERSIONING_FUNCTION)}(` +
          `${sqlLiteral(`${t.historySchema}.${t.historyTable}`)}, ` +
          `${sqlLiteral(t.periodEndColumn)});`
      );
      lines.push(
        `-- FOR SYSTEM_TIME rewrite for ${qn}: AS OF <t> becomes ` +
          `SELECT ... FROM ${qn} WHERE ${t.periodStartColumn} <= <t> AND ${t.periodEndColumn} > <t> ` +
          `UNION ALL SELECT ... FROM ${qualifiedName(t.historySchema, t.historyTable)} WHERE ` +
          `${t.periodStartColumn} <= <t> AND ${t.periodEndColumn} > <t>; ALL becomes the base ` +
          `UNION ALL the history table.` +
          (args.ruleCite?.('temporal_table') ? ` See ${args.ruleCite('temporal_table')}.` : '')
      );
    }
  }

  if (fullText.length > 0) {
    const cite = args.ruleCite?.('fulltext');
    lines.push('');
    lines.push(`-- ===== Full-text indexes${cite ? ` — ${cite}` : ''} =====`);
    lines.push(
      '-- A generated tsvector column + GIN index reproduces the access shape; CONTAINS /'
    );
    lines.push(
      '-- FREETEXT predicates become @@ to_tsquery / plainto_tsquery. Ranking and stemming'
    );
    lines.push('-- differ between the engines, so result ORDER is advisory, never a parity failure.');
    for (const f of fullText) {
      const qn = qualifiedName(f.schemaName, f.tableName);
      const qq = quotedQualifiedName(f.schemaName, f.tableName);
      const expression = f.columns
        .map((c) => `coalesce(${quoteIdent(c)}, '')`)
        .join(" || ' ' || ");
      lines.push('');
      lines.push(
        `-- ${qn}.${f.indexName}: FULL-TEXT at source; emulated per resolved decision ` +
          `'${f.decisionKey}' over ${f.columns.join(', ')}.`
      );
      lines.push(
        `ALTER TABLE ${qq} ADD COLUMN ${quoteIdent(f.tsvColumn)} tsvector ` +
          `GENERATED ALWAYS AS (to_tsvector(${sqlLiteral(f.textSearchConfig)}, ${expression})) STORED;`
      );
      lines.push(
        `CREATE INDEX ${quoteIdent(clampIdent(`${f.indexName}_gin`))} ON ${qq} ` +
          `USING gin (${quoteIdent(f.tsvColumn)});`
      );
      lines.push(
        `-- Rewrite: CONTAINS(<col>, 'a AND b') becomes ${f.tsvColumn} @@ to_tsquery(` +
          `${sqlLiteral(f.textSearchConfig)}, 'a & b'); FREETEXT becomes plainto_tsquery / ` +
          `websearch_to_tsquery; CONTAINSTABLE/FREETEXTTABLE rank becomes ts_rank.`
      );
    }
  }

  return lines.join('\n') + '\n';
}

/** Single-quoted SQL string literal (doubling embedded quotes). */
function sqlLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
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
