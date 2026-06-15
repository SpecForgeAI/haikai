/**
 * Tests for ImplementerResponse type and 'implementation_clarification' phase
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 1: Extend ImplementChatPhase and Add ImplementerResponse Type
 *
 * Tests:
 * 1. ImplementChatPhase includes 'implementation_clarification' as valid value
 * 2. ImplementerResponse type has schemaVersion "1.0", message string, openQuestions array
 * 3. ImplementerResponse openQuestions uses existing OpenQuestion interface (id, question)
 * 4. TypeScript compilation succeeds with new types
 */

import {
  ImplementChatPhase,
  ImplementerResponse,
  OpenQuestion,
  ChatResponse,
} from '../types/chat';

describe('ImplementerResponse Types', () => {
  describe('ImplementChatPhase', () => {
    it('should include implementation_clarification as a valid value', () => {
      // Type assertion test - if this compiles, the type includes the value
      const phase: ImplementChatPhase = 'implementation_clarification';
      expect(phase).toBe('implementation_clarification');
    });

    it('should still include all existing phase values', () => {
      const phases: ImplementChatPhase[] = [
        'bootstrap',
        'refine',
        'implementation_planning',
        'generate_specs',
        'implementation_clarification',
      ];
      expect(phases).toHaveLength(5);
      expect(phases).toContain('implementation_clarification');
    });
  });

  describe('ImplementerResponse', () => {
    it('should have schemaVersion "1.0", message string, and openQuestions array', () => {
      const response: ImplementerResponse = {
        schemaVersion: '1.0',
        message: 'Test message from Software Architect',
        openQuestions: [],
      };

      expect(response.schemaVersion).toBe('1.0');
      expect(typeof response.message).toBe('string');
      expect(Array.isArray(response.openQuestions)).toBe(true);
    });

    it('should use OpenQuestion interface for openQuestions items', () => {
      const questions: OpenQuestion[] = [
        { id: 'q1-uuid', question: 'What is the expected response time?' },
        { id: 'q2-uuid', question: 'Which authentication method should be used?' },
      ];

      const response: ImplementerResponse = {
        schemaVersion: '1.0',
        message: 'I have some clarifying questions.',
        openQuestions: questions,
      };

      expect(response.openQuestions).toHaveLength(2);
      expect(response.openQuestions[0].id).toBe('q1-uuid');
      expect(response.openQuestions[0].question).toBe('What is the expected response time?');
      expect(response.openQuestions[1].id).toBe('q2-uuid');
      expect(response.openQuestions[1].question).toBe('Which authentication method should be used?');
    });

    it('should allow empty openQuestions array (indicates increment is ready)', () => {
      const response: ImplementerResponse = {
        schemaVersion: '1.0',
        message: 'All questions have been answered. This increment is ready for implementation.',
        openQuestions: [],
      };

      expect(response.openQuestions).toHaveLength(0);
    });
  });

  describe('ChatResponse with implementerResponse', () => {
    it('should include optional implementerResponse field', () => {
      const chatResponse: ChatResponse = {
        sessionId: 'test-session-id',
        assistant: {
          message: 'Test message',
        },
        implementerResponse: {
          schemaVersion: '1.0',
          message: 'SA clarification message',
          openQuestions: [
            { id: 'q1', question: 'What database should be used?' },
          ],
        },
      };

      expect(chatResponse.implementerResponse).toBeDefined();
      expect(chatResponse.implementerResponse?.schemaVersion).toBe('1.0');
      expect(chatResponse.implementerResponse?.openQuestions).toHaveLength(1);
    });

    it('should allow ChatResponse without implementerResponse (backward compatibility)', () => {
      const chatResponse: ChatResponse = {
        sessionId: 'test-session-id',
        assistant: {
          message: 'Test message',
        },
      };

      expect(chatResponse.implementerResponse).toBeUndefined();
    });

    it('should allow ChatResponse with both plannerResponse and implementerResponse', () => {
      // This is a valid structure even though in practice only one would be populated
      const chatResponse: ChatResponse = {
        sessionId: 'test-session-id',
        assistant: {
          message: 'Test message',
        },
        plannerResponse: {
          schemaVersion: '1.1',
          message: 'Planner message',
          featureUnderstanding: 'Test understanding',
          scope: { in: [], out: [] },
          assumptions: [],
          acceptanceCriteria: [],
          openQuestions: [],
          plannerReadyForSpec: false,
          implementationPlan: null,
        },
        implementerResponse: {
          schemaVersion: '1.0',
          message: 'SA message',
          openQuestions: [],
        },
      };

      expect(chatResponse.plannerResponse).toBeDefined();
      expect(chatResponse.implementerResponse).toBeDefined();
    });
  });
});
