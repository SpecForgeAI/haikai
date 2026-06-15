/**
 * Tests for UUID generation in plannerResponseValidator
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 2: UUID Generation in plannerResponseValidator
 *
 * Tests that verify:
 * - transformOpenQuestions converts string array to OpenQuestion array
 * - Each transformed question has a valid UUID (v4 format)
 * - Each transformed question preserves original question text
 * - Empty array input returns empty array output
 * - Transformation happens post-validation (raw strings validated first)
 */

import { describe, it, expect } from '@jest/globals';
import {
  transformOpenQuestions,
  validatePlannerResponse,
  createFallbackPlannerResponse,
} from '../services/plannerResponseValidator';

// UUID v4 format regex: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
// where y is one of 8, 9, a, or b
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('Task Group 2: UUID Generation in plannerResponseValidator', () => {
  describe('Test 2.1: transformOpenQuestions converts string array to OpenQuestion array', () => {
    it('should convert an array of strings to an array of OpenQuestion objects', () => {
      const questions = [
        'What authentication method should be used?',
        'Should we support bulk upload?',
      ];

      const result = transformOpenQuestions(questions);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('question');
      expect(result[1]).toHaveProperty('id');
      expect(result[1]).toHaveProperty('question');
    });
  });

  describe('Test 2.2: Each transformed question has a valid UUID v4', () => {
    it('should generate valid UUID v4 for each question', () => {
      const questions = ['Question 1?', 'Question 2?', 'Question 3?'];

      const result = transformOpenQuestions(questions);

      result.forEach(openQuestion => {
        expect(openQuestion.id).toMatch(UUID_V4_REGEX);
      });
    });

    it('should generate unique UUIDs for each question', () => {
      const questions = [
        'Question A?',
        'Question B?',
        'Question C?',
        'Question D?',
      ];

      const result = transformOpenQuestions(questions);
      const ids = result.map(q => q.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('Test 2.3: Transformed questions preserve original text', () => {
    it('should preserve the original question text in each OpenQuestion', () => {
      const questions = [
        'What is the max file size?',
        'Should we support internationalization?',
        'What logging level is required?',
      ];

      const result = transformOpenQuestions(questions);

      expect(result[0].question).toBe('What is the max file size?');
      expect(result[1].question).toBe('Should we support internationalization?');
      expect(result[2].question).toBe('What logging level is required?');
    });

    it('should preserve empty string questions', () => {
      const questions = ['', 'Non-empty question?'];

      const result = transformOpenQuestions(questions);

      expect(result[0].question).toBe('');
      expect(result[1].question).toBe('Non-empty question?');
    });
  });

  describe('Test 2.4: Empty array input returns empty array output', () => {
    it('should return empty array when input is empty', () => {
      const result = transformOpenQuestions([]);

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Test 2.5: Validation integrates with transformation', () => {
    it('should return OpenQuestion[] in valid plannerResponse', () => {
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: 'I understand your requirements.',
        featureUnderstanding: 'A feature to add user login',
        scope: {
          in: ['Login form', 'Password validation'],
          out: ['Social login'],
        },
        assumptions: ['Users have email accounts'],
        acceptanceCriteria: ['User can log in'],
        openQuestions: ['What password rules?', 'What lockout policy?'],
        plannerReadyForSpec: false,
        implementationPlan: null,
      });

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse).toBeDefined();
      expect(result.plannerResponse!.openQuestions).toHaveLength(2);

      // Verify each question is transformed to OpenQuestion format
      result.plannerResponse!.openQuestions.forEach(q => {
        expect(q).toHaveProperty('id');
        expect(q).toHaveProperty('question');
        expect(q.id).toMatch(UUID_V4_REGEX);
      });

      // Verify original text is preserved
      expect(result.plannerResponse!.openQuestions[0].question).toBe('What password rules?');
      expect(result.plannerResponse!.openQuestions[1].question).toBe('What lockout policy?');
    });

    it('should return empty OpenQuestion[] for empty openQuestions', () => {
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: 'No questions at this time.',
        featureUnderstanding: 'Feature is clear',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: null,
      });

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse!.openQuestions).toEqual([]);
    });
  });

  describe('Test 2.6: Fallback response has correct OpenQuestion[] type', () => {
    it('should return empty OpenQuestion[] in fallback response', () => {
      const fallback = createFallbackPlannerResponse();

      expect(fallback.openQuestions).toEqual([]);
      expect(Array.isArray(fallback.openQuestions)).toBe(true);
    });
  });
});
