/**
 * Data-parity run route — Spec P of the Data-Tier Oracle Program.
 *
 *   POST /api/data-parity/run
 *
 * One-shot, session-less comparison of the SOURCE and TARGET databases'
 * loaded data (counts → column sets → ordered row comparison through the
 * migration-pair ruleset). Credentials arrive in the request body, live in
 * function scope for THIS invocation only, are never logged and never
 * persisted; both adapters are disposed in `finally` — the same posture as
 * the wizard's stateless test-connection route.
 *
 * The report persists to AMS (`data_parity_reports`) so the migrate gate
 * can read the latest verdict fail-closed. A persist failure does not hide
 * the report from the caller — it returns with `report_persisted: false`
 * (and the gate stays closed, since AMS has nothing).
 *
 * Body (snake_case wire):
 * {
 *   project_id, architecture_id,
 *   source_db: { db_type, host, port, database, schema?, username, password },
 *   target_db: { ... same },
 *   tables: [ { table, schema?, order_by? } ],          // required, >= 1
 *   sample_rows?, full_scan_max_rows?, timeout_seconds?  // knob overrides
 * }
 */
import { Router, Request, Response } from 'express';
import { DbAdapter } from '../services/db/DbAdapter';
import { createDbAdapter as defaultCreateDbAdapter } from '../services/db/dbAdapterFactory';
import {
  DataParityKnobs,
  DataParityReportBody,
  DataParityTableSpec,
  runDataParityComparison,
} from '../services/dataParity/dataParityComparator';
import { archModelClient } from '../services/archModelClient';
import { loadPairRuleset } from '../migrationPairRules';
import { createTracer } from '../trace';

// DATA-stage predicate emission (predicate run-judging — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only; no
// predicate ever carries a cell value (counts + rule ids only).
const trace = createTracer('capture-svc');

/** Env-tunable defaults (program decision 3). */
const DEFAULT_SAMPLE_ROWS = Number(process.env.DATA_PARITY_SAMPLE_ROWS ?? 1000);
const DEFAULT_FULLSCAN_MAX_ROWS = Number(process.env.DATA_PARITY_FULLSCAN_MAX_ROWS ?? 10000);
const DEFAULT_TIMEOUT_SECONDS = Number(process.env.DATA_PARITY_TIMEOUT_SECONDS ?? 60);

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
  tables?: Array<{ table?: string; schema?: string | null; order_by?: string[] }>;
  sample_rows?: number;
  full_scan_max_rows?: number;
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

export interface DataParityRunDeps {
  createDbAdapter?: typeof defaultCreateDbAdapter;
  saveReport?: (
    projectId: string,
    architectureId: string,
    report: DataParityReportBody,
  ) => Promise<{ id: string }>;
}

export function buildDataParityRunRouter(deps: DataParityRunDeps = {}): Router {
  const router = Router({ mergeParams: true });
  const factory = deps.createDbAdapter ?? defaultCreateDbAdapter;
  const saveReport =
    deps.saveReport ??
    ((projectId: string, architectureId: string, report: DataParityReportBody) =>
      archModelClient.saveDataParityReport(projectId, architectureId, report));

  router.post('/api/data-parity/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RunBody;
    const projectId = body.project_id;
    const architectureId = body.architecture_id;
    if (!projectId || !architectureId) {
      return res
        .status(400)
        .json({ error: 'project_id and architecture_id are required' });
    }
    const sourceError = dbBlockError('source_db', body.source_db);
    if (sourceError) return res.status(400).json({ error: sourceError });
    const targetError = dbBlockError('target_db', body.target_db);
    if (targetError) return res.status(400).json({ error: targetError });
    const tables: DataParityTableSpec[] = (body.tables ?? [])
      .filter((t): t is { table: string; schema?: string | null; order_by?: string[] } =>
        typeof t?.table === 'string' && t.table.trim() !== '')
      .map((t) => ({ table: t.table, schema: t.schema ?? null, orderBy: t.order_by }));
    if (tables.length === 0) {
      return res
        .status(400)
        .json({ error: 'tables must contain at least one { table } entry' });
    }

    const knobs: DataParityKnobs = {
      sampleRows: body.sample_rows ?? DEFAULT_SAMPLE_ROWS,
      fullScanMaxRows: body.full_scan_max_rows ?? DEFAULT_FULLSCAN_MAX_ROWS,
      timeoutSeconds: body.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS,
    };
    const corr = { project: projectId, arch: architectureId };

    // Credentials: function scope only — never logged, never persisted.
    const source = factory({
      dbType: body.source_db!.db_type as 'postgres' | 'sybase',
      host: body.source_db!.host!,
      port: body.source_db!.port!,
      database: body.source_db!.database!,
      schema: body.source_db!.schema ?? null,
      username: body.source_db!.username!,
      password: body.source_db!.password!,
    }) as DbAdapter;
    const target = factory({
      dbType: body.target_db!.db_type as 'postgres' | 'sybase',
      host: body.target_db!.host!,
      port: body.target_db!.port!,
      database: body.target_db!.database!,
      schema: body.target_db!.schema ?? null,
      username: body.target_db!.username!,
      password: body.target_db!.password!,
    }) as DbAdapter;

    trace.stageStart('DATA', corr);
    try {
      const ruleset = loadPairRuleset();
      const report = await runDataParityComparison({
        source,
        target,
        tables,
        ruleset,
        knobs,
      });

      const countMismatches = report.tables.filter(
        (t) => t.divergence_class === 'count_mismatch',
      ).length;
      trace.predicate(
        'DATA.CNT.01', 'row counts compared for every scoped table',
        report.tables.every((t) => t.source_count !== null || t.verdict === 'unverifiable'),
        'every table reaches at least the counts rung',
        `tables=${report.tables.length} count_mismatches=${countMismatches}`,
        corr,
      );
      trace.predicateSkip(
        'DATA.SUM.01', 'engine-side checksum tier',
        'not in this build — client-side canonical comparison covers ' +
          `full<=${knobs.fullScanMaxRows} rows, sampled ${knobs.sampleRows} above`,
        corr,
      );
      const rowsCompared = report.tables.reduce((acc, t) => acc + t.rows_compared, 0);
      const cellDivergences = report.tables.reduce((acc, t) => acc + t.cell_divergences, 0);
      trace.predicate(
        'DATA.ROW.01', 'ordered rows compared through the pair ruleset',
        report.summary.status === 'clean',
        'no divergent tables (tolerated divergences are rule-cited)',
        `status=${report.summary.status} rows_compared=${rowsCompared} ` +
          `cell_divergences=${cellDivergences} divergent_tables=${report.summary.divergent} ` +
          `unverifiable=${report.summary.unverifiable} ` +
          `rules_cited=[${report.summary.rules_cited.join(',')}]`,
        corr,
      );

      let reportId: string | null = null;
      let persistError: string | null = null;
      try {
        const saved = await saveReport(projectId, architectureId, report);
        reportId = saved.id;
      } catch (err) {
        persistError = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
      }
      trace.predicate(
        'DATA.REP.01', 'data-parity report persisted for the gate to read',
        persistError === null,
        'report row lands in AMS (the migrate gate reads the latest)',
        persistError === null
          ? `report_id=${reportId} status=${report.summary.status}`
          : `persist FAILED: ${persistError} — gate stays closed (no report)`,
        corr,
      );
      trace.stageEnd('DATA', corr);

      return res.status(200).json({
        report_id: reportId,
        report_persisted: persistError === null,
        persist_error: persistError,
        report,
      });
    } catch (err) {
      trace.predicate(
        'DATA.ROW.01', 'ordered rows compared through the pair ruleset', false,
        'comparison completes without a run-level error',
        `run error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        corr,
      );
      trace.stageEnd('DATA', corr);
      return res.status(500).json({
        error: 'data-parity run failed',
        detail: err instanceof Error ? err.message.slice(0, 300) : 'unknown',
      });
    } finally {
      await source.dispose().catch(() => undefined);
      await target.dispose().catch(() => undefined);
    }
  });

  return router;
}

export const dataParityRunRouter = buildDataParityRunRouter();
