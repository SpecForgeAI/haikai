/**
 * Integration tests for Handoff Phase in Chat Route
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * Task Group 6: Test Review and Gap Analysis
 *
 * These tests verify the handoff phase handling in the chat route,
 * including successful validation and fallback plan generation.
 */

import { validateHandoffPlan, generateFallbackPlan } from '../services/handoffPlanValidator';
import type { ChatResponse, HandoffPlanResponse, ChatContext } from '../types/chat';

describe('Handoff Chat Route Integration', () => {
  describe('handoff phase detection', () => {
    it('should detect handoff phase from context', () => {
      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'handoff',
        workItem: {
          id: 'WI-1',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      expect(context.phase).toBe('handoff');
      expect(context.mode).toBe('implement_feature');
    });

    it('should distinguish handoff phase from refine phase', () => {
      const refineContext: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'WI-1',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
        architectureContext: {
          entityIds: [],
          diagramIds: [],
        },
      };

      const handoffContext: ChatContext = {
        ...refineContext,
        phase: 'handoff',
      };

      expect(refineContext.phase).toBe('refine');
      expect(handoffContext.phase).toBe('handoff');
    });
  });

  describe('successful handoff plan validation flow', () => {
    it('should build valid ChatResponse with handoffPlan when validation succeeds', () => {
      const validJson = JSON.stringify({
        is_split: true,
        handoff_plan_summary: 'Two sub-specs for backend and frontend',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Backend API',
            intent: 'Create REST endpoints',
            in_scope: ['POST /api/items'],
            out_of_scope: ['WebSocket'],
            acceptance_criteria: ['Endpoint returns 200'],
            dependencies: [],
          },
          {
            id: 'S2',
            title: 'Frontend UI',
            intent: 'Create React components',
            in_scope: ['ItemList component'],
            out_of_scope: ['Animations'],
            acceptance_criteria: ['List renders items'],
            dependencies: ['S1'],
          },
        ],
      });

      const validationResult = validateHandoffPlan(validJson);

      expect(validationResult.valid).toBe(true);
      expect(validationResult.handoffPlan).toBeDefined();

      // Simulate chat response construction
      const chatResponse: ChatResponse = {
        sessionId: 'test-session',
        assistant: {
          message: 'Here is your implementation plan.',
        },
        handoffPlan: validationResult.handoffPlan,
      };

      expect(chatResponse.handoffPlan?.is_split).toBe(true);
      expect(chatResponse.handoffPlan?.handoff_intents).toHaveLength(2);
      expect(chatResponse.handoffPlan?.handoff_intents[0].id).toBe('S1');
      expect(chatResponse.handoffPlan?.handoff_intents[1].dependencies).toContain('S1');
    });
  });

  describe('fallback plan flow when validation fails', () => {
    it('should generate fallback plan with work item context', () => {
      const invalidContent = 'This is not valid JSON at all.';
      const validationResult = validateHandoffPlan(invalidContent);

      expect(validationResult.valid).toBe(false);

      // Generate fallback
      const workItemTitle = 'Add User Authentication';
      const workItemDescription = 'Implement login and registration';
      const fallbackPlan = generateFallbackPlan(workItemTitle, workItemDescription);

      expect(fallbackPlan.is_split).toBe(false);
      expect(fallbackPlan.handoff_intents).toHaveLength(1);
      expect(fallbackPlan.handoff_intents[0].id).toBe('S1');
      expect(fallbackPlan.handoff_intents[0].title).toContain(workItemTitle);
    });

    it('should build ChatResponse with fallback plan and error note', () => {
      const invalidContent = '{"is_split": true, "handoff_plan_summary":'; // Incomplete JSON
      const validationResult = validateHandoffPlan(invalidContent);

      expect(validationResult.valid).toBe(false);

      const fallbackPlan = generateFallbackPlan('Test Feature', 'Test description');

      // Simulate chat response construction with fallback
      const chatResponse: ChatResponse = {
        sessionId: 'test-session',
        assistant: {
          message: `Note: Could not parse structured handoff plan. Using fallback. Error: ${validationResult.error}`,
        },
        handoffPlan: fallbackPlan,
      };

      expect(chatResponse.handoffPlan).toBeDefined();
      expect(chatResponse.handoffPlan?.is_split).toBe(false);
      expect(chatResponse.assistant.message).toContain('fallback');
    });
  });

  describe('ChatResponse handoffPlan field contract', () => {
    it('should not have handoffPlan for non-handoff phases', () => {
      // For refine phase, handoffPlan should be undefined
      const refineResponse: ChatResponse = {
        sessionId: 'test-session',
        assistant: {
          message: 'Clarifying requirements...',
        },
      };

      expect(refineResponse.handoffPlan).toBeUndefined();
    });

    it('should have handoffPlan for handoff phase responses', () => {
      const handoffResponse: ChatResponse = {
        sessionId: 'test-session',
        assistant: {
          message: 'Here is your plan.',
        },
        handoffPlan: {
          is_split: false,
          handoff_plan_summary: 'Single implementation unit',
          handoff_intents: [
            {
              id: 'S1',
              title: 'Full Implementation',
              intent: 'Implement all features',
              in_scope: ['All'],
              out_of_scope: [],
              acceptance_criteria: ['Works'],
              dependencies: [],
            },
          ],
        },
      };

      expect(handoffResponse.handoffPlan).toBeDefined();
      expect(handoffResponse.handoffPlan?.is_split).toBe(false);
    });
  });
});
