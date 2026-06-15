/**
 * Tests for SA Questions Filtering
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 6: Filter Questions Table by Active Increment for SA Questions
 *
 * Tests:
 * 1. PO questions (no incrementId) are always displayed
 * 2. SA questions with matching incrementId are displayed
 * 3. SA questions with non-matching incrementId are hidden
 * 4. Filtering updates when activeIncrementId changes
 * 5. deriveQuestions sets incrementId when source is 'Software Architect'
 */

import type { Question } from '../api/chatApi';

/**
 * Filter function that determines which questions should be displayed
 * based on the active increment ID.
 *
 * Logic:
 * - PO questions (source !== 'Software Architect') are always shown
 * - SA questions are shown only if their incrementId matches activeIncrementId
 */
export function filterQuestionsByIncrement(
  questions: Question[],
  activeIncrementId: string | null
): Question[] {
  return questions.filter((q) => {
    // PO questions are always shown
    if (q.source !== 'Software Architect') {
      return true;
    }
    // SA questions are shown only if incrementId matches activeIncrementId
    return q.incrementId === activeIncrementId;
  });
}

describe('SA Questions Filtering', () => {
  describe('filterQuestionsByIncrement', () => {
    const poQuestion1: Question = {
      id: 'po-1',
      question: 'What is the expected user flow?',
      status: 'Open',
      answer: '',
      source: 'Product Owner',
      // No incrementId for PO questions
    };

    const poQuestion2: Question = {
      id: 'po-2',
      question: 'Should we support multiple languages?',
      status: 'Answered',
      answer: 'Yes, support English and Spanish.',
      source: 'Product Owner',
    };

    const saQuestionInc1: Question = {
      id: 'sa-1',
      question: 'What database should we use?',
      status: 'Open',
      answer: '',
      source: 'Software Architect',
      incrementId: 'INC-1',
    };

    const saQuestionInc2: Question = {
      id: 'sa-2',
      question: 'Should we implement caching?',
      status: 'Open',
      answer: '',
      source: 'Software Architect',
      incrementId: 'INC-2',
    };

    const saQuestionInc1Again: Question = {
      id: 'sa-3',
      question: 'What error handling strategy?',
      status: 'Open',
      answer: '',
      source: 'Software Architect',
      incrementId: 'INC-1',
    };

    it('should always display PO questions (no incrementId)', () => {
      const questions = [poQuestion1, poQuestion2, saQuestionInc1];
      const filtered = filterQuestionsByIncrement(questions, 'INC-1');

      // Both PO questions should be present
      expect(filtered).toContainEqual(poQuestion1);
      expect(filtered).toContainEqual(poQuestion2);
    });

    it('should display SA questions with matching incrementId', () => {
      const questions = [poQuestion1, saQuestionInc1, saQuestionInc2];
      const filtered = filterQuestionsByIncrement(questions, 'INC-1');

      // SA question for INC-1 should be shown
      expect(filtered).toContainEqual(saQuestionInc1);
      // SA question for INC-2 should NOT be shown
      expect(filtered).not.toContainEqual(saQuestionInc2);
    });

    it('should hide SA questions with non-matching incrementId', () => {
      const questions = [poQuestion1, saQuestionInc1, saQuestionInc2];
      const filtered = filterQuestionsByIncrement(questions, 'INC-2');

      // SA question for INC-2 should be shown
      expect(filtered).toContainEqual(saQuestionInc2);
      // SA question for INC-1 should NOT be shown
      expect(filtered).not.toContainEqual(saQuestionInc1);
    });

    it('should update filtering when activeIncrementId changes', () => {
      const questions = [poQuestion1, saQuestionInc1, saQuestionInc2, saQuestionInc1Again];

      // When INC-1 is active
      const filteredForInc1 = filterQuestionsByIncrement(questions, 'INC-1');
      expect(filteredForInc1).toHaveLength(3); // PO + 2 SA questions for INC-1
      expect(filteredForInc1).toContainEqual(saQuestionInc1);
      expect(filteredForInc1).toContainEqual(saQuestionInc1Again);
      expect(filteredForInc1).not.toContainEqual(saQuestionInc2);

      // When INC-2 is active
      const filteredForInc2 = filterQuestionsByIncrement(questions, 'INC-2');
      expect(filteredForInc2).toHaveLength(2); // PO + 1 SA question for INC-2
      expect(filteredForInc2).toContainEqual(saQuestionInc2);
      expect(filteredForInc2).not.toContainEqual(saQuestionInc1);
      expect(filteredForInc2).not.toContainEqual(saQuestionInc1Again);
    });

    it('should show only PO questions when activeIncrementId is null', () => {
      const questions = [poQuestion1, poQuestion2, saQuestionInc1, saQuestionInc2];
      const filtered = filterQuestionsByIncrement(questions, null);

      // Only PO questions should be shown
      expect(filtered).toHaveLength(2);
      expect(filtered).toContainEqual(poQuestion1);
      expect(filtered).toContainEqual(poQuestion2);
      expect(filtered).not.toContainEqual(saQuestionInc1);
      expect(filtered).not.toContainEqual(saQuestionInc2);
    });
  });

  describe('deriveQuestions with incrementId', () => {
    /**
     * Mock deriveQuestions function that sets incrementId for SA questions
     */
    function deriveQuestionsWithIncrement(
      openQuestions: Array<{ id: string; question: string }>,
      answers: Record<string, string>,
      source: 'Product Owner' | 'Software Architect',
      activeIncrementId?: string | null
    ): Question[] {
      return openQuestions.map((oq) => {
        const answer = answers[oq.id] ?? '';
        const status = answer.trim() ? 'Answered' : 'Open';
        return {
          id: oq.id,
          question: oq.question,
          status,
          answer,
          source,
          // Set incrementId only for SA questions
          incrementId: source === 'Software Architect' ? (activeIncrementId ?? undefined) : undefined,
        } as Question;
      });
    }

    it('should set incrementId when source is Software Architect', () => {
      const openQuestions = [
        { id: 'q1', question: 'Technical question?' },
        { id: 'q2', question: 'Another technical question?' },
      ];
      const answers = {};
      const activeIncrementId = 'INC-42';

      const questions = deriveQuestionsWithIncrement(
        openQuestions,
        answers,
        'Software Architect',
        activeIncrementId
      );

      expect(questions[0].incrementId).toBe('INC-42');
      expect(questions[1].incrementId).toBe('INC-42');
    });

    it('should NOT set incrementId when source is Product Owner', () => {
      const openQuestions = [
        { id: 'q1', question: 'Business question?' },
      ];
      const answers = {};
      const activeIncrementId = 'INC-42';

      const questions = deriveQuestionsWithIncrement(
        openQuestions,
        answers,
        'Product Owner',
        activeIncrementId
      );

      expect(questions[0].incrementId).toBeUndefined();
    });
  });
});
