import express from 'express';
import { PORT } from './config';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { discoveryRouter } from './routes';
import { initializeAnalyzerRegistry } from './services/analyzerRegistry';
import { initializeLinkerRuleRegistry } from './services/linkerRuleRegistry';

// Register all extension packs at startup (side-effect import)
import './services/extensionPacks/register';

/**
 * Discovery Service Entry Point
 *
 * This server provides HTTP endpoints for the legacy/current-state discovery
 * pipeline with Phase 0 (framing/setup) and Phase 1 (code-repo analysis)
 * skeleton routes.
 *
 * Dead registry initializations removed as part of Spec 2026-04-07, Task Group 12:
 *   - initializeClusteringRuleRegistry (clustering pipeline removed)
 *   - initializeCandidateGenerationRuleRegistry (candidate generation pipeline removed)
 */

// Initialize Express application
const app = express();

// Apply JSON body parser
app.use(express.json());

// Apply request logger middleware (before routes)
app.use(requestLogger);

// Mount discovery router at /discovery
app.use('/discovery', discoveryRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply error handler middleware (after routes)
app.use(errorHandler);

// Initialize analyzer registry
initializeAnalyzerRegistry();

// Initialize linker rule registry (must be called before any run can execute)
initializeLinkerRuleRegistry();

// Start server
app.listen(PORT, () => {
  console.log(`[Discovery Service] Started on port ${PORT}`);
  console.log(`[Discovery Service] Health check: http://localhost:${PORT}/health`);
  console.log(`[Discovery Service] Discovery endpoint: http://localhost:${PORT}/discovery`);

  // Predicate-run-judging BOOT header (docs/trace-logging.md §Predicates):
  // one HAIKAI_CONFIG line per boot so the run judge can score fail-closed
  // degradations against config. No-op unless HAIKAI_TRACE is on; must never
  // affect boot.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createTracer } = require('./trace');
    const bootTrace = createTracer('discovery');
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
        log_parse_max_file_bytes: Number(process.env.LOG_PARSE_MAX_FILE_BYTES ?? 104857600),
        log_parse_max_total_bytes: Number(process.env.LOG_PARSE_MAX_TOTAL_BYTES ?? 2097152000),
        vuln_enrich_auto: process.env.DISCOVERY_VULN_ENRICH_AUTO !== 'false',
        osv_base_url_default: !process.env.OSV_API_BASE_URL,
        ...pairInfo,
      });
    }
  } catch { /* tracing must never affect boot */ }
});

export { app };
