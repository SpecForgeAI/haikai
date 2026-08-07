/**
 * Data-migration run route — Spec Y of the Data-Tier Oracle Program, wired as a
 * dispatchable service capability (Spec W runner dispatch).
 *
 *   POST /api/data-migration/run
 *
 * Executes the pack's Phase-2 bulk load against a live target: for each table in
 * the load plan (from the generated pack manifest), read the source rows,
 * forward-transform them through the migration-pair ruleset, write them to the
 * target, and reconcile the counts. Self-scores as EXEC.DATA.* predicates on the
 * shared trace log.
 *
 * Credentials arrive in the request body, live in function scope for THIS
 * invocation only, are never logged and never persisted; the read adapters +
 * the write loader are all disposed in `finally` — the same posture as the
 * data-parity run route.
 *
 * Body (snake_case wire):
 * {
 *   project_id, architecture_id?,
 *   source_db: { db_type, host, port, database, schema?, username, password },
 *   target_db: { ... same (postgres) },
 *   manifest: { expected_schema: { tables, columns, keysAndIndexes } },  // pack main manifest
 *   bulk_manifest?: { table_order, expected_source_row_counts },          // optional
 *   read_cap?, batch_rows?, page_rows?, timeout_seconds?                  // knob overrides
 * }
 */
import { Router, Request, Response } from 'express';
import { DbAdapter } from '../services/db/DbAdapter';
import { createDbAdapter as defaultCreateDbAdapter } from '../services/db/dbAdapterFactory';
import { DbConnectionConfig } from '../types/db';
import {
  PostgresTargetLoader,
  TargetLoader,
} from '../services/dataMigration/targetLoader';
import { buildLoadPlan } from '../services/dataMigration/buildLoadPlan';
import { runDataMigration } from '../services/dataMigration/dataMigrationRunner';
import { emitDataMigrationPredicates } from '../services/dataMigration/dataMigrationPredicates';
import { loadPairRuleset } from '../migrationPairRules';
import { createTracer } from '../trace';

const trace = createTracer('data-migrate');

// UNCAPPED by default (2026-08-07): the old 50k default silently loaded ZERO
// rows for every larger table. read_cap survives ONLY as an explicit operator
// valve (env/body, 0 = no cap); the load itself is keyset-paginated so table
// size no longer needs a protective cap.
const DEFAULT_READ_CAP = Number(process.env.DATA_MIGRATION_READ_CAP ?? 0);
const DEFAULT_BATCH_ROWS = Number(process.env.DATA_MIGRATION_BATCH_ROWS ?? 500);
// Rows per keyset page — must stay at or under the Sybase sidecar's 10k
// per-response guard (the sidecar buffers each page as one JSON response).
const DEFAULT_PAGE_ROWS = Math.min(
  10_000,
  Math.max(1, Number(process.env.DATA_MIGRATION_PAGE_ROWS ?? 5000)),
);
const DEFAULT_TIMEOUT_SECONDS = Number(process.env.DATA_MIGRATION_TIMEOUT_SECONDS ?? 120);

interface DbBlock {
  db_type?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string | null;
  username?: string;
  password?: string;
}

interface RunBody {
  project_id?: string;
  architecture_id?: string;
  source_db?: DbBlock;
  target_db?: DbBlock;
  manifest?: unknown;
  bulk_manifest?: unknown;
  read_cap?: number;
  batch_rows?: number;
  page_rows?: number;
  timeout_seconds?: number;
}

function dbBlockError(label: string, block: DbBlock | undefined): string | null {
  if (!block) return `${label} is required`;
  if (block.db_type !== 'postgres' && block.db_type !== 'sybase') {
    return `${label}.db_type must be 'postgres' or 'sybase'`;
  }
  for (const field of ['host', 'database', 'username', 'password'] as const) {
    if (!block[field] || typeof block[field] !== 'string') {
      return `${label}.${field} is required`;
    }
  }
  if (typeof block.port !== 'number' || !Number.isFinite(block.port)) {
    return `${label}.port is required`;
  }
  return null;
}

function toConfig(block: DbBlock): DbConnectionConfig {
  return {
    dbType: block.db_type as 'postgres' | 'sybase',
    host: block.host as string,
    port: block.port as number,
    database: block.database as string,
    schema: block.schema ?? null,
    username: block.username as string,
    password: block.password as string,
  };
}

export interface DataMigrationRunDeps {
  createDbAdapter?: typeof defaultCreateDbAdapter;
  createTargetLoader?: (
    config: DbConnectionConfig,
    opts: { batchRows: number },
  ) => TargetLoader;
}

export function buildDataMigrationRunRouter(deps: DataMigrationRunDeps = {}): Router {
  const router = Router({ mergeParams: true });
  const factory = deps.createDbAdapter ?? defaultCreateDbAdapter;
  const makeLoader =
    deps.createTargetLoader ??
    ((config: DbConnectionConfig, opts: { batchRows: number }) =>
      new PostgresTargetLoader(config, opts));

  router.post('/api/data-migration/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RunBody;
    const projectId = body.project_id;
    if (!projectId) {
      return res.status(400).json({ error: 'project_id is required' });
    }
    const sourceError = dbBlockError('source_db', body.source_db);
    if (sourceError) return res.status(400).json({ error: sourceError });
    const targetError = dbBlockError('target_db', body.target_db);
    if (targetError) return res.status(400).json({ error: targetError });
    if (!body.manifest || typeof body.manifest !== 'object') {
      return res
        .status(400)
        .json({ error: 'manifest (the pack main manifest with expected_schema) is required' });
    }

    const plan = buildLoadPlan(body.manifest, body.bulk_manifest);
    if (plan.tables.length === 0) {
      return res.status(422).json({
        error: 'the manifest yields no load plan',
        issues: plan.issues,
      });
    }

    const corr = { project: projectId, arch: body.architecture_id };
    const knobs = {
      readCap: body.read_cap ?? DEFAULT_READ_CAP,
      pageRows: Math.min(10_000, Math.max(1, body.page_rows ?? DEFAULT_PAGE_ROWS)),
      timeoutSeconds: body.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS,
    };

    // Credentials: function scope only — never logged, never persisted.
    const source = factory(toConfig(body.source_db!)) as DbAdapter;
    const target = factory(toConfig(body.target_db!)) as DbAdapter;
    const targetLoader = makeLoader(toConfig(body.target_db!), {
      batchRows: body.batch_rows ?? DEFAULT_BATCH_ROWS,
    });

    try {
      const ruleset = loadPairRuleset();
      const report = await runDataMigration({ source, target, targetLoader, plan, ruleset, knobs });
      emitDataMigrationPredicates(report, trace, corr);
      return res.status(200).json({ report, summary: report.summary });
    } catch (err) {
      trace.fail(
        `data migration run errored: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        corr,
      );
      return res.status(500).json({
        error: 'data-migration run failed',
        detail: err instanceof Error ? err.message.slice(0, 300) : 'unknown',
      });
    } finally {
      await source.dispose().catch(() => undefined);
      await target.dispose().catch(() => undefined);
      await targetLoader.dispose().catch(() => undefined);
    }
  });

  return router;
}

export const dataMigrationRunRouter = buildDataMigrationRunRouter();
