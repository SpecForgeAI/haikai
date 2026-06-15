/**
 * FeatureDefinitionPanel Gap Coverage Tests
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * Task Group 5: Test Review and Gap Analysis
 *
 * These tests fill coverage gaps identified during the test review:
 * - Panel renders with null plannerResponse
 * - Panel renders with minimal valid plannerResponse
 * - Panel handles missing optional sections gracefully
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse } from '../api/chatApi';

describe('Task Group 5: FeatureDefinitionPanel Gap Coverage', () => {
  // Default props required by FeatureDefinitionPanel
  const defaultProps = {
    workItemTitle: 'Test Feature',
    workItemDescription: 'Test description for the feature.',
    answers: {},
    onAnswerChange: vi.fn(),
    onSubmitAnswers: vi.fn(),
    activeIncrementId: null,
    onIncrementSelect: vi.fn(),
  };

  describe('Panel with null plannerResponse', () => {
    it('should render combined Description + Context section with null plannerResponse', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      // Combined section should be rendered
      expect(screen.getByText('Initial Description & Context')).toBeInTheDocument();
      expect(screen.getByText('Test description for the feature.')).toBeInTheDocument();
    });

    it('should render Product Manager Understanding with empty state when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      expect(screen.getByText('Product Manager Understanding')).toBeInTheDocument();
      expect(screen.getByText('Waiting for Product Manager understanding...')).toBeInTheDocument();
    });

    it('should not render Scope section when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      // Scope section title should not appear
      expect(screen.queryByText('Scope')).not.toBeInTheDocument();
      expect(screen.queryByText('In Scope')).not.toBeInTheDocument();
    });

    it('should render Acceptance Criteria with empty state when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      expect(screen.getByText('Acceptance Criteria')).toBeInTheDocument();
      expect(screen.getByText('No acceptance criteria defined yet.')).toBeInTheDocument();
    });

    it('should not render Assumptions section when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      // Assumptions section should not appear (hidden when empty)
      expect(screen.queryByText('Assumptions')).not.toBeInTheDocument();
    });

    it('should not render Open Questions section when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      // Open Questions section should not appear
      expect(screen.queryByText(/Open Questions/)).not.toBeInTheDocument();
    });
  });

  describe('Panel with minimal plannerResponse', () => {
    const minimalPlannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Minimal response',
      featureUnderstanding: '',
      scope: { in: [], out: [] },
      assumptions: [],
      acceptanceCriteria: [],
      openQuestions: [],
      plannerReadyForSpec: false,
      implementationPlan: null,
    };

    it('should render all visible sections with minimal plannerResponse', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={minimalPlannerResponse}
        />
      );

      // Always visible sections should be present
      expect(screen.getByText('Initial Description & Context')).toBeInTheDocument();
      expect(screen.getByText('Product Manager Understanding')).toBeInTheDocument();
      expect(screen.getByText('Acceptance Criteria')).toBeInTheDocument();

      // Conditionally hidden sections should NOT be present
      expect(screen.queryByText('Scope')).not.toBeInTheDocument();
      expect(screen.queryByText('Assumptions')).not.toBeInTheDocument();
      expect(screen.queryByText(/Open Questions/)).not.toBeInTheDocument();

      // Check card count
      const cards = container.querySelectorAll('[class*="card"]');
      // Should have 3 cards: Description+Context, PO Understanding, Acceptance Criteria
      expect(cards.length).toBe(3);
    });
  });

  describe('Panel icons present on all required sections', () => {
    const fullPlannerResponse: PlannerResponse = {
      schemaVersion: '1.1',
      message: 'Full response',
      featureUnderstanding: 'I understand the feature.',
      scope: { in: ['Feature A'], out: ['Feature B'] },
      assumptions: ['Assumption 1'],
      acceptanceCriteria: ['Criterion 1'],
      openQuestions: [
        { id: 'q1', question: 'Question 1', source: 'Product Owner', incrementId: null },
      ],
      plannerReadyForSpec: true,
      implementationPlan: null,
    };

    it('should have icons on all planner-generated sections', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      // Find all cards with icon containers
      const cardsWithIcons = container.querySelectorAll('[class*="sectionIcon"]');

      // Should have icons on: Description+Context (user), PO Understanding (bot),
      // Scope (bot), Acceptance Criteria (bot), Assumptions (bot)
      // Open Questions has dual icons in a different structure
      expect(cardsWithIcons.length).toBeGreaterThanOrEqual(5);
    });

    it('should render SquareUserRound icon on user-authored section', () => {
      const { container } = render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={fullPlannerResponse}
        />
      );

      // Find the topSectionCard (combined Description + Context)
      const topSection = container.querySelector('[class*="topSectionCard"]');
      expect(topSection).toBeInTheDocument();

      // Should have an icon
      const icon = topSection?.querySelector('[class*="sectionIcon"] svg');
      expect(icon).toBeInTheDocument();
    });
  });
});
