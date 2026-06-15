/**
 * IncrementCard Component Tests
 *
 * Spec 2026-01-23: Implement Triggers Plan Generation
 * Task Group 2: Create IncrementCard Component
 *
 * Tests for:
 * - IncrementCard renders increment id and title
 * - Active state shows correct styling
 * - Non-active state shows standard styling
 * - onClick callback fires when card is clicked
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { IncrementCard } from '../components/ProductView/IncrementCard';
import type { Increment } from '../api/chatApi';

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

describe('Task Group 2: IncrementCard Component', () => {
  const mockIncrement: Increment = {
    id: 'INC-1',
    partIndex: 1,
    title: 'Setup Authentication Module',
    intent: 'Initialize OAuth2 client and configure authentication providers.',
  };

  describe('Test 2.1a: IncrementCard renders increment id and title', () => {
    it('should render the increment id', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={() => {}}
        />
      );

      expect(screen.getByText('INC-1')).toBeInTheDocument();
    });

    it('should render the increment title', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={() => {}}
        />
      );

      expect(screen.getByText('Setup Authentication Module')).toBeInTheDocument();
    });
  });

  describe('Test 2.1c: Active state shows correct styling', () => {
    it('should apply active class when isActive is true', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={true}
          onClick={() => {}}
        />
      );

      // CSS modules add hash suffixes, so we check if className contains the key part
      const card = screen.getByTestId('increment-card');
      expect(card.className).toContain('rowActive');
    });

    it('should have active styling when active', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={true}
          onClick={() => {}}
        />
      );

      const card = screen.getByTestId('increment-card');
      // The active class should be applied which contains the border styling
      expect(card.className).toContain('rowActive');
    });
  });

  describe('Test 2.1d: Non-active state shows standard styling', () => {
    it('should not apply active class when isActive is false', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={() => {}}
        />
      );

      const card = screen.getByTestId('increment-card');
      expect(card.className).not.toContain('rowActive');
    });

    it('should apply base row class when not active', () => {
      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={() => {}}
        />
      );

      const card = screen.getByTestId('increment-card');
      // CSS modules add hash to class names, check for 'row' substring
      expect(card.className).toContain('row');
    });
  });

  describe('Test 2.1e: onClick callback fires when card is clicked', () => {
    it('should call onClick when card is clicked', () => {
      const mockOnClick = vi.fn();

      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={false}
          onClick={mockOnClick}
        />
      );

      const card = screen.getByTestId('increment-card');
      fireEvent.click(card);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('should call onClick when active card is clicked', () => {
      const mockOnClick = vi.fn();

      render(
        <IncrementCard
          increment={mockIncrement}
          isActive={true}
          onClick={mockOnClick}
        />
      );

      const card = screen.getByTestId('increment-card');
      fireEvent.click(card);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });
  });
});
