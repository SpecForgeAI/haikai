/**
 * Tests for Spec Intent Composition
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 2: Spec Intent Composition Function
 * Task Group 8: Test Review and Gap Analysis (additional strategic tests)
 *
 * Tests the composeSpecIntent function that extracts fields from PlannerResponse
 * and formats them into an LLM-friendly string prefixed with `/shape-spec `.
 */

import { describe, it, expect } from 'vitest';
import { composeSpecIntent } from './specIntentComposer';
import type { PlannerResponse } from '../api/chatApi';

describe('composeSpecIntent', () => {
  /**
   * Test 1: Composition from full PlannerResponse with all fields populated.
   * Verifies that all fields are extracted and formatted correctly.
   */
  it('composes spec intent from full PlannerResponse with all fields populated', () => {
    // Given
    const fullPlannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'This is the chat message',
      featureUnderstanding: 'A user authentication system that allows users to log in with email and password.',
      scope: {
        in: ['Email/password login', 'Password reset flow', 'Session management'],
        out: ['Social login', 'Multi-factor authentication', 'Account creation'],
      },
      assumptions: [
        'Users have valid email addresses',
        'Password requirements follow standard security practices',
      ],
      acceptanceCriteria: [
        'Users can log in with valid credentials',
        'Invalid credentials show appropriate error messages',
        'Sessions expire after 24 hours of inactivity',
      ],
      openQuestions: [{ id: 'q1', question: 'What is the session timeout?' }],
      plannerReadyForSpec: true,
      implementationPlan: null,
    };

    // When
    const result = composeSpecIntent(fullPlannerResponse);

    // Then
    expect(result).not.toBeNull();
    expect(result).toContain('/shape-spec ');
    expect(result).toContain('A user authentication system that allows users to log in with email and password.');
    expect(result).toContain('Email/password login');
    expect(result).toContain('Password reset flow');
    expect(result).toContain('Session management');
    expect(result).toContain('Social login');
    expect(result).toContain('Multi-factor authentication');
    expect(result).toContain('Account creation');
    expect(result).toContain('Users have valid email addresses');
    expect(result).toContain('Password requirements follow standard security practices');
    expect(result).toContain('Users can log in with valid credentials');
    expect(result).toContain('Invalid credentials show appropriate error messages');
    expect(result).toContain('Sessions expire after 24 hours of inactivity');
  });

  /**
   * Test 2: Composition with empty arrays (scope.in=[], assumptions=[], etc.).
   * Verifies that empty arrays result in empty sections (not omitted).
   */
  it('composes spec intent with empty arrays resulting in empty sections', () => {
    // Given
    const emptyArraysPlannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Clarification message',
      featureUnderstanding: 'A simple feature with minimal details.',
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

    // When
    const result = composeSpecIntent(emptyArraysPlannerResponse);

    // Then
    expect(result).not.toBeNull();
    expect(result).toContain('/shape-spec ');
    expect(result).toContain('A simple feature with minimal details.');
    // Empty sections should still have headers
    expect(result).toContain('In Scope');
    expect(result).toContain('Out of Scope');
    expect(result).toContain('Assumptions');
    expect(result).toContain('Acceptance Criteria');
  });

  /**
   * Test 3: Output is prefixed with `/shape-spec `.
   * Verifies the exact prefix requirement.
   */
  it('prefixes output with /shape-spec followed by space', () => {
    // Given
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Message',
      featureUnderstanding: 'Feature description',
      scope: { in: ['item'], out: [] },
      assumptions: [],
      acceptanceCriteria: [],
      openQuestions: [],
      plannerReadyForSpec: true,
      implementationPlan: null,
    };

    // When
    const result = composeSpecIntent(plannerResponse);

    // Then
    expect(result).not.toBeNull();
    expect(result!.startsWith('/shape-spec ')).toBe(true);
  });

  /**
   * Test 4: Output is LLM-friendly string format with clear section headers.
   * Verifies markdown-style formatting with section headers.
   */
  it('formats output as LLM-friendly string with markdown-style section headers', () => {
    // Given
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Message',
      featureUnderstanding: 'Build a notification system.',
      scope: {
        in: ['Push notifications', 'Email notifications'],
        out: ['SMS notifications'],
      },
      assumptions: ['Users opt-in to notifications'],
      acceptanceCriteria: ['Notifications are delivered within 5 seconds'],
      openQuestions: [],
      plannerReadyForSpec: true,
      implementationPlan: null,
    };

    // When
    const result = composeSpecIntent(plannerResponse);

    // Then
    expect(result).not.toBeNull();
    // Check for section headers (markdown-style)
    expect(result).toMatch(/## Feature Description/);
    expect(result).toMatch(/## In Scope/);
    expect(result).toMatch(/## Out of Scope/);
    expect(result).toMatch(/## Assumptions/);
    expect(result).toMatch(/## Acceptance Criteria/);
    // Check for bulleted lists
    expect(result).toMatch(/- Push notifications/);
    expect(result).toMatch(/- Email notifications/);
    expect(result).toMatch(/- SMS notifications/);
    expect(result).toMatch(/- Users opt-in to notifications/);
    expect(result).toMatch(/- Notifications are delivered within 5 seconds/);
  });

  /**
   * Test 5: Null/undefined input returns null.
   * Verifies appropriate fallback for invalid input.
   */
  it('returns null when input is null', () => {
    // When
    const result = composeSpecIntent(null);

    // Then
    expect(result).toBeNull();
  });

  /**
   * Test 5b: Undefined input returns null.
   */
  it('returns null when input is undefined', () => {
    // When
    const result = composeSpecIntent(undefined as unknown as PlannerResponse | null);

    // Then
    expect(result).toBeNull();
  });

  // ==========================================================================
  // Task Group 8: Additional Strategic Tests - Gap Analysis
  // ==========================================================================

  /**
   * Test 6 (Gap Analysis): Empty/undefined featureUnderstanding handling.
   * Gap: Tests composition when featureUnderstanding is empty string.
   */
  it('handles empty featureUnderstanding string gracefully', () => {
    // Given - featureUnderstanding is empty string
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Message',
      featureUnderstanding: '',
      scope: { in: ['Some scope item'], out: [] },
      assumptions: [],
      acceptanceCriteria: [],
      openQuestions: [],
      plannerReadyForSpec: true,
      implementationPlan: null,
    };

    // When
    const result = composeSpecIntent(plannerResponse);

    // Then
    expect(result).not.toBeNull();
    expect(result).toContain('/shape-spec ');
    // Should still have section header even with empty content
    expect(result).toContain('## Feature Description');
    // Should still have scope section with content
    expect(result).toContain('- Some scope item');
  });

  /**
   * Test 7 (Gap Analysis): Undefined scope object handling.
   * Gap: Tests composition when scope object fields might be undefined.
   */
  it('handles undefined scope.in and scope.out arrays gracefully', () => {
    // Given - scope has undefined in/out arrays (edge case from malformed response)
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Message',
      featureUnderstanding: 'Feature description',
      scope: {
        in: undefined as unknown as string[],
        out: undefined as unknown as string[],
      },
      assumptions: ['An assumption'],
      acceptanceCriteria: [],
      openQuestions: [],
      plannerReadyForSpec: true,
      implementationPlan: null,
    };

    // When
    const result = composeSpecIntent(plannerResponse);

    // Then
    expect(result).not.toBeNull();
    expect(result).toContain('/shape-spec ');
    expect(result).toContain('## In Scope');
    expect(result).toContain('## Out of Scope');
    // Should still have assumptions content
    expect(result).toContain('- An assumption');
  });

  /**
   * Test 8 (Gap Analysis): Special characters in content.
   * Gap: Tests that special characters in PlannerResponse fields are preserved.
   */
  it('preserves special characters in content fields', () => {
    // Given - content with special characters
    const plannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Message',
      featureUnderstanding: 'Feature with <HTML> & "quotes" and `backticks`',
      scope: {
        in: ['Item with $pecial ch@racters!', 'Item with unicode: \u2713 \u2717'],
        out: [],
      },
      assumptions: ['URLs like https://example.com/path?query=value&other=123'],
      acceptanceCriteria: [],
      openQuestions: [],
      plannerReadyForSpec: true,
      implementationPlan: null,
    };

    // When
    const result = composeSpecIntent(plannerResponse);

    // Then
    expect(result).not.toBeNull();
    expect(result).toContain('<HTML>');
    expect(result).toContain('"quotes"');
    expect(result).toContain('`backticks`');
    expect(result).toContain('$pecial ch@racters!');
    expect(result).toContain('\u2713');
    expect(result).toContain('https://example.com/path?query=value&other=123');
  });
});
