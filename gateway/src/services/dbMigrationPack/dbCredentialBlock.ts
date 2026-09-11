/**
 * Engine-typed DB credential-block parsing (2026-08-24 engine-name-guard
 * burn-down). The supported-engine vocabulary and its validation lived
 * inline in `routes/migrationExecution.ts` three times over — a GENERIC
 * route module the guard pins engine-free. Engine knowledge belongs in
 * pack territory, so the parser lives here; the routes call it and carry
 * no engine tokens of their own.
 */

import type { TargetDbSecret } from '../migrationTargetCredentialsStore';

export const SUPPORTED_DB_ENGINES = ['postgres', 'sybase', 'mssql'] as const;
export type SupportedDbEngine = (typeof SUPPORTED_DB_ENGINES)[number];

/** The 400-response text for a malformed credential block. */
export function dbBlockShapeError(label: string): string {
  return `${label} block must include { dbType: ${SUPPORTED_DB_ENGINES.join('|')}, host, port, database, username, password }`;
}

/**
 * Whole-or-null credential-block parse: every field present and the engine
 * supported, or null. Never partially parses — a malformed block must fail
 * loudly at the route (secrets are held in memory only; a half-parsed block
 * would silently drop the state-parity capability it was supplied for).
 */
export function parseDbCredentialBlock(raw: unknown): TargetDbSecret | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const d = raw as {
    dbType?: string;
    host?: string;
    port?: number;
    database?: string;
    schema?: string | null;
    username?: string;
    password?: string;
  };
  if (!SUPPORTED_DB_ENGINES.includes(d.dbType as SupportedDbEngine)) return null;
  if (
    !d.host ||
    typeof d.port !== 'number' ||
    !d.database ||
    !d.username ||
    typeof d.password !== 'string' ||
    d.password.length === 0
  ) {
    return null;
  }
  return {
    dbType: d.dbType as SupportedDbEngine,
    host: d.host,
    port: d.port,
    database: d.database,
    schema: d.schema ?? null,
    username: d.username,
    password: d.password,
  };
}
