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
});

export { app };
