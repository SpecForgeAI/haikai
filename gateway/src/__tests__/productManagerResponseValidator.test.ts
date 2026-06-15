/**
 * Tests for Product Manager Response Validator
 *
 * Spec 2026-02-12: Increment 3 - Introduce Product Manager Chat Mode
 * Task Group 3: Product Manager Response Validator
 *
 * Tests:
 * 1. Valid "questions" phase response parses correctly
 * 2. Valid "ready" phase response parses correctly
 * 3. Invalid phase value (e.g., "unknown") returns { valid: false } with error
 * 4. Missing questions array returns { valid: false } with error
 * 5. Non-JSON content triggers extractJson() fallback and fails gracefully
 * 6. createFallbackProductManagerResponse() returns safe default { phase: "questions", questions: [], summary: "" }
 */

import {
  validateProductManagerResponse,
  createFallbackProductManagerResponse,
} from '../services/productManagerResponseValidator';

describe('productManagerResponseValidator', () => {
  describe('validateProductManagerResponse', () => {
    it('should validate a valid "questions" phase response correctly', () => {
      const validJson = JSON.stringify({
        phase: 'questions',
        questions: [
          'What is the core problem your product solves?',
          'Who is your target audience?',
        ],
        summary: 'Let me understand your product better by asking a few questions.',
      });

      const result = validateProductManagerResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.productManagerResponse).toBeDefined();
      expect(result.productManagerResponse?.phase).toBe('questions');
      expect(result.productManagerResponse?.questions).toHaveLength(2);
      expect(result.productManagerResponse?.questions[0]).toBe(
        'What is the core problem your product solves?'
      );
      expect(result.productManagerResponse?.questions[1]).toBe(
        'Who is your target audience?'
      );
      expect(result.productManagerResponse?.summary).toBe(
        'Let me understand your product better by asking a few questions.'
      );
      expect(result.error).toBeUndefined();
    });

    it('should validate a valid "ready" phase response correctly', () => {
      const validJson = JSON.stringify({
        phase: 'ready',
        questions: [],
        summary:
          'I now have enough information to generate the MISSION.MD. Would you like me to proceed?',
      });

      const result = validateProductManagerResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.productManagerResponse).toBeDefined();
      expect(result.productManagerResponse?.phase).toBe('ready');
      expect(result.productManagerResponse?.questions).toHaveLength(0);
      expect(result.productManagerResponse?.summary).toBe(
        'I now have enough information to generate the MISSION.MD. Would you like me to proceed?'
      );
      expect(result.error).toBeUndefined();
    });

    it('should return { valid: false } with error for invalid phase value', () => {
      const invalidJson = JSON.stringify({
        phase: 'unknown',
        questions: ['q1'],
        summary: 'test summary',
      });

      const result = validateProductManagerResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('phase');
      expect(result.error).toContain('unknown');
      expect(result.productManagerResponse).toBeUndefined();
    });

    it('should return { valid: false } with error for missing questions array', () => {
      const invalidJson = JSON.stringify({
        phase: 'questions',
        summary: 'test summary',
      });

      const result = validateProductManagerResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('questions');
      expect(result.error).toContain('array');
      expect(result.productManagerResponse).toBeUndefined();
    });

    it('should fail gracefully when non-JSON content triggers extractJson() fallback', () => {
      const noJsonContent =
        'This is just plain text with no JSON structure whatsoever. No braces at all.';

      const result = validateProductManagerResponse(noJsonContent);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('No JSON found');
      expect(result.productManagerResponse).toBeUndefined();
    });
  });

  describe('createFallbackProductManagerResponse', () => {
    it('should return safe default { phase: "questions", questions: [], summary: "" }', () => {
      const fallback = createFallbackProductManagerResponse();

      expect(fallback.phase).toBe('questions');
      expect(fallback.questions).toEqual([]);
      expect(fallback.summary).toBe('');

      // Verify the shape is complete
      expect(fallback).toHaveProperty('phase');
      expect(fallback).toHaveProperty('questions');
      expect(fallback).toHaveProperty('summary');
      expect(Array.isArray(fallback.questions)).toBe(true);
    });
  });
});
