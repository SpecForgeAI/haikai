/**
 * Tests for Azure OpenAI LLM provider configuration
 * Spec 2026-03-06: Azure OpenAI LLM Provider - Task Group 1
 */

describe('Config - Azure OpenAI Provider', () => {
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

  describe('llmProvider default', () => {
    it('should default llmProvider to openai when LLM_PROVIDER is unset', () => {
      // Set required variable for openai provider
      process.env.OPENAI_API_KEY = 'test-api-key';
      delete process.env.LLM_PROVIDER;

      const { loadConfig } = require('../config');

      // Clear optional vars that dotenv.config() may have loaded
      delete process.env.LLM_PROVIDER;

      const config = loadConfig();

      expect(config.llmProvider).toBe('openai');
    });
  });

  describe('Azure OpenAI config loading', () => {
    it('should populate all Azure fields when LLM_PROVIDER=azure-openai and all six Azure env vars are set', () => {
      // Set provider to azure-openai
      process.env.LLM_PROVIDER = 'azure-openai';

      // Set all six Azure env vars
      process.env.AZURE_AUTH_ENDPOINT = 'https://auth.example.com/token';
      process.env.AZURE_API_USERNAME = 'test-user';
      process.env.AZURE_API_PASSWORD = 'test-password';
      process.env.AZURE_CHAT_ENDPOINT = 'https://chat.example.com/genai/oai';
      process.env.AZURE_API_VERSION = '2025-11-13';
      process.env.AZURE_API_MODEL = 'gpt-5.1-2025-11-13';

      // Do NOT set OPENAI_API_KEY - it should not be required for azure-openai
      delete process.env.OPENAI_API_KEY;

      const { loadConfig } = require('../config');
      const config = loadConfig();

      expect(config.llmProvider).toBe('azure-openai');
      expect(config.azureAuthEndpoint).toBe('https://auth.example.com/token');
      expect(config.azureApiUsername).toBe('test-user');
      expect(config.azureApiPassword).toBe('test-password');
      expect(config.azureChatEndpoint).toBe('https://chat.example.com/genai/oai');
      expect(config.azureApiVersion).toBe('2025-11-13');
      expect(config.azureApiModel).toBe('gpt-5.1-2025-11-13');
    });
  });

  describe('Azure OpenAI validation', () => {
    it('should throw a descriptive error listing missing Azure env vars when LLM_PROVIDER=azure-openai and vars are missing', () => {
      // Set provider to azure-openai but omit some required Azure vars
      process.env.LLM_PROVIDER = 'azure-openai';
      process.env.AZURE_AUTH_ENDPOINT = 'https://auth.example.com/token';
      process.env.AZURE_API_USERNAME = 'test-user';
      // Omit: AZURE_API_PASSWORD, AZURE_CHAT_ENDPOINT, AZURE_API_VERSION, AZURE_API_MODEL
      delete process.env.AZURE_API_PASSWORD;
      delete process.env.AZURE_CHAT_ENDPOINT;
      delete process.env.AZURE_API_VERSION;
      delete process.env.AZURE_API_MODEL;
      delete process.env.OPENAI_API_KEY;

      const { loadConfig } = require('../config');

      expect(() => loadConfig()).toThrow(/AZURE_API_PASSWORD/);
      expect(() => loadConfig()).toThrow(/AZURE_CHAT_ENDPOINT/);
      expect(() => loadConfig()).toThrow(/AZURE_API_VERSION/);
      expect(() => loadConfig()).toThrow(/AZURE_API_MODEL/);
    });
  });

  describe('OpenAI validation preserved', () => {
    it('should still validate OPENAI_API_KEY as required when LLM_PROVIDER is openai or unset', () => {
      // Ensure LLM_PROVIDER is not set (defaults to openai)
      delete process.env.LLM_PROVIDER;
      delete process.env.OPENAI_API_KEY;

      const { loadConfig: loadConfig1 } = require('../config');
      expect(() => loadConfig1()).toThrow('OPENAI_API_KEY environment variable is required');

      // Also test with explicit LLM_PROVIDER=openai
      jest.resetModules();
      process.env = { ...originalEnv };
      process.env.LLM_PROVIDER = 'openai';
      delete process.env.OPENAI_API_KEY;

      const { loadConfig: loadConfig2 } = require('../config');
      expect(() => loadConfig2()).toThrow('OPENAI_API_KEY environment variable is required');
    });
  });
});
