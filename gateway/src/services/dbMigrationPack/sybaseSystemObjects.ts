/**
 * Sybase ASE system-catalog objects (2026-08-07).
 *
 * The live failure: `dbo.sysquerymetrics` — an ASE system VIEW over
 * `sysqueryplans` — was harvested into the committed model, routed through
 * the translation queue, approved, and emitted as the pack's final post-load
 * changeset. It can never build: the system tables it selects from are
 * Sybase-internal and are not (and must never be) part of the migrated app
 * schema. Same generator-defect class as the name-scoping bugs: the pack
 * must OWN the engine difference — system catalogs are per-engine
 * infrastructure, not application schema.
 *
 * CURATED EXACT-NAME LIST, not a `sys*` prefix heuristic: ASE does not
 * reserve the prefix, so a legitimate application table named `sys_config`
 * or `system_audit` must never be silently dropped. Case-insensitive match
 * on the bare object name (ASE system objects are dbo-owned per database,
 * so schema does not discriminate).
 */

/** ASE per-database + master-database system tables and system views. */
export const SYBASE_SYSTEM_OBJECT_NAMES: ReadonlySet<string> = new Set([
  // Per-database catalogs.
  'sysalternates',
  'sysattributes',
  'syscolumns',
  'syscomments',
  'sysconstraints',
  'syscoordinations',
  'sysdams',
  'sysdepends',
  'sysencryptkeys',
  'sysgams',
  'sysindexes',
  'sysjars',
  'syskeys',
  'syslogs',
  'sysobjects',
  'sysoptions',
  'syspartitionkeys',
  'syspartitions',
  'sysprocedures',
  'sysprotects',
  'sysquerymetrics',
  'sysqueryplans',
  'sysreferences',
  'sysroles',
  'syssegments',
  'sysslices',
  'sysstatistics',
  'systabstats',
  'systhresholds',
  'systypes',
  'sysusermessages',
  'sysusers',
  'sysxtypes',
  // Master-database catalogs (captured when a harvest sweeps master).
  'syscharsets',
  'sysconfigures',
  'syscurconfigs',
  'sysdatabases',
  'sysdevices',
  'sysengines',
  'sysinstances',
  'syslanguages',
  'syslocks',
  'sysloginroles',
  'syslogins',
  'sysmessages',
  'sysmonitors',
  'sysprocesses',
  'sysremotelogins',
  'sysresourcelimits',
  'sysservers',
  'syssessions',
  'syssrvroles',
  'systimeranges',
  'systransactions',
  'sysusages',
]);

/** True when the BARE object name is an ASE system catalog table/view. */
export function isSybaseSystemObject(objectName: string): boolean {
  return SYBASE_SYSTEM_OBJECT_NAMES.has(String(objectName ?? '').trim().toLowerCase());
}

/**
 * True for a qualified `[schema.]object` reference (the last dot segment is
 * the object name — matches `parseQualifiedName` semantics).
 */
export function isSybaseSystemObjectRef(objectRef: string): boolean {
  const parts = String(objectRef ?? '').split('.').filter((p) => p.length > 0);
  return parts.length > 0 && isSybaseSystemObject(parts[parts.length - 1]);
}

/**
 * Distinct ASE system-catalog names referenced by a SQL text, ignoring
 * comment lines (`--`) — emitted comments may legitimately MENTION a system
 * object (exclusion notes); executable statements may not.
 */
export function findSybaseSystemReferences(sql: string): string[] {
  const executable = String(sql ?? '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .toLowerCase();
  const found = new Set<string>();
  for (const name of SYBASE_SYSTEM_OBJECT_NAMES) {
    // Word-boundary match; covers bare, schema-qualified and quoted forms.
    if (new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`).test(executable)) {
      found.add(name);
    }
  }
  return [...found].sort();
}
