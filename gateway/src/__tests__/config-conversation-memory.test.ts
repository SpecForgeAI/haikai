/**
 * Tests for conversation memory configuration fields
 * These tests verify the maxConversationMessages and maxConversationBytes config fields
 */

describe('Config - Conversation Memory', () => {
  // Store original environment
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to clear cached config
    jest.resetModules();
    // Clone the original environment
    process.env = { ...originalEnv };
    // Set required variable for all tests
    process.env.OPENAI_API_KEY = 'test-api-key';
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('maxConversationMessages', () => {
    it('should default to 80 when MAX_CONVERSATION_MESSAGES env var is not set', () => {
      delete process.env.MAX_CONVERSATION_MESSAGES;

      const { loadConfig } = require('../config');
      const config = loadConfig();

      expect(config.maxConversationMessages).toBe(80);
    });

    it('should parse MAX_CONVERSATION_MESSAGES from environment variable', () => {
      process.env.MAX_CONVERSATION_MESSAGES = '100';

      const { loadConfig } = require('../config');
      const config = loadConfig();

      expect(config.maxConversationMessages).toBe(100);
    });
  });

  describe('maxConversationBytes', () => {
    it('should default to 200000 when MAX_CONVERSATION_BYTES env var is not set', () => {
      delete process.env.MAX_CONVERSATION_BYTES;

      const { loadConfig } = require('../config');
      const config = loadConfig();

      expect(config.maxConversationBytes).toBe(200000);
    });

    it('should parse MAX_CONVERSATION_BYTES from environment variable', () => {
      process.env.MAX_CONVERSATION_BYTES = '500000';

      const { loadConfig } = require('../config');
      const config = loadConfig();

      expect(config.maxConversationBytes).toBe(500000);
    });
  });
});
