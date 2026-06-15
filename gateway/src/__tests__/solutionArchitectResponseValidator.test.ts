/**
 * Tests for Solution Architect Response Validator
 *
 * Spec 2026-02-13: SA Increment 1 - Add Solution Architect Mode
 * Task Group 3: Solution Architect Response Validator
 *
 * Spec 2026-02-13: SA Increment 3 - Section Enum Expansion (7 to 9 sections)
 * Task Group 1: Section Enum Expansion -- Types and Validator (R-1, R-8)
 * Document Intake: Section Enum Expansion (9 to 10 sections, added document_intake)
 *
 * Original tests (updated for 10-section set):
 * 1. Valid response with phase="questions" parses correctly (all 4 fields extracted)
 * 2. Valid response with phase="ready" and empty questions array parses correctly
 * 3. Invalid phase value (e.g., "planning") returns { valid: false }
 * 4. Invalid section value (e.g., "unknown_section") returns { valid: false }
 * 5. createFallbackSolutionArchitectResponse() returns expected safe defaults
 *
 * New tests (SA Increment 3 - Task Group 1):
 * 7. Valid response with `non_functional` section is accepted
 * 8. Response with old `non_functional_requirements` section is rejected as invalid
 * 9. Valid response with `artefact_review` section is accepted
 * 10. Valid response with `final_review` section is accepted
 * 11. Valid `phase="ready"` response with `section="final_review"` is accepted
 * 12. `createFallbackSolutionArchitectResponse()` still returns `section: 'context_and_boundaries'` (R-8 confirmation)
 */

import {
  validateSolutionArchitectResponse,
  createFallbackSolutionArchitectResponse,
} from '../services/solutionArchitectResponseValidator';

// Mock logger
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

describe('solutionArchitectResponseValidator', () => {
  describe('validateSolutionArchitectResponse', () => {
    it('should validate a valid "questions" phase response correctly (all 4 fields extracted)', () => {
      const validJson = JSON.stringify({
        phase: 'questions',
        section: 'context_and_boundaries',
        questions: [
          'What is the primary purpose of this system?',
          'Who are the main users?',
        ],
        summary: 'Let me understand the context and boundaries of your system.',
      });

      const result = validateSolutionArchitectResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.solutionArchitectResponse).toBeDefined();
      expect(result.solutionArchitectResponse?.phase).toBe('questions');
      expect(result.solutionArchitectResponse?.section).toBe('context_and_boundaries');
      expect(result.solutionArchitectResponse?.questions).toHaveLength(2);
      expect(result.solutionArchitectResponse?.questions[0]).toBe(
        'What is the primary purpose of this system?'
      );
      expect(result.solutionArchitectResponse?.questions[1]).toBe(
        'Who are the main users?'
      );
      expect(result.solutionArchitectResponse?.summary).toBe(
        'Let me understand the context and boundaries of your system.'
      );
      expect(result.error).toBeUndefined();
    });

    it('should validate a valid "ready" phase response with empty questions array correctly', () => {
      const validJson = JSON.stringify({
        phase: 'ready',
        section: 'final_review',
        questions: [],
        summary: 'Architecture baseline is ready. We have covered all major sections.',
      });

      const result = validateSolutionArchitectResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.solutionArchitectResponse).toBeDefined();
      expect(result.solutionArchitectResponse?.phase).toBe('ready');
      expect(result.solutionArchitectResponse?.section).toBe('final_review');
      expect(result.solutionArchitectResponse?.questions).toHaveLength(0);
      expect(result.solutionArchitectResponse?.summary).toBe(
        'Architecture baseline is ready. We have covered all major sections.'
      );
      expect(result.error).toBeUndefined();
    });

    it('should return { valid: false } for invalid phase value (e.g., "planning")', () => {
      const invalidJson = JSON.stringify({
        phase: 'planning',
        section: 'context_and_boundaries',
        questions: ['test question'],
        summary: 'test summary',
      });

      const result = validateSolutionArchitectResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('phase');
      expect(result.error).toContain('planning');
      expect(result.solutionArchitectResponse).toBeUndefined();
    });

    it('should return { valid: false } for invalid section value (e.g., "unknown_section")', () => {
      const invalidJson = JSON.stringify({
        phase: 'questions',
        section: 'unknown_section',
        questions: ['test question'],
        summary: 'test summary',
      });

      const result = validateSolutionArchitectResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('section');
      expect(result.error).toContain('unknown_section');
      expect(result.solutionArchitectResponse).toBeUndefined();
    });

    // =========================================================================
    // SA Increment 3 -- Task Group 1: New tests for 9-section validator
    // =========================================================================

    it('should accept a valid response with document_intake section (Document Intake Test 1)', () => {
      const validJson = JSON.stringify({
        phase: 'questions',
        section: 'document_intake',
        questions: ['Do you have any existing business, architectural, or requirements documents you would like to share before we begin?'],
        summary: 'Before we start structured discovery, I would like to check whether you have any existing documents to share.',
      });

      const result = validateSolutionArchitectResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.solutionArchitectResponse).toBeDefined();
      expect(result.solutionArchitectResponse?.section).toBe('document_intake');
      expect(result.solutionArchitectResponse?.phase).toBe('questions');
      expect(result.solutionArchitectResponse?.questions).toHaveLength(1);
    });

    it('should accept a valid response with non_functional section (SA Inc 3 Test 1)', () => {
      const validJson = JSON.stringify({
        phase: 'questions',
        section: 'non_functional',
        questions: ['What are your performance targets?'],
        summary: 'Let us discuss non-functional requirements.',
      });

      const result = validateSolutionArchitectResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.solutionArchitectResponse).toBeDefined();
      expect(result.solutionArchitectResponse?.section).toBe('non_functional');
    });

    it('should reject old non_functional_requirements section as invalid (SA Inc 3 Test 2)', () => {
      const invalidJson = JSON.stringify({
        phase: 'questions',
        section: 'non_functional_requirements',
        questions: ['What are your performance targets?'],
        summary: 'Let us discuss non-functional requirements.',
      });

      const result = validateSolutionArchitectResponse(invalidJson);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('section');
      expect(result.error).toContain('non_functional_requirements');
    });

    it('should accept a valid response with artefact_review section (SA Inc 3 Test 3)', () => {
      const validJson = JSON.stringify({
        phase: 'questions',
        section: 'artefact_review',
        questions: ['Do you have any additional documents or diagrams to upload?'],
        summary: 'Let us review any additional artefacts you may have.',
      });

      const result = validateSolutionArchitectResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.solutionArchitectResponse).toBeDefined();
      expect(result.solutionArchitectResponse?.section).toBe('artefact_review');
    });

    it('should accept a valid response with final_review section (SA Inc 3 Test 4)', () => {
      const validJson = JSON.stringify({
        phase: 'questions',
        section: 'final_review',
        questions: ['Does this architecture recap look correct?'],
        summary: 'Here is a consolidated architecture recap with all assumptions and open items.',
      });

      const result = validateSolutionArchitectResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.solutionArchitectResponse).toBeDefined();
      expect(result.solutionArchitectResponse?.section).toBe('final_review');
    });

    it('should accept a valid phase="ready" response with section="final_review" (SA Inc 3 Test 5)', () => {
      const validJson = JSON.stringify({
        phase: 'ready',
        section: 'final_review',
        questions: [],
        summary: 'Architecture baseline is complete. Would you like to save?',
      });

      const result = validateSolutionArchitectResponse(validJson);

      expect(result.valid).toBe(true);
      expect(result.solutionArchitectResponse).toBeDefined();
      expect(result.solutionArchitectResponse?.phase).toBe('ready');
      expect(result.solutionArchitectResponse?.section).toBe('final_review');
      expect(result.solutionArchitectResponse?.questions).toHaveLength(0);
    });
  });

  describe('createFallbackSolutionArchitectResponse', () => {
    it('should return expected safe defaults', () => {
      const fallback = createFallbackSolutionArchitectResponse();

      expect(fallback.phase).toBe('questions');
      expect(fallback.section).toBe('context_and_boundaries');
      expect(fallback.questions).toEqual([]);
      expect(fallback.summary).toBe('');

      // Verify the shape is complete with all 4 fields
      expect(fallback).toHaveProperty('phase');
      expect(fallback).toHaveProperty('section');
      expect(fallback).toHaveProperty('questions');
      expect(fallback).toHaveProperty('summary');
      expect(Object.keys(fallback)).toHaveLength(4);
      expect(Array.isArray(fallback.questions)).toBe(true);
    });

    it('should still return section: "context_and_boundaries" after enum expansion (R-8 confirmation, SA Inc 3 Test 6)', () => {
      const fallback = createFallbackSolutionArchitectResponse();

      // R-8: Fallback response must continue to return section: 'context_and_boundaries'
      // This confirms the fallback was not inadvertently changed during the 7-to-9 section expansion
      expect(fallback.section).toBe('context_and_boundaries');
      expect(fallback.phase).toBe('questions');
    });
  });
});
