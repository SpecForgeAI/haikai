/**
 * SA Handoff Per Increment - Frontend Integration Tests
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 11: Integration Testing and Gap Analysis
 *
 * Strategic integration tests focusing on end-to-end user workflows
 * for the SA Handoff feature on the frontend side.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  ImplementChatPhase,
  Question,
  PlannerResponse,
  ImplementationPlan,
  Increment,
  ChatResponse,
  ImplementerResponse,
} from '../api/chatApi';

// Import helper functions from the test files (these are exported for testing)
import {
  shouldAutoTriggerSAClarification,
  selectFirstIncrement,
  getIncrementById,
  getPhaseForSATrigger,
  getInitialClarificationStatus,
} from './autoTrigger.saClarification.test';

import {
  shouldRouteToSA,
  composeAnswersMessage,
  transformSAQuestionsToQuestions,
  determineIncrementStatus,
} from './answerSubmission.sa.test';

import { filterQuestionsByIncrement } from './questionsFiltering.sa.test';

import { getPersonaForPhase } from './chatPersona.sa.test';

/**
 * Type for IncrementCard clarificationStatus prop
 */
type ClarificationStatus = 'in_clarification' | 'ready' | undefined;

/**
 * Maps IncrementClarificationStatus to IncrementCard clarificationStatus
 */
function mapStatusToCardProp(
  status: 'In Clarification' | 'Ready' | null
): ClarificationStatus {
  if (status === 'In Clarification') return 'in_clarification';
  if (status === 'Ready') return 'ready';
  return undefined;
}

describe('SA Handoff Per Increment - Frontend Integration', () => {
  describe('End-to-end: Plan generation -> auto-trigger SA -> questions displayed', () => {
    it('should complete full auto-trigger flow after plan generation', () => {
      // Step 1: Simulate plan generation response
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Plan generated successfully.',
        featureUnderstanding: 'Feature understood.',
        scope: { in: ['Feature A'], out: [] },
        assumptions: [],
        acceptanceCriteria: ['AC1'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'User Authentication Plan',
          increments: [
            {
              id: 'INC-1',
              partIndex: 1,
              title: 'API Authentication',
              intent: 'Implement JWT auth. Create POST /auth/login endpoint with JWT generation.',
            },
            {
              id: 'INC-2',
              partIndex: 2,
              title: 'User Sessions',
              intent: 'Implement session management. Add session storage and validation.',
            },
          ],
        },
      };

      // Step 2: Check if auto-trigger should occur
      expect(shouldAutoTriggerSAClarification(plannerResponse)).toBe(true);

      // Step 3: Select first increment
      const firstIncrementId = selectFirstIncrement(plannerResponse.implementationPlan);
      expect(firstIncrementId).toBe('INC-1');

      // Step 4: Get increment data for SA context
      const increment = getIncrementById(plannerResponse.implementationPlan, firstIncrementId!);
      expect(increment).not.toBeNull();
      expect(increment?.intent).toContain('POST /auth/login');

      // Step 5: Set phase to implementation_clarification
      const phase = getPhaseForSATrigger();
      expect(phase).toBe('implementation_clarification');

      // Step 6: Get initial status
      const initialStatus = getInitialClarificationStatus();
      expect(initialStatus).toBe('In Clarification');

      // Step 7: Map status to card prop
      const cardStatus = mapStatusToCardProp(initialStatus);
      expect(cardStatus).toBe('in_clarification');

      // Step 8: Verify persona routing for SA phase
      const persona = getPersonaForPhase('implementation_clarification');
      expect(persona.persona).toBe('Software Architect');
      expect(persona.personaColor).toBe('purple');
    });
  });

  describe('End-to-end: Answer questions -> submit to SA -> follow-up questions', () => {
    it('should handle SA returning follow-up questions after answer submission', () => {
      const activeIncrementId = 'INC-1';

      // Step 1: Initial SA questions for increment
      const initialSAQuestions: Question[] = [
        {
          id: 'sa-q1',
          question: 'What database should we use?',
          status: 'Answered',
          answer: 'PostgreSQL',
          source: 'Software Architect',
          incrementId: activeIncrementId,
        },
      ];

      // Step 2: Verify routing to SA
      const phase: ImplementChatPhase = 'implementation_clarification';
      expect(shouldRouteToSA(phase)).toBe(true);

      // Step 3: Compose message from answers
      const message = composeAnswersMessage(initialSAQuestions);
      expect(message).toContain('Q: What database should we use?');
      expect(message).toContain('A: PostgreSQL');

      // Step 4: Simulate SA response with follow-up questions
      const saResponseQuestions = [
        { id: 'sa-q2', question: 'What connection pool size?' },
        { id: 'sa-q3', question: 'What retry strategy for failed connections?' },
      ];

      // Step 5: Transform to Question objects
      const newQuestions = transformSAQuestionsToQuestions(
        saResponseQuestions,
        activeIncrementId
      );

      expect(newQuestions).toHaveLength(2);
      expect(newQuestions[0].incrementId).toBe(activeIncrementId);
      expect(newQuestions[0].source).toBe('Software Architect');
      expect(newQuestions[0].status).toBe('Open');

      // Step 6: Determine increment status (still in clarification)
      const status = determineIncrementStatus(saResponseQuestions);
      expect(status).toBe('In Clarification');
    });
  });

  describe('End-to-end: Answer questions -> submit to SA -> empty questions -> increment ready', () => {
    it('should mark increment as ready when SA returns empty questions', () => {
      const activeIncrementId = 'INC-1';

      // Step 1: Answered questions
      const answeredQuestions: Question[] = [
        {
          id: 'sa-q1',
          question: 'What database should we use?',
          status: 'Answered',
          answer: 'PostgreSQL',
          source: 'Software Architect',
          incrementId: activeIncrementId,
        },
        {
          id: 'sa-q2',
          question: 'What connection pool size?',
          status: 'Answered',
          answer: '10 connections',
          source: 'Software Architect',
          incrementId: activeIncrementId,
        },
      ];

      // Step 2: Compose message
      const message = composeAnswersMessage(answeredQuestions);
      expect(message).toContain('Q: What database should we use?');
      expect(message).toContain('A: 10 connections');

      // Step 3: SA returns empty questions (all clarified)
      const emptyQuestions: Array<{ id: string; question: string }> = [];

      // Step 4: Determine increment status
      const status = determineIncrementStatus(emptyQuestions);
      expect(status).toBe('Ready');

      // Step 5: Map to card prop
      const cardStatus = mapStatusToCardProp(status);
      expect(cardStatus).toBe('ready');
    });
  });

  describe('Switching active increment shows correct SA questions', () => {
    it('should filter SA questions by active increment', () => {
      const allQuestions: Question[] = [
        // PO questions (no incrementId)
        {
          id: 'po-q1',
          question: 'What is the priority?',
          status: 'Open',
          answer: '',
          source: 'Product Owner',
        },
        // SA questions for INC-1
        {
          id: 'sa-q1',
          question: 'What DB for INC-1?',
          status: 'Open',
          answer: '',
          source: 'Software Architect',
          incrementId: 'INC-1',
        },
        // SA questions for INC-2
        {
          id: 'sa-q2',
          question: 'What cache for INC-2?',
          status: 'Open',
          answer: '',
          source: 'Software Architect',
          incrementId: 'INC-2',
        },
      ];

      // Filter for INC-1
      const inc1Questions = filterQuestionsByIncrement(allQuestions, 'INC-1');
      expect(inc1Questions).toHaveLength(2); // PO + INC-1 SA
      expect(inc1Questions.find((q) => q.id === 'po-q1')).toBeTruthy();
      expect(inc1Questions.find((q) => q.id === 'sa-q1')).toBeTruthy();
      expect(inc1Questions.find((q) => q.id === 'sa-q2')).toBeFalsy();

      // Filter for INC-2
      const inc2Questions = filterQuestionsByIncrement(allQuestions, 'INC-2');
      expect(inc2Questions).toHaveLength(2); // PO + INC-2 SA
      expect(inc2Questions.find((q) => q.id === 'po-q1')).toBeTruthy();
      expect(inc2Questions.find((q) => q.id === 'sa-q2')).toBeTruthy();
      expect(inc2Questions.find((q) => q.id === 'sa-q1')).toBeFalsy();
    });
  });

  describe('PO questions remain visible regardless of active increment', () => {
    it('should always show PO questions regardless of incrementId', () => {
      const questions: Question[] = [
        {
          id: 'po-q1',
          question: 'What is the timeline?',
          status: 'Open',
          answer: '',
          source: 'Product Owner',
        },
        {
          id: 'po-q2',
          question: 'What is the budget?',
          status: 'Answered',
          answer: '$10k',
          source: 'Product Owner',
        },
      ];

      // PO questions visible with any incrementId
      const withInc1 = filterQuestionsByIncrement(questions, 'INC-1');
      expect(withInc1).toHaveLength(2);

      const withInc2 = filterQuestionsByIncrement(questions, 'INC-2');
      expect(withInc2).toHaveLength(2);

      const withNull = filterQuestionsByIncrement(questions, null);
      expect(withNull).toHaveLength(2);
    });
  });

  describe('Persona displays correctly for SA vs PO messages', () => {
    it('should use purple persona for SA phase and blue for PO phase', () => {
      // SA phase (implementation_clarification)
      const saPersona = getPersonaForPhase('implementation_clarification');
      expect(saPersona.persona).toBe('Software Architect');
      expect(saPersona.personaColor).toBe('purple');

      // PO phases
      const refinePersona = getPersonaForPhase('refine');
      expect(refinePersona.persona).toBe('Product Owner');
      expect(refinePersona.personaColor).toBe('blue');

      const bootstrapPersona = getPersonaForPhase('bootstrap');
      expect(bootstrapPersona.persona).toBe('Product Owner');
      expect(bootstrapPersona.personaColor).toBe('blue');

      const planningPersona = getPersonaForPhase('implementation_planning');
      expect(planningPersona.persona).toBe('Product Owner');
      expect(planningPersona.personaColor).toBe('blue');
    });
  });

  describe('Status badge transitions', () => {
    it('should transition from null -> In Clarification -> Ready', () => {
      // Initial state: null (Not Started)
      let status: 'In Clarification' | 'Ready' | null = null;
      let cardStatus = mapStatusToCardProp(status);
      expect(cardStatus).toBeUndefined();

      // After SA trigger: In Clarification
      status = getInitialClarificationStatus();
      expect(status).toBe('In Clarification');
      cardStatus = mapStatusToCardProp(status);
      expect(cardStatus).toBe('in_clarification');

      // After SA returns empty questions: Ready
      const emptyQuestions: Array<{ id: string; question: string }> = [];
      status = determineIncrementStatus(emptyQuestions);
      expect(status).toBe('Ready');
      cardStatus = mapStatusToCardProp(status);
      expect(cardStatus).toBe('ready');
    });
  });

  describe('incrementId flows correctly through the system', () => {
    it('should preserve incrementId when transforming SA questions', () => {
      const incrementId = 'INC-42';
      const saQuestions = [
        { id: 'q1', question: 'Question 1?' },
        { id: 'q2', question: 'Question 2?' },
      ];

      const transformedQuestions = transformSAQuestionsToQuestions(
        saQuestions,
        incrementId
      );

      // All transformed questions should have the incrementId
      expect(transformedQuestions.every((q) => q.incrementId === incrementId)).toBe(true);

      // They should be filterable by that incrementId
      const filtered = filterQuestionsByIncrement(transformedQuestions, incrementId);
      expect(filtered).toHaveLength(2);

      // They should NOT show for a different increment
      const filteredOther = filterQuestionsByIncrement(transformedQuestions, 'INC-OTHER');
      expect(filteredOther).toHaveLength(0);
    });
  });

  describe('Error handling: graceful degradation', () => {
    it('should handle null plan gracefully', () => {
      expect(shouldAutoTriggerSAClarification(null)).toBe(false);
      expect(selectFirstIncrement(null)).toBeNull();
      expect(getIncrementById(null, 'INC-1')).toBeNull();
    });

    it('should handle empty increments gracefully', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'No plan yet.',
        featureUnderstanding: 'Partial understanding.',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: {
          planTitle: 'Empty Plan',
          increments: [],
        },
      };

      expect(shouldAutoTriggerSAClarification(plannerResponse)).toBe(false);
      expect(selectFirstIncrement(plannerResponse.implementationPlan)).toBeNull();
    });

    it('should handle missing incrementId in SA question transform', () => {
      const questions = transformSAQuestionsToQuestions(
        [{ id: 'q1', question: 'Question?' }],
        null
      );

      expect(questions[0].incrementId).toBeUndefined();
    });
  });
});
