/**
 * Spec 2026-01-23: Execute Increment Pipeline
 * Task Group 2: IncrementCard Badge Updates
 *
 * Tests for the IncrementCard status badge rendering with status values:
 * - NOT_STARTED: gray badge
 * - IN_CLARIFICATION: purple badge
 * - READY_TO_EXECUTE: blue badge
 * - EXECUTING: amber badge
 * - COMPLETED: green badge
 * - FAILED: red badge
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IncrementCard } from '../components/ProductView/IncrementCard';
import type { Increment } from '../api/chatApi';
import type { IncrementStatus } from '../components/ProductView/ImplementationAssistantPanel';

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

// Mock increment data for tests
const mockIncrement: Increment = {
  id: 'INC-1',
  partIndex: 1,
  title: 'Test Increment',
  intent: 'A test increment for badge testing',
};

describe('Spec 2026-01-23: IncrementCard Badge Tests', () => {
  describe('Badge text rendering', () => {
    it('should render "Not Started" text for NOT_STARTED status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="NOT_STARTED"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge).toHaveTextContent('Not Started');
    });

    it('should render "In Clarification" text for IN_CLARIFICATION status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="IN_CLARIFICATION"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge).toHaveTextContent('In Clarification');
    });

    it('should render "Ready" text for READY_TO_EXECUTE status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="READY_TO_EXECUTE"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge).toHaveTextContent('Ready');
    });

    it('should render "Executing" text for EXECUTING status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="EXECUTING"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge).toHaveTextContent('Executing');
    });

    it('should render "Completed" text for COMPLETED status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="COMPLETED"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge).toHaveTextContent('Completed');
    });

    it('should render "Failed" text for FAILED status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="FAILED"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge).toHaveTextContent('Failed');
    });

    it('should render "Not Started" text for undefined status (fallback)', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status={undefined}
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge).toHaveTextContent('Not Started');
    });
  });

  describe('Badge CSS class application', () => {
    it('should apply statusNotStarted class for NOT_STARTED status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="NOT_STARTED"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      // CSS modules mangle class names, so we check the class attribute contains the base name
      expect(badge.className).toContain('statusBadge');
      expect(badge.className).toContain('statusNotStarted');
    });

    it('should apply statusInClarification class for IN_CLARIFICATION status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="IN_CLARIFICATION"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge.className).toContain('statusBadge');
      expect(badge.className).toContain('statusInClarification');
    });

    it('should apply statusReadyToExecute class for READY_TO_EXECUTE status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="READY_TO_EXECUTE"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge.className).toContain('statusBadge');
      expect(badge.className).toContain('statusReadyToExecute');
    });

    it('should apply statusExecuting class for EXECUTING status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="EXECUTING"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge.className).toContain('statusBadge');
      expect(badge.className).toContain('statusExecuting');
    });

    it('should apply statusCompleted class for COMPLETED status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="COMPLETED"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge.className).toContain('statusBadge');
      expect(badge.className).toContain('statusCompleted');
    });

    it('should apply statusFailed class for FAILED status', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={vi.fn()}
          status="FAILED"
        />
      );

      const badge = screen.getByTestId('increment-status-badge');
      expect(badge.className).toContain('statusBadge');
      expect(badge.className).toContain('statusFailed');
    });
  });

  describe('All 6 status values render correctly', () => {
    const statusTestCases: Array<{
      status: IncrementStatus;
      expectedText: string;
      expectedClass: string;
    }> = [
      { status: 'NOT_STARTED', expectedText: 'Not Started', expectedClass: 'statusNotStarted' },
      { status: 'IN_CLARIFICATION', expectedText: 'In Clarification', expectedClass: 'statusInClarification' },
      { status: 'READY_TO_EXECUTE', expectedText: 'Ready', expectedClass: 'statusReadyToExecute' },
      { status: 'EXECUTING', expectedText: 'Executing', expectedClass: 'statusExecuting' },
      { status: 'COMPLETED', expectedText: 'Completed', expectedClass: 'statusCompleted' },
      { status: 'FAILED', expectedText: 'Failed', expectedClass: 'statusFailed' },
    ];

    statusTestCases.forEach(({ status, expectedText, expectedClass }) => {
      it(`should render ${status} with text "${expectedText}" and class "${expectedClass}"`, () => {
        render(
          <IncrementCard
            increment={mockIncrement}
            isActive={false}
            onClick={vi.fn()}
            status={status}
          />
        );

        const badge = screen.getByTestId('increment-status-badge');
        expect(badge).toHaveTextContent(expectedText);
        expect(badge.className).toContain(expectedClass);
      });
    });
  });
});
