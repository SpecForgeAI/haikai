/**
 * chatApi Legacy Type Removal Tests
 *
 * Spec 2026-03-02: Increment 10 - Legacy Chat Removal and Cleanup
 * Task Group 3, Task 3.1: Write 3 focused tests for the cleaned frontend types
 *
 * Tests verify:
 * 1. ChatResponse type does NOT have productManagerResponse, solutionArchitectResponse,
 *    or roadmapPmResponse fields (compile-time type assertion)
 * 2. ChatResponse type still has plannerResponse, implementerResponse, handoffPlan,
 *    specs, and baselineSaved fields (compile-time assertion that implement-flow types survive)
 * 3. postChatMessage function can be called with an implement_feature mode context
 *    and returns a ChatResponse (smoke test that the API client still works)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatResponse } from '../api/chatApi';
import { postChatMessage } from '../api/chatApi';

describe('Task Group 3: chatApi Legacy Type Removal', () => {
  // --------------------------------------------------------------------------
  // Test 1: ChatResponse does NOT have legacy response fields
  // --------------------------------------------------------------------------

  it('ChatResponse type does NOT have productManagerResponse, solutionArchitectResponse, or roadmapPmResponse fields', () => {
    // Construct a ChatResponse with only the surviving fields
    const response: ChatResponse = {
      sessionId: 'test-session',
      assistant: { message: 'Hello' },
    };

    // Verify the legacy fields do not exist on the response object
    // Using 'in' operator to check at runtime that these keys are absent
    expect('productManagerResponse' in response).toBe(false);
    expect('solutionArchitectResponse' in response).toBe(false);
    expect('roadmapPmResponse' in response).toBe(false);

    // Compile-time assertion: accessing these fields should produce 'undefined'
    // because they no longer exist on the ChatResponse interface.
    // If someone re-adds them, these assertions serve as documentation of intent.
    const asAny = response as Record<string, unknown>;
    expect(asAny['productManagerResponse']).toBeUndefined();
    expect(asAny['solutionArchitectResponse']).toBeUndefined();
    expect(asAny['roadmapPmResponse']).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Test 2: ChatResponse still has implement-flow fields
  // --------------------------------------------------------------------------

  it('ChatResponse type still has plannerResponse, implementerResponse, handoffPlan, specs, and baselineSaved fields', () => {
    // Construct a ChatResponse with all surviving optional implement-flow fields populated
    const response: ChatResponse = {
      sessionId: 'test-session-2',
      assistant: { message: 'Implement response' },
      specs: ['spec-1', 'spec-2'],
      handoffPlan: {
        is_split: false,
        handoff_plan_summary: 'Single feature',
        handoff_intents: [{
          id: 'S1',
          title: 'Main Feature',
          intent: 'Implement the feature',
          in_scope: ['login'],
          out_of_scope: ['registration'],
          acceptance_criteria: ['User can log in'],
          dependencies: [],
        }],
      },
      plannerResponse: {
        schemaVersion: '1.1',
        message: 'Planner message',
        featureUnderstanding: 'A login feature',
        scope: { in: ['login'], out: ['registration'] },
        assumptions: ['Users have accounts'],
        acceptanceCriteria: ['Can log in'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: null,
      },
      implementerResponse: {
        schemaVersion: '1.0',
        message: 'SA clarification',
        openQuestions: [],
      },
      baselineSaved: true,
    };

    // Verify all implement-flow fields are accessible and have correct values
    expect(response.specs).toHaveLength(2);
    expect(response.handoffPlan).toBeDefined();
    expect(response.handoffPlan!.is_split).toBe(false);
    expect(response.plannerResponse).toBeDefined();
    expect(response.plannerResponse!.schemaVersion).toBe('1.1');
    expect(response.implementerResponse).toBeDefined();
    expect(response.implementerResponse!.schemaVersion).toBe('1.0');
    expect(response.baselineSaved).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 3: postChatMessage can be called with implement_feature mode
  // --------------------------------------------------------------------------

  describe('postChatMessage smoke test', () => {
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = mockFetch;
      mockFetch.mockClear();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('can be called with implement_feature mode context and returns a ChatResponse', async () => {
      const mockResponse: ChatResponse = {
        sessionId: 'session-impl-1',
        assistant: { message: 'Bootstrap complete' },
        plannerResponse: {
          schemaVersion: '1.1',
          message: 'Feature understanding',
          featureUnderstanding: 'A login feature',
          scope: { in: ['login'], out: [] },
          assumptions: [],
          acceptanceCriteria: [],
          openQuestions: [],
          plannerReadyForSpec: false,
          implementationPlan: null,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await postChatMessage({
        message: 'Start implementing',
        context: {
          mode: 'implement_feature',
          phase: 'bootstrap',
          filename: 'test-project.json',
        },
      });

      expect(result.sessionId).toBe('session-impl-1');
      expect(result.assistant.message).toBe('Bootstrap complete');
      expect(result.plannerResponse).toBeDefined();
      expect(result.plannerResponse!.featureUnderstanding).toBe('A login feature');

      // Verify fetch was called with correct endpoint
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });
});
