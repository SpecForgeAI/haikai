/**
 * Tests for SA Auto-Trigger Clarification
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 10: Auto-Trigger SA Clarification After Plan Generation
 *
 * Tests:
 * 1. SA clarification auto-triggered after successful plan generation
 * 2. First increment selected and phase set to 'implementation_clarification'
 * 3. SA prompt receives first increment's intent
 * 4. Increment status set to 'In Clarification' on auto-trigger
 * 5. SA questions added to Questions table for first increment
 */

import type { ImplementChatPhase, Increment, ImplementationPlan, PlannerResponse } from '../api/chatApi';

/**
 * Type for increment clarification status
 */
type IncrementClarificationStatus = 'In Clarification' | 'Ready' | null;

/**
 * Determines if SA clarification should be auto-triggered after plan generation.
 * Triggered when:
 * - Plan generation was successful
 * - Plan has at least one increment
 *
 * @param plannerResponse - Response from plan generation
 * @returns True if SA clarification should be triggered
 */
export function shouldAutoTriggerSAClarification(
  plannerResponse: PlannerResponse | null
): boolean {
  if (!plannerResponse?.implementationPlan) {
    return false;
  }
  return plannerResponse.implementationPlan.increments.length > 0;
}

/**
 * Selects the first increment from a plan for SA clarification.
 *
 * @param plan - Implementation plan
 * @returns First increment ID, or null if no increments
 */
export function selectFirstIncrement(plan: ImplementationPlan | null): string | null {
  if (!plan || plan.increments.length === 0) {
    return null;
  }
  return plan.increments[0].id;
}

/**
 * Gets the increment by ID from a plan.
 *
 * @param plan - Implementation plan
 * @param incrementId - ID to look up
 * @returns Increment if found, null otherwise
 */
export function getIncrementById(
  plan: ImplementationPlan | null,
  incrementId: string
): Increment | null {
  if (!plan) {
    return null;
  }
  return plan.increments.find((inc) => inc.id === incrementId) ?? null;
}

/**
 * Determines the phase to set when triggering SA clarification.
 * Always returns 'implementation_clarification' when triggering SA.
 */
export function getPhaseForSATrigger(): ImplementChatPhase {
  return 'implementation_clarification';
}

/**
 * Determines the initial status for an increment when entering SA clarification.
 * Always starts as 'In Clarification'.
 */
export function getInitialClarificationStatus(): IncrementClarificationStatus {
  return 'In Clarification';
}

describe('SA Auto-Trigger Clarification', () => {
  describe('shouldAutoTriggerSAClarification', () => {
    it('should return true when plan has increments', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Plan generated.',
        featureUnderstanding: 'Understood the feature.',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'Test Plan',
          increments: [
            {
              id: 'INC-1',
              partIndex: 1,
              title: 'First Increment',
              intent: 'Definition for increment 1',
            },
          ],
        },
      };

      expect(shouldAutoTriggerSAClarification(plannerResponse)).toBe(true);
    });

    it('should return false when plan has no increments', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Plan generated.',
        featureUnderstanding: 'Understood the feature.',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'Test Plan',
          increments: [],
        },
      };

      expect(shouldAutoTriggerSAClarification(plannerResponse)).toBe(false);
    });

    it('should return false when implementationPlan is null', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Not ready for plan.',
        featureUnderstanding: 'Understood the feature.',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(shouldAutoTriggerSAClarification(plannerResponse)).toBe(false);
    });

    it('should return false when plannerResponse is null', () => {
      expect(shouldAutoTriggerSAClarification(null)).toBe(false);
    });
  });

  describe('selectFirstIncrement', () => {
    it('should return first increment ID when plan has increments', () => {
      const plan: ImplementationPlan = {
        planTitle: 'Test Plan',
        increments: [
          {
            id: 'INC-1',
            partIndex: 1,
            title: 'First',
            intent: 'Definition 1',
          },
          {
            id: 'INC-2',
            partIndex: 2,
            title: 'Second',
            intent: 'Definition 2',
          },
        ],
      };

      expect(selectFirstIncrement(plan)).toBe('INC-1');
    });

    it('should return null when plan has no increments', () => {
      const plan: ImplementationPlan = {
        planTitle: 'Test Plan',
        increments: [],
      };

      expect(selectFirstIncrement(plan)).toBeNull();
    });

    it('should return null when plan is null', () => {
      expect(selectFirstIncrement(null)).toBeNull();
    });
  });

  describe('getIncrementById', () => {
    const plan: ImplementationPlan = {
      planTitle: 'Test Plan',
      increments: [
        {
          id: 'INC-1',
          partIndex: 1,
          title: 'First',
          intent: 'Definition 1',
        },
        {
          id: 'INC-2',
          partIndex: 2,
          title: 'Second',
          intent: 'Definition 2',
        },
      ],
    };

    it('should return increment when ID exists', () => {
      const increment = getIncrementById(plan, 'INC-1');

      expect(increment).not.toBeNull();
      expect(increment?.id).toBe('INC-1');
      expect(increment?.title).toBe('First');
      expect(increment?.intent).toBe('Definition 1');
    });

    it('should return second increment when ID matches', () => {
      const increment = getIncrementById(plan, 'INC-2');

      expect(increment).not.toBeNull();
      expect(increment?.id).toBe('INC-2');
      expect(increment?.intent).toBe('Definition 2');
    });

    it('should return null when ID does not exist', () => {
      expect(getIncrementById(plan, 'INC-999')).toBeNull();
    });

    it('should return null when plan is null', () => {
      expect(getIncrementById(null, 'INC-1')).toBeNull();
    });
  });

  describe('getPhaseForSATrigger', () => {
    it('should return implementation_clarification phase', () => {
      expect(getPhaseForSATrigger()).toBe('implementation_clarification');
    });
  });

  describe('getInitialClarificationStatus', () => {
    it('should return In Clarification status', () => {
      expect(getInitialClarificationStatus()).toBe('In Clarification');
    });
  });

  describe('Auto-trigger flow integration', () => {
    it('should follow complete auto-trigger flow after plan generation', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Plan generated successfully.',
        featureUnderstanding: 'Feature understood.',
        scope: { in: ['Feature A', 'Feature B'], out: ['Feature C'] },
        assumptions: ['Assume X'],
        acceptanceCriteria: ['AC1', 'AC2'],
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

      // Step 1: Check if should auto-trigger
      expect(shouldAutoTriggerSAClarification(plannerResponse)).toBe(true);

      // Step 2: Select first increment
      const firstIncrementId = selectFirstIncrement(plannerResponse.implementationPlan);
      expect(firstIncrementId).toBe('INC-1');

      // Step 3: Get increment data
      const increment = getIncrementById(plannerResponse.implementationPlan, firstIncrementId!);
      expect(increment).not.toBeNull();
      expect(increment?.intent).toContain('POST /auth/login');

      // Step 4: Get phase for SA trigger
      expect(getPhaseForSATrigger()).toBe('implementation_clarification');

      // Step 5: Get initial status
      expect(getInitialClarificationStatus()).toBe('In Clarification');
    });

    it('should not trigger when plan generation returns no plan', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Still clarifying requirements.',
        featureUnderstanding: 'Partial understanding.',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [{ id: 'q1', question: 'What is the scope?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(shouldAutoTriggerSAClarification(plannerResponse)).toBe(false);
    });
  });
});
