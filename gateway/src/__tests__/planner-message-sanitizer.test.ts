/**
 * Tests for Planner Message Sanitizer
 *
 * Spec 2026-01-24: Planner Message Hygiene
 * Task Group 2: Message Sanitizer Service Implementation
 * Task Group 4: Test Review and Gap Analysis - Additional Edge Case Tests
 */

import {
  sanitizePlannerMessage,
  hasBulletPoints,
  hasNumberedList,
  hasFieldLabels,
  hasSectionHeaders,
  hasMultipleNewlines,
  exceedsLengthLimit,
  hasQuestionSubstring,
  generateReplacementMessage,
  TEMPLATE_WITH_QUESTIONS,
  TEMPLATE_WITHOUT_QUESTIONS,
  MESSAGE_LENGTH_LIMIT,
  SanitizationResult,
} from '../services/plannerMessageSanitizer';
import type { OpenQuestion } from '../types/chat';

describe('plannerMessageSanitizer', () => {
  // ============================================================================
  // Pattern Detection Tests
  // ============================================================================

  describe('hasBulletPoints', () => {
    it('should detect lines starting with dash', () => {
      expect(hasBulletPoints('- Item one\n- Item two')).toBe(true);
    });

    it('should detect lines starting with asterisk', () => {
      expect(hasBulletPoints('* First point\n* Second point')).toBe(true);
    });

    it('should detect indented bullet points', () => {
      expect(hasBulletPoints('  - Indented item')).toBe(true);
    });

    it('should return false for plain text with dash in middle', () => {
      expect(hasBulletPoints('This has a - dash in the middle')).toBe(false);
    });

    it('should return false for clean single-line message', () => {
      expect(hasBulletPoints('I understand your requirements.')).toBe(false);
    });
  });

  describe('hasNumberedList', () => {
    it('should detect numbered list with period', () => {
      expect(hasNumberedList('1. First item\n2. Second item')).toBe(true);
    });

    it('should detect numbered list with parenthesis', () => {
      expect(hasNumberedList('1) First item\n2) Second item')).toBe(true);
    });

    it('should detect indented numbered list', () => {
      expect(hasNumberedList('  3. Indented item')).toBe(true);
    });

    it('should return false for number in middle of text', () => {
      expect(hasNumberedList('I have 3 questions for you.')).toBe(false);
    });

    it('should return false for clean message', () => {
      expect(hasNumberedList("I've updated the scope.")).toBe(false);
    });
  });

  describe('hasFieldLabels', () => {
    it('should detect "Questions:" label', () => {
      expect(hasFieldLabels('Questions: Here are my questions')).toBe(true);
    });

    it('should detect "Scope:" label', () => {
      expect(hasFieldLabels('Scope: The feature includes...')).toBe(true);
    });

    it('should detect "Acceptance Criteria:" label', () => {
      expect(hasFieldLabels('Acceptance Criteria: User can...')).toBe(true);
    });

    it('should detect "Assumptions:" label', () => {
      expect(hasFieldLabels('Assumptions: We assume that...')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(hasFieldLabels('QUESTIONS: Here are my questions')).toBe(true);
      expect(hasFieldLabels('scope: the feature includes...')).toBe(true);
    });

    it('should return false for word "scope" without colon', () => {
      expect(hasFieldLabels('Let me clarify the scope of this feature.')).toBe(false);
    });
  });

  describe('hasSectionHeaders', () => {
    it('should detect "Open Questions" header', () => {
      expect(hasSectionHeaders('Open Questions\n1. What is...')).toBe(true);
    });

    it('should detect "Assumptions" header', () => {
      expect(hasSectionHeaders('Assumptions\n- We assume...')).toBe(true);
    });

    it('should detect "Acceptance Criteria" header', () => {
      expect(hasSectionHeaders('Acceptance Criteria\n- User can...')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(hasSectionHeaders('OPEN QUESTIONS\n1. What...')).toBe(true);
    });

    it('should return false for clean message', () => {
      expect(hasSectionHeaders('I have 3 questions for you to answer.')).toBe(false);
    });
  });

  describe('hasMultipleNewlines', () => {
    it('should detect two newlines', () => {
      expect(hasMultipleNewlines('First paragraph.\n\nSecond paragraph.')).toBe(true);
    });

    it('should detect multiple newlines with content between', () => {
      expect(hasMultipleNewlines('Line 1\nLine 2\nLine 3')).toBe(true);
    });

    it('should return false for single newline at end', () => {
      expect(hasMultipleNewlines('Single line message\n')).toBe(false);
    });

    it('should return false for no newlines', () => {
      expect(hasMultipleNewlines('A simple single-line message.')).toBe(false);
    });
  });

  describe('exceedsLengthLimit', () => {
    it('should return true for message exceeding default limit', () => {
      const longMessage = 'a'.repeat(301);
      expect(exceedsLengthLimit(longMessage)).toBe(true);
    });

    it('should return false for message at exactly the limit', () => {
      const exactMessage = 'a'.repeat(300);
      expect(exceedsLengthLimit(exactMessage)).toBe(false);
    });

    it('should return false for short message', () => {
      expect(exceedsLengthLimit('Short message.')).toBe(false);
    });

    it('should respect custom limit parameter', () => {
      expect(exceedsLengthLimit('12345', 4)).toBe(true);
      expect(exceedsLengthLimit('1234', 4)).toBe(false);
    });
  });

  describe('hasQuestionSubstring', () => {
    const openQuestions: OpenQuestion[] = [
      { id: 'q1', question: 'What password validation rules should be enforced?' },
      { id: 'q2', question: 'Should we support social login?' },
    ];

    it('should detect duplicated question content', () => {
      const message = 'I need to know: What password validation rules should be enforced?';
      const result = hasQuestionSubstring(message, openQuestions);
      expect(result.matched).toBe(true);
      expect(result.matchedQuestions).toHaveLength(1);
      expect(result.matchedQuestions[0]).toContain('password validation');
    });

    it('should be case-insensitive', () => {
      const message = 'Please answer: SHOULD WE SUPPORT SOCIAL LOGIN?';
      const result = hasQuestionSubstring(message, openQuestions);
      expect(result.matched).toBe(true);
    });

    it('should return false when no questions duplicated', () => {
      const message = 'I have 2 questions for you to answer.';
      const result = hasQuestionSubstring(message, openQuestions);
      expect(result.matched).toBe(false);
      expect(result.matchedQuestions).toHaveLength(0);
    });

    it('should return false for empty openQuestions array', () => {
      const result = hasQuestionSubstring('Any message here.', []);
      expect(result.matched).toBe(false);
    });

    it('should skip very short questions to avoid false positives', () => {
      const shortQuestions: OpenQuestion[] = [
        { id: 'q1', question: 'Why?' }, // Too short, should be skipped
      ];
      const message = 'Why is this happening? Let me explain.';
      const result = hasQuestionSubstring(message, shortQuestions);
      expect(result.matched).toBe(false);
    });
  });

  // ============================================================================
  // Replacement Template Tests
  // ============================================================================

  describe('generateReplacementMessage', () => {
    it('should generate message with question count when questions exist', () => {
      const result = generateReplacementMessage(3);
      expect(result).toContain('I have 3 questions');
      expect(result).toBe(TEMPLATE_WITH_QUESTIONS.replace('{N}', '3'));
    });

    it('should generate message without questions when count is zero', () => {
      const result = generateReplacementMessage(0);
      expect(result).toBe(TEMPLATE_WITHOUT_QUESTIONS);
      expect(result).toContain('based on our discussion');
    });

    it('should handle single question', () => {
      const result = generateReplacementMessage(1);
      expect(result).toContain('I have 1 questions');
    });
  });

  // ============================================================================
  // Main Sanitization Function Tests
  // ============================================================================

  describe('sanitizePlannerMessage', () => {
    const openQuestions: OpenQuestion[] = [
      { id: 'q1', question: 'What password rules should apply?' },
      { id: 'q2', question: 'Should error messages be detailed?' },
    ];

    it('should return unchanged message when no violations detected', () => {
      const cleanMessage = 'I understand your requirements. I have 2 questions for you.';
      const result = sanitizePlannerMessage(cleanMessage, openQuestions);

      expect(result.sanitized).toBe(false);
      expect(result.message).toBe(cleanMessage);
      expect(result.reasons).toHaveLength(0);
    });

    it('should sanitize message with bullet points', () => {
      const message = 'Here are my questions:\n- Question 1\n- Question 2';
      const result = sanitizePlannerMessage(message, openQuestions);

      expect(result.sanitized).toBe(true);
      expect(result.message).toContain('I have 2 questions');
      expect(result.reasons).toContain('bullet_points');
    });

    it('should sanitize message with numbered list', () => {
      const message = 'My questions:\n1. First question\n2. Second question';
      const result = sanitizePlannerMessage(message, openQuestions);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('numbered_list');
    });

    it('should sanitize message with field labels', () => {
      const message = 'Questions: What about X? Scope: We include Y.';
      const result = sanitizePlannerMessage(message, openQuestions);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('field_labels');
    });

    it('should sanitize message exceeding length limit', () => {
      const longMessage = 'This is a very detailed message. '.repeat(20); // >300 chars
      const result = sanitizePlannerMessage(longMessage, openQuestions);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('exceeds_length_limit');
      expect(result.message.length).toBeLessThan(MESSAGE_LENGTH_LIMIT);
    });

    it('should sanitize message with duplicated question content', () => {
      const message = 'I need to know: What password rules should apply? This is important.';
      const result = sanitizePlannerMessage(message, openQuestions);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('question_content_duplicated');
    });

    it('should collect multiple violation reasons', () => {
      const message = 'Questions:\n- What password rules should apply?\n- Second question here';
      const result = sanitizePlannerMessage(message, openQuestions);

      expect(result.sanitized).toBe(true);
      expect(result.reasons.length).toBeGreaterThan(1);
      // Should have bullet_points, field_labels, possibly others
      expect(result.reasons).toContain('bullet_points');
    });

    it('should use template without questions when openQuestions is empty', () => {
      const message = 'Here is a verbose response with:\n- Bullet point 1\n- Bullet point 2';
      const result = sanitizePlannerMessage(message, []);

      expect(result.sanitized).toBe(true);
      expect(result.message).toBe(TEMPLATE_WITHOUT_QUESTIONS);
      expect(result.message).toContain('based on our discussion');
    });

    it('should handle empty message', () => {
      const result = sanitizePlannerMessage('', openQuestions);

      // Empty message should not trigger any pattern violations
      expect(result.sanitized).toBe(false);
      expect(result.message).toBe('');
    });

    it('should handle message with only whitespace', () => {
      const result = sanitizePlannerMessage('   ', openQuestions);

      // Whitespace-only should not trigger violations
      expect(result.sanitized).toBe(false);
      expect(result.message).toBe('   ');
    });
  });

  // ============================================================================
  // Task Group 4: Additional Edge Case Tests
  // ============================================================================

  describe('edge cases - combined violations', () => {
    it('should detect bullets AND exceeds length combined', () => {
      // Message with both bullets and exceeding length
      const message = `Here is a comprehensive list of everything:\n${'- Long bullet point item '.repeat(20)}`;
      const result = sanitizePlannerMessage(message, [{ id: 'q1', question: 'Test question?' }]);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('bullet_points');
      expect(result.reasons).toContain('exceeds_length_limit');
    });

    it('should detect numbered list with field labels combined', () => {
      const message = 'Questions:\n1. First\n2. Second';
      const result = sanitizePlannerMessage(message, [{ id: 'q1', question: 'Q1?' }]);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('numbered_list');
      expect(result.reasons).toContain('field_labels');
    });

    it('should detect multiple newlines with bullets combined', () => {
      // Message with bullets across multiple lines
      const message = 'First:\n- Item A\n\nSecond:\n- Item B';
      const result = sanitizePlannerMessage(message, [{ id: 'q1', question: 'Q1?' }]);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('bullet_points');
      expect(result.reasons).toContain('multiple_newlines');
    });
  });

  describe('edge cases - boundary conditions', () => {
    it('should not sanitize message at exactly 300 characters with no other violations', () => {
      const exactMessage = 'a'.repeat(300);
      const result = sanitizePlannerMessage(exactMessage, [{ id: 'q1', question: 'Q?' }]);

      expect(result.sanitized).toBe(false);
      expect(result.message).toBe(exactMessage);
    });

    it('should sanitize message at 301 characters', () => {
      const overMessage = 'a'.repeat(301);
      const result = sanitizePlannerMessage(overMessage, [{ id: 'q1', question: 'Q?' }]);

      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('exceeds_length_limit');
    });

    it('should detect multiple newlines even with minimal content', () => {
      // The hasMultipleNewlines pattern detects \n.*\n - so "X\nY" triggers it
      const message = 'Line 1\nLine 2\nLine 3';
      const result = hasMultipleNewlines(message);
      expect(result).toBe(true);
    });

    it('should not detect multiple newlines for single newline followed by nothing', () => {
      const message = 'Single line\n';
      const result = hasMultipleNewlines(message);
      expect(result).toBe(false);
    });
  });

  describe('edge cases - case sensitivity', () => {
    it('should detect "SCOPE:" regardless of case', () => {
      expect(hasFieldLabels('SCOPE: something')).toBe(true);
      expect(hasFieldLabels('Scope: something')).toBe(true);
      expect(hasFieldLabels('scope: something')).toBe(true);
    });

    it('should detect mixed case section headers', () => {
      expect(hasSectionHeaders('Open QUESTIONS here')).toBe(true);
      expect(hasSectionHeaders('ACCEPTANCE CRITERIA list')).toBe(true);
    });
  });

  describe('edge cases - question substring matching', () => {
    it('should match partial question only if full question is substring', () => {
      const questions: OpenQuestion[] = [
        { id: 'q1', question: 'What are the specific requirements for password validation?' },
      ];
      // Partial match - "password" alone should not trigger
      const partialMessage = 'We need to discuss password handling.';
      const partialResult = hasQuestionSubstring(partialMessage, questions);
      expect(partialResult.matched).toBe(false);

      // Full match - entire question as substring should trigger
      const fullMessage = 'I need to know: What are the specific requirements for password validation?';
      const fullResult = hasQuestionSubstring(fullMessage, questions);
      expect(fullResult.matched).toBe(true);
    });

    it('should detect multiple duplicated questions', () => {
      const questions: OpenQuestion[] = [
        { id: 'q1', question: 'First question about authentication?' },
        { id: 'q2', question: 'Second question about authorization?' },
      ];
      const message = 'I have questions: First question about authentication? And also Second question about authorization?';
      const result = hasQuestionSubstring(message, questions);

      expect(result.matched).toBe(true);
      expect(result.matchedQuestions).toHaveLength(2);
    });
  });

  describe('edge cases - special characters', () => {
    it('should detect section header word "assumptions" in message', () => {
      // "assumptions" triggers hasSectionHeaders because it matches \bassumptions\b
      const message = "I've updated the feature's scope & assumptions criteria.";
      const result = sanitizePlannerMessage(message, []);

      // Should trigger because "assumptions" word is present
      expect(result.sanitized).toBe(true);
      expect(result.reasons).toContain('section_headers');
    });

    it('should not trigger bullet detection for markdown emphasis', () => {
      // *text* for emphasis should not trigger bullet detection
      const message = 'This is *important* information.';
      expect(hasBulletPoints(message)).toBe(false);
    });
  });

  describe('edge cases - unicode and international', () => {
    it('should handle unicode characters in message', () => {
      const message = 'I understand the requirements for the feature.';
      const result = sanitizePlannerMessage(message, []);
      expect(result.sanitized).toBe(false);
    });
  });

  describe('edge cases - clean messages that should pass', () => {
    it('should allow short conversational message without violations', () => {
      const message = 'I understand. I have 3 questions for you.';
      const result = sanitizePlannerMessage(message, [
        { id: 'q1', question: 'Q1?' },
        { id: 'q2', question: 'Q2?' },
        { id: 'q3', question: 'Q3?' },
      ]);
      expect(result.sanitized).toBe(false);
    });

    it('should allow message with period ending sentence', () => {
      const message = 'Thank you for clarifying. I have updated the criteria.';
      const result = sanitizePlannerMessage(message, []);
      expect(result.sanitized).toBe(false);
    });
  });
});
