/**
 * FeatureDefinitionPanel Questions Integration Tests
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 6: FeatureDefinitionPanel Integration
 *
 * Tests that verify:
 * - QuestionsTable is rendered in the panel
 * - Questions state is managed (answers Map)
 * - Question objects are derived from openQuestions + answers
 * - QuestionsTable positioned after Acceptance Criteria
 * - onSubmitAnswers callback is provided and called
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse, OpenQuestion } from '../api/chatApi';

// Mock ProductUiStateContext
vi.mock('../contexts/ProductUiStateContext', () => ({
  ProductUiStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useProductUiState: () => ({
    getImplementChatState: vi.fn(() => null),
    setImplementChatState: vi.fn(),
    getLastImplementWorkItemId: vi.fn(() => null),
    setLastImplementWorkItemId: vi.fn(),
    getExpandedIds: vi.fn(() => new Set()),
    setExpandedIds: vi.fn(),
    toggleExpanded: vi.fn(),
  }),
  deriveProjectKey: (id: string) => id,
}));

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

describe('Task Group 6: FeatureDefinitionPanel Questions Integration', () => {
  const createPlannerResponse = (
    openQuestions: OpenQuestion[]
  ): PlannerResponse => ({
    schemaVersion: '1.1',
    message: 'Test message',
    featureUnderstanding: 'Test understanding of the feature',
    scope: { in: ['In scope 1'], out: ['Out of scope 1'] },
    assumptions: ['Assumption 1'],
    acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
    openQuestions,
    plannerReadyForSpec: false,
    implementationPlan: null,
  });

  describe('Test 6.1: QuestionsTable is rendered when openQuestions exist', () => {
    it('should render QuestionsTable section when openQuestions is not empty', () => {
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      // Should see the "Open Questions" section header
      expect(screen.getByText('Open Questions')).toBeInTheDocument();
      // Should see the question text
      expect(screen.getByText('What authentication method?')).toBeInTheDocument();
    });

    it('should not render QuestionsTable when openQuestions is empty', () => {
      const plannerResponse = createPlannerResponse([]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      // Should not see the "Open Questions" section
      expect(screen.queryByText('Open Questions')).not.toBeInTheDocument();
    });

    it('should not render QuestionsTable when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={null}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      expect(screen.queryByText('Open Questions')).not.toBeInTheDocument();
    });
  });

  describe('Test 6.2: Answers state is passed correctly', () => {
    it('should display answer value in the input when answers map has entry', () => {
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{ q1: 'OAuth 2.0' }}
        />
      );

      const input = screen.getByDisplayValue('OAuth 2.0');
      expect(input).toBeInTheDocument();
    });

    it('should display empty input when answers map has no entry for question', () => {
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      expect(input).toHaveValue('');
    });
  });

  describe('Test 6.3: onAnswerChange callback is called correctly', () => {
    it('should call onAnswerChange with question ID and value when typing', async () => {
      const handleChange = vi.fn();
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={handleChange}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      await user.type(input, 'JWT');

      expect(handleChange).toHaveBeenCalledWith('q1', expect.any(String));
    });
  });

  describe('Test 6.4: QuestionsTable positioned in the Clarifying Questions zone', () => {
    it('should render Open Questions inside the questions zone, ABOVE the Work Item Details', () => {
      // The panel was redesigned into three zones: the Clarifying Questions
      // zone (containing the Open Questions card) now renders BEFORE the
      // Work Item Details zone (which contains Acceptance Criteria).
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
      ]);

      const { container } = render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      const questionsZone = container.querySelector('[data-testid="questions-zone"]');
      const detailsContent = container.querySelector('[data-testid="feature-definition-content"]');
      expect(questionsZone).toBeInTheDocument();
      expect(detailsContent).toBeInTheDocument();

      // The Open Questions card lives inside the questions zone
      expect(questionsZone!.textContent).toContain('Open Questions');
      // Acceptance Criteria lives in the details zone, which follows the zone
      expect(detailsContent!.textContent).toContain('Acceptance Criteria');
      const panelChildren = Array.from(container.firstElementChild!.children);
      expect(panelChildren.indexOf(questionsZone as Element)).toBeLessThan(
        panelChildren.indexOf(detailsContent as Element)
      );
    });
  });

  describe('Test 6.5: onSubmitAnswers callback is provided and called', () => {
    it('should call onSubmitAnswers when button is clicked and all questions answered', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={handleSubmit}
          answers={{ q1: 'OAuth 2.0' }}
        />
      );

      const button = screen.getByRole('button', { name: /answer open questions/i });
      await user.click(button);

      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    it('enables the button once at least one question is answered (partial submission)', () => {
      // Spec 2026-01-24 changed the gating from every() to some(): partial
      // answers can be submitted; the button only disables when NO open
      // question has an answer.
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
        { id: 'q2', question: 'What max file size?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{ q1: 'OAuth 2.0' }} // Only one answered
        />
      );

      const button = screen.getByRole('button', { name: /answer open questions/i });
      expect(button).not.toBeDisabled();
    });

    it('disables the button when no questions are answered', () => {
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'What authentication method?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      const button = screen.getByRole('button', { name: /answer open questions/i });
      expect(button).toBeDisabled();
    });
  });

  describe('Test 6.6: Multiple questions are rendered correctly', () => {
    it('should render all questions from openQuestions array', () => {
      const plannerResponse = createPlannerResponse([
        { id: 'q1', question: 'First question?' },
        { id: 'q2', question: 'Second question?' },
        { id: 'q3', question: 'Third question?' },
      ]);

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponse}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
          answers={{}}
        />
      );

      expect(screen.getByText('First question?')).toBeInTheDocument();
      expect(screen.getByText('Second question?')).toBeInTheDocument();
      expect(screen.getByText('Third question?')).toBeInTheDocument();
    });
  });
});
