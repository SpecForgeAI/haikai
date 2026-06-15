/**
 * Tests for Implementation LLM Service Configuration
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Client
 * Tests that IMPLEMENTATION_LLM_SERVICE_BASE_URL and IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN
 * are properly loaded from environment variables.
 *
 * (Originally tested as STANDARDS_SERVICE_* before unification)
 */

import { loadConfig, resetConfig } from '../config';

describe('Implementation LLM Service Configuration', () => {
  // Store original env vars
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset config singleton before each test
    resetConfig();
    // Create a fresh copy of process.env
    process.env = { ...originalEnv };
    // Ensure required OPENAI_API_KEY is set
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterAll(() => {
    // Restore original env vars
    process.env = originalEnv;
    resetConfig();
  });

  describe('IMPLEMENTATION_LLM_SERVICE_BASE_URL', () => {
    it('loads from environment variable', () => {
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://custom-standards:8080';

      const config = loadConfig();

      expect(config.implementationLlmServiceBaseUrl).toBe('http://custom-standards:8080');
    });

    it('defaults to http://localhost:8000 when not set', () => {
      delete process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL;

      const config = loadConfig();

      expect(config.implementationLlmServiceBaseUrl).toBe('http://localhost:8000');
    });
  });

  describe('IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN', () => {
    it('loads from environment variable', () => {
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'secret-token-123';

      const config = loadConfig();

      expect(config.implementationLlmServiceBearerToken).toBe('secret-token-123');
    });

    it('defaults to empty string when not set', () => {
      delete process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN;

      const config = loadConfig();

      expect(config.implementationLlmServiceBearerToken).toBe('');
    });
  });

  describe('combined configuration', () => {
    it('loads both service config values together', () => {
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'https://standards-api.example.com';
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'bearer-token-xyz';

      const config = loadConfig();

      expect(config.implementationLlmServiceBaseUrl).toBe('https://standards-api.example.com');
      expect(config.implementationLlmServiceBearerToken).toBe('bearer-token-xyz');
    });
  });
});
