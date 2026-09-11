/**
 * SQL Server relationship inference.
 *
 * Spec: SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11),
 * task 2.1.
 *
 * Same two-layer surface as the Sybase and Postgres packs -- DECLARED foreign
 * keys from the catalog, plus the shared name-based heuristic inference
 * (`../relationshipHeuristics.ts`, used verbatim by both T-SQL packs so the
 * cross-engine fixtures share one set of expectations).
 *
 * SQL-Server-specific note, and the reason this file is not simply the Sybase
 * one: `sys.foreign_key_columns` ALWAYS resolves both sides of a foreign key
 * (`referenced_object_id` + `referenced_column_id` are non-nullable), so a
 * declared FK arrives with its `referencedColumns` POPULATED. The ASE path
 * needs a PK-lookup fallback for older catalogs that omit them; here that
 * fallback is a belt-and-braces safety net that should never fire, and when
 * it does it is stated in the rationale so the evidence is honest about where
 * the columns came from.
 *
 * Two further facts SQL Server reports that ASE does not, both carried onto
 * the relationship so downstream consumers see them:
 *   - referential ACTIONS (`ON DELETE` / `ON UPDATE`) are always present.
 *   - NOT TRUSTED foreign keys (a constraint created or re-enabled WITH
 *     NOCHECK) are real on SQL Server: the constraint exists but the engine
 *     has not verified the existing rows, so the target's equivalent FK can
 *     FAIL to create. That is stated in the rationale.
 */

import type {
  IntrospectionResult,
  KeyOrIndexMetadata,
  RelationshipInference,
} from '../types';
import { buildPkMap, nameBasedInferences } from '../relationshipHeuristics';
import type { MssqlIndexExtras } from './mssqlIntrospection';

/**
 * Surface declared FKs from the introspection metadata. The referenced
 * columns come straight off the wire; the PK fallback only runs in the
 * should-never-happen case and says so in the rationale.
 */
function declaredForeignKeys(
  keys: KeyOrIndexMetadata[],
  indexExtras: MssqlIndexExtras[],
): RelationshipInference[] {
  const pkByTable = buildPkMap(keys);
  const notTrusted = new Set<string>();
  for (const x of indexExtras) {
    if (x.isNotTrusted) {
      notTrusted.add(`${x.schemaName}.${x.tableName}.${x.name}`);
    }
  }
  const out: RelationshipInference[] = [];
  for (const k of keys) {
    if (k.kind !== 'foreign_key') continue;
    if (!k.referencedSchema || !k.referencedTable) continue;
    let referencedColumns = k.referencedColumns ?? [];
    let columnsWereDerived = false;
    if (referencedColumns.length === 0) {
      const pk = pkByTable.get(`${k.referencedSchema}.${k.referencedTable}`);
      if (pk) {
        referencedColumns = pk.columns;
        columnsWereDerived = true;
      }
    }
    const rationaleParts = [
      `Declared foreign key '${k.name}' (SQL Server sys.foreign_keys).`,
    ];
    if (columnsWereDerived) {
      rationaleParts.push(
        'The catalog did not resolve the referenced columns; the referenced ' +
          "table's primary key was substituted.",
      );
    }
    if (notTrusted.has(`${k.schemaName}.${k.tableName}.${k.name}`)) {
      rationaleParts.push(
        'The constraint is NOT TRUSTED (created or re-enabled WITH NOCHECK), ' +
          'so existing rows were never verified against it -- the equivalent ' +
          'constraint on the target may fail to create.',
      );
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
      rationale: rationaleParts.join(' '),
      // Always populated on this engine -- `sys.foreign_keys` reports both
      // referential actions for every constraint.
      onDelete: k.onDelete ?? null,
      onUpdate: k.onUpdate ?? null,
      // WITH NOCHECK: the source itself never validated the existing rows
      // against this FK, so the pack emits the target constraint NOT VALID.
      isNotTrusted: k.isNotTrusted ?? null,
    });
  }
  return out;
}

export function inferMssqlRelationships(
  introspection: IntrospectionResult,
  indexExtras: MssqlIndexExtras[] = [],
): RelationshipInference[] {
  const declared = declaredForeignKeys(
    introspection.keysAndIndexes,
    indexExtras,
  );
  const pkMap = buildPkMap(introspection.keysAndIndexes);
  const inferred = nameBasedInferences(introspection.columns, pkMap, declared);
  return [...declared, ...inferred];
}
