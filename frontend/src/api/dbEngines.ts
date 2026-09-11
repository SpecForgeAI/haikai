/**
 * Database engine vocabulary shared by every DB-facing form and API module.
 *
 * SQL Server 16 -> PostgreSQL 18 pair programme, Spec 0 (2026-09-11): the
 * engine key is the ONLY engine discriminator on the wire (`dbEngine` /
 * `dbType` / `db_type`). Labels and default ports live here so no component
 * hardcodes an engine name it did not get from data.
 */
export const DB_ENGINE_KEYS = ['postgres', 'sybase', 'mssql'] as const;
export type DbEngineKey = (typeof DB_ENGINE_KEYS)[number];

export const DB_ENGINE_LABEL: Record<DbEngineKey, string> = {
  postgres: 'PostgreSQL',
  sybase: 'Sybase ASE',
  mssql: 'SQL Server',
};

export const DB_ENGINE_DEFAULT_PORT: Record<DbEngineKey, number> = {
  postgres: 5432,
  sybase: 5000,
  mssql: 1433,
};

/** Select options in a stable order (labels from DB_ENGINE_LABEL). */
export const DB_ENGINE_OPTIONS: ReadonlyArray<{ value: DbEngineKey; label: string }> = DB_ENGINE_KEYS.map((k) => ({
  value: k,
  label: DB_ENGINE_LABEL[k],
}));

export function isDbEngineKey(value: unknown): value is DbEngineKey {
  return typeof value === 'string' && (DB_ENGINE_KEYS as readonly string[]).includes(value);
}

/** Display label for an engine key or a free-text engine string from a manifest. */
export function dbEngineLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  if (isDbEngineKey(lowered)) return DB_ENGINE_LABEL[lowered];
  if (lowered.startsWith('postgres')) return 'PostgreSQL';
  if (lowered.startsWith('sybase')) return 'Sybase ASE';
  if (lowered === 'sqlserver' || lowered === 'sql server') return 'SQL Server';
  return raw;
}
