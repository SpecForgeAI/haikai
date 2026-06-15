/**
 * Tests for Question.incrementId field
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 5: Frontend Question Type - Add incrementId
 *
 * Tests:
 * 1. Question interface includes optional incrementId field
 * 2. incrementId is undefined for PO questions (no increment context)
 * 3. incrementId is populated for SA questions (linked to specific increment)
 */

import type { Question } from '../api/chatApi';

describe('Question incrementId field', () => {
  describe('Question interface', () => {
    it('should allow Question without incrementId (PO questions)', () => {
      // PO questions do not have an incrementId - they are feature-level
      const poQuestion: Question = {
        id: 'q-uuid-1',
        question: 'What is the expected user flow?',
        status: 'Open',
        answer: '',
        source: 'Product Owner',
        // incrementId is optional and omitted
      };

      expect(poQuestion.id).toBe('q-uuid-1');
      expect(poQuestion.source).toBe('Product Owner');
      expect(poQuestion.incrementId).toBeUndefined();
    });

    it('should allow Question with incrementId (SA questions)', () => {
      // SA questions are linked to a specific increment
      const saQuestion: Question = {
        id: 'q-uuid-2',
        question: 'What error handling strategy should be used?',
        status: 'Open',
        answer: '',
        source: 'Software Architect',
        incrementId: 'INC-1', // Linked to increment INC-1
      };

      expect(saQuestion.id).toBe('q-uuid-2');
      expect(saQuestion.source).toBe('Software Architect');
      expect(saQuestion.incrementId).toBe('INC-1');
    });

    it('should allow incrementId to be undefined explicitly', () => {
      const question: Question = {
        id: 'q-uuid-3',
        question: 'What database should be used?',
        status: 'Answered',
        answer: 'PostgreSQL',
        source: 'Product Owner',
        incrementId: undefined, // Explicitly undefined
      };

      expect(question.incrementId).toBeUndefined();
    });
  });

  describe('PO vs SA question differentiation', () => {
    it('should distinguish PO questions (no incrementId) from SA questions (with incrementId)', () => {
      const questions: Question[] = [
        {
          id: 'po-1',
          question: 'PO question',
          status: 'Open',
          answer: '',
          source: 'Product Owner',
        },
        {
          id: 'sa-1',
          question: 'SA question for INC-1',
          status: 'Open',
          answer: '',
          source: 'Software Architect',
          incrementId: 'INC-1',
        },
        {
          id: 'sa-2',
          question: 'SA question for INC-2',
          status: 'Open',
          answer: '',
          source: 'Software Architect',
          incrementId: 'INC-2',
        },
      ];

      // Filter PO questions (no incrementId or source === 'Product Owner')
      const poQuestions = questions.filter((q) => !q.incrementId);
      expect(poQuestions).toHaveLength(1);
      expect(poQuestions[0].id).toBe('po-1');

      // Filter SA questions for specific increment
      const inc1Questions = questions.filter((q) => q.incrementId === 'INC-1');
      expect(inc1Questions).toHaveLength(1);
      expect(inc1Questions[0].id).toBe('sa-1');

      const inc2Questions = questions.filter((q) => q.incrementId === 'INC-2');
      expect(inc2Questions).toHaveLength(1);
      expect(inc2Questions[0].id).toBe('sa-2');
    });
  });
});
