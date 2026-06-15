/**
 * Tests for HandoffPlanResponse schema validation
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * Task Group 1: Type Definitions and Schema
 */

import type { HandoffIntent, HandoffPlanResponse, ChatResponse } from '../types/chat';

describe('HandoffPlanResponse schema validation', () => {
  describe('valid HandoffPlanResponse parsing', () => {
    it('should accept a valid HandoffPlanResponse with single intent', () => {
      const response: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Single implementation unit for adding login feature',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Implement login feature',
            intent: 'Add login functionality with username/password authentication',
            in_scope: ['Login form', 'Authentication API call'],
            out_of_scope: ['Password reset', 'Social login'],
            acceptance_criteria: ['User can login with valid credentials', 'Error shown for invalid credentials'],
            dependencies: [],
          },
        ],
      };

      expect(response.is_split).toBe(false);
      expect(response.handoff_intents).toHaveLength(1);
      expect(response.handoff_intents[0].id).toBe('S1');
    });

    it('should accept a valid HandoffPlanResponse with multiple intents', () => {
      const response: HandoffPlanResponse = {
        is_split: true,
        handoff_plan_summary: 'This will be implemented as 2 sub-specs: Backend API, Frontend UI',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Backend API endpoint',
            intent: 'Create REST endpoint for user authentication',
            in_scope: ['POST /auth/login endpoint'],
            out_of_scope: ['OAuth integration'],
            acceptance_criteria: ['Returns JWT on success'],
            dependencies: [],
          },
          {
            id: 'S2',
            title: 'Frontend login UI',
            intent: 'Create login form component',
            in_scope: ['Login form', 'Error handling'],
            out_of_scope: ['Remember me'],
            acceptance_criteria: ['Form submits to API'],
            dependencies: ['S1'],
          },
        ],
      };

      expect(response.is_split).toBe(true);
      expect(response.handoff_intents).toHaveLength(2);
      expect(response.handoff_intents[1].dependencies).toContain('S1');
    });
  });

  describe('is_split consistency with handoff_intents length', () => {
    it('should have is_split = false when handoff_intents length is 1', () => {
      const response: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Single intent',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Single task',
            intent: 'Do something',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: [],
          },
        ],
      };

      // Contract: if length == 1 then is_split must be false
      expect(response.handoff_intents.length).toBe(1);
      expect(response.is_split).toBe(false);
    });

    it('should have is_split = true when handoff_intents length > 1', () => {
      const response: HandoffPlanResponse = {
        is_split: true,
        handoff_plan_summary: 'Multiple intents',
        handoff_intents: [
          {
            id: 'S1',
            title: 'First task',
            intent: 'Do first thing',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: [],
          },
          {
            id: 'S2',
            title: 'Second task',
            intent: 'Do second thing',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: [],
          },
        ],
      };

      // Contract: if length > 1 then is_split must be true
      expect(response.handoff_intents.length).toBeGreaterThan(1);
      expect(response.is_split).toBe(true);
    });
  });

  describe('minimum handoff_intents.length >= 1 constraint', () => {
    it('should require at least one handoff intent', () => {
      // This test validates the type contract that handoff_intents must have at least 1 element
      // The actual runtime validation is done in handoffPlanValidator.ts
      const validResponse: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Valid response',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Required intent',
            intent: 'Must have at least one',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: [],
          },
        ],
      };

      expect(validResponse.handoff_intents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('HandoffIntent field presence', () => {
    it('should have all required fields on HandoffIntent', () => {
      const intent: HandoffIntent = {
        id: 'S1',
        title: 'Test Intent',
        intent: 'Test intent description',
        in_scope: ['item1', 'item2'],
        out_of_scope: ['excluded1'],
        acceptance_criteria: ['criterion1', 'criterion2'],
        dependencies: ['S0'],
      };

      // Verify all required fields are present
      expect(intent.id).toBeDefined();
      expect(intent.title).toBeDefined();
      expect(intent.intent).toBeDefined();
      expect(intent.in_scope).toBeDefined();
      expect(intent.out_of_scope).toBeDefined();
      expect(intent.acceptance_criteria).toBeDefined();
      expect(intent.dependencies).toBeDefined();

      // Verify array types
      expect(Array.isArray(intent.in_scope)).toBe(true);
      expect(Array.isArray(intent.out_of_scope)).toBe(true);
      expect(Array.isArray(intent.acceptance_criteria)).toBe(true);
      expect(Array.isArray(intent.dependencies)).toBe(true);
    });
  });

  describe('ChatResponse with handoffPlan field', () => {
    it('should allow ChatResponse to have optional handoffPlan field', () => {
      const responseWithPlan: ChatResponse = {
        sessionId: 'session-123',
        assistant: {
          message: 'Here is your handoff plan',
        },
        handoffPlan: {
          is_split: false,
          handoff_plan_summary: 'Single implementation',
          handoff_intents: [
            {
              id: 'S1',
              title: 'Implementation',
              intent: 'Implement feature',
              in_scope: [],
              out_of_scope: [],
              acceptance_criteria: [],
              dependencies: [],
            },
          ],
        },
      };

      expect(responseWithPlan.handoffPlan).toBeDefined();
      expect(responseWithPlan.handoffPlan?.is_split).toBe(false);
    });

    it('should allow ChatResponse without handoffPlan field', () => {
      const responseWithoutPlan: ChatResponse = {
        sessionId: 'session-456',
        assistant: {
          message: 'Normal response',
        },
      };

      expect(responseWithoutPlan.handoffPlan).toBeUndefined();
    });
  });
});
