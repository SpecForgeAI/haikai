import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Base URL for the architecture-model-service backend
 * Default: http://localhost:8080
 */
export const ARCH_MODEL_SERVICE_BASE_URL: string =
  process.env.ARCH_MODEL_SERVICE_BASE_URL || 'http://localhost:8080';

/**
 * Session time-to-live in minutes
 * Default: 30 minutes
 */
export const MCP_SESSION_TTL_MINUTES: number =
  parseInt(process.env.MCP_SESSION_TTL_MINUTES || '30', 10);

/**
 * Server port
 * Default: 8090
 */
export const PORT: number =
  parseInt(process.env.PORT || '8090', 10);
