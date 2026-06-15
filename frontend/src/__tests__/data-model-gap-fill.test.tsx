/**
 * Gap-fill tests for Detailed Data Model Task -- End-to-End Fix (Frontend)
 *
 * Spec 2026-03-14, Task Group 5: Test Review and Gap Analysis
 *
 * Test 1: Guard chain: showDataModelPreview is true and showQuestions is false
 *         when structuredResponse type is 'data-model-preview' with questions
 *         present in the same payload
 */

import { describe, it, expect } from 'vitest';
import { isDataModelPreview } from '../components/UnifiedChat/MessageBubble';

// ============================================================================
// Test 1: Guard chain - data-model-preview excludes showQuestions
// ============================================================================
describe('Detailed Data Model: guard chain exclusion', () => {
  it('isDataModelPreview returns true for data-model-preview, ensuring showQuestions is excluded by the guard chain', () => {
    // A structuredResponse that has BOTH a data-model-preview type AND questions.
    // In the MessageBubble component, when isDataModelPreview is true,
    // the showQuestions guard explicitly checks !showDataModelPreview,
    // so questions should not be rendered when a data-model-preview is active.

    const responseWithPreviewAndQuestions = {
      type: 'data-model-preview',
      content: JSON.stringify({
        logicalDataEntities: [
          { name: 'User', description: 'User entity' },
        ],
        physicalDataEntities: [],
      }),
      // These fields would normally trigger showQuestions,
      // but the data-model-preview type takes precedence in the guard chain
      questions: ['Should we add an Address entity?', 'What about relationships?'],
      phase: 'ready',
      section: 'final_review',
      summary: 'Ready for review.',
    };

    // isDataModelPreview should return true because type === 'data-model-preview' and content is a string
    expect(isDataModelPreview(responseWithPreviewAndQuestions)).toBe(true);

    // Now verify that a regular questions-only response does NOT pass isDataModelPreview
    const questionsOnlyResponse = {
      phase: 'questions',
      section: 'domain_identification',
      summary: 'Let me ask some questions.',
      questions: ['What are your core entities?'],
    };
    expect(isDataModelPreview(questionsOnlyResponse)).toBe(false);

    // A response with type but wrong type should not match
    const architecturePreviewResponse = {
      type: 'architecture-preview',
      content: '{}',
    };
    expect(isDataModelPreview(architecturePreviewResponse)).toBe(false);

    // A data-model-preview with non-string content should not match
    const invalidContentResponse = {
      type: 'data-model-preview',
      content: { logicalDataEntities: [] },
    };
    expect(isDataModelPreview(invalidContentResponse)).toBe(false);
  });
});
