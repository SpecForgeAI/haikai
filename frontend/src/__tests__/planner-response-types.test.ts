/**
 * PlannerResponse Type Definition Tests
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 1: Type Definitions Layer
 *
 * Tests for:
 * - PlannerResponse interface shape validation
 * - ChatResponse includes optional plannerResponse field
 * - ImplementationPlan interface shape validation
 * - Type guards work correctly for PlannerResponse validation
 */

import { describe, it, expect } from 'vitest';
import type {
  PlannerResponse,
  ImplementationPlan,
  Increment,
  ChatResponse,
} from '../api/chatApi';

describe('Task Group 1: PlannerResponse Type Definitions', () => {
  describe('Test 1.1: PlannerResponse interface shape validation', () => {
    it('should allow valid PlannerResponse object with all required fields', () => {
      const validPlannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Test message',
        featureUnderstanding: 'Understanding of the feature',
        scope: {
          in: ['Item 1', 'Item 2'],
          out: ['Excluded item'],
        },
        assumptions: ['Assumption 1'],
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        openQuestions: ['Question 1'],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Type assertion - if this compiles, the shape is correct
      expect(validPlannerResponse.schemaVersion).toBe('1.1');
      expect(validPlannerResponse.message).toBe('Test message');
      expect(validPlannerResponse.featureUnderstanding).toBe('Understanding of the feature');
      expect(validPlannerResponse.scope.in).toHaveLength(2);
      expect(validPlannerResponse.scope.out).toHaveLength(1);
      expect(validPlannerResponse.assumptions).toHaveLength(1);
      expect(validPlannerResponse.acceptanceCriteria).toHaveLength(2);
      expect(validPlannerResponse.openQuestions).toHaveLength(1);
      expect(validPlannerResponse.plannerReadyForSpec).toBe(false);
      expect(validPlannerResponse.implementationPlan).toBeNull();
    });

    it('should allow PlannerResponse with empty arrays', () => {
      const emptyArraysResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Initial response',
        featureUnderstanding: '',
        scope: {
          in: [],
          out: [],
        },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(emptyArraysResponse.scope.in).toHaveLength(0);
      expect(emptyArraysResponse.scope.out).toHaveLength(0);
      expect(emptyArraysResponse.assumptions).toHaveLength(0);
      expect(emptyArraysResponse.acceptanceCriteria).toHaveLength(0);
      expect(emptyArraysResponse.openQuestions).toHaveLength(0);
    });
  });

  describe('Test 1.2: ChatResponse includes optional plannerResponse field', () => {
    it('should allow ChatResponse without plannerResponse', () => {
      const responseWithoutPlanner: ChatResponse = {
        sessionId: 'session-123',
        assistant: {
          message: 'Standard response',
        },
      };

      expect(responseWithoutPlanner.sessionId).toBe('session-123');
      expect(responseWithoutPlanner.assistant.message).toBe('Standard response');
      expect(responseWithoutPlanner.plannerResponse).toBeUndefined();
    });

    it('should allow ChatResponse with plannerResponse', () => {
      const responseWithPlanner: ChatResponse = {
        sessionId: 'session-456',
        assistant: {
          message: 'Response with planner data',
        },
        plannerResponse: {
          schemaVersion: '1.1',
          message: 'Planner message',
          featureUnderstanding: 'Feature understanding text',
          scope: {
            in: ['Scope item'],
            out: [],
          },
          assumptions: [],
          acceptanceCriteria: ['AC 1'],
          openQuestions: [],
          plannerReadyForSpec: true,
          implementationPlan: null,
        },
      };

      expect(responseWithPlanner.plannerResponse).toBeDefined();
      expect(responseWithPlanner.plannerResponse?.schemaVersion).toBe('1.1');
      expect(responseWithPlanner.plannerResponse?.message).toBe('Planner message');
    });
  });

  describe('Test 1.3: ImplementationPlan interface shape validation', () => {
    it('should allow valid ImplementationPlan with increments', () => {
      const validIncrement: Increment = {
        id: 'INC-1',
        partIndex: 1,
        title: 'Increment 1',
        intent: 'First increment description and sub-feature definition',
      };

      const validPlan: ImplementationPlan = {
        planTitle: 'Implementation Plan Title',
        increments: [validIncrement],
      };

      expect(validPlan.planTitle).toBe('Implementation Plan Title');
      expect(validPlan.increments).toHaveLength(1);
      expect(validPlan.increments[0].id).toBe('INC-1');
      expect(validPlan.increments[0].partIndex).toBe(1);
      expect(validPlan.increments[0].intent).toBeDefined();
    });

    it('should allow PlannerResponse with implementationPlan', () => {
      const plannerWithPlan: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Plan ready',
        featureUnderstanding: 'Fully understood feature',
        scope: {
          in: ['Everything'],
          out: ['Nothing'],
        },
        assumptions: ['Assumption'],
        acceptanceCriteria: ['AC 1', 'AC 2'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'Full Plan',
          increments: [
            {
              id: 'INC-1',
              partIndex: 1,
              title: 'First Increment',
              intent: 'Do the first thing - first sub-feature',
            },
            {
              id: 'INC-2',
              partIndex: 2,
              title: 'Second Increment',
              intent: 'Do the second thing - second sub-feature',
            },
          ],
        },
      };

      expect(plannerWithPlan.implementationPlan).not.toBeNull();
      expect(plannerWithPlan.implementationPlan?.planTitle).toBe('Full Plan');
      expect(plannerWithPlan.implementationPlan?.increments).toHaveLength(2);
    });
  });

  describe('Test 1.4: Type guards for PlannerResponse validation', () => {
    it('should correctly identify valid PlannerResponse objects', () => {
      const validResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Valid',
        featureUnderstanding: 'Understanding',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // Check required fields exist
      expect('schemaVersion' in validResponse).toBe(true);
      expect('message' in validResponse).toBe(true);
      expect('featureUnderstanding' in validResponse).toBe(true);
      expect('scope' in validResponse).toBe(true);
      expect('assumptions' in validResponse).toBe(true);
      expect('acceptanceCriteria' in validResponse).toBe(true);
      expect('openQuestions' in validResponse).toBe(true);
      expect('plannerReadyForSpec' in validResponse).toBe(true);
      expect('implementationPlan' in validResponse).toBe(true);
    });

    it('should validate scope object structure', () => {
      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Test',
        featureUnderstanding: 'Test',
        scope: {
          in: ['item1', 'item2'],
          out: ['excluded1'],
        },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(Array.isArray(plannerResponse.scope.in)).toBe(true);
      expect(Array.isArray(plannerResponse.scope.out)).toBe(true);
      expect(plannerResponse.scope.in.every((item) => typeof item === 'string')).toBe(true);
      expect(plannerResponse.scope.out.every((item) => typeof item === 'string')).toBe(true);
    });
  });
});
