/**
 * Tests for type validation utilities
 */

import {
  validateChatRequest,
  validateChatContext,
  validateSessionId,
  isValidPreferredFormat,
} from '../types';

describe('Type Validation', () => {
  const MAX_MESSAGE_BYTES = 32768; // 32KB
  const MAX_OAS_BYTES = 2097152; // 2MB

  describe('validateChatRequest', () => {
    it('should validate a valid ChatRequest with required fields', () => {
      const request = {
        sessionId: 'session-123',
        message: 'Hello, can you help me generate an OAS spec?',
      };

      const result = validateChatRequest(request, MAX_MESSAGE_BYTES, MAX_OAS_BYTES);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept request with missing sessionId (optional)', () => {
      const request = {
        message: 'Hello',
      };

      const result = validateChatRequest(request, MAX_MESSAGE_BYTES, MAX_OAS_BYTES);

      // sessionId is now optional - request should pass validation
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject request with whitespace-only sessionId', () => {
      const request = {
        sessionId: '   ',
        message: 'Hello',
      };

      const result = validateChatRequest(request, MAX_MESSAGE_BYTES, MAX_OAS_BYTES);

      // If sessionId is provided but empty after trim, it should fail
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'sessionId',
        message: 'sessionId must be a non-empty string if provided',
      });
    });

    it('should reject request with missing message', () => {
      const request = {
        sessionId: 'session-123',
      };

      const result = validateChatRequest(request, MAX_MESSAGE_BYTES, MAX_OAS_BYTES);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'message',
        message: 'message is required and must be a non-empty string',
      });
    });

    it('should reject request with oversized message', () => {
      const request = {
        sessionId: 'session-123',
        message: 'x'.repeat(MAX_MESSAGE_BYTES + 100),
      };

      const result = validateChatRequest(request, MAX_MESSAGE_BYTES, MAX_OAS_BYTES);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'message' && e.message.includes('exceeds maximum size'))).toBe(true);
    });
  });

  describe('validateChatContext', () => {
    it('should validate context with valid preferredFormat yaml', () => {
      const context = {
        filename: 'architecture.json',
        interfaceId: 'INT-001',
        preferredFormat: 'yaml',
      };

      const result = validateChatContext(context, MAX_OAS_BYTES);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate context with valid preferredFormat json', () => {
      const context = {
        preferredFormat: 'json',
      };

      const result = validateChatContext(context, MAX_OAS_BYTES);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject context with invalid preferredFormat', () => {
      const context = {
        preferredFormat: 'xml',
      };

      const result = validateChatContext(context, MAX_OAS_BYTES);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'context.preferredFormat',
        message: 'preferredFormat must be "yaml" or "json"',
      });
    });

    it('should allow undefined preferredFormat', () => {
      const context = {
        filename: 'test.json',
      };

      const result = validateChatContext(context, MAX_OAS_BYTES);

      expect(result.valid).toBe(true);
    });
  });

  describe('validateSessionId', () => {
    it('should validate non-empty sessionId', () => {
      const result = validateSessionId('session-abc-123');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept empty sessionId (optional)', () => {
      const result = validateSessionId('');

      // Empty string sessionId is now acceptable - handler will generate one
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept undefined sessionId (optional)', () => {
      const result = validateSessionId(undefined);

      // Undefined sessionId is now acceptable - handler will generate one
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject whitespace-only sessionId', () => {
      const result = validateSessionId('   ');

      // Whitespace-only is considered "provided but invalid"
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'sessionId',
        message: 'sessionId must be a non-empty string if provided',
      });
    });
  });

  describe('isValidPreferredFormat', () => {
    it('should return true for yaml', () => {
      expect(isValidPreferredFormat('yaml')).toBe(true);
    });

    it('should return true for json', () => {
      expect(isValidPreferredFormat('json')).toBe(true);
    });

    it('should return true for undefined', () => {
      expect(isValidPreferredFormat(undefined)).toBe(true);
    });

    it('should return false for invalid format', () => {
      expect(isValidPreferredFormat('xml')).toBe(false);
      expect(isValidPreferredFormat('txt')).toBe(false);
    });
  });
});
