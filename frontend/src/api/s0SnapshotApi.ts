/**
 * S0-snapshot client (CSD, 2026-08-20 journey-audit fix).
 *
 * Talks to the gateway's thin S0 proxies (routes/apiMigrationValidation.ts),
 * which forward verbatim to the validation service's s0-snapshot routes.
 * Wire is snake_case (the validation service's own shape — the proxy never
 * reshapes). Restore carries DB credentials in the request body only:
 * function-scope, never persisted, never logged.
 */
import type { DbEngineKey } from './dbEngines';

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

export interface S0TableManifestEntry {
  table: string;
  row_count: number;
  checksum: string | null;
  file: string | null;
  note: string | null;
}

export interface S0Manifest {
  snapshot_id: string;
  project_id: string;
  architecture_id: string;
  created_at: string;
  source_db_type: string;
  schema: string | null;
  tables: S0TableManifestEntry[];
}

export interface S0SourceDb {
  db_type: DbEngineKey;
  host: string;
  port: number;
  database: string;
  schema: string | null;
  username: string;
  password: string;
}

export interface S0RestoreTableResult {
  table: string;
  // 'unchanged' (2026-08-26 minimal-diff restore): the table was already at
  // S0 and was deliberately not reloaded.
  status: 'restored' | 'skipped_not_dumped' | 'unchanged' | 'failed';
  rows_inserted: number;
  detail: string | null;
}

export interface S0RestoreResponse {
  snapshot_id: string;
  report: {
    status: 'restored' | 'failed';
    tables: S0RestoreTableResult[];
    verification: {
      matches: number;
      mismatches: Array<Record<string, unknown>>;
    } | null;
  };
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message =
      (parsed as { error?: string | { message?: string } } | null)?.error ?? null;
    const detail =
      typeof message === 'string'
        ? message
        : (message?.message ?? `HTTP ${response.status}`);
    throw new Error(detail);
  }
  return parsed as T;
}

export async function getLatestS0Snapshot(
  projectId: string,
  architectureId: string,
): Promise<S0Manifest | null> {
  const response = await fetch(
    `${GATEWAY_BASE}/api/v1/api-migration-validation/s0-snapshot/latest` +
      `?project_id=${encodeURIComponent(projectId)}` +
      `&architecture_id=${encodeURIComponent(architectureId)}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
  );
  const body = await jsonOrThrow<{ snapshot: S0Manifest | null }>(response);
  return body.snapshot ?? null;
}

export async function restoreS0Snapshot(body: {
  project_id: string;
  architecture_id: string;
  source_db: S0SourceDb;
  snapshot_id?: string;
  confirm: true;
  /** Item #6 (2026-08-27): when set, a successful restore is RECORDED on
   *  this capture session — the migrate/reconcile gate reads the receipt. */
  session_id?: string;
}): Promise<S0RestoreResponse> {
  const response = await fetch(
    `${GATEWAY_BASE}/api/v1/api-migration-validation/s0-snapshot/restore`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return jsonOrThrow<S0RestoreResponse>(response);
}
