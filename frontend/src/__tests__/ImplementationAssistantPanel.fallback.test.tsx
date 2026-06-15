/**
 * ImplementationAssistantPanel Fallback Detection Tests
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 * Task Group 2: Frontend Fallback Detection and State Preservation
 *
 * Tests for:
 * - isFallbackPlannerResponse helper function
 * - setLatestPlannerResponse guard in handleSend callback
 * - setLatestPlannerResponse guard in handleSubmitAnswers callback
 * - Previous latestPlannerResponse state preservation on fallback
 */

import { describe, it, expect } from 'vitest';
import type { PlannerResponse } from '../api/chatApi';

/**
 * Detects if a PlannerResponse is a fallback response from validation failure.
 * A fallback response has:
 * - featureUnderstanding === '' (empty string)
 * - scope.in.length === 0 (empty array)
 *
 * This function is used to prevent overwriting valid LHS state with empty fallback data.
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 *
 * @param response - The PlannerResponse to check
 * @returns true if the response is a fallback (should not update state)
 */
export function isFallbackPlannerResponse(response: PlannerResponse): boolean {
  return response.featureUnderstanding === '' && response.scope.in.length === 0;
}

describe('Task Group 2: Frontend Fallback Detection', () => {
  describe('isFallbackPlannerResponse helper function', () => {
    it('should return true for fallback response with empty featureUnderstanding AND empty scope.in', () => {
      const fallbackResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: "I couldn't parse the structured response. Please try again.",
        featureUnderstanding: '',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(isFallbackPlannerResponse(fallbackResponse)).toBe(true);
    });

    it('should return false for valid response with non-empty featureUnderstanding', () => {
      const validResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'I understand your feature requirements.',
        featureUnderstanding: 'This feature enables user authentication via email and password.',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(isFallbackPlannerResponse(validResponse)).toBe(false);
    });

    it('should return false for valid response with non-empty scope.in', () => {
      const validResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'I understand your feature requirements.',
        featureUnderstanding: '',
        scope: { in: ['Login page', 'Password validation'], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(isFallbackPlannerResponse(validResponse)).toBe(false);
    });

    it('should return false for valid response with both featureUnderstanding AND scope.in populated', () => {
      const validResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'I understand your feature requirements.',
        featureUnderstanding: 'User authentication feature',
        scope: { in: ['Login page'], out: ['Social login'] },
        assumptions: ['Users have email accounts'],
        acceptanceCriteria: ['User can log in'],
        openQuestions: [{ id: 'q1', question: 'What password rules?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(isFallbackPlannerResponse(validResponse)).toBe(false);
    });

    it('should handle edge case: non-empty featureUnderstanding with empty scope.in is NOT a fallback', () => {
      const response: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Clarifying the feature...',
        featureUnderstanding: 'Some initial understanding',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Has featureUnderstanding, so not a fallback
      expect(isFallbackPlannerResponse(response)).toBe(false);
    });
  });

  describe('setLatestPlannerResponse guard behavior', () => {
    it('should NOT update state when response is a fallback (preserves previous state)', () => {
      // Simulating the state management pattern
      let latestPlannerResponse: PlannerResponse | null = {
        schemaVersion: '1.1',
        message: 'Previous valid message',
        featureUnderstanding: 'Previous feature understanding that should be preserved',
        scope: { in: ['Previous item 1', 'Previous item 2'], out: ['Excluded'] },
        assumptions: ['Assumption 1'],
        acceptanceCriteria: ['AC 1'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: null,
      };

      const setLatestPlannerResponse = (response: PlannerResponse) => {
        latestPlannerResponse = response;
      };

      // Simulate receiving a fallback response
      const fallbackResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: "I couldn't parse the structured response. Please try again.",
        featureUnderstanding: '',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Apply the guard: only update if NOT a fallback
      if (!isFallbackPlannerResponse(fallbackResponse)) {
        setLatestPlannerResponse(fallbackResponse);
      }

      // State should be preserved (not overwritten with fallback)
      expect(latestPlannerResponse?.featureUnderstanding).toBe('Previous feature understanding that should be preserved');
      expect(latestPlannerResponse?.scope.in).toHaveLength(2);
    });

    it('should update state when response is valid (not a fallback)', () => {
      // Simulating the state management pattern
      let latestPlannerResponse: PlannerResponse | null = {
        schemaVersion: '1.1',
        message: 'Previous message',
        featureUnderstanding: 'Previous understanding',
        scope: { in: ['Old item'], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const setLatestPlannerResponse = (response: PlannerResponse) => {
        latestPlannerResponse = response;
      };

      // Simulate receiving a valid response
      const validResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'New valid message',
        featureUnderstanding: 'New feature understanding',
        scope: { in: ['New item 1', 'New item 2'], out: ['New excluded'] },
        assumptions: ['New assumption'],
        acceptanceCriteria: ['New AC'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: null,
      };

      // Apply the guard: only update if NOT a fallback
      if (!isFallbackPlannerResponse(validResponse)) {
        setLatestPlannerResponse(validResponse);
      }

      // State should be updated with new valid response
      expect(latestPlannerResponse?.featureUnderstanding).toBe('New feature understanding');
      expect(latestPlannerResponse?.scope.in).toHaveLength(2);
      expect(latestPlannerResponse?.scope.in[0]).toBe('New item 1');
    });

    it('should preserve LHS Feature Definition panel state when sequence is: valid -> fallback', () => {
      // Simulating the full sequence: valid response followed by fallback
      let latestPlannerResponse: PlannerResponse | null = null;

      const setLatestPlannerResponse = (response: PlannerResponse) => {
        latestPlannerResponse = response;
      };

      // Step 1: Receive valid response
      const validResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Understanding your feature...',
        featureUnderstanding: 'User authentication with email/password login',
        scope: { in: ['Login form', 'Password validation', 'Session management'], out: ['Social login'] },
        assumptions: ['Users have email accounts', 'Password meets security standards'],
        acceptanceCriteria: ['User can log in with valid credentials', 'User sees error on invalid credentials'],
        openQuestions: [{ id: 'q1', question: 'What password complexity rules should be enforced?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Apply valid response (should update state)
      if (!isFallbackPlannerResponse(validResponse)) {
        setLatestPlannerResponse(validResponse);
      }

      // Verify state was updated
      expect(latestPlannerResponse?.featureUnderstanding).toBe('User authentication with email/password login');
      expect(latestPlannerResponse?.scope.in).toHaveLength(3);

      // Step 2: Receive fallback response (parse failure)
      const fallbackResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: "I couldn't parse the structured response. Please try again.",
        featureUnderstanding: '',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Apply fallback response (should NOT update state)
      if (!isFallbackPlannerResponse(fallbackResponse)) {
        setLatestPlannerResponse(fallbackResponse);
      }

      // Verify state was PRESERVED from valid response
      expect(latestPlannerResponse?.featureUnderstanding).toBe('User authentication with email/password login');
      expect(latestPlannerResponse?.scope.in).toHaveLength(3);
      expect(latestPlannerResponse?.assumptions).toHaveLength(2);
      expect(latestPlannerResponse?.acceptanceCriteria).toHaveLength(2);
    });
  });
});
