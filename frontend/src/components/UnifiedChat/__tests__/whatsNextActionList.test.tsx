/**
 * WhatsNextActionList Tests
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 6, Task 6.1: Write 3-5 focused tests for WhatsNextActionList
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 7, Task 7.1: Update test fixtures to include ModalAction variant
 * - Added ModalAction variant (define-tech-stack with launch: 'modal')
 * - Added test: "calls onActionClick with ModalAction object on modal-type card click"
 *
 * Tests verify:
 * - Renders explanation text
 * - Renders correct number of action cards with data-testid
 * - Displays label and reason per card
 * - Calls onActionClick on card click with correct action object
 * - Calls onActionClick with ModalAction object on modal-type card click
 * - Handles empty actions array
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhatsNextActionList, NextAction } from '../WhatsNextActionList';

// ============================================================================
// Test Data
// ============================================================================

const mockActions: NextAction[] = [
  {
    id: 'define-mission',
    label: 'Define Product Mission',
    reason: 'A product mission is the foundation for all other activities.',
    priority: 100,
    target: { screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' },
    launch: 'panel',
  },
  {
    id: 'define-tech-stack',
    label: 'Define Tech Stack',
    reason: 'Establishing technology standards early ensures consistent architectural decisions.',
    priority: 80,
    launch: 'modal',
    modalId: 'generate-standards',
    target: { personaId: 'architect' },
  },
  {
    id: 'define-roadmap',
    label: 'Define Product Roadmap',
    reason: 'A roadmap gives the team a clear direction and helps prioritize upcoming work.',
    priority: 70,
    target: { screen: 'product', tab: 'roadmap', personaId: 'product-manager', taskId: 'product-manager--roadmap' },
    launch: 'panel',
  },
];

const mockExplanation = 'Your project has a mission defined but is missing 3 foundational artifacts.';

// ============================================================================
// Tests
// ============================================================================

describe('WhatsNextActionList', () => {
  it('renders explanation text', () => {
    const onActionClick = vi.fn();
    render(
      <WhatsNextActionList
        explanation={mockExplanation}
        actions={mockActions}
        onActionClick={onActionClick}
      />
    );

    expect(screen.getByText(mockExplanation)).toBeInTheDocument();
  });

  it('renders correct number of action cards with data-testid', () => {
    const onActionClick = vi.fn();
    render(
      <WhatsNextActionList
        explanation={mockExplanation}
        actions={mockActions}
        onActionClick={onActionClick}
      />
    );

    // Should render 3 action cards
    expect(screen.getByTestId('whats-next-action-define-mission')).toBeInTheDocument();
    expect(screen.getByTestId('whats-next-action-define-tech-stack')).toBeInTheDocument();
    expect(screen.getByTestId('whats-next-action-define-roadmap')).toBeInTheDocument();

    // Verify all 3 buttons are rendered
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
  });

  it('displays label and reason per card', () => {
    const onActionClick = vi.fn();
    render(
      <WhatsNextActionList
        explanation={mockExplanation}
        actions={mockActions}
        onActionClick={onActionClick}
      />
    );

    // Check first action card (PanelAction)
    expect(screen.getByText('Define Product Mission')).toBeInTheDocument();
    expect(screen.getByText('A product mission is the foundation for all other activities.')).toBeInTheDocument();

    // Check second action card (ModalAction)
    expect(screen.getByText('Define Tech Stack')).toBeInTheDocument();
    expect(screen.getByText('Establishing technology standards early ensures consistent architectural decisions.')).toBeInTheDocument();

    // Check third action card (PanelAction)
    expect(screen.getByText('Define Product Roadmap')).toBeInTheDocument();
    expect(screen.getByText('A roadmap gives the team a clear direction and helps prioritize upcoming work.')).toBeInTheDocument();
  });

  it('calls onActionClick on card click with correct action object', () => {
    const onActionClick = vi.fn();
    render(
      <WhatsNextActionList
        explanation={mockExplanation}
        actions={mockActions}
        onActionClick={onActionClick}
      />
    );

    // Click the first action card (PanelAction: define-mission)
    fireEvent.click(screen.getByTestId('whats-next-action-define-mission'));

    expect(onActionClick).toHaveBeenCalledTimes(1);
    expect(onActionClick).toHaveBeenCalledWith(mockActions[0]);
  });

  it('calls onActionClick with ModalAction object on modal-type card click', () => {
    const onActionClick = vi.fn();
    render(
      <WhatsNextActionList
        explanation={mockExplanation}
        actions={mockActions}
        onActionClick={onActionClick}
      />
    );

    // Click the define-tech-stack card (ModalAction)
    fireEvent.click(screen.getByTestId('whats-next-action-define-tech-stack'));

    expect(onActionClick).toHaveBeenCalledTimes(1);
    expect(onActionClick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'define-tech-stack',
        launch: 'modal',
        modalId: 'generate-standards',
        target: { personaId: 'architect' },
      })
    );
  });

  it('handles empty actions array', () => {
    const onActionClick = vi.fn();
    const emptyExplanation = 'No actions available.';
    render(
      <WhatsNextActionList
        explanation={emptyExplanation}
        actions={[]}
        onActionClick={onActionClick}
      />
    );

    // Explanation should still render
    expect(screen.getByText(emptyExplanation)).toBeInTheDocument();

    // No buttons should be rendered
    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(0);

    // The list container should still be present
    expect(screen.getByTestId('whats-next-action-list')).toBeInTheDocument();
  });
});
