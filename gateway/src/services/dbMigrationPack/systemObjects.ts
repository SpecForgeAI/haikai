/**
 * Engine-keyed system-catalog exclusion (SQL Server 16 -> PostgreSQL 18 pair
 * programme, Spec 5.1, 2026-09-11).
 *
 * A source engine's system catalogs are ENGINE INFRASTRUCTURE, never migrated
 * application schema — the 2026-08-07 live failure (a harvested
 * `dbo.sysquerymetrics` ASE system view translated, approved and emitted as
 * the pack's final post-load changeset, unbuildable because its
 * `sysqueryplans` source can never exist on the target) is the same class on
 * every engine. This module keys that knowledge by engine:
 *
 *   - `sybase`: the CURATED exact-name list in `sybaseSystemObjects.ts`
 *     (ASE does not reserve the `sys` prefix, so an application table named
 *     `sys_config` must never be dropped). UNCHANGED — the Sybase corpus is
 *     the regression gate.
 *   - `mssql`: SQL Server DOES reserve schemas. The rule is schema-first —
 *     `sys` / `INFORMATION_SCHEMA` — plus the small set of tool-owned objects
 *     Microsoft's own tooling plants in a user schema (`sysdiagrams`,
 *     `dtproperties`, `MSreplication_*`, `__RefactorLog`, `spt_*`).
 *
 * This file is PACK CODE (`services/dbMigrationPack/**`) and is free to name
 * engines; the generic core is not.
 */

import {
  findSybaseSystemReferences,
  isSybaseSystemObject,
  isSybaseSystemObjectRef,
} from './sybaseSystemObjects';

/** Reserved SQL Server catalog SCHEMAS (case-insensitive). */
export const MSSQL_SYSTEM_SCHEMAS: ReadonlySet<string> = new Set([
  'sys',
  'information_schema',
]);

/**
 * SQL Server tool-owned objects that live in a USER schema (usually `dbo`)
 * and are engine/tooling infrastructure rather than application schema.
 * Exact names; the two prefix families are matched separately below.
 */
export const MSSQL_SYSTEM_OBJECT_NAMES: ReadonlySet<string> = new Set([
  'sysdiagrams',
  'dtproperties',
  '__refactorlog',
]);

/** Prefix families: replication metadata + the `master..spt_*` helpers. */
const MSSQL_SYSTEM_NAME_PREFIXES: readonly string[] = ['msreplication_', 'spt_'];

/** TRUE when the BARE object name is SQL Server tooling infrastructure. */
export function isMssqlSystemObjectName(objectName: string): boolean {
  const n = String(objectName ?? '').trim().toLowerCase();
  if (n === '') return false;
  if (MSSQL_SYSTEM_OBJECT_NAMES.has(n)) return true;
  return MSSQL_SYSTEM_NAME_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * TRUE when (schema, name) names a system object for `engine`.
 *
 * `schema` may be null/empty when the caller only has a bare name — the
 * schema test then simply does not fire, and the name test still does.
 */
export function isSystemObjectFor(
  engine: string,
  schemaName: string | null | undefined,
  objectName: string,
): boolean {
  const e = String(engine ?? '').trim().toLowerCase();
  if (e === 'mssql') {
    const schema = String(schemaName ?? '').trim().toLowerCase();
    if (schema !== '' && MSSQL_SYSTEM_SCHEMAS.has(schema)) return true;
    return isMssqlSystemObjectName(objectName);
  }
  // Sybase (and any engine without its own list): the curated ASE names.
  return isSybaseSystemObject(objectName);
}

/**
 * TRUE for a qualified `[catalog.]schema.object` reference. The last dot
 * segment is the object name and the one before it the schema — matching
 * `parseQualifiedName` semantics.
 */
export function isSystemObjectRefFor(engine: string, objectRef: string): boolean {
  const e = String(engine ?? '').trim().toLowerCase();
  if (e !== 'mssql') return isSybaseSystemObjectRef(objectRef);
  const parts = String(objectRef ?? '')
    .split('.')
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  const name = parts[parts.length - 1];
  const schema = parts.length >= 2 ? parts[parts.length - 2] : null;
  return isSystemObjectFor('mssql', schema, name);
}

/**
 * Distinct system-catalog references an executable SQL text makes, ignoring
 * comment lines (`--`) — emitted comments may legitimately MENTION a system
 * object (exclusion notes); executable statements may not.
 *
 * Sybase: the curated exact-name scan (unchanged). MSSQL: schema-qualified
 * `sys.<name>` / `INFORMATION_SCHEMA.<name>` references plus the tool-owned
 * object names. A bare `sys` word is NOT a reference — only the qualified
 * form is, because `sys` alone is a perfectly ordinary column/alias name.
 */
export function findSystemReferences(engine: string, sql: string): string[] {
  const e = String(engine ?? '').trim().toLowerCase();
  if (e !== 'mssql') return findSybaseSystemReferences(sql);
  const executable = String(sql ?? '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const found = new Set<string>();
  const qualified = /(^|[^A-Za-z0-9_."[])(?:\[?(sys|INFORMATION_SCHEMA)\]?)\s*\.\s*\[?([A-Za-z0-9_]+)\]?/gi;
  let m: RegExpExecArray | null;
  while ((m = qualified.exec(executable)) !== null) {
    found.add(`${m[2].toLowerCase()}.${m[3].toLowerCase()}`);
  }
  const lowered = executable.toLowerCase();
  for (const name of MSSQL_SYSTEM_OBJECT_NAMES) {
    if (new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`).test(lowered)) found.add(name);
  }
  for (const prefix of MSSQL_SYSTEM_NAME_PREFIXES) {
    const re = new RegExp(`(^|[^a-z0-9_])(${prefix}[a-z0-9_]*)`, 'g');
    let p: RegExpExecArray | null;
    while ((p = re.exec(lowered)) !== null) found.add(p[2]);
  }
  return [...found].sort();
}

export { findSybaseSystemReferences, isSybaseSystemObject, isSybaseSystemObjectRef };
