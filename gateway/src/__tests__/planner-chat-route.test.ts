/**
 * Tests for PlannerResponse handling in chat route
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * Task Group 4: Route Handler Layer
 */

import { validatePlannerResponse, createFallbackPlannerResponse } from '../services/plannerResponseValidator';
import type { PlannerResponse, ChatResponse } from '../types';

describe('Chat Route PlannerResponse Handling', () => {
  describe('refine phase handling', () => {
    it('should validate planner response with expectImplementationPlan=false for refine phase', () => {
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: 'I understand your requirements.',
        featureUnderstanding: 'A feature to add user login',
        scope: { in: ['Login form'], out: ['Social login'] },
        assumptions: ['Users have email accounts'],
        acceptanceCriteria: ['User can log in'],
        openQuestions: ['What password rules?'],
        plannerReadyForSpec: false,
        implementationPlan: null,
      });

      const result = validatePlannerResponse(content, false);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.message).toBe('I understand your requirements.');
      expect(result.plannerResponse?.implementationPlan).toBeNull();
    });

    it('should include both message and plannerResponse in response for refine phase', () => {
      // Simulate what the route handler would do
      const llmContent = JSON.stringify({
        schemaVersion: '1.1',
        message: 'Conversational response',
        featureUnderstanding: 'Test feature',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      });

      const validationResult = validatePlannerResponse(llmContent, false);
      expect(validationResult.valid).toBe(true);

      // Build response like route handler does
      const chatResponse: Partial<ChatResponse> = {
        sessionId: 'test-session',
        assistant: {
          message: validationResult.plannerResponse?.message || llmContent,
        },
        plannerResponse: validationResult.plannerResponse,
      };

      expect(chatResponse.assistant?.message).toBe('Conversational response');
      expect(chatResponse.plannerResponse?.featureUnderstanding).toBe('Test feature');
    });

    it('should use fallback for malformed JSON in refine phase', () => {
      const malformedContent = 'This is not JSON';

      const validationResult = validatePlannerResponse(malformedContent, false);
      expect(validationResult.valid).toBe(false);

      // Fallback behavior (Spec 2026-01-24: safe static message, no args)
      const fallback = createFallbackPlannerResponse();

      expect(fallback.schemaVersion).toBe('1.1');
      expect(fallback.message).toBe("I couldn't parse the structured response. Please try again.");
      expect(fallback.implementationPlan).toBeNull();
    });
  });

  describe('implementation_planning phase handling', () => {
    it('should validate planner response with expectImplementationPlan=true', () => {
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: 'Here is your implementation plan.',
        featureUnderstanding: 'User authentication feature',
        scope: { in: ['Login'], out: [] },
        assumptions: [],
        acceptanceCriteria: ['User can log in'],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: {
          planTitle: 'Auth Implementation',
          increments: [
            {
              id: 'INC-1',
              partIndex: 1,
              title: 'Backend API',
              intent: 'Create auth endpoints. Implement POST /auth/login and POST /auth/register with JWT token generation.',
            },
          ],
        },
      });

      const result = validatePlannerResponse(content, true);

      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.implementationPlan).toBeDefined();
      expect(result.plannerResponse?.implementationPlan?.increments).toHaveLength(1);
    });

    it('should fail validation if implementationPlan is missing when expected', () => {
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: 'Test',
        featureUnderstanding: 'Test',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: true,
        implementationPlan: null,
      });

      const result = validatePlannerResponse(content, true);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('implementationPlan');
    });
  });

  describe('fallback behavior', () => {
    it('should never break chat flow due to malformed JSON', () => {
      const testCases = [
        'Plain text response',
        '{ invalid json }',
        '```json\n{ missing closing brace',
        '',
        '{"partial": "json"',
      ];

      for (const content of testCases) {
        // Validation fails
        const result = validatePlannerResponse(content, false);
        expect(result.valid).toBe(false);

        // But fallback always works (Spec 2026-01-24: safe static message)
        const fallback = createFallbackPlannerResponse();
        expect(fallback.schemaVersion).toBe('1.1');
        expect(typeof fallback.message).toBe('string');
        expect(fallback.implementationPlan).toBeNull();
      }
    });

    it('should include error field in response when validation fails', () => {
      const malformedContent = 'Not valid JSON';
      const validationResult = validatePlannerResponse(malformedContent, false);

      // Simulate route handler behavior
      const fallback = createFallbackPlannerResponse();

      const chatResponse: Partial<ChatResponse> = {
        sessionId: 'test-session',
        assistant: {
          message: fallback.message,
        },
        plannerResponse: fallback,
        error: validationResult.error,
      };

      expect(chatResponse.error).toBeDefined();
      expect(chatResponse.plannerResponse).toBeDefined();
      expect(chatResponse.assistant?.message).toBe("I couldn't parse the structured response. Please try again.");
    });
  });

  describe('message extraction', () => {
    it('should use plannerResponse.message as the assistant message', () => {
      const content = JSON.stringify({
        schemaVersion: '1.1',
        message: 'This is the chat bubble text',
        featureUnderstanding: 'Feature definition',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      });

      const result = validatePlannerResponse(content, false);
      expect(result.valid).toBe(true);

      // The message field from PlannerResponse should be used for chat display
      expect(result.plannerResponse?.message).toBe('This is the chat bubble text');
    });

    it('should extract JSON from markdown code blocks', () => {
      const content = `Here is my analysis:

\`\`\`json
{
  "schemaVersion": "1.1",
  "message": "Extracted from code block",
  "featureUnderstanding": "Test",
  "scope": { "in": [], "out": [] },
  "assumptions": [],
  "acceptanceCriteria": [],
  "openQuestions": [],
  "plannerReadyForSpec": false,
  "implementationPlan": null
}
\`\`\`

Let me know if you have questions.`;

      const result = validatePlannerResponse(content, false);
      expect(result.valid).toBe(true);
      expect(result.plannerResponse?.message).toBe('Extracted from code block');
    });
  });
});
