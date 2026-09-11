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
 *
 * SQL Server pair programme, Spec 2 (2026-09-11): the engine-neutral name
 * heuristics (`deriveCandidateParentName`, `buildPkMap`,
 * `nameBasedInferences`) moved VERBATIM to
 * `../relationshipHeuristics.ts` so the SQL Server pack shares them instead
 * of carrying a hand-copied twin. Declared-FK surfacing stays here -- the
 * catalog quirk it compensates for is Sybase's.
 */

import type {
  IntrospectionResult,
  KeyOrIndexMetadata,
  RelationshipInference,
} from '../types';
import { buildPkMap, nameBasedInferences } from '../relationshipHeuristics';

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
