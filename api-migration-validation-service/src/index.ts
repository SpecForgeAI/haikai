import express from 'express';
import { PORT } from './config';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { apiMigrationValidationRouter } from './routes';
import { reconcileOrphanRunningSessions } from './services/startupReconciliation';

/**
 * API Migration Validation Service Entry Point
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * Mirrors the discovery-service entry-point shape: JSON body parser, request
 * logger, mounted router at `/api-migration-validation`, error handler last.
 * On startup the service runs a reconciliation pass that marks any AMS
 * sessions left in `running` state (e.g. after a process crash) as `failed`
 * with `error_message='secrets_lost_during_run'` -- secrets live in process
 * memory only, so a restart can't continue an in-flight run.
 */

const app = express();

// Apply JSON body parser
app.use(express.json({ limit: '20mb' }));

// Apply request logger middleware (before routes)
app.use(requestLogger);

// Mount api-migration-validation router at /api-migration-validation
app.use('/api-migration-validation', apiMigrationValidationRouter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply error handler middleware (after routes)
app.use(errorHandler);

// Boot the server unless running under Jest (NODE_ENV='test' skip)
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  app.listen(PORT, () => {
    console.log(`[API Migration Validation Service] Started on port ${PORT}`);
    console.log(`[API Migration Validation Service] Health: http://localhost:${PORT}/health`);
    console.log(`[API Migration Validation Service] Mount:  http://localhost:${PORT}/api-migration-validation`);

    // Predicate-run-judging BOOT header (docs/trace-logging.md §Predicates):
    // one HAIKAI_CONFIG line per boot so the run judge can score fail-closed
    // degradations against config (e.g. DB creds are per-request only — a
    // restart legitimately loses them). No-op unless HAIKAI_TRACE is on.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTracer } = require('./trace');
      const bootTrace = createTracer('capture-svc');
      if (bootTrace.enabled) {
        let gitSha = 'unknown';
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { execSync } = require('child_process');
          gitSha = execSync('git rev-parse --short HEAD', {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'ignore'],
          }).toString().trim() || 'unknown';
        } catch { /* not a git checkout */ }
        // Migration-pair ruleset stamp (Data-Tier Oracle Spec O).
        let pairInfo: Record<string, unknown> = { migration_pair: 'none' };
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { loadPairRuleset } = require('./migrationPairRules');
          const rs = loadPairRuleset();
          if (rs) {
            pairInfo = {
              migration_pair: rs.pair_id,
              ruleset_version: rs.version,
              rule_count: rs.rules.length,
            };
          }
        } catch { /* fail-soft */ }
        bootTrace.configHeader({
          git_sha: gitSha,
          db_creds_per_request_only: true,
          volatility_probe_repeats: Number(process.env.VOLATILITY_PROBE_REPEATS ?? 3),
          volatility_probe_budget_ms: Number(process.env.VOLATILITY_PROBE_BUDGET_MS ?? 10000),
          replay_consecutive_failure_abort: Number(process.env.TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT ?? 10),
          llm_scenario_round_limit: Number(process.env.LLM_SCENARIO_ROUND_LIMIT ?? 12),
          ...pairInfo,
        });
      }
    } catch { /* tracing must never affect boot */ }

    // Fire-and-forget startup reconciliation -- don't block boot. Errors are
    // surfaced via stderr; the spec accepts that orphaned `running` rows
    // remain orphaned if AMS is unreachable at boot (operator restart of AMS
    // followed by another boot of this service will catch them).
    reconcileOrphanRunningSessions().catch((err) => {
      console.error(
        '[API Migration Validation Service] Startup reconciliation failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
  });
}

export { app };
