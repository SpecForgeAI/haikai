/**
 * Data-parity readiness gate — Spec P part 2 of the Data-Tier Oracle Program
 * (agent-os/planning/2026-07-14-data-tier-oracle-program.md).
 *
 * Gate 4d in the Migrate hard-block chain (stacks with the spec-ready /
 * baseline gate, the DB-pack gate 4b and the code-tier gate 4c): when
 * DB-pack stories are in the dispatch scope, Migrate additionally requires
 * the LATEST data-parity report for (project, CURRENT architecture) to be
 * CLEAN:
 *
 *   - no report, unreadable report state, or a report whose summary status
 *     is not clean/divergent  =>  `data_parity_unverified`
 *   - status divergent with >= 1 UNWAIVED divergent table
 *     =>  `data_parity_failed`
 *
 * Waivers reuse the break-fingerprint waiver store with the target format
 * `data-parity:<table>` (or `data-parity:<schema>.<table>`) — an accepted
 * data divergence is waived PER TABLE, visibly, never silently.
 *
 * FAIL-CLOSED: a read failure blocks as unverified. GENERIC CORE: this
 * module never names a database engine.
 */
import { getConfig } from '../config';
import { logger } from './logger';
import { createTracer } from '../trace';
import {
  BreakFingerprintWaiver,
  fetchBreakFingerprintWaivers,
} from './migrationParityVerifier';

// DATA-stage gate predicate (predicate run-judging). Emission only; actuals
// carry verdicts + counts + codes, never cell values.
const trace = createTracer('gateway');

export interface DataParityGateReason {
  code: 'data_parity_unverified' | 'data_parity_failed';
  message: string;
  workItemId?: string | null;
  /**
   * The UNWAIVED divergent tables (schema-qualified when known) behind a
   * `data_parity_failed` reason (Residual 1, 2026-07-20). The break-glass
   * override records THIS list on the run's decision log so the downstream
   * API reconcile can attribute breaks (data-echo classification).
   */
  tables?: string[];
}

export interface DataParityGateResult {
  ok: boolean;
  reasons: DataParityGateReason[];
}

/** The AMS `GET .../data-parity-reports/latest` wire shape (snake_case). */
export interface LatestDataParityReport {
  status?: string | null;
  created_at?: string | null;
  report_json?: {
    tables?: Array<{ table?: string; schema?: string | null; verdict?: string }>;
  } | null;
}

export interface DataParityGateReads {
  fetchLatestDataParityReport(
    projectId: string,
    architectureId: string,
  ): Promise<LatestDataParityReport | null>;
  fetchWaivers(projectId: string): Promise<BreakFingerprintWaiver[]>;
}

export function defaultDataParityGateReads(): DataParityGateReads {
  return {
    async fetchLatestDataParityReport(projectId, architectureId) {
      const baseUrl = getConfig().architectureModelServiceBaseUrl;
      const url =
        `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/data-parity-reports/latest`;
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (resp.status === 404) return null;
      if (!resp.ok) {
        throw new Error(`latest data-parity report read failed: HTTP ${resp.status}`);
      }
      return (await resp.json()) as LatestDataParityReport;
    },
    fetchWaivers: fetchBreakFingerprintWaivers,
  };
}

const WAIVER_PREFIX = 'data-parity:';

function normalizeWaiverTarget(target: string): string {
  return target.trim().toLowerCase();
}

/**
 * Evaluate the data-parity gate. NEVER throws — a read failure becomes a
 * fail-closed `data_parity_unverified` reason. The caller owns the in-scope
 * trigger (DB-pack stories in the dispatch set).
 */
export async function evaluateDataParityReadiness(params: {
  projectId: string;
  architectureId: string | null;
  reads?: DataParityGateReads;
}): Promise<DataParityGateResult> {
  const reads = params.reads ?? defaultDataParityGateReads();
  const reasons: DataParityGateReason[] = [];
  let actual = '';
  let readError = false;

  try {
    if (!params.architectureId) {
      reasons.push({
        code: 'data_parity_unverified',
        message:
          'The book of work has no current architecture id, so the data-parity ' +
          'report cannot be located (fail-closed).',
      });
      actual = 'no current architecture id';
    } else {
      const report = await reads.fetchLatestDataParityReport(
        params.projectId,
        params.architectureId,
      );
      if (!report) {
        reasons.push({
          code: 'data_parity_unverified',
          message:
            'No data-parity report exists for this project/architecture. Run ' +
            'POST /api-migration-validation/api/data-parity/run (source + target ' +
            'DB credentials, table scope) and Migrate again.',
        });
        actual = 'no report';
      } else {
        const status = (report.status ?? '').toLowerCase();
        if (status === 'clean') {
          actual = 'status=clean';
        } else if (status === 'divergent') {
          const tables = report.report_json?.tables ?? [];
          const divergent = tables.filter((t) => (t.verdict ?? '') === 'divergent');
          const waivers = await reads.fetchWaivers(params.projectId);
          const waivedTargets = new Set(
            waivers
              .map((w) => normalizeWaiverTarget(w.target ?? ''))
              .filter((t) => t.startsWith(WAIVER_PREFIX)),
          );
          const isWaived = (t: { table?: string; schema?: string | null }): boolean => {
            const table = (t.table ?? '').toLowerCase();
            if (!table) return false;
            if (waivedTargets.has(`${WAIVER_PREFIX}${table}`)) return true;
            if (t.schema) {
              return waivedTargets.has(
                `${WAIVER_PREFIX}${String(t.schema).toLowerCase()}.${table}`,
              );
            }
            return false;
          };
          const unwaived = divergent.filter((t) => !isWaived(t));
          if (unwaived.length > 0) {
            const names = unwaived.map((t) => t.table ?? '?').slice(0, 8).join(', ');
            reasons.push({
              code: 'data_parity_failed',
              message:
                `${unwaived.length} table(s) diverge between the source and target ` +
                `data (${names}${unwaived.length > 8 ? ', …' : ''}). Fix the load and ` +
                're-run data parity, or waive an accepted divergence per table with ' +
                'a waiver target "data-parity:<table>".',
              // Full structured list (uncapped) — the override recorder freezes
              // it onto the run for downstream echo attribution.
              tables: unwaived.map((t) =>
                t.schema ? `${t.schema}.${t.table ?? '?'}` : (t.table ?? '?'),
              ),
            });
          }
          actual =
            `status=divergent divergent=${divergent.length} ` +
            `waived=${divergent.length - unwaived.length} unwaived=${unwaived.length}`;
        } else {
          reasons.push({
            code: 'data_parity_unverified',
            message:
              `The latest data-parity report status is '${report.status ?? 'unknown'}' — ` +
              'a clean report is required. Re-run data parity.',
          });
          actual = `status=${report.status ?? 'unknown'}`;
        }
      }
    }
  } catch (err) {
    readError = true;
    const msg = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    reasons.push({
      code: 'data_parity_unverified',
      message: `Could not read the data-parity report (fail-closed): ${msg}`,
    });
    actual = `read error (fail-closed): ${msg}`;
    logger.warn('[diag-gateway] migration_data_parity_gate read_failed', {
      projectId: params.projectId,
      error: msg,
    });
  }

  const ok = reasons.length === 0;
  trace.predicate(
    'DATA.GATE.01', 'data-parity gate evaluated with an honest verdict',
    !readError,
    'gate evaluation reads the latest report (clean OR blocked-with-reasons)',
    `verdict=${ok ? 'ok' : 'blocked'} ${actual}` +
      (ok ? '' : ` codes=[${reasons.map((r) => r.code).join(',')}]`),
    { project: params.projectId, arch: params.architectureId ?? undefined },
  );
  return { ok, reasons };
}
