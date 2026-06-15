/**
 * Questions System Integration Tests
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 8: Integration Testing and Gap Analysis
 *
 * End-to-end integration tests for the Questions System feature:
 * - PlannerResponse with questions renders table
 * - User enters answer and triggers submit
 * - Answer preservation across response updates
 * - Empty questions array behavior
 * - Multiple questions workflow
 *
 * Updated: FeatureDefinitionPanel now requires activeIncrementId and onIncrementSelect.
 * Questions zone starts collapsed - tests must click to expand before asserting.
 * Source column was removed from the row layout.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse, OpenQuestion } from '../api/chatApi';

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

/**
 * Test wrapper component that manages answer state internally
 * to simulate real usage of FeatureDefinitionPanel
 */
function TestWrapper({
  plannerResponse,
  onSubmitAnswers,
}: {
  plannerResponse: PlannerResponse | null;
  onSubmitAnswers?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const handleAnswerChange = (id: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [id]: answer }));
  };

  return (
    <FeatureDefinitionPanel
      workItemTitle="Test Feature"
      workItemDescription="Test description"
      plannerResponse={plannerResponse}
      answers={answers}
      onAnswerChange={handleAnswerChange}
      onSubmitAnswers={onSubmitAnswers ?? (() => {})}
      activeIncrementId={null}
      onIncrementSelect={() => {}}
    />
  );
}

/**
 * Helper to ensure the questions zone is expanded.
 * The zone AUTO-expands when questions exist, so only click the header when
 * the body is not already visible (clicking an expanded zone collapses it).
 */
async function expandQuestionsZone(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByTestId('questions-zone-body')) return;
  const zoneHeader = screen.getByTestId('questions-zone-header');
  await user.click(zoneHeader);
}

describe('Task Group 8: Questions System Integration Tests', () => {
  const createPlannerResponse = (
    openQuestions: OpenQuestion[]
  ): PlannerResponse => ({
    schemaVersion: '1.1',
    message: 'Test message',
    featureUnderstanding: 'Test understanding',
    scope: { in: ['In scope'], out: [] },
    assumptions: [],
    acceptanceCriteria: ['Criterion 1'],
    openQuestions,
    plannerReadyForSpec: false,
    implementationPlan: null,
  });

  describe('Test 8.1: End-to-end flow - render questions, answer, submit', () => {
    it('should render questions table when plannerResponse has openQuestions', async () => {
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What auth method?' },
        { id: 'q2', question: 'What file size limit?' },
      ]);

      render(<TestWrapper plannerResponse={plannerResponse} />);

      // Expand the collapsed questions zone
      await expandQuestionsZone(user);

      expect(screen.getByText('Open Questions')).toBeInTheDocument();
      expect(screen.getByText('What auth method?')).toBeInTheDocument();
      expect(screen.getByText('What file size limit?')).toBeInTheDocument();
    });

    it('should enable submit button after user enters answer', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What auth method?' },
      ]);

      render(
        <TestWrapper
          plannerResponse={plannerResponse}
          onSubmitAnswers={handleSubmit}
        />
      );

      // Expand the collapsed questions zone
      await expandQuestionsZone(user);

      // Initially button should be disabled (no answers)
      const button = screen.getByRole('button', { name: /answer open questions/i });
      expect(button).toBeDisabled();

      // Type an answer
      const input = screen.getByPlaceholderText('Enter your answer...');
      await user.type(input, 'OAuth 2.0');

      // Button should now be enabled
      expect(button).not.toBeDisabled();

      // Click submit
      await user.click(button);
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test 8.2: Empty questions array behavior', () => {
    it('should not render questions zone body when openQuestions is empty', async () => {
      const plannerResponse = createPlannerResponse([]);

      render(<TestWrapper plannerResponse={plannerResponse} />);

      // With no questions, the zone body should not be present
      expect(screen.queryByTestId('questions-zone-body')).not.toBeInTheDocument();
    });

    it('should not render questions zone body when plannerResponse is null', () => {
      render(<TestWrapper plannerResponse={null} />);

      expect(screen.queryByTestId('questions-zone-body')).not.toBeInTheDocument();
    });
  });

  describe('Test 8.3: Multiple questions workflow', () => {
    it('should enable submit after at least one open question has an answer', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'First question?' },
        { id: 'q2', question: 'Second question?' },
        { id: 'q3', question: 'Third question?' },
      ]);

      render(
        <TestWrapper
          plannerResponse={plannerResponse}
          onSubmitAnswers={handleSubmit}
        />
      );

      // Expand the collapsed questions zone
      await expandQuestionsZone(user);

      // Get all answer inputs
      const inputs = screen.getAllByPlaceholderText('Enter your answer...');
      expect(inputs).toHaveLength(3);

      // Button should be disabled initially
      const button = screen.getByRole('button', { name: /answer open questions/i });
      expect(button).toBeDisabled();

      // Answer first question - button should be enabled (some() logic)
      await user.type(inputs[0], 'Answer 1');
      expect(button).not.toBeDisabled();

      // Click submit
      await user.click(button);
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test 8.4: Question ID uniqueness from gateway', () => {
    it('should handle questions with different IDs correctly', async () => {
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'uuid-1-abc', question: 'Question 1?' },
        { id: 'uuid-2-def', question: 'Question 2?' },
        { id: 'uuid-3-ghi', question: 'Question 3?' },
      ]);

      render(<TestWrapper plannerResponse={plannerResponse} />);

      // Expand the collapsed questions zone
      await expandQuestionsZone(user);

      // All questions should be rendered
      expect(screen.getByText('Question 1?')).toBeInTheDocument();
      expect(screen.getByText('Question 2?')).toBeInTheDocument();
      expect(screen.getByText('Question 3?')).toBeInTheDocument();

      // All should have Open status initially
      const openBadges = screen.getAllByText('Open');
      expect(openBadges).toHaveLength(3);
    });
  });

  describe('Test 8.5: Answer input updates correctly', () => {
    it('should update answer state as user types', async () => {
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'Test question?' },
      ]);

      render(<TestWrapper plannerResponse={plannerResponse} />);

      // Expand the collapsed questions zone
      await expandQuestionsZone(user);

      // Initially Open
      expect(screen.getByText('Open')).toBeInTheDocument();

      // Type an answer character by character
      const input = screen.getByPlaceholderText('Enter your answer...');
      fireEvent.change(input, { target: { value: 'My answer' } });

      // Verify the input has the value
      expect(input).toHaveValue('My answer');
    });
  });

  describe('Test 8.7: Questions positioned correctly in panel', () => {
    it('should render Clarifying Questions zone header when questions exist', async () => {
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'Test question?' },
      ]);

      render(<TestWrapper plannerResponse={plannerResponse} />);

      // The zone header should be visible (even when collapsed)
      expect(screen.getByText('Clarifying Questions')).toBeInTheDocument();

      // Expand to see the Open Questions section inside
      await expandQuestionsZone(user);

      expect(screen.getByText('Open Questions')).toBeInTheDocument();
    });
  });

  describe('Test 8.8: Type alignment between frontend and gateway', () => {
    it('should accept OpenQuestion objects with id and question fields from gateway', async () => {
      const user = userEvent.setup();
      // This test verifies the type contract between gateway and frontend
      const gatewayOpenQuestions: OpenQuestion[] = [
        { id: '550e8400-e29b-41d4-a716-446655440000', question: 'Gateway question?' },
      ];

      const plannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Test',
        featureUnderstanding: 'Test',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: gatewayOpenQuestions,
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      render(<TestWrapper plannerResponse={plannerResponse} />);

      // Expand the collapsed questions zone
      await expandQuestionsZone(user);

      expect(screen.getByText('Gateway question?')).toBeInTheDocument();
    });
  });
});
