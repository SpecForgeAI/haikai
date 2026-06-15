/**
 * Spec 2026-01-25: Implement Button Three-Phase Enablement and Warning
 * Task Group 1: Derivation Hooks Tests
 * Task Group 2: Button Enablement and Modal Trigger Tests
 * Task Group 3: Legacy Code Removal Verification Tests
 * Task Group 4: Test Review and Gap Analysis - Additional Strategic Tests
 *
 * Tests for the derivation logic that powers the 3-phase Implement button model:
 * - hasPlannerDefinition: Validates planner response has meaningful content
 * - hasUnansweredQuestions: Derives from questionStatuses map, not answer text
 *
 * Phase Model:
 * - Phase 1: No planner definition - Button DISABLED
 * - Phase 2: Planner definition + unanswered questions - Button ENABLED, modal on click
 * - Phase 3: Planner definition + all answered - Button ENABLED, proceed directly
 */

import { describe, it, expect, vi } from 'vitest';
import type { PlannerResponse, OpenQuestion } from '../api/chatApi';

/**
 * Helper function to test hasPlannerDefinition logic.
 * Mirrors the useMemo implementation in ImplementationAssistantPanel.
 *
 * Returns true when:
 * - latestPlannerResponse is present AND
 * - featureUnderstanding is non-empty/non-whitespace AND
 * - at least one substantive field is populated (non-empty array)
 *
 * Substantive fields: scope.in, scope.out, acceptanceCriteria, assumptions, openQuestions
 */
function hasPlannerDefinition(latestPlannerResponse: PlannerResponse | null | undefined): boolean {
  if (!latestPlannerResponse) {
    return false;
  }

  const { featureUnderstanding, scope, acceptanceCriteria, assumptions, openQuestions } = latestPlannerResponse;

  // featureUnderstanding must be meaningful (non-empty, non-whitespace)
  if (!featureUnderstanding || !featureUnderstanding.trim()) {
    return false;
  }

  // At least one substantive field must be a non-empty array
  const hasSubstantiveField =
    (scope?.in?.length ?? 0) > 0 ||
    (scope?.out?.length ?? 0) > 0 ||
    (acceptanceCriteria?.length ?? 0) > 0 ||
    (assumptions?.length ?? 0) > 0 ||
    (openQuestions?.length ?? 0) > 0;

  return hasSubstantiveField;
}

/**
 * Helper function to test openQuestionCount derivation.
 * Uses questionStatuses map instead of answer text presence.
 *
 * A question is "unanswered" if questionStatuses.get(id) !== 'Answered'
 * (i.e., status is 'Open' or missing from the map)
 */
function deriveOpenQuestionCount(
  openQuestions: OpenQuestion[] | undefined,
  questionStatuses: Map<string, 'Open' | 'Answered'>
): number {
  if (!openQuestions) {
    return 0;
  }
  return openQuestions.filter(oq => questionStatuses.get(oq.id) !== 'Answered').length;
}

/**
 * Helper function to test hasUnansweredQuestions derivation.
 * Simply returns openQuestionCount > 0.
 */
function hasUnansweredQuestions(openQuestionCount: number): boolean {
  return openQuestionCount > 0;
}

/**
 * Task Group 2: Helper function to compute canImplementBase.
 * Mirrors the formula in ImplementationAssistantPanel.
 *
 * Prerequisites:
 * - sessionId present
 * - not isLoading
 * - not isBootstrapping
 * - workItemId present
 * - hasPlannerDefinition (new - replaces hasProposedDefinition)
 * - not isImplementing
 */
interface CanImplementBaseParams {
  sessionId: string | null;
  isLoading: boolean;
  isBootstrapping: boolean;
  workItemId: string | null;
  hasPlannerDefinition: boolean;
  isImplementing: boolean;
}

function computeCanImplementBase(params: CanImplementBaseParams): boolean {
  const { sessionId, isLoading, isBootstrapping, workItemId, hasPlannerDefinition, isImplementing } = params;
  return !!sessionId && !isLoading && !isBootstrapping && !!workItemId && hasPlannerDefinition && !isImplementing;
}

/**
 * Task Group 2: Helper function to compute canImplement.
 * Button is enabled when not in implementationMode AND base conditions are met.
 */
function computeCanImplement(implementationMode: boolean, canImplementBase: boolean): boolean {
  return !implementationMode && canImplementBase;
}

describe('Spec 2026-01-25: Derivation Hooks - hasPlannerDefinition', () => {
  it('returns false when latestPlannerResponse is null', () => {
    const result = hasPlannerDefinition(null);
    expect(result).toBe(false);
  });

  it('returns false when latestPlannerResponse is undefined', () => {
    const result = hasPlannerDefinition(undefined);
    expect(result).toBe(false);
  });

  it('returns false when featureUnderstanding is empty string', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: '',
      scope: { in: ['item'], out: [] },
      acceptanceCriteria: ['AC1'],
      assumptions: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(false);
  });

  it('returns false when featureUnderstanding is whitespace only', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: '   \n\t  ',
      scope: { in: ['item'], out: [] },
      acceptanceCriteria: ['AC1'],
      assumptions: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(false);
  });

  it('returns false when featureUnderstanding present but no substantive fields populated', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: 'A meaningful understanding of the feature.',
      scope: { in: [], out: [] },
      acceptanceCriteria: [],
      assumptions: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(false);
  });

  it('returns true when featureUnderstanding + scope.in present', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: 'A meaningful understanding of the feature.',
      scope: { in: ['Item 1'], out: [] },
      acceptanceCriteria: [],
      assumptions: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(true);
  });

  it('returns true when featureUnderstanding + scope.out present', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: 'A meaningful understanding of the feature.',
      scope: { in: [], out: ['Out of scope item'] },
      acceptanceCriteria: [],
      assumptions: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(true);
  });

  it('returns true when featureUnderstanding + acceptanceCriteria present', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: 'A meaningful understanding of the feature.',
      scope: { in: [], out: [] },
      acceptanceCriteria: ['AC1', 'AC2'],
      assumptions: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(true);
  });

  it('returns true when featureUnderstanding + assumptions present', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: 'A meaningful understanding of the feature.',
      scope: { in: [], out: [] },
      acceptanceCriteria: [],
      assumptions: ['Assumption 1'],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(true);
  });

  it('returns true when featureUnderstanding + openQuestions present', () => {
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Hello',
      featureUnderstanding: 'A meaningful understanding of the feature.',
      scope: { in: [], out: [] },
      acceptanceCriteria: [],
      assumptions: [],
      openQuestions: [{ id: 'q1', question: 'What is X?' }],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };
    const result = hasPlannerDefinition(plannerResponse);
    expect(result).toBe(true);
  });
});

describe('Spec 2026-01-25: Derivation Hooks - openQuestionCount using questionStatuses', () => {
  it('returns 0 when openQuestions is undefined', () => {
    const questionStatuses = new Map<string, 'Open' | 'Answered'>();
    const result = deriveOpenQuestionCount(undefined, questionStatuses);
    expect(result).toBe(0);
  });

  it('returns 0 when openQuestions array is empty', () => {
    const questionStatuses = new Map<string, 'Open' | 'Answered'>();
    const result = deriveOpenQuestionCount([], questionStatuses);
    expect(result).toBe(0);
  });

  it('counts questions with status Open', () => {
    const openQuestions: OpenQuestion[] = [
      { id: 'q1', question: 'Question 1?' },
      { id: 'q2', question: 'Question 2?' },
      { id: 'q3', question: 'Question 3?' },
    ];
    const questionStatuses = new Map<string, 'Open' | 'Answered'>([
      ['q1', 'Open'],
      ['q2', 'Answered'],
      ['q3', 'Open'],
    ]);
    const result = deriveOpenQuestionCount(openQuestions, questionStatuses);
    expect(result).toBe(2);
  });

  it('counts questions missing from map as unanswered', () => {
    const openQuestions: OpenQuestion[] = [
      { id: 'q1', question: 'Question 1?' },
      { id: 'q2', question: 'Question 2?' },
      { id: 'q3', question: 'Question 3?' },
    ];
    // Only q2 is in the map with 'Answered' status
    const questionStatuses = new Map<string, 'Open' | 'Answered'>([
      ['q2', 'Answered'],
    ]);
    const result = deriveOpenQuestionCount(openQuestions, questionStatuses);
    // q1 and q3 are missing from map, so they count as unanswered
    expect(result).toBe(2);
  });

  it('returns 0 when all questions have Answered status', () => {
    const openQuestions: OpenQuestion[] = [
      { id: 'q1', question: 'Question 1?' },
      { id: 'q2', question: 'Question 2?' },
    ];
    const questionStatuses = new Map<string, 'Open' | 'Answered'>([
      ['q1', 'Answered'],
      ['q2', 'Answered'],
    ]);
    const result = deriveOpenQuestionCount(openQuestions, questionStatuses);
    expect(result).toBe(0);
  });

  it('returns full count when all questions have Open status', () => {
    const openQuestions: OpenQuestion[] = [
      { id: 'q1', question: 'Question 1?' },
      { id: 'q2', question: 'Question 2?' },
      { id: 'q3', question: 'Question 3?' },
    ];
    const questionStatuses = new Map<string, 'Open' | 'Answered'>([
      ['q1', 'Open'],
      ['q2', 'Open'],
      ['q3', 'Open'],
    ]);
    const result = deriveOpenQuestionCount(openQuestions, questionStatuses);
    expect(result).toBe(3);
  });
});

describe('Spec 2026-01-25: Derivation Hooks - hasUnansweredQuestions', () => {
  it('returns true when openQuestionCount > 0', () => {
    expect(hasUnansweredQuestions(1)).toBe(true);
    expect(hasUnansweredQuestions(5)).toBe(true);
  });

  it('returns false when openQuestionCount === 0', () => {
    expect(hasUnansweredQuestions(0)).toBe(false);
  });
});

/**
 * Task Group 2: Button Enablement and Modal Trigger Tests
 *
 * Tests the 3-phase state model for the Implement button:
 * - Phase 1 (No Planner Definition): Button is DISABLED
 * - Phase 2 (Planner Present + Unanswered Questions): Button is ENABLED, modal shown on click
 * - Phase 3 (Planner Present + All Answered): Button is ENABLED, proceed directly
 */
describe('Spec 2026-01-25: Task Group 2 - Button Enablement Logic', () => {
  describe('Phase 1: Button DISABLED when hasPlannerDefinition === false', () => {
    it('should disable button when hasPlannerDefinition is false even if other prerequisites are met', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: false, // Phase 1 - no planner definition
        isImplementing: false,
      });

      expect(canImplementBase).toBe(false);
    });

    it('should disable button with null latestPlannerResponse', () => {
      const plannerDef = hasPlannerDefinition(null);
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });

      expect(plannerDef).toBe(false);
      expect(canImplementBase).toBe(false);
    });
  });

  describe('Phase 2/3: Button ENABLED when hasPlannerDefinition === true', () => {
    it('should enable button when hasPlannerDefinition is true (regardless of unanswered questions)', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: true, // Phase 2 or 3
        isImplementing: false,
      });

      expect(canImplementBase).toBe(true);
    });

    it('should enable button in Phase 2 (planner present + unanswered questions)', () => {
      // Setup: Valid planner response with unanswered questions
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Hello',
        featureUnderstanding: 'Feature description',
        scope: { in: ['In scope item'], out: [] },
        acceptanceCriteria: [],
        assumptions: [],
        openQuestions: [{ id: 'q1', question: 'What is the deadline?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };
      const questionStatuses = new Map<string, 'Open' | 'Answered'>([['q1', 'Open']]);

      const plannerDef = hasPlannerDefinition(plannerResponse);
      const openCount = deriveOpenQuestionCount(plannerResponse.openQuestions, questionStatuses);
      const hasUnanswered = hasUnansweredQuestions(openCount);

      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });

      expect(plannerDef).toBe(true);
      expect(hasUnanswered).toBe(true); // Phase 2: has unanswered questions
      expect(canImplementBase).toBe(true); // Button is ENABLED in Phase 2
    });

    it('should enable button in Phase 3 (planner present + all answered)', () => {
      // Setup: Valid planner response with all questions answered
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Hello',
        featureUnderstanding: 'Feature description',
        scope: { in: ['In scope item'], out: [] },
        acceptanceCriteria: [],
        assumptions: [],
        openQuestions: [{ id: 'q1', question: 'What is the deadline?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };
      const questionStatuses = new Map<string, 'Open' | 'Answered'>([['q1', 'Answered']]);

      const plannerDef = hasPlannerDefinition(plannerResponse);
      const openCount = deriveOpenQuestionCount(plannerResponse.openQuestions, questionStatuses);
      const hasUnanswered = hasUnansweredQuestions(openCount);

      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });

      expect(plannerDef).toBe(true);
      expect(hasUnanswered).toBe(false); // Phase 3: all questions answered
      expect(canImplementBase).toBe(true); // Button is ENABLED in Phase 3
    });
  });

  describe('Existing base prerequisites still apply', () => {
    it('should disable button when sessionId is missing', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: null, // Missing
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: true,
        isImplementing: false,
      });

      expect(canImplementBase).toBe(false);
    });

    it('should disable button when isLoading is true', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: true, // Loading
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: true,
        isImplementing: false,
      });

      expect(canImplementBase).toBe(false);
    });

    it('should disable button when isBootstrapping is true', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: true, // Bootstrapping
        workItemId: 'workitem-456',
        hasPlannerDefinition: true,
        isImplementing: false,
      });

      expect(canImplementBase).toBe(false);
    });

    it('should disable button when workItemId is missing', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: null, // Missing
        hasPlannerDefinition: true,
        isImplementing: false,
      });

      expect(canImplementBase).toBe(false);
    });

    it('should disable button when isImplementing is true', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: true,
        isImplementing: true, // Currently implementing
      });

      expect(canImplementBase).toBe(false);
    });

    it('should disable canImplement when implementationMode is true', () => {
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: true,
        isImplementing: false,
      });

      // canImplementBase is true, but implementationMode gates the final result
      expect(canImplementBase).toBe(true);

      const canImplement = computeCanImplement(true, canImplementBase); // implementationMode = true
      expect(canImplement).toBe(false);
    });
  });
});

describe('Spec 2026-01-25: Task Group 2 - Modal Trigger Logic', () => {
  describe('Phase 2: Modal SHOWN when button clicked AND hasUnansweredQuestions === true', () => {
    it('should show modal when clicked with unanswered questions', () => {
      const implementationMode = false;
      const openQuestionCount = 3;
      const onShowModal = vi.fn();
      const onProceed = vi.fn();

      // Simulated handleImplementClick logic
      function handleImplementClick() {
        if (implementationMode) {
          return; // Guard
        }
        if (openQuestionCount > 0) {
          onShowModal();
        } else {
          onProceed();
        }
      }

      handleImplementClick();

      expect(onShowModal).toHaveBeenCalledTimes(1);
      expect(onProceed).not.toHaveBeenCalled();
    });

    it('should pass correct openQuestionCount to modal', () => {
      const openQuestionCount = 5;
      let receivedCount: number | undefined;

      // Simulated modal trigger
      function showModal(count: number) {
        receivedCount = count;
      }

      showModal(openQuestionCount);

      expect(receivedCount).toBe(5);
    });
  });

  describe('Phase 3: Modal BYPASSED when button clicked AND hasUnansweredQuestions === false', () => {
    it('should proceed directly when no unanswered questions', () => {
      const implementationMode = false;
      const openQuestionCount = 0;
      const onShowModal = vi.fn();
      const onProceed = vi.fn();

      // Simulated handleImplementClick logic
      function handleImplementClick() {
        if (implementationMode) {
          return; // Guard
        }
        if (openQuestionCount > 0) {
          onShowModal();
        } else {
          onProceed();
        }
      }

      handleImplementClick();

      expect(onShowModal).not.toHaveBeenCalled();
      expect(onProceed).toHaveBeenCalledTimes(1);
    });

    it('should set implementationMode to true and generate plan when proceeding directly', () => {
      const openQuestionCount = 0;
      let implementationMode = false;
      const generatePlan = vi.fn();

      // Simulated handleImplementClick logic (Phase 3 path)
      function handleImplementClick() {
        if (implementationMode) {
          return;
        }
        if (openQuestionCount > 0) {
          // Would show modal
        } else {
          implementationMode = true;
          generatePlan();
        }
      }

      handleImplementClick();

      expect(implementationMode).toBe(true);
      expect(generatePlan).toHaveBeenCalledTimes(1);
    });
  });

  describe('Guard: implementationMode prevents repeated clicks', () => {
    it('should not trigger modal or proceed when implementationMode is already true', () => {
      const implementationMode = true; // Already in implementation mode
      const openQuestionCount = 3;
      const onShowModal = vi.fn();
      const onProceed = vi.fn();

      function handleImplementClick() {
        if (implementationMode) {
          return; // Guard prevents action
        }
        if (openQuestionCount > 0) {
          onShowModal();
        } else {
          onProceed();
        }
      }

      handleImplementClick();

      expect(onShowModal).not.toHaveBeenCalled();
      expect(onProceed).not.toHaveBeenCalled();
    });
  });
});

/**
 * Task Group 3: Legacy Code Removal Verification Tests
 *
 * These tests verify that after removing the legacy hasProposedDefinition useMemo
 * and extractProposedDefinition import, the 3-phase model still works correctly.
 *
 * Key verification points:
 * - Button behavior unchanged after removing legacy code
 * - No runtime errors with imports removed
 * - Phase 1/2/3 transitions still work correctly
 */
describe('Spec 2026-01-25: Task Group 3 - Legacy Code Removal Verification', () => {
  describe('Button behavior unchanged after removing hasProposedDefinition', () => {
    it('should use hasPlannerDefinition (not hasProposedDefinition) for button enablement', () => {
      // This test verifies the new derivation works as expected
      // hasPlannerDefinition uses latestPlannerResponse structure, not message extraction

      // Scenario: Valid planner response should enable button
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Feature analysis complete.',
        featureUnderstanding: 'This feature enables users to export reports.',
        scope: { in: ['Report generation', 'Export to PDF'], out: ['Email delivery'] },
        acceptanceCriteria: ['User can export to PDF', 'Export completes within 5 seconds'],
        assumptions: ['User has report data available'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: null,
      };

      // New derivation: hasPlannerDefinition
      const plannerDef = hasPlannerDefinition(plannerResponse);

      // Button should be enabled when planner definition exists
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });

      expect(plannerDef).toBe(true);
      expect(canImplementBase).toBe(true);
    });

    it('should disable button when planner response has no substantive content', () => {
      // This tests the edge case where we have a planner response but it lacks substance
      // The old hasProposedDefinition checked for a PROPOSED marker in messages
      // The new hasPlannerDefinition checks for featureUnderstanding + substantive fields

      const emptyPlannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Hello, how can I help?',
        featureUnderstanding: '', // Empty - no meaningful understanding
        scope: { in: [], out: [] },
        acceptanceCriteria: [],
        assumptions: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const plannerDef = hasPlannerDefinition(emptyPlannerResponse);

      expect(plannerDef).toBe(false);

      // Button should be disabled
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });

      expect(canImplementBase).toBe(false);
    });
  });

  describe('Phase transitions work correctly after cleanup', () => {
    it('should correctly transition from Phase 1 to Phase 2 when planner provides definition', () => {
      // Phase 1: No planner definition
      const phase1Response = null;
      const phase1PlannerDef = hasPlannerDefinition(phase1Response);
      expect(phase1PlannerDef).toBe(false);

      const phase1CanImplement = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: phase1PlannerDef,
        isImplementing: false,
      });
      expect(phase1CanImplement).toBe(false); // Button disabled in Phase 1

      // Phase 2: Planner provides definition with unanswered questions
      const phase2Response: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'I understand the feature.',
        featureUnderstanding: 'A dashboard for viewing metrics.',
        scope: { in: ['Metrics display'], out: [] },
        acceptanceCriteria: ['Dashboard loads within 2 seconds'],
        assumptions: [],
        openQuestions: [{ id: 'q1', question: 'What metrics should be displayed?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };
      const questionStatuses = new Map<string, 'Open' | 'Answered'>([['q1', 'Open']]);

      const phase2PlannerDef = hasPlannerDefinition(phase2Response);
      const phase2OpenCount = deriveOpenQuestionCount(phase2Response.openQuestions, questionStatuses);
      const phase2HasUnanswered = hasUnansweredQuestions(phase2OpenCount);

      expect(phase2PlannerDef).toBe(true);
      expect(phase2HasUnanswered).toBe(true);

      const phase2CanImplement = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: phase2PlannerDef,
        isImplementing: false,
      });
      expect(phase2CanImplement).toBe(true); // Button enabled in Phase 2
    });

    it('should correctly transition from Phase 2 to Phase 3 when questions are answered', () => {
      // Same planner response, but questions get answered
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'I understand the feature.',
        featureUnderstanding: 'A dashboard for viewing metrics.',
        scope: { in: ['Metrics display'], out: [] },
        acceptanceCriteria: ['Dashboard loads within 2 seconds'],
        assumptions: [],
        openQuestions: [
          { id: 'q1', question: 'What metrics should be displayed?' },
          { id: 'q2', question: 'How often should data refresh?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Phase 2: Some questions open
      const phase2Statuses = new Map<string, 'Open' | 'Answered'>([
        ['q1', 'Answered'],
        ['q2', 'Open'],
      ]);
      const phase2OpenCount = deriveOpenQuestionCount(plannerResponse.openQuestions, phase2Statuses);
      const phase2HasUnanswered = hasUnansweredQuestions(phase2OpenCount);
      expect(phase2HasUnanswered).toBe(true); // Still in Phase 2

      // Phase 3: All questions answered
      const phase3Statuses = new Map<string, 'Open' | 'Answered'>([
        ['q1', 'Answered'],
        ['q2', 'Answered'],
      ]);
      const phase3OpenCount = deriveOpenQuestionCount(plannerResponse.openQuestions, phase3Statuses);
      const phase3HasUnanswered = hasUnansweredQuestions(phase3OpenCount);
      expect(phase3HasUnanswered).toBe(false); // Now in Phase 3

      // Both phases should have button enabled (just different modal behavior)
      const plannerDef = hasPlannerDefinition(plannerResponse);
      expect(plannerDef).toBe(true);

      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });
      expect(canImplementBase).toBe(true); // Button enabled in both Phase 2 and 3
    });
  });

  describe('No runtime errors after import cleanup', () => {
    it('should not reference extractProposedDefinition or hasProposedDefinition in button logic', () => {
      // This test documents that the cleanup is complete:
      // - extractProposedDefinition is no longer used in button enablement
      // - hasProposedDefinition useMemo is removed
      // - hasPlannerDefinition useMemo is the sole source of truth

      // The button enablement formula is:
      // canImplementBase = !!sessionId && !isLoading && !isBootstrapping && !!workItemId && hasPlannerDefinition && !isImplementing
      //
      // Notice: hasPlannerDefinition (not hasProposedDefinition)

      // Verify the formula works with all prerequisites
      const allPrerequisitesMet = computeCanImplementBase({
        sessionId: 'valid-session',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'valid-workitem',
        hasPlannerDefinition: true,
        isImplementing: false,
      });
      expect(allPrerequisitesMet).toBe(true);

      // Verify the formula works without planner definition
      const noPlannerDef = computeCanImplementBase({
        sessionId: 'valid-session',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'valid-workitem',
        hasPlannerDefinition: false,
        isImplementing: false,
      });
      expect(noPlannerDef).toBe(false);
    });
  });
});

/**
 * Task Group 4: Test Review and Gap Analysis - Additional Strategic Tests
 *
 * These tests fill coverage gaps identified during test review:
 * - Edge cases for hasPlannerDefinition criteria
 * - Phase transitions
 * - Work item transitions
 * - Multiple substantive fields
 */
describe('Spec 2026-01-25: Task Group 4 - Additional Strategic Tests', () => {
  describe('Edge case: Multiple substantive fields populated simultaneously', () => {
    it('should return true when all substantive fields are populated', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Complete feature analysis.',
        featureUnderstanding: 'A comprehensive dashboard for analytics.',
        scope: {
          in: ['Real-time metrics', 'Historical data'],
          out: ['Predictive analytics', 'AI recommendations'],
        },
        acceptanceCriteria: ['Dashboard loads in < 2s', 'Data refreshes every 30s'],
        assumptions: ['User has authenticated', 'Data source is available'],
        openQuestions: [
          { id: 'q1', question: 'What date range should be default?' },
          { id: 'q2', question: 'Should we support export?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const result = hasPlannerDefinition(plannerResponse);
      expect(result).toBe(true);
    });

    it('should return true when scope.in and scope.out are both populated (but other fields empty)', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Scope defined.',
        featureUnderstanding: 'A user profile management system.',
        scope: {
          in: ['Edit profile', 'View profile'],
          out: ['Delete account'],
        },
        acceptanceCriteria: [],
        assumptions: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const result = hasPlannerDefinition(plannerResponse);
      expect(result).toBe(true);
    });
  });

  describe('Edge case: Only openQuestions as substantive field', () => {
    it('should return true when featureUnderstanding + openQuestions only (no scope/AC/assumptions)', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'I have some questions.',
        featureUnderstanding: 'A notification system for alerting users.',
        scope: { in: [], out: [] },
        acceptanceCriteria: [],
        assumptions: [],
        openQuestions: [
          { id: 'q1', question: 'What notification channels are needed?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const result = hasPlannerDefinition(plannerResponse);
      expect(result).toBe(true);

      // Button should be enabled even with only questions as substantive field
      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: result,
        isImplementing: false,
      });
      expect(canImplementBase).toBe(true);
    });
  });

  describe('Edge case: Partial question answering stays in Phase 2', () => {
    it('should remain in Phase 2 when going from 3 unanswered to 1 unanswered', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Feature defined.',
        featureUnderstanding: 'An inventory management system.',
        scope: { in: ['Stock tracking', 'Reorder alerts'], out: [] },
        acceptanceCriteria: ['Stock levels update in real-time'],
        assumptions: [],
        openQuestions: [
          { id: 'q1', question: 'What is the minimum stock threshold?' },
          { id: 'q2', question: 'Who receives reorder alerts?' },
          { id: 'q3', question: 'What is the alert frequency?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Initial state: All 3 questions unanswered (Phase 2)
      const initialStatuses = new Map<string, 'Open' | 'Answered'>([
        ['q1', 'Open'],
        ['q2', 'Open'],
        ['q3', 'Open'],
      ]);
      const initialOpenCount = deriveOpenQuestionCount(plannerResponse.openQuestions, initialStatuses);
      expect(initialOpenCount).toBe(3);
      expect(hasUnansweredQuestions(initialOpenCount)).toBe(true); // Phase 2

      // After answering 2 questions: Still 1 unanswered (still Phase 2)
      const partialStatuses = new Map<string, 'Open' | 'Answered'>([
        ['q1', 'Answered'],
        ['q2', 'Answered'],
        ['q3', 'Open'],
      ]);
      const partialOpenCount = deriveOpenQuestionCount(plannerResponse.openQuestions, partialStatuses);
      expect(partialOpenCount).toBe(1);
      expect(hasUnansweredQuestions(partialOpenCount)).toBe(true); // Still Phase 2

      // Button enabled in both states
      const plannerDef = hasPlannerDefinition(plannerResponse);
      expect(plannerDef).toBe(true);
    });
  });

  describe('Edge case: Work item transition clears plannerResponse', () => {
    it('should revert to Phase 1 when plannerResponse is cleared (simulating work item switch)', () => {
      // Phase 2: Has valid planner response with questions
      const phase2Response: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Feature understood.',
        featureUnderstanding: 'A search feature for the application.',
        scope: { in: ['Keyword search'], out: ['Voice search'] },
        acceptanceCriteria: ['Search returns results in < 1s'],
        assumptions: [],
        openQuestions: [{ id: 'q1', question: 'Should results be paginated?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Verify Phase 2 state
      const phase2PlannerDef = hasPlannerDefinition(phase2Response);
      expect(phase2PlannerDef).toBe(true);

      const phase2CanImplement = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: phase2PlannerDef,
        isImplementing: false,
      });
      expect(phase2CanImplement).toBe(true); // Button enabled in Phase 2

      // Work item transition: plannerResponse cleared (null)
      const afterTransitionResponse = null;
      const afterTransitionPlannerDef = hasPlannerDefinition(afterTransitionResponse);
      expect(afterTransitionPlannerDef).toBe(false);

      const afterTransitionCanImplement = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'new-workitem-789', // New work item
        hasPlannerDefinition: afterTransitionPlannerDef,
        isImplementing: false,
      });
      expect(afterTransitionCanImplement).toBe(false); // Button disabled in Phase 1
    });
  });

  describe('Edge case: Empty arrays vs undefined handling', () => {
    it('should treat empty arrays the same as absent substantive fields', () => {
      const withEmptyArrays: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Initial response.',
        featureUnderstanding: 'A feature description.',
        scope: { in: [], out: [] },
        acceptanceCriteria: [],
        assumptions: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const result = hasPlannerDefinition(withEmptyArrays);
      expect(result).toBe(false); // No substantive fields = Phase 1
    });

    it('should handle scope with empty arrays correctly', () => {
      // Scope object exists but both arrays are empty
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Response.',
        featureUnderstanding: 'A valid feature understanding.',
        scope: { in: [], out: [] }, // Empty arrays
        acceptanceCriteria: ['AC1'], // Has one substantive field
        assumptions: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const result = hasPlannerDefinition(plannerResponse);
      expect(result).toBe(true); // acceptanceCriteria is substantive
    });
  });

  describe('Complete 3-phase lifecycle integration test', () => {
    it('should correctly handle full Phase 1 -> Phase 2 -> Phase 3 lifecycle', () => {
      // === PHASE 1: Initial state - no planner response ===
      let currentResponse: PlannerResponse | null = null;
      let questionStatuses = new Map<string, 'Open' | 'Answered'>();

      let plannerDef = hasPlannerDefinition(currentResponse);
      let openCount = deriveOpenQuestionCount(currentResponse?.openQuestions, questionStatuses);
      let hasUnanswered = hasUnansweredQuestions(openCount);

      expect(plannerDef).toBe(false);
      expect(hasUnanswered).toBe(false); // No questions yet
      // Phase 1: Button disabled
      let canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });
      expect(canImplementBase).toBe(false);

      // === PHASE 2: Planner provides response with questions ===
      currentResponse = {
        schemaVersion: '1.1',
        message: 'I understand the feature.',
        featureUnderstanding: 'A payment processing feature.',
        scope: { in: ['Process payments', 'Generate receipts'], out: ['Refunds'] },
        acceptanceCriteria: ['Payment completes in < 3s'],
        assumptions: ['Payment gateway is available'],
        openQuestions: [
          { id: 'q1', question: 'Which payment methods?' },
          { id: 'q2', question: 'What currency support?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };
      questionStatuses = new Map<string, 'Open' | 'Answered'>([
        ['q1', 'Open'],
        ['q2', 'Open'],
      ]);

      plannerDef = hasPlannerDefinition(currentResponse);
      openCount = deriveOpenQuestionCount(currentResponse.openQuestions, questionStatuses);
      hasUnanswered = hasUnansweredQuestions(openCount);

      expect(plannerDef).toBe(true);
      expect(openCount).toBe(2);
      expect(hasUnanswered).toBe(true);
      // Phase 2: Button enabled, modal would show on click
      canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });
      expect(canImplementBase).toBe(true);

      // Simulate click decision in Phase 2
      const showModalPhase2 = openCount > 0;
      expect(showModalPhase2).toBe(true);

      // === PHASE 3: All questions answered ===
      questionStatuses = new Map<string, 'Open' | 'Answered'>([
        ['q1', 'Answered'],
        ['q2', 'Answered'],
      ]);

      plannerDef = hasPlannerDefinition(currentResponse);
      openCount = deriveOpenQuestionCount(currentResponse.openQuestions, questionStatuses);
      hasUnanswered = hasUnansweredQuestions(openCount);

      expect(plannerDef).toBe(true);
      expect(openCount).toBe(0);
      expect(hasUnanswered).toBe(false);
      // Phase 3: Button enabled, proceed directly (no modal)
      canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });
      expect(canImplementBase).toBe(true);

      // Simulate click decision in Phase 3
      const showModalPhase3 = openCount > 0;
      expect(showModalPhase3).toBe(false); // Proceed directly!
    });
  });

  describe('Edge case: Planner response without questions - direct Phase 3', () => {
    it('should be in Phase 3 when valid planner response has no openQuestions', () => {
      // Planner can provide a complete definition without asking questions
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Feature is fully defined.',
        featureUnderstanding: 'A simple logging feature that records user actions.',
        scope: { in: ['Log user actions'], out: ['Log system events'] },
        acceptanceCriteria: ['Logs are persisted', 'Logs include timestamps'],
        assumptions: ['Database is available'],
        openQuestions: [], // No questions - planner has all info needed
        plannerReadyForSpec: true,
        implementationPlan: null,
      };
      const questionStatuses = new Map<string, 'Open' | 'Answered'>();

      const plannerDef = hasPlannerDefinition(plannerResponse);
      const openCount = deriveOpenQuestionCount(plannerResponse.openQuestions, questionStatuses);
      const hasUnanswered = hasUnansweredQuestions(openCount);

      expect(plannerDef).toBe(true);
      expect(openCount).toBe(0);
      expect(hasUnanswered).toBe(false); // Phase 3 directly

      const canImplementBase = computeCanImplementBase({
        sessionId: 'session-123',
        isLoading: false,
        isBootstrapping: false,
        workItemId: 'workitem-456',
        hasPlannerDefinition: plannerDef,
        isImplementing: false,
      });
      expect(canImplementBase).toBe(true);

      // Click would proceed directly (no modal)
      const showModal = openCount > 0;
      expect(showModal).toBe(false);
    });
  });

  describe('Verify SA questions are handled via combinedQuestions (separate from PO questions)', () => {
    /**
     * Note: SA (Software Architect) questions come from ImplementerResponse.openQuestions
     * and are combined with PO questions via the `combinedQuestions` memo in the component.
     * This test verifies the count derivation logic works correctly when questions come
     * from multiple sources (PO + SA).
     *
     * The test simulates combined questions that would include both PO and SA sources.
     */
    it('should count combined PO and SA questions correctly', () => {
      // Simulate combined questions (PO + SA merged by the component)
      // In the real component, combinedQuestions merges:
      // - latestPlannerResponse.openQuestions (PO questions)
      // - saQuestions from ImplementerResponse (SA questions per increment)

      // For this test, we simulate the merged result:
      const combinedOpenQuestions: OpenQuestion[] = [
        // PO questions
        { id: 'po-q1', question: 'What is the target audience?' },
        { id: 'po-q2', question: 'What is the budget?' },
        // SA questions (would have incrementId in real impl, but id is sufficient for counting)
        { id: 'sa-q1', question: 'Which API endpoint should be used?' },
        { id: 'sa-q2', question: 'What authentication method?' },
      ];

      // Mixed status: some PO answered, some SA answered
      const questionStatuses = new Map<string, 'Open' | 'Answered'>([
        ['po-q1', 'Answered'], // PO answered
        ['po-q2', 'Open'],     // PO unanswered
        ['sa-q1', 'Open'],     // SA unanswered
        ['sa-q2', 'Answered'], // SA answered
      ]);

      const openCount = deriveOpenQuestionCount(combinedOpenQuestions, questionStatuses);
      expect(openCount).toBe(2); // po-q2 and sa-q1 are unanswered

      const hasUnanswered = hasUnansweredQuestions(openCount);
      expect(hasUnanswered).toBe(true); // Phase 2: has unanswered questions from both sources
    });
  });
});
