/**
 * Plan Generation Integration Tests
 *
 * Spec 2026-01-23: Implement Triggers Plan Generation
 * Task Group 7: Integration Testing
 *
 * Updated for Spec 2026-02-11: 3-Zone LHS Layout
 * - ImplementationPlanSection header is always visible (collapsible zone)
 * - Content auto-expands when increments arrive
 *
 * Strategic integration tests verifying:
 * - Component integration between IncrementCard and ImplementationPlanSection
 * - FeatureDefinitionPanel correctly renders ImplementationPlanSection
 * - Props are correctly passed through the component hierarchy
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { IncrementCard } from '../components/ProductView/IncrementCard';
import { ImplementationPlanSection } from '../components/ProductView/ImplementationPlanSection';
import { FeatureDefinitionPanel } from '../components/ProductView/FeatureDefinitionPanel';
import type { PlannerResponse, ImplementationPlan, Increment } from '../api/chatApi';

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

describe('Task Group 7: Plan Generation Integration Tests', () => {
  const mockIncrements: Increment[] = [
    {
      id: 'INC-1',
      partIndex: 1,
      title: 'Core Setup',
      intent: 'Set up core infrastructure.',
    },
    {
      id: 'INC-2',
      partIndex: 2,
      title: 'Feature Implementation',
      intent: 'Implement the main feature.',
    },
    {
      id: 'INC-3',
      partIndex: 3,
      title: 'Testing and Polish',
      intent: 'Add tests and polish the implementation.',
    },
  ];

  const mockImplementationPlan: ImplementationPlan = {
    planTitle: 'Feature Implementation Plan',
    increments: mockIncrements,
  };

  const mockPlannerResponseWithPlan: PlannerResponse = {
    schemaVersion: '1.1',
    message: 'Plan generated successfully.',
    featureUnderstanding: 'Test feature understanding.',
    scope: { in: ['Item 1', 'Item 2'], out: ['Excluded item'] },
    assumptions: ['Assumption 1'],
    acceptanceCriteria: ['Criteria 1'],
    openQuestions: [],
    plannerReadyForSpec: true,
    implementationPlan: mockImplementationPlan,
  };

  describe('Integration Test: IncrementCard to ImplementationPlanSection', () => {
    it('should correctly integrate IncrementCard within ImplementationPlanSection', () => {
      const mockOnSelect = vi.fn();

      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId="INC-2"
          onIncrementSelect={mockOnSelect}
          collapsed={false}
        />
      );

      // Verify all increments are rendered
      expect(screen.getByText('INC-1')).toBeInTheDocument();
      expect(screen.getByText('INC-2')).toBeInTheDocument();
      expect(screen.getByText('INC-3')).toBeInTheDocument();

      // Verify correct active state is applied
      const cards = screen.getAllByTestId('increment-card');
      expect(cards[0].className).not.toContain('rowActive');
      expect(cards[1].className).toContain('rowActive');
      expect(cards[2].className).not.toContain('rowActive');

      // Verify click handler is wired correctly
      fireEvent.click(cards[0]);
      expect(mockOnSelect).toHaveBeenCalledWith('INC-1');

      fireEvent.click(cards[2]);
      expect(mockOnSelect).toHaveBeenCalledWith('INC-3');
    });
  });

  describe('Integration Test: ImplementationPlanSection to FeatureDefinitionPanel', () => {
    it('should correctly integrate ImplementationPlanSection within FeatureDefinitionPanel', () => {
      const mockOnIncrementSelect = vi.fn();
      const mockOnAnswerChange = vi.fn();
      const mockOnSubmitAnswers = vi.fn();

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={mockPlannerResponseWithPlan}
          answers={{}}
          onAnswerChange={mockOnAnswerChange}
          onSubmitAnswers={mockOnSubmitAnswers}
          activeIncrementId="INC-1"
          onIncrementSelect={mockOnIncrementSelect}
        />
      );

      // Verify Implementation Plan section header is rendered
      expect(screen.getByText('Implementation Plan')).toBeInTheDocument();

      // Verify increments are rendered through the component hierarchy
      // (auto-expanded because increments arrive)
      expect(screen.getByText('INC-1')).toBeInTheDocument();
      expect(screen.getByText('Core Setup')).toBeInTheDocument();

      // Verify active state is correctly propagated
      const cards = screen.getAllByTestId('increment-card');
      expect(cards[0].className).toContain('rowActive');

      // Verify click handler propagates correctly
      fireEvent.click(cards[1]);
      expect(mockOnIncrementSelect).toHaveBeenCalledWith('INC-2');
    });
  });

  describe('Integration Test: Active Increment State Changes', () => {
    it('should update active state when activeIncrementId changes', () => {
      const mockOnSelect = vi.fn();

      const { rerender } = render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId="INC-1"
          onIncrementSelect={mockOnSelect}
          collapsed={false}
        />
      );

      // Initial state: first increment active
      let cards = screen.getAllByTestId('increment-card');
      expect(cards[0].className).toContain('rowActive');
      expect(cards[1].className).not.toContain('rowActive');

      // Re-render with different active increment
      rerender(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId="INC-2"
          onIncrementSelect={mockOnSelect}
          collapsed={false}
        />
      );

      // Verify state change is reflected
      cards = screen.getAllByTestId('increment-card');
      expect(cards[0].className).not.toContain('rowActive');
      expect(cards[1].className).toContain('rowActive');
    });
  });

  describe('Integration Test: Plan Hidden When Null', () => {
    it('should not render plan body when implementationPlan is null in FeatureDefinitionPanel', () => {
      const plannerResponseWithoutPlan: PlannerResponse = {
        ...mockPlannerResponseWithPlan,
        implementationPlan: null,
      };

      render(
        <FeatureDefinitionPanel
          workItemTitle="Test Feature"
          workItemDescription="Test description"
          plannerResponse={plannerResponseWithoutPlan}
          answers={{}}
          onAnswerChange={vi.fn()}
          onSubmitAnswers={vi.fn()}
          activeIncrementId={null}
          onIncrementSelect={vi.fn()}
        />
      );

      // Verify other sections render but plan body and increment cards do not
      expect(screen.getByText('Test description')).toBeInTheDocument();
      expect(screen.queryByTestId('implementation-plan-body')).not.toBeInTheDocument();
      expect(screen.queryByTestId('increment-card')).not.toBeInTheDocument();
    });
  });

  describe('Integration Test: Multiple Increments Keyboard Navigation', () => {
    it('should support keyboard interaction on increment cards', () => {
      const mockOnSelect = vi.fn();

      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId={null}
          onIncrementSelect={mockOnSelect}
          collapsed={false}
        />
      );

      const cards = screen.getAllByTestId('increment-card');

      // Test Enter key
      fireEvent.keyDown(cards[0], { key: 'Enter' });
      expect(mockOnSelect).toHaveBeenCalledWith('INC-1');

      // Test Space key
      fireEvent.keyDown(cards[1], { key: ' ' });
      expect(mockOnSelect).toHaveBeenCalledWith('INC-2');
    });
  });
});
