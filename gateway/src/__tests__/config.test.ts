/**
 * Tests for configuration loading
 */

describe('Config', () => {
  // Store original environment
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to clear cached config
    jest.resetModules();
    // Clone the original environment
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load required environment variables and provide defaults', () => {
      // Set required variable
      process.env.OPENAI_API_KEY = 'test-api-key';

      // Require triggers dotenv.config() which re-reads .env into process.env.
      // Clear ALL optional env vars that .env may set so loadConfig() sees only defaults.
      const { loadConfig } = require('../config');
      const optionalVars = [
        'OPENAI_MODEL', 'OPENAI_BASE_URL', 'OPENAI_TIMEOUT_MS',
        'PORT', 'MCP_BASE_URL', 'ALLOWED_ORIGINS',
        'MAX_TOOL_CALLS_PER_TURN', 'MAX_OAS_BYTES', 'MAX_MESSAGE_BYTES',
        'RATE_LIMIT_RPM', 'RATE_LIMIT_BURST', 'SESSION_TTL_HOURS',
        'LOG_LEVEL', 'ENABLE_TOOL_TRACE',
        'IMPLEMENTATION_LLM_SERVICE_BASE_URL', 'IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN',
        'ORCHESTRATION_SERVICE_BASE_URL',
      ];
      for (const v of optionalVars) delete process.env[v];
      const config = loadConfig();

      // Required variable loaded
      expect(config.openaiApiKey).toBe('test-api-key');

      // Defaults applied
      expect(config.openaiModel).toBe('gpt-4o');
      expect(config.port).toBe(8081);
      expect(config.mcpBaseUrl).toBe('http://localhost:8090');
      expect(config.maxToolCallsPerTurn).toBe(8);
      expect(config.maxOasBytes).toBe(2097152);
      expect(config.maxMessageBytes).toBe(32768);
      expect(config.rateLimitRpm).toBe(60);
      expect(config.sessionTtlHours).toBe(24);
      expect(config.logLevel).toBe('info');
      expect(config.enableToolTrace).toBe(false);
    });

    it('should throw error when OPENAI_API_KEY is missing', () => {
      // Remove the required variable
      delete process.env.OPENAI_API_KEY;

      const { loadConfig } = require('../config');

      expect(() => loadConfig()).toThrow('OPENAI_API_KEY environment variable is required');
    });

    it('should parse comma-separated ALLOWED_ORIGINS correctly', () => {
      process.env.OPENAI_API_KEY = 'test-api-key';
      process.env.ALLOWED_ORIGINS = 'http://localhost:5173, http://localhost:3000, https://example.com';

      const { loadConfig } = require('../config');
      const config = loadConfig();

      expect(config.allowedOrigins).toEqual([
        'http://localhost:5173',
        'http://localhost:3000',
        'https://example.com'
      ]);
    });

    it('should use default ALLOWED_ORIGINS when not specified', () => {
      process.env.OPENAI_API_KEY = 'test-api-key';

      // Require first (triggers dotenv.config()), then clear ALLOWED_ORIGINS
      const { loadConfig } = require('../config');
      delete process.env.ALLOWED_ORIGINS;
      const config = loadConfig();

      expect(config.allowedOrigins).toEqual(['http://localhost:5173']);
    });
  });
});
