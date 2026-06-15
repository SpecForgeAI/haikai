/**
 * ImplementationPlanSection Component Tests
 *
 * Spec 2026-01-23: Implement Triggers Plan Generation
 * Task Group 3: Create ImplementationPlanSection Component
 *
 * Tests for:
 * - Component returns null when implementationPlan is null
 * - Component renders plan title from implementationPlan.planTitle
 * - Component renders IncrementCard for each increment
 * - Correct increment receives isActive=true based on activeIncrementId
 * - onIncrementSelect callback fires when IncrementCard is clicked
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImplementationPlanSection } from '../components/ProductView/ImplementationPlanSection';
import type { ImplementationPlan } from '../api/chatApi';

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

describe('Task Group 3: ImplementationPlanSection Component', () => {
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
      {
        id: 'INC-3',
        partIndex: 3,
        title: 'Add Token Refresh',
        intent: 'Implement automatic token refresh mechanism.',
      },
    ],
  };

  describe('Test 3.1a: Component returns null when implementationPlan is null', () => {
    it('should render nothing when implementationPlan is null', () => {
      const { container } = render(
        <ImplementationPlanSection
          implementationPlan={null}
          activeIncrementId={null}
          onIncrementSelect={() => {}}
        />
      );

      // The section still renders a collapsed header, but no body content
      expect(screen.queryByTestId('implementation-plan-body')).not.toBeInTheDocument();
    });

    it('should not render plan body when plan is null', () => {
      render(
        <ImplementationPlanSection
          implementationPlan={null}
          activeIncrementId={null}
          onIncrementSelect={() => {}}
        />
      );

      expect(screen.queryByTestId('implementation-plan-body')).not.toBeInTheDocument();
    });
  });

  describe('Test 3.1b: Component renders plan title from implementationPlan.planTitle', () => {
    it('should render the section title "Implementation Plan"', () => {
      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId={null}
          onIncrementSelect={() => {}}
          collapsed={false}
        />
      );

      expect(screen.getByText('Implementation Plan')).toBeInTheDocument();
    });
  });

  describe('Test 3.1c: Component renders IncrementCard for each increment', () => {
    it('should render an IncrementCard for each increment in the plan', () => {
      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId={null}
          onIncrementSelect={() => {}}
          collapsed={false}
        />
      );

      // Check all increment IDs are rendered
      expect(screen.getByText('INC-1')).toBeInTheDocument();
      expect(screen.getByText('INC-2')).toBeInTheDocument();
      expect(screen.getByText('INC-3')).toBeInTheDocument();
    });

    it('should render all increment titles', () => {
      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId={null}
          onIncrementSelect={() => {}}
          collapsed={false}
        />
      );

      expect(screen.getByText('Setup Auth Module')).toBeInTheDocument();
      expect(screen.getByText('Implement Login Flow')).toBeInTheDocument();
      expect(screen.getByText('Add Token Refresh')).toBeInTheDocument();
    });
  });

  describe('Test 3.1d: Correct increment receives isActive=true based on activeIncrementId', () => {
    it('should mark the correct increment as active', () => {
      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId="INC-2"
          onIncrementSelect={() => {}}
          collapsed={false}
        />
      );

      const cards = screen.getAllByTestId('increment-card');

      // First card should not be active (check className contains rowActive)
      expect(cards[0].className).not.toContain('rowActive');
      // Second card should be active
      expect(cards[1].className).toContain('rowActive');
      // Third card should not be active
      expect(cards[2].className).not.toContain('rowActive');
    });

    it('should mark no increment as active when activeIncrementId is null', () => {
      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId={null}
          onIncrementSelect={() => {}}
          collapsed={false}
        />
      );

      const cards = screen.getAllByTestId('increment-card');

      cards.forEach(card => {
        expect(card.className).not.toContain('rowActive');
      });
    });

    it('should mark first increment as active when activeIncrementId matches first', () => {
      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId="INC-1"
          onIncrementSelect={() => {}}
          collapsed={false}
        />
      );

      const cards = screen.getAllByTestId('increment-card');

      expect(cards[0].className).toContain('rowActive');
      expect(cards[1].className).not.toContain('rowActive');
      expect(cards[2].className).not.toContain('rowActive');
    });
  });

  describe('Test 3.1e: onIncrementSelect callback fires when IncrementCard is clicked', () => {
    it('should call onIncrementSelect with correct increment ID when clicked', () => {
      const mockOnIncrementSelect = vi.fn();

      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId={null}
          onIncrementSelect={mockOnIncrementSelect}
          collapsed={false}
        />
      );

      const cards = screen.getAllByTestId('increment-card');
      fireEvent.click(cards[1]); // Click the second card

      expect(mockOnIncrementSelect).toHaveBeenCalledWith('INC-2');
    });

    it('should call onIncrementSelect for each increment when clicked', () => {
      const mockOnIncrementSelect = vi.fn();

      render(
        <ImplementationPlanSection
          implementationPlan={mockImplementationPlan}
          activeIncrementId={null}
          onIncrementSelect={mockOnIncrementSelect}
          collapsed={false}
        />
      );

      const cards = screen.getAllByTestId('increment-card');

      fireEvent.click(cards[0]);
      expect(mockOnIncrementSelect).toHaveBeenCalledWith('INC-1');

      fireEvent.click(cards[2]);
      expect(mockOnIncrementSelect).toHaveBeenCalledWith('INC-3');
    });
  });
});
