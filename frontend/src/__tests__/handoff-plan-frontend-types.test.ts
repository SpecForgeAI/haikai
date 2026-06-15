/**
 * Tests for Frontend Handoff Plan Types and State Management
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * Task Group 4: Frontend Type Definitions and State Management
 */

import type {
  HandoffIntent,
  HandoffPlanResponse,
  ChatResponse
} from '../api/chatApi';

describe('Frontend Handoff Plan Types', () => {
  describe('HandoffIntent interface', () => {
    it('should have all required fields', () => {
      const intent: HandoffIntent = {
        id: 'S1',
        title: 'Test Intent',
        intent: 'Description of the intent',
        in_scope: ['item1', 'item2'],
        out_of_scope: ['excluded1'],
        acceptance_criteria: ['criterion1'],
        dependencies: ['S0'],
      };

      expect(intent.id).toBeDefined();
      expect(intent.title).toBeDefined();
      expect(intent.intent).toBeDefined();
      expect(Array.isArray(intent.in_scope)).toBe(true);
      expect(Array.isArray(intent.out_of_scope)).toBe(true);
      expect(Array.isArray(intent.acceptance_criteria)).toBe(true);
      expect(Array.isArray(intent.dependencies)).toBe(true);
    });
  });

  describe('HandoffPlanResponse interface', () => {
    it('should have all required fields', () => {
      const plan: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Single implementation unit',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Test',
            intent: 'Test intent',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: [],
          },
        ],
      };

      expect(typeof plan.is_split).toBe('boolean');
      expect(typeof plan.handoff_plan_summary).toBe('string');
      expect(Array.isArray(plan.handoff_intents)).toBe(true);
    });
  });

  describe('ChatResponse with handoffPlan', () => {
    it('should accept response with handoffPlan', () => {
      const response: ChatResponse = {
        sessionId: 'session-123',
        assistant: {
          message: 'Here is your plan',
        },
        handoffPlan: {
          is_split: true,
          handoff_plan_summary: 'Two sub-specs',
          handoff_intents: [
            {
              id: 'S1',
              title: 'First',
              intent: 'First intent',
              in_scope: [],
              out_of_scope: [],
              acceptance_criteria: [],
              dependencies: [],
            },
            {
              id: 'S2',
              title: 'Second',
              intent: 'Second intent',
              in_scope: [],
              out_of_scope: [],
              acceptance_criteria: [],
              dependencies: ['S1'],
            },
          ],
        },
      };

      expect(response.handoffPlan).toBeDefined();
      expect(response.handoffPlan?.is_split).toBe(true);
      expect(response.handoffPlan?.handoff_intents).toHaveLength(2);
    });

    it('should accept response without handoffPlan', () => {
      const response: ChatResponse = {
        sessionId: 'session-456',
        assistant: {
          message: 'Normal response',
        },
      };

      expect(response.handoffPlan).toBeUndefined();
    });
  });
});
