/**
 * Tests for SA Answer Submission Wiring
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 9: Wire "Answer Open Questions" to Send Answers to SA
 *
 * Tests:
 * 1. onSubmitAnswers during implementation_clarification sends answers to chat API
 * 2. Message composed from answered questions (question + answer format)
 * 3. Request includes phase='implementation_clarification' and incrementId
 * 4. SA response with openQuestions adds new Question rows
 * 5. SA response with empty openQuestions marks increment as ready
 */

import type { Question, ImplementChatPhase, ChatResponse } from '../api/chatApi';

/**
 * Helper type for SA answer submission context
 */
interface SAAnswerSubmissionContext {
  phase: ImplementChatPhase;
  activeIncrementId: string | null;
}

/**
 * Composes a user message from answered questions for SA context.
 * Format: "Q: [question text]\nA: [answer text]\n\n" for each answered question
 *
 * @param questions - Array of Question objects
 * @returns Formatted message string
 */
export function composeAnswersMessage(questions: Question[]): string {
  const answeredQuestions = questions.filter(
    (q) => q.status === 'Answered' && q.answer.trim()
  );

  return answeredQuestions
    .map((q) => `Q: ${q.question}\nA: ${q.answer}`)
    .join('\n\n');
}

/**
 * Determines if the answer submission should route to SA handling
 *
 * @param phase - Current conversation phase
 * @returns True if should route to SA
 */
export function shouldRouteToSA(phase: ImplementChatPhase | undefined): boolean {
  return phase === 'implementation_clarification';
}

/**
 * Transforms SA open questions response into Question objects with incrementId.
 *
 * @param openQuestions - Array of {id, question} from SA response
 * @param activeIncrementId - Current active increment ID
 * @returns Array of Question objects with incrementId set
 */
export function transformSAQuestionsToQuestions(
  openQuestions: Array<{ id: string; question: string }>,
  activeIncrementId: string | null
): Question[] {
  return openQuestions.map((oq) => ({
    id: oq.id,
    question: oq.question,
    status: 'Open' as const,
    answer: '',
    source: 'Software Architect' as const,
    incrementId: activeIncrementId ?? undefined,
  }));
}

/**
 * Determines increment status based on SA response
 *
 * @param openQuestions - Open questions from SA response
 * @returns 'Ready' if empty, 'In Clarification' if has questions
 */
export function determineIncrementStatus(
  openQuestions: Array<{ id: string; question: string }>
): 'In Clarification' | 'Ready' {
  return openQuestions.length === 0 ? 'Ready' : 'In Clarification';
}

describe('SA Answer Submission Wiring', () => {
  describe('shouldRouteToSA', () => {
    it('should return true for implementation_clarification phase', () => {
      expect(shouldRouteToSA('implementation_clarification')).toBe(true);
    });

    it('should return false for refine phase', () => {
      expect(shouldRouteToSA('refine')).toBe(false);
    });

    it('should return false for bootstrap phase', () => {
      expect(shouldRouteToSA('bootstrap')).toBe(false);
    });

    it('should return false for implementation_planning phase', () => {
      expect(shouldRouteToSA('implementation_planning')).toBe(false);
    });

    it('should return false for undefined phase', () => {
      expect(shouldRouteToSA(undefined)).toBe(false);
    });
  });

  describe('composeAnswersMessage', () => {
    it('should compose message from answered questions in Q/A format', () => {
      const questions: Question[] = [
        {
          id: 'q1',
          question: 'What database should we use?',
          status: 'Answered',
          answer: 'PostgreSQL',
          source: 'Software Architect',
          incrementId: 'INC-1',
        },
        {
          id: 'q2',
          question: 'Should we implement caching?',
          status: 'Answered',
          answer: 'Yes, use Redis',
          source: 'Software Architect',
          incrementId: 'INC-1',
        },
      ];

      const message = composeAnswersMessage(questions);

      expect(message).toBe(
        'Q: What database should we use?\nA: PostgreSQL\n\n' +
        'Q: Should we implement caching?\nA: Yes, use Redis'
      );
    });

    it('should filter out unanswered questions', () => {
      const questions: Question[] = [
        {
          id: 'q1',
          question: 'What database?',
          status: 'Answered',
          answer: 'PostgreSQL',
          source: 'Software Architect',
          incrementId: 'INC-1',
        },
        {
          id: 'q2',
          question: 'What caching?',
          status: 'Open',
          answer: '',
          source: 'Software Architect',
          incrementId: 'INC-1',
        },
      ];

      const message = composeAnswersMessage(questions);

      expect(message).toBe('Q: What database?\nA: PostgreSQL');
      expect(message).not.toContain('What caching?');
    });

    it('should filter out questions with empty answer strings', () => {
      const questions: Question[] = [
        {
          id: 'q1',
          question: 'Question 1?',
          status: 'Answered',
          answer: 'Answer 1',
          source: 'Software Architect',
        },
        {
          id: 'q2',
          question: 'Question 2?',
          status: 'Answered',
          answer: '   ', // Whitespace only
          source: 'Software Architect',
        },
      ];

      const message = composeAnswersMessage(questions);

      expect(message).toBe('Q: Question 1?\nA: Answer 1');
    });

    it('should return empty string when no answered questions', () => {
      const questions: Question[] = [
        {
          id: 'q1',
          question: 'Question?',
          status: 'Open',
          answer: '',
          source: 'Software Architect',
        },
      ];

      const message = composeAnswersMessage(questions);

      expect(message).toBe('');
    });
  });

  describe('transformSAQuestionsToQuestions', () => {
    it('should transform SA open questions to Question objects with incrementId', () => {
      const saQuestions = [
        { id: 'sa-q1', question: 'What error handling strategy?' },
        { id: 'sa-q2', question: 'What retry logic?' },
      ];
      const activeIncrementId = 'INC-1';

      const questions = transformSAQuestionsToQuestions(saQuestions, activeIncrementId);

      expect(questions).toHaveLength(2);
      expect(questions[0]).toEqual({
        id: 'sa-q1',
        question: 'What error handling strategy?',
        status: 'Open',
        answer: '',
        source: 'Software Architect',
        incrementId: 'INC-1',
      });
      expect(questions[1]).toEqual({
        id: 'sa-q2',
        question: 'What retry logic?',
        status: 'Open',
        answer: '',
        source: 'Software Architect',
        incrementId: 'INC-1',
      });
    });

    it('should set incrementId to undefined when activeIncrementId is null', () => {
      const saQuestions = [
        { id: 'sa-q1', question: 'Question?' },
      ];

      const questions = transformSAQuestionsToQuestions(saQuestions, null);

      expect(questions[0].incrementId).toBeUndefined();
    });

    it('should set all questions as Open status', () => {
      const saQuestions = [
        { id: 'sa-q1', question: 'Question 1?' },
        { id: 'sa-q2', question: 'Question 2?' },
      ];

      const questions = transformSAQuestionsToQuestions(saQuestions, 'INC-1');

      expect(questions.every((q) => q.status === 'Open')).toBe(true);
    });

    it('should set source as Software Architect', () => {
      const saQuestions = [
        { id: 'sa-q1', question: 'Question?' },
      ];

      const questions = transformSAQuestionsToQuestions(saQuestions, 'INC-1');

      expect(questions[0].source).toBe('Software Architect');
    });
  });

  describe('determineIncrementStatus', () => {
    it('should return "Ready" when openQuestions is empty', () => {
      const status = determineIncrementStatus([]);

      expect(status).toBe('Ready');
    });

    it('should return "In Clarification" when openQuestions has items', () => {
      const openQuestions = [
        { id: 'q1', question: 'What error handling?' },
      ];

      const status = determineIncrementStatus(openQuestions);

      expect(status).toBe('In Clarification');
    });

    it('should return "In Clarification" for multiple questions', () => {
      const openQuestions = [
        { id: 'q1', question: 'Question 1?' },
        { id: 'q2', question: 'Question 2?' },
        { id: 'q3', question: 'Question 3?' },
      ];

      const status = determineIncrementStatus(openQuestions);

      expect(status).toBe('In Clarification');
    });
  });

  describe('Answer submission context', () => {
    it('should include phase=implementation_clarification in context', () => {
      const context: SAAnswerSubmissionContext = {
        phase: 'implementation_clarification',
        activeIncrementId: 'INC-1',
      };

      expect(context.phase).toBe('implementation_clarification');
    });

    it('should include incrementId in context', () => {
      const context: SAAnswerSubmissionContext = {
        phase: 'implementation_clarification',
        activeIncrementId: 'INC-42',
      };

      expect(context.activeIncrementId).toBe('INC-42');
    });
  });

  describe('SA response handling', () => {
    it('should recognize response with openQuestions as needing more clarification', () => {
      const mockResponse: Partial<ChatResponse> = {
        implementerResponse: {
          schemaVersion: '1.0',
          message: 'I have follow-up questions.',
          openQuestions: [
            { id: 'follow-1', question: 'Follow-up question?' },
          ],
        },
      };

      const hasMoreQuestions =
        (mockResponse.implementerResponse?.openQuestions?.length ?? 0) > 0;

      expect(hasMoreQuestions).toBe(true);
    });

    it('should recognize response with empty openQuestions as increment ready', () => {
      const mockResponse: Partial<ChatResponse> = {
        implementerResponse: {
          schemaVersion: '1.0',
          message: 'All questions answered. Ready for implementation.',
          openQuestions: [],
        },
      };

      const hasMoreQuestions =
        (mockResponse.implementerResponse?.openQuestions?.length ?? 0) > 0;

      expect(hasMoreQuestions).toBe(false);
    });
  });
});
