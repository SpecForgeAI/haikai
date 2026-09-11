/**
 * Automatic S0 snapshot at DB-scan completion (Capture-State Discipline
 * follow-up, 2026-08-19 — user ruling: the DB scan and the S0 snapshot are
 * ONE action; no separate step, no extra UI).
 *
 * When a database discovery run completes successfully, the run manager
 * calls this with the scan's OWN harvest (tables / columns / primary keys /
 * identity flags) and the SAME connection credentials the scan just used —
 * the validation service takes the canonical-state snapshot immediately,
 * without waiting for save-back. The outcome lands in the run's steps
 * payload so the scan results answer "was S0 pinned?" directly.
 *
 * FAIL-SOFT, LOUD: a snapshot failure never fails the scan (the harvest is
 * valuable on its own) — it is recorded as `failed` with the reason, and the
 * capture-side no-snapshot advisory remains the backstop. The manual
 * validation-service route stays available as the recovery path.
 */

import { API_MIGRATION_VALIDATION_BASE_URL } from '../../config';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
} from './types';
import { isDatabaseEngine } from './types';

export interface S0AutoSnapshotOutcome {
  status: 'taken' | 'failed' | 'skipped';
  snapshotId: string | null;
  tableCount: number;
  detail: string | null;
}

interface S0TableSpecWire {
  table: string;
  pk_columns: string[];
  columns: Array<{ name: string; source_type: string | null; is_identity: boolean }>;
}

/**
 * Project the scan's introspection into the snapshot's table specs. Bare
 * table names (the same convention the effect maps use); a bare name
 * appearing in MORE THAN ONE schema is skipped with a note — snapshotting an
 * ambiguous name would silently pick one.
 */
export function buildS0TableSpecs(introspection: IntrospectionResult): {
  specs: S0TableSpecWire[];
  ambiguous: string[];
} {
  const schemasByTable = new Map<string, Set<string>>();
  for (const t of introspection.tables) {
    const name = (t.tableName ?? '').trim();
    if (!name) continue;
    const set = schemasByTable.get(name.toLowerCase()) ?? new Set<string>();
    set.add(t.schemaName ?? '');
    schemasByTable.set(name.toLowerCase(), set);
  }

  const specs: S0TableSpecWire[] = [];
  const ambiguous: string[] = [];
  for (const t of introspection.tables) {
    const name = (t.tableName ?? '').trim();
    if (!name) continue;
    if ((schemasByTable.get(name.toLowerCase())?.size ?? 0) > 1) {
      if (!ambiguous.includes(name)) ambiguous.push(name);
      continue;
    }
    const columns = introspection.columns
      .filter((c) => c.tableName === t.tableName && c.schemaName === t.schemaName)
      .map((c) => ({
        name: c.columnName ?? '',
        source_type: c.dataType ?? null,
        is_identity: c.isIdentity === true,
      }))
      .filter((c) => c.name.length > 0);
    const pk = introspection.keysAndIndexes.find(
      (k) =>
        k.tableName === t.tableName &&
        k.schemaName === t.schemaName &&
        k.kind === 'primary_key' &&
        Array.isArray(k.columns) &&
        k.columns.length > 0,
    );
    specs.push({
      table: name,
      pk_columns: pk?.columns ?? [],
      columns,
    });
  }
  return { specs, ambiguous };
}

export async function takeS0AutoSnapshot(args: {
  projectId: string;
  architectureId: string;
  config: DatabaseDiscoveryConfig;
  credentials: DatabaseDiscoveryCredentials;
  introspection: IntrospectionResult;
  fetchFn?: typeof fetch;
}): Promise<S0AutoSnapshotOutcome> {
  const fetchFn = args.fetchFn ?? fetch;

  if (!isDatabaseEngine(args.config.dbEngine)) {
    return {
      status: 'skipped',
      snapshotId: null,
      tableCount: 0,
      detail: `engine '${String(args.config.dbEngine)}' has no S0 snapshot support`,
    };
  }
  const { specs, ambiguous } = buildS0TableSpecs(args.introspection);
  if (specs.length === 0) {
    return {
      status: 'skipped',
      snapshotId: null,
      tableCount: 0,
      detail: 'the scan harvested no tables to snapshot',
    };
  }

  try {
    const response = await fetchFn(
      `${API_MIGRATION_VALIDATION_BASE_URL}/api-migration-validation/api/s0-snapshot/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          project_id: args.projectId,
          architecture_id: args.architectureId,
          source_db: {
            db_type: args.config.dbEngine,
            host: args.config.host,
            port: args.config.port,
            database: args.config.databaseName,
            schema: null,
            username: args.credentials.username,
            password: args.credentials.password,
          },
          tables: specs,
        }),
      },
    );
    const parsed = (await response.json().catch(() => null)) as {
      snapshot_id?: string;
      manifest?: { tables?: unknown[] };
      error?: string;
    } | null;
    if (!response.ok) {
      return {
        status: 'failed',
        snapshotId: null,
        tableCount: specs.length,
        detail: parsed?.error ?? `validation service returned HTTP ${response.status}`,
      };
    }
    const noteParts: string[] = [];
    if (ambiguous.length > 0) {
      noteParts.push(
        `${ambiguous.length} table name(s) present in multiple schemas were skipped: ` +
          ambiguous.slice(0, 5).join(', '),
      );
    }
    return {
      status: 'taken',
      snapshotId: parsed?.snapshot_id ?? null,
      tableCount: parsed?.manifest?.tables?.length ?? specs.length,
      detail: noteParts.length > 0 ? noteParts.join('; ') : null,
    };
  } catch (err) {
    return {
      status: 'failed',
      snapshotId: null,
      tableCount: specs.length,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
