/**
 * Integration Tests for Planner Message Sanitization in Validation Flow
 *
 * Spec 2026-01-24: Planner Message Hygiene
 * Task Group 3: Integration into Response Validator
 *
 * Tests that sanitization is correctly integrated into validatePlannerResponse.
 */

import {
  validatePlannerResponse,
  createFallbackPlannerResponse,
} from '../services/plannerResponseValidator';
import {
  TEMPLATE_WITH_QUESTIONS,
  TEMPLATE_WITHOUT_QUESTIONS,
} from '../services/plannerMessageSanitizer';

describe('Planner Message Sanitization Integration', () => {
  // Helper to create a valid planner response JSON with custom message
  function createValidResponse(message: string, openQuestions: string[] = []): string {
    return JSON.stringify({
      schemaVersion: '1.1',
      message,
      featureUnderstanding: 'A test feature',
      scope: { in: ['Item 1'], out: ['Item 2'] },
      assumptions: ['Assumption 1'],
      acceptanceCriteria: ['Criteria 1'],
      openQuestions,
      plannerReadyForSpec: false,
      implementationPlan: null,
    });
  }

  describe('sanitization in validatePlannerResponse', () => {
    it('should sanitize verbose message after JSON parse', () => {
      // Message with bullet points - should be sanitized
      const verboseMessage = 'Here are my findings:\n- First item\n- Second item\n- Third item';
      const content = createValidResponse(verboseMessage, ['Q1?', 'Q2?']);

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse).toBeDefined();
      // Message should be replaced with template
      expect(result.plannerResponse?.message).toContain('I have 2 questions');
      expect(result.plannerResponse?.message).not.toContain('First item');
    });

    it('should include sanitized message in returned PlannerResponse', () => {
      // Message exceeding length limit
      const longMessage = 'This is a very detailed explanation. '.repeat(15); // >300 chars
      const content = createValidResponse(longMessage, ['Question 1?']);

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse).toBeDefined();
      expect(result.plannerResponse?.message.length).toBeLessThan(300);
      expect(result.plannerResponse?.message).toBe(
        TEMPLATE_WITH_QUESTIONS.replace('{N}', '1')
      );
    });

    it('should not modify clean message', () => {
      const cleanMessage = 'I understand your requirements. I have some questions for you.';
      const content = createValidResponse(cleanMessage, ['Q1?']);

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.message).toBe(cleanMessage);
    });

    it('should use template without questions when openQuestions is empty', () => {
      const verboseMessage = 'Questions:\n1. First question\n2. Second question';
      const content = createValidResponse(verboseMessage, []); // No questions

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.message).toBe(TEMPLATE_WITHOUT_QUESTIONS);
      expect(result.plannerResponse?.message).toContain('based on our discussion');
    });

    it('should sanitize message for refine phase', () => {
      const messageWithFieldLabels = 'Scope: The feature includes login.\nAssumptions: Users have emails.';
      const content = createValidResponse(messageWithFieldLabels, ['Q1?', 'Q2?', 'Q3?']);

      const result = validatePlannerResponse(content, false); // refine phase

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.message).toContain('I have 3 questions');
      expect(result.plannerResponse?.message).not.toContain('Scope:');
    });

    it('should sanitize message for implementation_planning phase', () => {
      const verboseMessage = 'Here is the detailed plan:\n- Step 1\n- Step 2\n- Step 3';
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: verboseMessage,
        featureUnderstanding: 'A test feature',
        scope: { in: ['Item 1'], out: ['Item 2'] },
        assumptions: ['Assumption 1'],
        acceptanceCriteria: ['Criteria 1'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'Test Plan',
          increments: [
            {
              id: 'INC-1',
              partIndex: 1,
              title: 'First Increment',
              intent: 'Do something detailed here',
            },
          ],
        },
      });

      const result = validatePlannerResponse(content, true); // implementation_planning phase

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.message).toBe(TEMPLATE_WITHOUT_QUESTIONS);
      expect(result.plannerResponse?.message).not.toContain('Step 1');
    });

    it('should detect multiple violations and sanitize', () => {
      // Message with multiple violations: bullets, field labels, length
      const multiViolationMessage = `Questions:
- What is the requirement for the password validation rules that should be enforced in the login form?
- Should we support social login integrations like Google and Facebook?

Assumptions:
- Users have valid email addresses
- The system will use JWT tokens for authentication`;

      const content = createValidResponse(multiViolationMessage, ['Q1?', 'Q2?']);

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.message).toContain('I have 2 questions');
      // Should not contain any of the verbose content
      expect(result.plannerResponse?.message).not.toContain('password validation');
      expect(result.plannerResponse?.message).not.toContain('Assumptions');
    });
  });

  describe('sanitization preserves other fields', () => {
    it('should preserve all non-message fields when sanitizing', () => {
      const verboseMessage = 'Detailed info:\n- Point 1\n- Point 2';
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: verboseMessage,
        featureUnderstanding: 'Feature definition here',
        scope: { in: ['In scope item'], out: ['Out of scope item'] },
        assumptions: ['Assumption A', 'Assumption B'],
        acceptanceCriteria: ['AC1', 'AC2'],
        openQuestions: ['Question 1?', 'Question 2?'],
        plannerReadyForSpec: false,
        implementationPlan: null,
      });

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.featureUnderstanding).toBe('Feature definition here');
      expect(result.plannerResponse?.scope.in).toEqual(['In scope item']);
      expect(result.plannerResponse?.scope.out).toEqual(['Out of scope item']);
      expect(result.plannerResponse?.assumptions).toEqual(['Assumption A', 'Assumption B']);
      expect(result.plannerResponse?.acceptanceCriteria).toEqual(['AC1', 'AC2']);
      expect(result.plannerResponse?.openQuestions).toHaveLength(2);
      expect(result.plannerResponse?.plannerReadyForSpec).toBe(false);
      // Only message is sanitized
      expect(result.plannerResponse?.message).toContain('I have 2 questions');
    });
  });

  describe('sanitization with duplicated question content', () => {
    it('should sanitize when question content is duplicated in message', () => {
      const questionContent = 'What password validation rules should be enforced in the login form?';
      const message = `I have a question: ${questionContent}`;
      const content = createValidResponse(message, [questionContent, 'Another question?']);

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      // Should be sanitized because question content is duplicated
      expect(result.plannerResponse?.message).toContain('I have 2 questions');
      expect(result.plannerResponse?.message).not.toContain('password validation');
    });
  });

  describe('edge cases', () => {
    it('should handle message at exactly 300 characters', () => {
      // Exactly 300 characters should NOT be sanitized for length
      const exactLengthMessage = 'a'.repeat(300);
      const content = createValidResponse(exactLengthMessage, ['Q1?']);

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      // 300 chars exactly should pass (not exceed limit)
      // But message is also single paragraph, no bullets, etc.
      expect(result.plannerResponse?.message).toBe(exactLengthMessage);
    });

    it('should handle message at 301 characters (just over limit)', () => {
      const overLengthMessage = 'a'.repeat(301);
      const content = createValidResponse(overLengthMessage, ['Q1?']);

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      // Should be sanitized for exceeding length
      expect(result.plannerResponse?.message).toContain('I have 1 questions');
    });
  });
});
