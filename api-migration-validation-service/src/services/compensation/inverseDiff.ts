/**
 * Row-level diff + inverse-statement generation (Capture-State Discipline
 * Spec 1).
 *
 * The inverse of what the call did, DERIVED — never authored:
 *   - rows that APPEARED   -> DELETE by PK tuple
 *   - rows that VANISHED   -> INSERT of the full before-image row
 *   - rows that CHANGED    -> UPDATE restoring every non-PK column to the
 *                             before-image value
 *
 * Identity columns: Sybase re-inserts of identity rows are wrapped in
 * `SET IDENTITY_INSERT <t> ON/OFF`; after undoing INSERTs on an identity
 * table a reseed statement pins the next minted id back to the before-image
 * maximum, so a replayed create mints the SAME id the baseline recorded
 * (kills the id-volatility class). Postgres reseeds via
 * `setval(pg_get_serial_sequence(...))`; the Postgres re-insert path is a
 * plain INSERT (serial defaults accept explicit values — a GENERATED ALWAYS
 * identity would reject it, which surfaces loudly as a failed batch, never
 * silently).
 *
 * Cross-table ordering is NOT derived here (FK topology is unknown at capture
 * time): statements are grouped per table in caller order; the runner retries
 * a failed batch once with the table order REVERSED before declaring residue.
 */

import { renderLiteral } from './sqlLiterals';
import { pkKeyOf, valueForColumn } from './tableImage';
import type {
  CompensationEngine,
  CompensationTableMeta,
  TableImage,
  TableRowDiff,
} from './types';

/** Compute the row-level diff between two images of the SAME table. */
export function computeRowDiff(before: TableImage, after: TableImage): TableRowDiff {
  const diff: TableRowDiff = { table: before.table, inserted: [], deleted: [], updated: [] };
  for (const [key, afterRow] of after.rowsByPk) {
    const beforeRow = before.rowsByPk.get(key);
    if (!beforeRow) {
      diff.inserted.push(afterRow);
    } else if (!rowsEqual(beforeRow, afterRow)) {
      diff.updated.push({ pkKey: key, before: beforeRow, after: afterRow });
    }
  }
  for (const [key, beforeRow] of before.rowsByPk) {
    if (!after.rowsByPk.has(key)) diff.deleted.push(beforeRow);
  }
  return diff;
}

export function rowsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) return false;
  }
  return true;
}

export function hasChanges(diff: TableRowDiff): boolean {
  return diff.inserted.length > 0 || diff.deleted.length > 0 || diff.updated.length > 0;
}

function qualify(table: string, schema: string | null | undefined, engine: CompensationEngine): string {
  if (engine === 'mssql') {
    // Bracket quoting is independent of the QUOTED_IDENTIFIER session option.
    const q = (s: string): string => `[${s.replace(/]/g, ']]')}]`;
    return schema ? `${q(schema)}.${q(table)}` : q(table);
  }
  if (!schema) return engine === 'postgres' ? `"${table}"` : table;
  return engine === 'postgres' ? `"${schema}"."${table}"` : `${schema}.${table}`;
}

/** Engines whose identity columns need SET IDENTITY_INSERT around explicit re-inserts. */
function needsIdentityInsertToggle(engine: CompensationEngine): boolean {
  return engine === 'sybase' || engine === 'mssql';
}

function typeOf(meta: CompensationTableMeta, column: string): string | null {
  const lower = column.toLowerCase();
  return meta.columns.find((c) => c.name.toLowerCase() === lower)?.sourceType ?? null;
}

function pkPredicate(
  row: Record<string, unknown>,
  meta: CompensationTableMeta,
  engine: CompensationEngine,
): string {
  return meta.pkColumns
    .map((c) => {
      const value = valueForColumn(row, c);
      if (value === null || value === undefined) return `${c} IS NULL`;
      return `${c} = ${renderLiteral(value, engine, typeOf(meta, c))}`;
    })
    .join(' AND ');
}

export interface InverseStatements {
  /** Ordered inverse DML for ONE table (identity wraps included). */
  statements: string[];
}

export function buildInverseStatements(
  diff: TableRowDiff,
  meta: CompensationTableMeta,
  engine: CompensationEngine,
  schema?: string | null,
): InverseStatements {
  const target = qualify(meta.table, schema ?? null, engine);
  const statements: string[] = [];

  // 1) Undo INSERTs first (typically child rows; frees FK references).
  for (const row of diff.inserted) {
    statements.push(`DELETE FROM ${target} WHERE ${pkPredicate(row, meta, engine)}`);
  }

  // 2) Undo UPDATEs: restore EVERY non-PK column from the before-image (not
  //    just the changed ones — byte-parity is the verification bar anyway).
  const pkLower = new Set(meta.pkColumns.map((c) => c.toLowerCase()));
  for (const change of diff.updated) {
    const sets: string[] = [];
    for (const col of meta.columns) {
      if (pkLower.has(col.name.toLowerCase())) continue;
      const value = valueForColumn(change.before, col.name);
      if (value === undefined) continue;
      sets.push(`${col.name} = ${renderLiteral(value, engine, col.sourceType)}`);
    }
    if (sets.length > 0) {
      statements.push(
        `UPDATE ${target} SET ${sets.join(', ')} WHERE ${pkPredicate(change.before, meta, engine)}`,
      );
    }
  }

  // 3) Undo DELETEs: re-insert full before-image rows, identity-wrapped when
  //    the row set includes identity columns.
  const identityColumns = meta.columns.filter((c) => c.isIdentity).map((c) => c.name);
  const needsIdentityWrap =
    needsIdentityInsertToggle(engine) &&
    identityColumns.length > 0 &&
    diff.deleted.some((row) =>
      identityColumns.some((c) => valueForColumn(row, c) !== undefined),
    );
  if (needsIdentityWrap) statements.push(`SET IDENTITY_INSERT ${target} ON`);
  for (const row of diff.deleted) {
    const cols: string[] = [];
    const values: string[] = [];
    for (const col of meta.columns) {
      const value = valueForColumn(row, col.name);
      if (value === undefined) continue;
      cols.push(col.name);
      values.push(renderLiteral(value, engine, col.sourceType));
    }
    if (cols.length > 0) {
      statements.push(`INSERT INTO ${target} (${cols.join(', ')}) VALUES (${values.join(', ')})`);
    }
  }
  if (needsIdentityWrap) statements.push(`SET IDENTITY_INSERT ${target} OFF`);

  // Identity reseed after undone INSERTs is the RUNNER's job — it holds the
  // full before-image and computes the true surviving maximum via
  // `buildReseedStatements`. No weaker diff-derived fallback exists here by
  // design: two reseed paths with different accuracy would be a trap.
  return { statements };
}

/**
 * Reseed statements for an explicit surviving-max value. Exposed separately so
 * the runner can reseed from the FULL before-image maximum (more accurate than
 * the diff-derived fallback when untouched rows hold the max id).
 */
export function buildReseedStatements(
  meta: CompensationTableMeta,
  identityColumn: string,
  engine: CompensationEngine,
  schema: string | null,
  survivingMax: number,
): string[] {
  const target = qualify(meta.table, schema, engine);
  if (engine === 'sybase') {
    // ASE: identity_burn_max pins the next minted identity to survivingMax+1.
    const bare = schema ? `${schema}.${meta.table}` : meta.table;
    return [`EXEC sp_chgattribute '${bare}', 'identity_burn_max', 0, '${survivingMax}'`];
  }
  if (engine === 'mssql') {
    // SQL Server: DBCC CHECKIDENT RESEED pins the CURRENT identity value, so
    // the next minted identity is survivingMax+1 on a table that has ever
    // held rows (after TRUNCATE the engine itself resets to the seed).
    return [`DBCC CHECKIDENT ('${target}', RESEED, ${survivingMax})`];
  }
  if (survivingMax >= 1) {
    return [
      `SELECT setval(pg_get_serial_sequence('${target.replace(/"/g, '')}', '${identityColumn}'), ${survivingMax}, true)`,
    ];
  }
  return [
    `SELECT setval(pg_get_serial_sequence('${target.replace(/"/g, '')}', '${identityColumn}'), 1, false)`,
  ];
}
