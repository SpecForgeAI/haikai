/**
 * Contract Tests for LLM Response Validation
 *
 * Tests that PlannerResponse and ImplementerResponse payloads conform
 * to their expected contracts. These are critical for ensuring LLM
 * responses can be safely stored and retrieved.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 10: Contract Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validatePlannerResponse,
  validateImplementerResponse,
  validateQuestions,
} from '../utils/validateLLMPayload';

describe('Contract Tests - LLM Response Validation', () => {
  describe('PlannerResponse Contract', () => {
    /**
     * Test 1: Standard response with all required fields.
     */
    it('validates standard response with all required fields', () => {
      // Given - A complete PlannerResponse as it would come from the LLM
      const standardResponse = {
        schemaVersion: '1.1',
        message: 'I understand your feature requirements. Here is my analysis...',
        featureUnderstanding: 'The user wants to implement a dashboard that shows real-time metrics.',
        scope: {
          in: [
            'Real-time data refresh',
            'Customizable widgets',
            'User preferences persistence',
          ],
          out: [
            'Historical data export',
            'Multi-tenant support',
          ],
        },
        assumptions: [
          'Data source is already available via REST API',
          'Authentication is handled by existing auth service',
        ],
        acceptanceCriteria: [
          'Dashboard loads within 2 seconds',
          'Widgets can be rearranged by drag-and-drop',
          'User preferences persist across sessions',
        ],
        openQuestions: [
          { id: 'q-001', question: 'What is the expected refresh rate for real-time data?' },
          { id: 'q-002', question: 'Should widgets be shareable between users?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // When
      const result = validatePlannerResponse(standardResponse);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    /**
     * Test 2: Response with empty arrays (valid edge case).
     */
    it('validates response with empty arrays', () => {
      // Given
      const emptyArraysResponse = {
        schemaVersion: '1.1',
        message: 'Initial analysis complete.',
        featureUnderstanding: 'Basic feature.',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: null,
      };

      // When
      const result = validatePlannerResponse(emptyArraysResponse);

      // Then
      expect(result.valid).toBe(true);
    });

    /**
     * Test 3: Response with implementation plan.
     */
    it('validates response with implementation plan', () => {
      // Given
      const responseWithPlan = {
        schemaVersion: '1.1',
        message: 'Implementation plan generated.',
        featureUnderstanding: 'Feature with plan.',
        scope: { in: ['item'], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'Dashboard Implementation',
          increments: [
            {
              id: 'INC-001',
              partIndex: 1,
              title: 'Core Dashboard Layout',
              intent: 'Implement basic dashboard structure with header, sidebar, and main content area',
            },
            {
              id: 'INC-002',
              partIndex: 2,
              title: 'Widget System',
              intent: 'Add widget rendering and management with configurable drag-and-drop',
            },
          ],
        },
      };

      // When
      const result = validatePlannerResponse(responseWithPlan);

      // Then
      expect(result.valid).toBe(true);
    });

    /**
     * Test 4: Invalid schemaVersion is rejected.
     */
    it('rejects invalid schemaVersion', () => {
      // Given
      const wrongVersion = {
        schemaVersion: '2.0', // Not supported
        message: 'Test',
        featureUnderstanding: 'Test',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      // When
      const result = validatePlannerResponse(wrongVersion);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid schemaVersion: expected '1.1', got '2.0'");
    });

    /**
     * Test 5: Missing required fields are detected.
     */
    it('detects missing required fields', () => {
      // Given - Incomplete response
      const incompleteResponse = {
        schemaVersion: '1.1',
        message: 'Test',
        // Missing: featureUnderstanding, scope, assumptions, acceptanceCriteria, openQuestions, plannerReadyForSpec
      };

      // When
      const result = validatePlannerResponse(incompleteResponse);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('featureUnderstanding'))).toBe(true);
      expect(result.errors.some(e => e.includes('scope'))).toBe(true);
      expect(result.errors.some(e => e.includes('assumptions'))).toBe(true);
      expect(result.errors.some(e => e.includes('openQuestions'))).toBe(true);
      expect(result.errors.some(e => e.includes('plannerReadyForSpec'))).toBe(true);
    });
  });

  describe('ImplementerResponse Contract', () => {
    /**
     * Test 1: Standard SA response with questions.
     */
    it('validates standard response with questions', () => {
      // Given
      const saResponse = {
        schemaVersion: '1.0',
        message: 'I have some technical questions about this increment.',
        openQuestions: [
          { id: 'sq-001', question: 'What database should be used for persistence?' },
          { id: 'sq-002', question: 'Are there any specific performance requirements?' },
        ],
      };

      // When
      const result = validateImplementerResponse(saResponse);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    /**
     * Test 2: Ready state with empty questions.
     */
    it('validates ready state with empty questions', () => {
      // Given
      const readyResponse = {
        schemaVersion: '1.0',
        message: 'All clarifications received. Ready to proceed with implementation.',
        openQuestions: [],
      };

      // When
      const result = validateImplementerResponse(readyResponse);

      // Then
      expect(result.valid).toBe(true);
    });

    /**
     * Test 3: Invalid schemaVersion is rejected.
     */
    it('rejects invalid schemaVersion', () => {
      // Given
      const wrongVersion = {
        schemaVersion: '1.1', // ImplementerResponse uses 1.0
        message: 'Test',
        openQuestions: [],
      };

      // When
      const result = validateImplementerResponse(wrongVersion);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid schemaVersion: expected '1.0', got '1.1'");
    });
  });

  describe('Question Array Contract', () => {
    /**
     * Test 1: Mixed PO and SA questions.
     */
    it('validates mixed PM and Dev questions', () => {
      // Given
      const mixedQuestions = [
        {
          id: 'po-001',
          question: 'What is the expected user load?',
          status: 'Answered',
          answer: 'Up to 1000 concurrent users',
          source: 'Product Manager',
        },
        {
          id: 'po-002',
          question: 'Is mobile support required?',
          status: 'Open',
          answer: '',
          source: 'Product Manager',
        },
        {
          id: 'sa-001',
          question: 'Which cloud provider should be used?',
          status: 'Answered',
          answer: 'AWS',
          source: 'Software Developer',
          incrementId: 'INC-001',
        },
      ];

      // When
      const result = validateQuestions(mixedQuestions);

      // Then
      expect(result.valid).toBe(true);
    });

    /**
     * Test 2: Invalid status is rejected.
     */
    it('rejects invalid question status', () => {
      // Given
      const invalidStatusQuestions = [
        {
          id: 'q-001',
          question: 'Test question',
          status: 'Pending', // Invalid - should be 'Open' or 'Answered'
          answer: '',
          source: 'Product Manager',
        },
      ];

      // When
      const result = validateQuestions(invalidStatusQuestions);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('status'))).toBe(true);
    });

    /**
     * Test 3: Invalid source is rejected.
     */
    it('rejects invalid question source', () => {
      // Given
      const invalidSourceQuestions = [
        {
          id: 'q-001',
          question: 'Test question',
          status: 'Open',
          answer: '',
          source: 'Unknown Source', // Invalid
        },
      ];

      // When
      const result = validateQuestions(invalidSourceQuestions);

      // Then
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('source'))).toBe(true);
    });
  });
});
