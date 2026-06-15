import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

/**
 * Configuration for condensed context DTO transformation.
 * Controls token bounding and truncation limits.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 2
 */
export interface CondensedContextConfig {
  /** Maximum number of DTOs to include in condensed context (default: 50) */
  maxDtoCount: number;
  /** Maximum JSON characters for the condensed context payload (default: 40000) */
  maxJsonChars: number;
}

/**
 * Configuration interface for the Gateway service
 */
export interface Config {
  // OpenAI Configuration
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  openaiTimeoutMs: number;

  // MCP Server Configuration
  mcpBaseUrl: string;

  // Architecture Model Service Configuration
  architectureModelServiceBaseUrl: string;

  // Implementation LLM Proxy Service Configuration
  // Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
  // All calls to standards, orchestrations, and shape-spec use this unified config
  implementationLlmServiceBaseUrl: string;
  implementationLlmServiceBearerToken: string;

  // Jira Service Configuration
  // Spec 2026-02-05: Jira Service (Spring Boot) -- GET /jira/issues
  jiraServiceBaseUrl: string;

  // Jira Browse Base URL for constructing external_url links (distinct from jiraServiceBaseUrl which points to the jira-service app)
  // Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton
  jiraBrowseBaseUrl: string;

  // Discovery Service Configuration
  // Spec 2026-04-04: Legacy Discovery Capability Skeleton
  discoveryServiceBaseUrl: string;

  // API Migration Validation Service Configuration
  // Spec 2026-05-15: API Behaviour Baseline Capture Service -- Task Group 6
  // Base URL for the new api-migration-validation-service (port 8092). The
  // gateway action proxies (`/parse-oas`, `/test-api-connection`,
  // `/test-db-connection`, `/start`, `/cancel`, `/secrets`) forward here.
  apiMigrationValidationServiceBaseUrl: string;

  // Conversation Persistence Configuration
  // Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
  conversationPersistBasePath: string;

  // Gateway Server Configuration
  port: number;
  maxToolCallsPerTurn: number;
  maxOasBytes: number;
  maxMessageBytes: number;

  // Rate Limiting
  rateLimitRpm: number;
  rateLimitBurst: number;

  // Session Management
  sessionTtlHours: number;
  maxConversationMessages: number;
  maxConversationBytes: number;

  // Logging
  logLevel: string;

  // Security
  allowedOrigins: string[];

  // Debug Options
  enableToolTrace: boolean;

  // Condensed Context Configuration
  // Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 2
  condensedContext: CondensedContextConfig;

  // V2 Conversation Engine Configuration
  // Spec 2026-02-28: Unified Conversation Engine v1 (Backend) - Task Group 2
  /** Base directory for persona/task/prompt config files */
  registryBasePath: string;

  // LLM Provider Switch
  // Spec 2026-03-06: Azure OpenAI LLM Provider
  llmProvider: 'openai' | 'azure-openai';

  // Azure OpenAI Configuration
  azureAuthEndpoint: string;
  azureApiUsername: string;
  azureApiPassword: string;
  azureChatEndpoint: string;
  azureApiVersion: string;
  azureApiModel: string;

  // Migration Delivery Plan Generation Configuration
  // Spec 2026-06-11: Two-Phase Migration Delivery Plan Generation (Skeleton -> Expand)
  /**
   * Max in-flight LLM requests across the WHOLE migration-plan flow (phase-1
   * per-stream skeleton calls AND all phase-2 expansion/judge/rewrite calls
   * share ONE pool — see services/llmConcurrencyPool.ts). Hard user
   * requirement: tunable via MIGRATION_PLAN_LLM_CONCURRENCY alone — set to 1
   * for fully serial execution with NO code change. Default: 4.
   */
  migrationPlanLlmConcurrency: number;
  /**
   * Inventory items (endpoints/tables) per phase-2 expansion LLM call.
   * Read from MIGRATION_PLAN_EXPANSION_BATCH_SIZE. Default: 12.
   */
  migrationPlanExpansionBatchSize: number;

  // Migration Execution Driver Configuration
  // Spec 2026-06-14: Migrate Button + Migration Execution Driver (Spec 3 of 4)
  /**
   * The gateway's OWN public base URL (e.g. https://haikai.internal:8081). The
   * Migration Execution Driver threads
   * `{gatewayPublicBaseUrl}/api/implementation/build-results` as the per-request
   * `callback_url` on every orchestration submit (CD-3), so the external
   * implementation/verification service posts build-results back to this
   * gateway. Read from GATEWAY_PUBLIC_BASE_URL; defaults to
   * http://localhost:{PORT}.
   */
  gatewayPublicBaseUrl: string;
  /**
   * The shared secret the external implementation/verification service presents
   * on the INBOUND build-results door (`POST /api/implementation/build-results`).
   * The existing /api/implementation routes are OUTBOUND-auth only; this is the
   * NEW inbound service-token check (a bad/missing token is a 401). Read from
   * BUILD_RESULTS_SERVICE_TOKEN; empty by default (when empty the guard rejects
   * all inbound callbacks, so the token MUST be configured for the door to work).
   */
  buildResultsServiceToken: string;
}

/**
 * Validates that required environment variables are present.
 * Conditional on the selected LLM provider:
 * - When 'openai' (or unset): validates OPENAI_API_KEY
 * - When 'azure-openai': validates all six Azure env vars
 * @throws Error if required environment variables are missing
 */
function validateRequiredEnvVars(): void {
  const llmProvider = process.env.LLM_PROVIDER || 'openai';

  if (llmProvider === 'azure-openai') {
    const requiredAzureVars = [
      'AZURE_AUTH_ENDPOINT',
      'AZURE_API_USERNAME',
      'AZURE_API_PASSWORD',
      'AZURE_CHAT_ENDPOINT',
      'AZURE_API_VERSION',
      'AZURE_API_MODEL',
    ];

    const missingVars = requiredAzureVars.filter(
      (varName) => !process.env[varName] || process.env[varName]!.trim() === ''
    );

    if (missingVars.length > 0) {
      throw new Error(
        `Azure OpenAI provider requires the following environment variables: ${missingVars.join(', ')}`
      );
    }
  } else {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
  }
}

/**
 * Parses a comma-separated string into an array of trimmed strings
 * @param value - Comma-separated string
 * @param defaultValue - Default array if value is empty
 * @returns Array of strings
 */
function parseCommaSeparated(value: string | undefined, defaultValue: string[]): string[] {
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Parses an integer from environment variable with default
 * @param value - String value from environment
 * @param defaultValue - Default if parsing fails
 * @returns Parsed integer
 */
function parseIntEnv(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parses a boolean from environment variable with default
 * @param value - String value from environment
 * @param defaultValue - Default if parsing fails
 * @returns Parsed boolean
 */
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Loads and validates configuration from environment variables.
 * This function should be called once at startup.
 * @returns Configuration object
 * @throws Error if required environment variables are missing
 */
export function loadConfig(): Config {
  validateRequiredEnvVars();

  return {
    // OpenAI Configuration
    openaiApiKey: process.env.OPENAI_API_KEY!,
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiTimeoutMs: parseIntEnv(process.env.OPENAI_TIMEOUT_MS, 1200000),

    // MCP Server Configuration
    mcpBaseUrl: process.env.MCP_BASE_URL || 'http://localhost:8090',

    // Architecture Model Service Configuration
    architectureModelServiceBaseUrl: process.env.ARCHITECTURE_MODEL_SERVICE_URL || 'http://localhost:8080',

    // Implementation LLM Proxy Service Configuration
    // Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
    // All calls to standards, orchestrations, and shape-spec use this unified config
    // No startup validation - token absence is checked per-request (fail-fast pattern)
    implementationLlmServiceBaseUrl: process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL || 'http://localhost:8000',
    implementationLlmServiceBearerToken: process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN || '',

    // Jira Service Configuration
    // Spec 2026-02-05: Jira Service (Spring Boot) -- GET /jira/issues
    jiraServiceBaseUrl: process.env.JIRA_SERVICE_URL || 'http://localhost:8078',

    // Jira Browse Base URL for constructing external_url links (distinct from jiraServiceBaseUrl which points to the jira-service app)
    // Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton
    jiraBrowseBaseUrl: process.env.JIRA_BROWSE_BASE_URL || 'https://jira.example.com',

    // Discovery Service Configuration
    // Spec 2026-04-04: Legacy Discovery Capability Skeleton
    discoveryServiceBaseUrl: process.env.DISCOVERY_SERVICE_URL || 'http://localhost:8091',

    // API Migration Validation Service Configuration
    // Spec 2026-05-15: API Behaviour Baseline Capture Service -- Task Group 6
    apiMigrationValidationServiceBaseUrl:
      process.env.API_MIGRATION_VALIDATION_SERVICE_URL || 'http://localhost:8092',

    // Conversation Persistence Configuration
    // Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
    // Default to current working directory if not specified
    conversationPersistBasePath: process.env.CONVERSATION_PERSIST_BASE_PATH || process.cwd(),

    // Gateway Server Configuration
    port: parseIntEnv(process.env.PORT, 8081),
    maxToolCallsPerTurn: parseIntEnv(process.env.MAX_TOOL_CALLS_PER_TURN, 8),
    maxOasBytes: parseIntEnv(process.env.MAX_OAS_BYTES, 2097152), // 2MB
    maxMessageBytes: parseIntEnv(process.env.MAX_MESSAGE_BYTES, 32768), // 32KB

    // Rate Limiting
    rateLimitRpm: parseIntEnv(process.env.RATE_LIMIT_RPM, 60),
    rateLimitBurst: parseIntEnv(process.env.RATE_LIMIT_BURST, 20),

    // Session Management
    sessionTtlHours: parseIntEnv(process.env.SESSION_TTL_HOURS, 24),
    maxConversationMessages: parseIntEnv(process.env.MAX_CONVERSATION_MESSAGES, 80),
    maxConversationBytes: parseIntEnv(process.env.MAX_CONVERSATION_BYTES, 200000),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',

    // Security
    allowedOrigins: parseCommaSeparated(
      process.env.ALLOWED_ORIGINS,
      ['http://localhost:5173']
    ),

    // Debug Options
    enableToolTrace: parseBoolEnv(process.env.ENABLE_TOOL_TRACE, false),

    // Condensed Context Configuration
    // Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 2
    condensedContext: {
      maxDtoCount: parseIntEnv(process.env.CONDENSED_CONTEXT_MAX_DTO_COUNT, 50),
      maxJsonChars: parseIntEnv(process.env.CONDENSED_CONTEXT_MAX_JSON_CHARS, 40000),
    },

    // V2 Conversation Engine Configuration
    // Spec 2026-02-28: Unified Conversation Engine v1 (Backend) - Task Group 2
    registryBasePath: process.env.REGISTRY_BASE_PATH || path.resolve(__dirname, 'config'),

    // LLM Provider Switch
    // Spec 2026-03-06: Azure OpenAI LLM Provider
    llmProvider: (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'azure-openai',

    // Azure OpenAI Configuration
    azureAuthEndpoint: process.env.AZURE_AUTH_ENDPOINT || '',
    azureApiUsername: process.env.AZURE_API_USERNAME || '',
    azureApiPassword: process.env.AZURE_API_PASSWORD || '',
    azureChatEndpoint: process.env.AZURE_CHAT_ENDPOINT || '',
    azureApiVersion: process.env.AZURE_API_VERSION || '',
    azureApiModel: process.env.AZURE_API_MODEL || '',

    // Migration Delivery Plan Generation Configuration
    // Spec 2026-06-11: Two-Phase Migration Delivery Plan Generation (Skeleton -> Expand)
    // MIGRATION_PLAN_LLM_CONCURRENCY: max concurrent LLM requests for the
    // migration-plan flow (default 4; set to 1 for fully serial — env change
    // only, no code change). MIGRATION_PLAN_EXPANSION_BATCH_SIZE: inventory
    // items per phase-2 expansion call (default 12). Both documented in
    // .env.example alongside the other gateway env vars.
    migrationPlanLlmConcurrency: parseIntEnv(process.env.MIGRATION_PLAN_LLM_CONCURRENCY, 4),
    migrationPlanExpansionBatchSize: parseIntEnv(process.env.MIGRATION_PLAN_EXPANSION_BATCH_SIZE, 12),

    // Migration Execution Driver Configuration
    // Spec 2026-06-14: Migrate Button + Migration Execution Driver (Spec 3 of 4)
    // GATEWAY_PUBLIC_BASE_URL: the gateway's own public base URL; the Driver
    // threads {gatewayPublicBaseUrl}/api/implementation/build-results as the
    // per-request callback_url on every orchestration submit (CD-3). Defaults to
    // http://localhost:{PORT}. BUILD_RESULTS_SERVICE_TOKEN: the inbound shared
    // secret the external service presents on the build-results door (NEW inbound
    // check; a bad/missing token is a 401). Both documented in .env.example.
    gatewayPublicBaseUrl:
      process.env.GATEWAY_PUBLIC_BASE_URL ||
      `http://localhost:${parseIntEnv(process.env.PORT, 8081)}`,
    buildResultsServiceToken: process.env.BUILD_RESULTS_SERVICE_TOKEN || '',
  };
}

// Export a singleton config instance for convenience
// Note: For testing, use loadConfig() directly to control environment
let _config: Config | null = null;

/**
 * Gets the singleton config instance.
 * Lazily loads configuration on first access.
 * @returns Configuration object
 */
export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Resets the singleton config instance.
 * Useful for testing to reload configuration.
 */
export function resetConfig(): void {
  _config = null;
}
