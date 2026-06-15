/**
 * Sybase relationship inference.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4.
 *
 * Same logic surface as the Postgres pack -- declared FKs (from
 * {@code sysreferences}) + name-based heuristic inference (column patterns
 * {@code <entity>_id}, {@code <entity>Id}, {@code fk_<entity>}). The
 * heuristic surface deliberately mirrors the Postgres pack so cross-engine
 * test fixtures share the same expectations.
 *
 * Sybase-specific note: {@code sysreferences} occasionally exposes FKs
 * without populated {@code referencedColumns} for older ASE versions; in
 * those cases the declared FK is still surfaced but the column list is
 * empty. The PK lookup uses the referenced table's primary key columns to
 * fill in the gap.
 */

import type {
  ColumnMetadata,
  IntrospectionResult,
  KeyOrIndexMetadata,
  RelationshipInference,
} from '../types';

function deriveCandidateParentName(columnName: string): string | null {
  let m = columnName.match(/^fk_(.+)$/i);
  if (m) return m[1].toLowerCase();
  m = columnName.match(/^(.+)_id$/i);
  if (m) return m[1].toLowerCase();
  m = columnName.match(/^(.+?)Id$/);
  if (m && /[a-z]Id$/.test(columnName)) return m[1].toLowerCase();
  return null;
}

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
 * Surface declared FKs from the introspection metadata. If the referenced
 * columns list is empty (Sybase older-version gap), fall back to the
 * referenced table's PK columns when available.
 */
function declaredForeignKeys(
  keys: KeyOrIndexMetadata[],
): RelationshipInference[] {
  const pkByTable = buildPkMap(keys);
  const out: RelationshipInference[] = [];
  for (const k of keys) {
    if (k.kind !== 'foreign_key') continue;
    if (!k.referencedSchema || !k.referencedTable) continue;
    let referencedColumns = k.referencedColumns ?? [];
    if (referencedColumns.length === 0) {
      const pk = pkByTable.get(`${k.referencedSchema}.${k.referencedTable}`);
      if (pk) referencedColumns = pk.columns;
    }
    out.push({
      fromSchema: k.schemaName,
      fromTable: k.tableName,
      fromColumns: k.columns,
      toSchema: k.referencedSchema,
      toTable: k.referencedTable,
      toColumns: referencedColumns,
      kind: 'declared_fk',
      confidence: 1.0,
      rationale: `Declared foreign key '${k.name}' (Sybase sysreferences).`,
      // Oracle-W3: carry referential actions where the sidecar surfaced them
      // (null today -- see sybaseIntrospection TODO).
      onDelete: k.onDelete ?? null,
      onUpdate: k.onUpdate ?? null,
    });
  }
  return out;
}

function nameBasedInferences(
  columns: ColumnMetadata[],
  pkMap: Map<
    string,
    { schemaName: string; tableName: string; columns: string[] }
  >,
  declared: RelationshipInference[],
): RelationshipInference[] {
  const declaredFromKey = new Set<string>();
  for (const r of declared) {
    declaredFromKey.add(
      `${r.fromSchema}.${r.fromTable}.${r.fromColumns.join(',')}`,
    );
  }

  const targetsByName = new Map<
    string,
    Array<{ schemaName: string; tableName: string; columns: string[] }>
  >();
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
          targets
            .map((t) => `${t.schemaName}.${t.tableName}`)
            .join(', '),
        competingTargets: targets.map((t) => ({
          schemaName: t.schemaName,
          tableName: t.tableName,
        })),
      });
    }
  }
  return out;
}

export function inferSybaseRelationships(
  introspection: IntrospectionResult,
): RelationshipInference[] {
  const declared = declaredForeignKeys(introspection.keysAndIndexes);
  const pkMap = buildPkMap(introspection.keysAndIndexes);
  const inferred = nameBasedInferences(
    introspection.columns,
    pkMap,
    declared,
  );
  return [...declared, ...inferred];
}
