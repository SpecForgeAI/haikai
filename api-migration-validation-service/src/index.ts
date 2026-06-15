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
