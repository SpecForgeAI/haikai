/**
 * FeatureDefinitionPanel Plan Integration Tests
 *
 * Spec 2026-01-23: Implement Triggers Plan Generation
 * Task Group 5: Update FeatureDefinitionPanel to Include Plan Section
 *
 * Updated for Spec 2026-02-11: 3-Zone LHS Layout
 * - ImplementationPlanSection is always rendered as Zone 1 (collapsed header)
 * - Content auto-expands when increments arrive
 *
 * Tests for:
 * - ImplementationPlanSection body not rendered when plannerResponse.implementationPlan is null
 * - ImplementationPlanSection body rendered with increments when implementationPlan exists
 * - ImplementationPlanSection receives correct props (plan, activeIncrementId, callback)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse, ImplementationPlan } from '../api/chatApi';

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

describe('Task Group 5: FeatureDefinitionPanel Plan Integration', () => {
  const mockImplementationPlan: ImplementationPlan = {
    planTitle: 'OAuth2 Authentication Implementation',
    increments: [
      {
        id: 'INC-1',
        partIndex: 1,
        title: 'Setup Auth Module',
        intent: 'Initialize OAuth2 client configuration.',
      },
      {
        id: 'INC-2',
        partIndex: 2,
        title: 'Implement Login Flow',
        intent: 'Create login page and authentication flow.',
      },
    ],
  };

  const mockPlannerResponseWithPlan: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'Plan generated.',
    featureUnderstanding: 'OAuth2 authentication feature.',
    scope: { in: ['Login', 'Token refresh'], out: ['Social auth'] },
    assumptions: ['User has valid email'],
    acceptanceCriteria: ['User can log in'],
    openQuestions: [],
    plannerReadyForSpec: true,
    implementationPlan: mockImplementationPlan,
  };

  const mockPlannerResponseWithoutPlan: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'Still refining.',
    featureUnderstanding: 'OAuth2 authentication.',
    scope: { in: ['Login'], out: [] },
    assumptions: ['User has email'],
    acceptanceCriteria: ['User can log in'],
    openQuestions: [],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };

  const defaultProps = {
    workItemTitle: 'OAuth Authentication',
    workItemDescription: 'Add OAuth2 authentication to the application.',
    answers: {},
    onAnswerChange: vi.fn(),
    onSubmitAnswers: vi.fn(),
    activeIncrementId: null,
    onIncrementSelect: vi.fn(),
  };

  describe('Test 5.1a: ImplementationPlanSection body not rendered when implementationPlan is null', () => {
    it('should not render Implementation Plan body when implementationPlan is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={mockPlannerResponseWithoutPlan}
        />
      );

      // The section header is always visible (collapsible zone), but body content should not be rendered
      expect(screen.queryByTestId('implementation-plan-body')).not.toBeInTheDocument();
    });

    it('should not render Implementation Plan body when plannerResponse is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={null}
        />
      );

      // No body content when no plannerResponse
      expect(screen.queryByTestId('implementation-plan-body')).not.toBeInTheDocument();
    });

    it('should not render any increment cards when implementationPlan is null', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={mockPlannerResponseWithoutPlan}
        />
      );

      expect(screen.queryByTestId('increment-card')).not.toBeInTheDocument();
    });
  });

  describe('Test 5.1b: ImplementationPlanSection rendered when implementationPlan exists', () => {
    it('should render Implementation Plan section header when implementationPlan exists', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={mockPlannerResponseWithPlan}
        />
      );

      expect(screen.getByText('Implementation Plan')).toBeInTheDocument();
    });

    it('should auto-expand and render all increment cards when implementationPlan exists', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={mockPlannerResponseWithPlan}
        />
      );

      // Auto-expand triggers when increments first arrive
      expect(screen.getByText('INC-1')).toBeInTheDocument();
      expect(screen.getByText('INC-2')).toBeInTheDocument();
      expect(screen.getByText('Setup Auth Module')).toBeInTheDocument();
      expect(screen.getByText('Implement Login Flow')).toBeInTheDocument();
    });
  });

  describe('Test 5.1c: ImplementationPlanSection receives correct props', () => {
    it('should mark correct increment as active based on activeIncrementId', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={mockPlannerResponseWithPlan}
          activeIncrementId="INC-2"
        />
      );

      const cards = screen.getAllByTestId('increment-card');
      // CSS modules add hash suffixes, check className contains the active class name
      expect(cards[0].className).not.toContain('rowActive');
      expect(cards[1].className).toContain('rowActive');
    });

    it('should call onIncrementSelect when increment card is clicked', () => {
      const mockOnIncrementSelect = vi.fn();

      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={mockPlannerResponseWithPlan}
          onIncrementSelect={mockOnIncrementSelect}
        />
      );

      const cards = screen.getAllByTestId('increment-card');
      fireEvent.click(cards[0]);

      expect(mockOnIncrementSelect).toHaveBeenCalledWith('INC-1');
    });
  });

  describe('Test 5.1d: Implementation Plan is in Zone 1 (top of panel)', () => {
    it('should render Implementation Plan section before Work Item Details', () => {
      render(
        <FeatureDefinitionPanel
          {...defaultProps}
          plannerResponse={mockPlannerResponseWithPlan}
        />
      );

      // Implementation Plan section is Zone 1 (top), Work Item Details is Zone 3 (bottom)
      const planSection = screen.getByTestId('implementation-plan-section');
      const detailsHeader = screen.getByTestId('work-item-details-header');

      // Plan section should appear before work item details in the DOM
      const planRect = planSection.compareDocumentPosition(detailsHeader);
      // DOCUMENT_POSITION_FOLLOWING means detailsHeader is after planSection
      expect(planRect & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
