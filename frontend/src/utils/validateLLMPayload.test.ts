/**
 * Tests for LLM Payload Validation
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 9: Validation and Error Handling
 */

import { describe, it, expect } from 'vitest';
import {
  validatePlannerResponse,
  validateImplementerResponse,
  validateQuestions,
  validateLLMPayload,
} from './validateLLMPayload';

describe('validateLLMPayload', () => {
  describe('validatePlannerResponse', () => {
    /**
     * Test 1: Valid PlannerResponse payload passes validation.
     */
    it('valid PlannerResponse with all required fields passes', () => {
      // Given
      const validPayload = {
        schemaVersion: '1.1',
        message: 'Test message',
        featureUnderstanding: 'Test feature understanding',
        scope: { in: ['item1'], out: ['item2'] },
        assumptions: ['assumption1'],
        acceptanceCriteria: ['criteria1'],
        openQuestions: [{ id: 'q1', question: 'What is X?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // When
      const result = validatePlannerResponse(validPayload);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    /**
     * Test 2: Malformed PlannerResponse is rejected.
     */
    it('malformed PlannerResponse is rejected with specific errors', () => {
      // Given
      const invalidPayload = {
        schemaVersion: '1.0', // wrong version
        message: 123, // should be string
        // missing featureUnderstanding
        scope: { in: 'not an array' }, // missing out
        // missing assumptions
        // missing acceptanceCriteria
        openQuestions: 'not an array', // should be array
        plannerReadyForSpec: 'yes', // should be boolean
      };

      // When
      const result = validatePlannerResponse(invalidPayload);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors).toContain("Invalid schemaVersion: expected '1.1', got '1.0'");
      expect(result.errors).toContain('Invalid message: expected string, got number');
      expect(result.errors.some(e => e.includes('featureUnderstanding'))).toBe(true);
    });

    /**
     * Test with optional implementationPlan.
     */
    it('validates optional implementationPlan', () => {
      // Given
      const validWithPlan = {
        schemaVersion: '1.1',
        message: 'Test',
        featureUnderstanding: 'Test',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'Test Plan',
          increments: [{ id: 'INC-1', partIndex: 1, title: 'First', intent: 'First increment intent' }],
        },
      };

      // When
      const result = validatePlannerResponse(validWithPlan);

      // Then
      expect(result.valid).toBe(true);
    });
  });

  describe('validateQuestions', () => {
    /**
     * Test 3: Valid Question array passes validation.
     */
    it('valid Question array passes', () => {
      // Given
      const validQuestions = [
        {
          id: 'q1',
          question: 'What is X?',
          status: 'Open',
          answer: '',
          source: 'Product Manager',
        },
        {
          id: 'q2',
          question: 'How to do Y?',
          status: 'Answered',
          answer: 'Do this way',
          source: 'Software Developer',
          incrementId: 'INC-1',
        },
      ];

      // When
      const result = validateQuestions(validQuestions);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    /**
     * Test: Invalid questions are rejected.
     */
    it('rejects invalid questions with specific errors', () => {
      // Given
      const invalidQuestions = [
        {
          id: 123, // should be string
          question: 'Valid question',
          status: 'Pending', // invalid status
          answer: '', // valid
          source: 'Unknown', // invalid source
        },
      ];

      // When
      const result = validateQuestions(invalidQuestions);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('id: expected string'))).toBe(true);
      expect(result.errors.some(e => e.includes('status'))).toBe(true);
      expect(result.errors.some(e => e.includes('source'))).toBe(true);
    });
  });

  describe('validateImplementerResponse', () => {
    it('valid ImplementerResponse passes', () => {
      // Given
      const validPayload = {
        schemaVersion: '1.0',
        message: 'SA response',
        openQuestions: [{ id: 'sq1', question: 'Technical question?' }],
      };

      // When
      const result = validateImplementerResponse(validPayload);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('empty openQuestions (ready state) passes', () => {
      // Given
      const readyPayload = {
        schemaVersion: '1.0',
        message: 'All clear, ready for implementation',
        openQuestions: [],
      };

      // When
      const result = validateImplementerResponse(readyPayload);

      // Then
      expect(result.valid).toBe(true);
    });
  });

  describe('validateLLMPayload dispatcher', () => {
    /**
     * Test 4: Structurally unreadable JSON fails hard.
     */
    it('null payload fails for PlannerResponse', () => {
      // When
      const result = validateLLMPayload(null, 'PlannerResponse');

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PlannerResponse must be a non-null object');
    });

    it('non-object payload fails for ImplementerResponse', () => {
      // When
      const result = validateLLMPayload('not an object', 'ImplementerResponse');

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('ImplementerResponse must be a non-null object');
    });

    it('non-array fails for Questions', () => {
      // When
      const result = validateLLMPayload({ notAnArray: true }, 'Questions');

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Questions must be an array');
    });
  });
});
