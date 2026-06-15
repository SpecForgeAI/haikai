/**
 * Tests for Implementer Response Validator
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 2: Gateway Validator - implementerResponseValidator.ts
 *
 * Tests:
 * 1. Validates valid ImplementerResponse JSON (schemaVersion 1.0, message, openQuestions)
 * 2. Extracts JSON from markdown/prose using extractJson (reused)
 * 3. Transforms openQuestions strings to OpenQuestion objects with UUIDs
 * 4. Returns validation error for missing/invalid fields
 * 5. Creates fallback response preserving raw message
 */

import {
  validateImplementerResponse,
  createFallbackImplementerResponse,
} from '../services/implementerResponseValidator';

describe('implementerResponseValidator', () => {
  describe('validateImplementerResponse', () => {
    it('should validate a valid ImplementerResponse JSON', () => {
      const validJson = JSON.stringify({
        schemaVersion: '1.0',
        message: 'I have reviewed the increment specification.',
        openQuestions: [
          'What error handling strategy should be used?',
          'Should we implement retry logic?',
        ],
      });

      const result = validateImplementerResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.implementerResponse).toBeDefined();
      expect(result.implementerResponse?.schemaVersion).toBe('1.0');
      expect(result.implementerResponse?.message).toBe(
        'I have reviewed the increment specification.'
      );
      expect(result.implementerResponse?.openQuestions).toHaveLength(2);
    });

    it('should extract JSON from markdown code block', () => {
      const markdownContent = `
Here is my response:

\`\`\`json
{
  "schemaVersion": "1.0",
  "message": "Review complete.",
  "openQuestions": ["Question 1?"]
}
\`\`\`

That's all I have for now.
`;

      const result = validateImplementerResponse(markdownContent);

      expect(result.valid).toBe(true);
      expect(result.implementerResponse?.message).toBe('Review complete.');
      expect(result.implementerResponse?.openQuestions).toHaveLength(1);
    });

    it('should transform openQuestions strings to OpenQuestion objects with UUIDs', () => {
      const validJson = JSON.stringify({
        schemaVersion: '1.0',
        message: 'Test message',
        openQuestions: ['Question A?', 'Question B?'],
      });

      const result = validateImplementerResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.implementerResponse?.openQuestions[0]).toHaveProperty('id');
      expect(result.implementerResponse?.openQuestions[0]).toHaveProperty('question');
      expect(result.implementerResponse?.openQuestions[0].question).toBe('Question A?');
      expect(result.implementerResponse?.openQuestions[1].question).toBe('Question B?');

      // UUIDs should be valid format (basic check)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(result.implementerResponse?.openQuestions[0].id).toMatch(uuidRegex);
    });

    it('should accept empty openQuestions array (indicates increment is ready)', () => {
      const validJson = JSON.stringify({
        schemaVersion: '1.0',
        message: 'The specification is clear. Ready for implementation.',
        openQuestions: [],
      });

      const result = validateImplementerResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.implementerResponse?.openQuestions).toHaveLength(0);
    });

    it('should return validation error for invalid schemaVersion', () => {
      const invalidJson = JSON.stringify({
        schemaVersion: '2.0',
        message: 'Test message',
        openQuestions: [],
      });

      const result = validateImplementerResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('schemaVersion');
    });

    it('should return validation error for missing message', () => {
      const invalidJson = JSON.stringify({
        schemaVersion: '1.0',
        openQuestions: [],
      });

      const result = validateImplementerResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('message');
    });

    it('should return validation error for missing openQuestions', () => {
      const invalidJson = JSON.stringify({
        schemaVersion: '1.0',
        message: 'Test message',
      });

      const result = validateImplementerResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('openQuestions');
    });

    it('should return validation error for openQuestions not being an array', () => {
      const invalidJson = JSON.stringify({
        schemaVersion: '1.0',
        message: 'Test message',
        openQuestions: 'not an array',
      });

      const result = validateImplementerResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('openQuestions');
      expect(result.error).toContain('array');
    });

    it('should return validation error when no JSON found in content', () => {
      const noJsonContent = 'This is just plain text with no JSON whatsoever.';

      const result = validateImplementerResponse(noJsonContent);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No JSON found');
    });

    it('should return validation error for malformed JSON', () => {
      const malformedJson = '{ "schemaVersion": "1.0", "message": }';

      const result = validateImplementerResponse(malformedJson);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });
  });

  describe('createFallbackImplementerResponse', () => {
    it('should create a fallback response preserving the raw message', () => {
      const rawMessage = 'This is some raw text that could not be parsed.';

      const fallback = createFallbackImplementerResponse(rawMessage);

      expect(fallback.schemaVersion).toBe('1.0');
      expect(fallback.message).toBe(rawMessage);
      expect(fallback.openQuestions).toEqual([]);
    });

    it('should create a valid ImplementerResponse structure', () => {
      const fallback = createFallbackImplementerResponse('Test fallback');

      expect(fallback).toHaveProperty('schemaVersion');
      expect(fallback).toHaveProperty('message');
      expect(fallback).toHaveProperty('openQuestions');
      expect(Array.isArray(fallback.openQuestions)).toBe(true);
    });
  });
});
