/**
 * PostgreSQL relationship inference.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3.
 *
 * Inputs:
 *   - declared keys/indexes (from introspection)
 *   - column list (from introspection)
 *   - profile result (for value-overlap sampling in deep mode -- not used
 *     in v1 inference because the row caps make it unreliable for cross-
 *     table samples; the spec D8 deep mode says "value-overlap sampling for
 *     relationship inference" but the v1 pack restricts overlap-sampling to
 *     future spec work)
 *
 * Output:
 *   - One `RelationshipInference` per declared FK (kind='declared_fk',
 *     confidence=1.0).
 *   - For columns without a declared FK that look like FK columns
 *     (`<entity>_id`, `<entity>Id`, `fk_<entity>`): emit `inferred` with
 *     confidence in [0.5, 0.8] depending on match strength.
 *   - For columns with two or more plausible parent matches: emit
 *     `ambiguous` carrying the competing target list.
 */

import type {
  ColumnMetadata,
  IntrospectionResult,
  KeyOrIndexMetadata,
  RelationshipInference,
} from '../types';

/**
 * Strip a trailing `_id` / `Id` / `_ID` / leading `fk_` from a column name
 * to produce a candidate parent-entity name. Returns null when the column
 * does not look like an FK column.
 */
function deriveCandidateParentName(columnName: string): string | null {
  // fk_<entity>
  let m = columnName.match(/^fk_(.+)$/i);
  if (m) return m[1].toLowerCase();
  // <entity>_id  (case-insensitive)
  m = columnName.match(/^(.+)_id$/i);
  if (m) return m[1].toLowerCase();
  // <entity>Id  (camelCase: capital I before d)
  m = columnName.match(/^(.+?)Id$/);
  if (m && /[a-z]Id$/.test(columnName)) return m[1].toLowerCase();
  return null;
}

/**
 * Build a lookup of PK columns per table: schema.table -> column[].
 */
function buildPkMap(
  keys: KeyOrIndexMetadata[],
): Map<string, { schemaName: string; tableName: string; columns: string[] }> {
  const out = new Map<
    string,
    { schemaName: string; tableName: string; columns: string[] }
  >();
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
 * Compute declared FK relationships from the keys/indexes metadata.
 * Each FK constraint produces ONE relationship (multi-column FKs collapse
 * onto one inference with the column list intact).
 */
function declaredForeignKeys(
  keys: KeyOrIndexMetadata[],
): RelationshipInference[] {
  const out: RelationshipInference[] = [];
  for (const k of keys) {
    if (k.kind !== 'foreign_key') continue;
    if (
      !k.referencedSchema ||
      !k.referencedTable ||
      !k.referencedColumns ||
      k.referencedColumns.length === 0
    ) {
      continue;
    }
    out.push({
      fromSchema: k.schemaName,
      fromTable: k.tableName,
      fromColumns: k.columns,
      toSchema: k.referencedSchema,
      toTable: k.referencedTable,
      toColumns: k.referencedColumns,
      kind: 'declared_fk',
      confidence: 1.0,
      rationale: `Declared foreign key constraint '${k.name}'`,
      // Oracle-W3: carry the verbatim referential actions through to the
      // relationship candidate's fk_columns JSONB.
      onDelete: k.onDelete ?? null,
      onUpdate: k.onUpdate ?? null,
    });
  }
  return out;
}

/**
 * Compute name-based inferences for columns that look like FKs but lack a
 * declared constraint. Emits `inferred` (single plausible match) or
 * `ambiguous` (multiple plausible matches).
 */
function nameBasedInferences(
  columns: ColumnMetadata[],
  pkMap: Map<string, { schemaName: string; tableName: string; columns: string[] }>,
  declared: RelationshipInference[],
): RelationshipInference[] {
  // Build "columns covered by a declared FK" set so we don't re-infer.
  const declaredFromKey = new Set<string>();
  for (const r of declared) {
    declaredFromKey.add(
      `${r.fromSchema}.${r.fromTable}.${r.fromColumns.join(',')}`,
    );
  }

  // Build lookup: parent-entity-name -> list of (schema, table) targets that
  // have that name (singular or plural). Use lowercase comparison throughout.
  const targetsByName = new Map<
    string,
    Array<{ schemaName: string; tableName: string; columns: string[] }>
  >();
  for (const pk of pkMap.values()) {
    const base = pk.tableName.toLowerCase();
    const variants = new Set<string>([
      base,
      // strip trailing 's' / 'es'
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
    const key = `${col.schemaName}.${col.tableName}.${col.columnName}`;
    if (declaredFromKey.has(key)) continue;
    const targets = targetsByName.get(parentName);
    if (!targets || targets.length === 0) continue;
    if (targets.length === 1) {
      const t = targets[0];
      // Don't self-reference.
      if (t.schemaName === col.schemaName && t.tableName === col.tableName) {
        continue;
      }
      // Confidence: 0.8 if column name exactly matches `<table>_id`/`<table>Id`,
      // otherwise 0.6.
      const exactMatch =
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
        confidence: exactMatch ? 0.8 : 0.6,
        rationale:
          `Column '${col.columnName}' name matches PK table '${t.schemaName}.${t.tableName}' ` +
          `via naming heuristic; no declared FK exists.`,
      });
    } else {
      // Multiple plausible parents -- ambiguous.
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
          `Column '${col.columnName}' matches PK tables: ` +
          targets
            .map((t) => `${t.schemaName}.${t.tableName}`)
            .join(', ') +
          `. Cannot resolve ambiguity from naming alone.`,
        competingTargets: targets.map((t) => ({
          schemaName: t.schemaName,
          tableName: t.tableName,
        })),
      });
    }
  }
  return out;
}

/**
 * Combine declared + inferred + ambiguous relationships.
 */
export function inferPostgresRelationships(
  introspection: IntrospectionResult,
): RelationshipInference[] {
  const declared = declaredForeignKeys(introspection.keysAndIndexes);
  const pkMap = buildPkMap(introspection.keysAndIndexes);
  const inferred = nameBasedInferences(introspection.columns, pkMap, declared);
  return [...declared, ...inferred];
}
