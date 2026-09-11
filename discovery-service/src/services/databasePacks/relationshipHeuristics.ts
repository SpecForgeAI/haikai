/**
 * Shared, engine-neutral relationship-inference heuristics.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4 (the heuristics
 * were written once for Sybase and copied in spirit by Postgres). Extracted
 * verbatim by the SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2
 * (2026-09-11), so the Sybase and SQL Server packs share ONE implementation
 * rather than a second hand-copied one.
 *
 * NOTHING in this module names an engine or knows an engine catalog: it works
 * purely off the engine-neutral {@link ColumnMetadata} /
 * {@link KeyOrIndexMetadata} IR. The per-engine packs keep ownership of the
 * DECLARED foreign keys (the catalog names and their quirks differ) and call
 * in here only for the name-based inference layer.
 *
 * BEHAVIOUR IS UNCHANGED from the pre-extraction Sybase implementation --
 * `sybaseDiscoveryPack.test.ts`'s inference expectations are the regression
 * gate.
 */

import type {
  ColumnMetadata,
  KeyOrIndexMetadata,
  RelationshipInference,
} from './types';

/** A primary-key tuple, keyed by `schema.table`. */
export interface PkTarget {
  schemaName: string;
  tableName: string;
  columns: string[];
}

/**
 * Derive the candidate PARENT entity name a foreign-key-looking column points
 * at. Recognised shapes (in priority order):
 *
 *   - `fk_<entity>`   -- an explicit fk-prefixed column
 *   - `<entity>_id`   -- the snake_case convention
 *   - `<entity>Id`    -- the camelCase convention (only when the character
 *                        before `Id` is lower-case, so `ID` / `UUID` do not
 *                        match)
 *
 * Returns the lower-cased entity name, or null when the column name does not
 * look like a foreign key at all.
 */
export function deriveCandidateParentName(columnName: string): string | null {
  let m = columnName.match(/^fk_(.+)$/i);
  if (m) return m[1].toLowerCase();
  m = columnName.match(/^(.+)_id$/i);
  if (m) return m[1].toLowerCase();
  m = columnName.match(/^(.+?)Id$/);
  if (m && /[a-z]Id$/.test(columnName)) return m[1].toLowerCase();
  return null;
}

/**
 * Index the primary keys in the introspection by `schema.table`. Used both to
 * fill in a declared FK whose referenced columns the catalog omitted, and as
 * the target set for the name heuristic.
 */
export function buildPkMap(
  keys: KeyOrIndexMetadata[],
): Map<string, PkTarget> {
  const out = new Map<string, PkTarget>();
  for (const k of keys) {
    if (k.kind !== 'primary_key') continue;
    out.set(`${k.schemaName}.${k.tableName}`, {
      schemaName: k.schemaName,
      tableName: k.tableName,
      columns: k.columns,
    });
  }
  return out;
}

/**
 * Name-based relationship inference. For every column that looks like a
 * foreign key and has no DECLARED FK already covering it, find the PK table
 * whose name matches (singular / plural variants included):
 *
 *   - exactly one match  -> an `inferred` relationship (confidence 0.8 when
 *     the column name matches the target table verbatim, else 0.6)
 *   - more than one      -> an `ambiguous` relationship (confidence 0.4)
 *     carrying every competing target so a human can disambiguate
 *   - no match           -> nothing emitted
 *
 * Self-references (the matched PK table IS the column's own table) are
 * skipped: a `parent_id` on `categories` is a hierarchy, not a discovery.
 */
export function nameBasedInferences(
  columns: ColumnMetadata[],
  pkMap: Map<string, PkTarget>,
  declared: RelationshipInference[],
): RelationshipInference[] {
  const declaredFromKey = new Set<string>();
  for (const r of declared) {
    declaredFromKey.add(
      `${r.fromSchema}.${r.fromTable}.${r.fromColumns.join(',')}`,
    );
  }

  const targetsByName = new Map<string, PkTarget[]>();
  for (const pk of pkMap.values()) {
    const base = pk.tableName.toLowerCase();
    const variants = new Set<string>([
      base,
      base.endsWith('ies')
        ? `${base.slice(0, -3)}y`
        : base.endsWith('es')
        ? base.slice(0, -2)
        : base.endsWith('s')
        ? base.slice(0, -1)
        : '',
    ]);
    variants.delete('');
    for (const v of variants) {
      let bucket = targetsByName.get(v);
      if (!bucket) {
        bucket = [];
        targetsByName.set(v, bucket);
      }
      bucket.push(pk);
    }
  }

  const out: RelationshipInference[] = [];
  for (const col of columns) {
    const parentName = deriveCandidateParentName(col.columnName);
    if (!parentName) continue;
    const dedupeKey = `${col.schemaName}.${col.tableName}.${col.columnName}`;
    if (declaredFromKey.has(dedupeKey)) continue;
    const targets = targetsByName.get(parentName);
    if (!targets || targets.length === 0) continue;
    if (targets.length === 1) {
      const t = targets[0];
      if (t.schemaName === col.schemaName && t.tableName === col.tableName) {
        continue;
      }
      const exact =
        col.columnName.toLowerCase() === `${t.tableName.toLowerCase()}_id` ||
        col.columnName.toLowerCase() === `${t.tableName.toLowerCase()}id` ||
        col.columnName === `${t.tableName}Id`;
      out.push({
        fromSchema: col.schemaName,
        fromTable: col.tableName,
        fromColumns: [col.columnName],
        toSchema: t.schemaName,
        toTable: t.tableName,
        toColumns: t.columns,
        kind: 'inferred',
        confidence: exact ? 0.8 : 0.6,
        rationale:
          `Column '${col.columnName}' matches PK table ` +
          `'${t.schemaName}.${t.tableName}' via naming heuristic; ` +
          `no declared FK exists.`,
      });
    } else {
      out.push({
        fromSchema: col.schemaName,
        fromTable: col.tableName,
        fromColumns: [col.columnName],
        toSchema: targets[0].schemaName,
        toTable: targets[0].tableName,
        toColumns: targets[0].columns,
        kind: 'ambiguous',
        confidence: 0.4,
        rationale:
          `Column '${col.columnName}' matches multiple PK tables: ` +
          targets.map((t) => `${t.schemaName}.${t.tableName}`).join(', '),
        competingTargets: targets.map((t) => ({
          schemaName: t.schemaName,
          tableName: t.tableName,
        })),
      });
    }
  }
  return out;
}
