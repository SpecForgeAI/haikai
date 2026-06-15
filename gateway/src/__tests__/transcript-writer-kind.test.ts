/**
 * Tests for normalizeKind and updated buildTranscriptPath kind parameter
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * Task Group 1: Transcript Writer Utilities and Service Exports
 */

import path from 'path';
import {
  normalizeKind,
  buildTranscriptPath,
} from '../services/transcriptWriter';

// Mock config (required by transcriptWriter module even though these tests don't exercise config-dependent code)
const mockConfig = {
  sessionTtlHours: 24,
  openaiApiKey: 'test-key',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiTimeoutMs: 60000,
  mcpBaseUrl: 'http://localhost:8090',
  architectureModelServiceBaseUrl: 'http://localhost:8080',
  orchestrationServiceBaseUrl: 'http://localhost:8085',
  conversationPersistBasePath: '/tmp/test-transcripts',
  port: 8081,
  maxToolCallsPerTurn: 8,
  maxOasBytes: 2097152,
  maxMessageBytes: 32768,
  rateLimitRpm: 60,
  rateLimitBurst: 20,
  maxConversationMessages: 80,
  maxConversationBytes: 200000,
  logLevel: 'info',
  allowedOrigins: ['http://localhost:5173'],
  enableToolTrace: false,
};

jest.mock('../config', () => ({
  getConfig: () => mockConfig,
}));

// Mock logger - use factory function to avoid hoisting issues
jest.mock('../services/logger', () => {
  return {
    logger: {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

describe('Transcript Writer Kind Support', () => {
  describe('normalizeKind', () => {
    it('should return "implement" when called with undefined', () => {
      const result = normalizeKind(undefined);
      expect(result).toBe('implement');
    });

    it('should return "implement" when called with empty string', () => {
      const result = normalizeKind('');
      expect(result).toBe('implement');
    });

    it('should normalize case: "Product" returns "product"', () => {
      const result = normalizeKind('Product');
      expect(result).toBe('product');
    });

    it('should throw for invalid kind "design" with descriptive message', () => {
      expect(() => normalizeKind('design')).toThrow('Invalid kind');
      expect(() => normalizeKind('design')).toThrow('Allowed values: implement, product');
    });
  });

  describe('buildTranscriptPath with kind', () => {
    it('should produce dirPath with kind segment for kind="product"', () => {
      const basePath = '/base/path';
      const folderName = 'my-feature-abc12345';
      const result = buildTranscriptPath(basePath, folderName, 'product');
      const expectedSuffix = path.join('conversations', 'product', folderName);
      expect(result.dirPath).toContain(expectedSuffix);
      expect(result.dirPath.endsWith(expectedSuffix)).toBe(true);
    });

    it('should default to "implement" kind when kind is not provided (backward compatible)', () => {
      const basePath = '/base/path';
      const folderName = 'my-feature-abc12345';
      const result = buildTranscriptPath(basePath, folderName);
      const expectedSuffix = path.join('conversations', 'implement', folderName);
      expect(result.dirPath).toContain(expectedSuffix);
      expect(result.dirPath.endsWith(expectedSuffix)).toBe(true);
    });
  });
});
