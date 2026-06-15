import express from 'express';
import { PORT } from './config';
import { toolsRouter } from './routes/tools';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { startCleanupInterval } from './services/sessionManager';

/**
 * MCP Server Entry Point
 *
 * This server provides MCP-compatible HTTP endpoints for chat assistant workflows
 * to discover and retrieve interface metadata from the architecture-model-service.
 */

// Initialize Express application
const app = express();

// Apply JSON body parser
app.use(express.json());

// Apply request logger middleware (before routes)
app.use(requestLogger);

// Mount tools router at /mcp/tools
app.use('/mcp/tools', toolsRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply error handler middleware (after routes)
app.use(errorHandler);

// Start session cleanup interval (every 5 minutes)
startCleanupInterval(5);

// Start server
app.listen(PORT, () => {
  console.log(`[MCP Server] Started on port ${PORT}`);
  console.log(`[MCP Server] Health check: http://localhost:${PORT}/health`);
  console.log(`[MCP Server] Tools endpoint: http://localhost:${PORT}/mcp/tools`);
});

export { app };
