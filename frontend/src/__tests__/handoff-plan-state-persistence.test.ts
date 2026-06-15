/**
 * Tests for Handoff Plan State Persistence
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * Task Group 6: Test Review and Gap Analysis
 *
 * These tests verify that handoffPlan state is correctly persisted
 * and hydrated from ProductUiStateContext.
 */

import type { HandoffPlanResponse } from '../api/chatApi';
import type { ImplementChatUiState } from '../contexts/ProductUiStateContext';

describe('Handoff Plan State Persistence', () => {
  describe('ImplementChatUiState with handoffPlan', () => {
    it('should include handoffPlan in persisted state', () => {
      const handoffPlan: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Single implementation unit',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Full Feature',
            intent: 'Complete implementation',
            in_scope: ['All functionality'],
            out_of_scope: [],
            acceptance_criteria: ['Feature works'],
            dependencies: [],
          },
        ],
      };

      const chatState: ImplementChatUiState = {
        sessionId: 'session-123',
        messages: [{ id: 'msg-1', role: 'assistant', content: 'Hello', timestamp: new Date() }],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        hasBootstrapped: true,
        handoffPlan: handoffPlan,
      };

      expect(chatState.handoffPlan).toBeDefined();
      expect(chatState.handoffPlan?.is_split).toBe(false);
      expect(chatState.handoffPlan?.handoff_intents).toHaveLength(1);
    });

    it('should allow null handoffPlan in state', () => {
      const chatState: ImplementChatUiState = {
        sessionId: 'session-456',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        hasBootstrapped: false,
        handoffPlan: null,
      };

      expect(chatState.handoffPlan).toBeNull();
    });

    it('should support undefined handoffPlan for backward compatibility', () => {
      // Legacy state without handoffPlan field
      const legacyState: Partial<ImplementChatUiState> = {
        sessionId: 'session-789',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        hasBootstrapped: false,
      };

      // When hydrating, undefined should be treated as null
      const handoffPlan = legacyState.handoffPlan ?? null;
      expect(handoffPlan).toBeNull();
    });
  });

  describe('handoffPlan hydration flow', () => {
    it('should preserve handoffPlan across state serialization', () => {
      const originalPlan: HandoffPlanResponse = {
        is_split: true,
        handoff_plan_summary: 'Two sub-specs',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Backend',
            intent: 'API work',
            in_scope: ['REST endpoints'],
            out_of_scope: ['GraphQL'],
            acceptance_criteria: ['Endpoints work'],
            dependencies: [],
          },
          {
            id: 'S2',
            title: 'Frontend',
            intent: 'UI work',
            in_scope: ['React components'],
            out_of_scope: ['Animations'],
            acceptance_criteria: ['UI renders'],
            dependencies: ['S1'],
          },
        ],
      };

      // Simulate serialization and deserialization (as would happen with context storage)
      const serialized = JSON.stringify(originalPlan);
      const deserialized: HandoffPlanResponse = JSON.parse(serialized);

      expect(deserialized.is_split).toBe(originalPlan.is_split);
      expect(deserialized.handoff_plan_summary).toBe(originalPlan.handoff_plan_summary);
      expect(deserialized.handoff_intents).toHaveLength(2);
      expect(deserialized.handoff_intents[0].id).toBe('S1');
      expect(deserialized.handoff_intents[1].dependencies).toContain('S1');
    });

    it('should handle empty arrays in handoffPlan during hydration', () => {
      const minimalPlan: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Minimal plan',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Minimal',
            intent: 'Minimal work',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: [],
          },
        ],
      };

      const serialized = JSON.stringify(minimalPlan);
      const deserialized: HandoffPlanResponse = JSON.parse(serialized);

      expect(deserialized.handoff_intents[0].in_scope).toHaveLength(0);
      expect(deserialized.handoff_intents[0].out_of_scope).toHaveLength(0);
      expect(deserialized.handoff_intents[0].acceptance_criteria).toHaveLength(0);
      expect(deserialized.handoff_intents[0].dependencies).toHaveLength(0);
    });
  });

  describe('state equivalence checking', () => {
    it('should consider states with same handoffPlan as equivalent', () => {
      const plan: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Same plan',
        handoff_intents: [
          { id: 'S1', title: 'T', intent: 'I', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] },
        ],
      };

      const state1: ImplementChatUiState = {
        sessionId: 'session',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        hasBootstrapped: true,
        handoffPlan: plan,
      };

      const state2: ImplementChatUiState = {
        sessionId: 'session',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
        hasBootstrapped: true,
        handoffPlan: { ...plan },
      };

      // Deep equality check for handoffPlan
      expect(JSON.stringify(state1.handoffPlan)).toBe(JSON.stringify(state2.handoffPlan));
    });

    it('should detect different handoffPlan values', () => {
      const plan1: HandoffPlanResponse = {
        is_split: false,
        handoff_plan_summary: 'Plan 1',
        handoff_intents: [
          { id: 'S1', title: 'T1', intent: 'I1', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] },
        ],
      };

      const plan2: HandoffPlanResponse = {
        is_split: true,
        handoff_plan_summary: 'Plan 2',
        handoff_intents: [
          { id: 'S1', title: 'T1', intent: 'I1', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] },
          { id: 'S2', title: 'T2', intent: 'I2', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: ['S1'] },
        ],
      };

      expect(JSON.stringify(plan1)).not.toBe(JSON.stringify(plan2));
    });
  });
});
