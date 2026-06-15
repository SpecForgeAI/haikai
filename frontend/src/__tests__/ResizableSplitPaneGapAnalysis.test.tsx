/**
 * ResizableSplitPane Gap Analysis Tests
 * Task Group 6: Additional strategic tests for coverage gaps
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 *
 * These tests cover edge cases and scenarios not fully addressed
 * in the primary test suites:
 * 1. ARIA valuenow updates dynamically during interactions
 * 2. Multiple rapid keyboard adjustments maintain consistency
 * 3. Drag handle works correctly when width is at boundaries
 * 4. Component handles missing/corrupt localStorage gracefully
 * 5. Integration test: keyboard after mouse drag
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizableSplitPane } from '../components/shared/ResizableSplitPane';

// Mock localStorage
const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
};

let mockLocalStorage = createMockLocalStorage();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

describe('ResizableSplitPane Gap Analysis Tests', () => {
  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    vi.clearAllMocks();
  });

  /**
   * Gap 1: ARIA valuenow updates dynamically during keyboard interaction
   *
   * Ensures the aria-valuenow attribute is updated in real-time
   * as the user adjusts width via keyboard, providing proper
   * screen reader feedback.
   */
  describe('dynamic ARIA value updates', () => {
    it('should update aria-valuenow when width changes via keyboard', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.aria.update"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');

      // Initial value
      expect(dragHandle).toHaveAttribute('aria-valuenow', '350');

      // Adjust via keyboard
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });

      // ARIA value should be updated
      expect(dragHandle).toHaveAttribute('aria-valuenow', '360');

      // Adjust again
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight', shiftKey: true });

      // ARIA value should reflect new width
      expect(dragHandle).toHaveAttribute('aria-valuenow', '410');
    });
  });

  /**
   * Gap 2: Multiple rapid keyboard adjustments maintain state consistency
   *
   * Simulates rapid keyboard presses to ensure state updates
   * are applied correctly and localStorage reflects final state.
   */
  describe('rapid keyboard adjustments', () => {
    it('should handle multiple rapid arrow key presses correctly', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.rapid"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      dragHandle.focus();

      // Rapid right presses
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });

      // Should have increased by 50px total (5 * 10px)
      expect(leftPane).toHaveStyle({ width: '400px' });

      // Last setItem call should have final value
      const setItemCalls = mockLocalStorage.setItem.mock.calls;
      const lastCall = setItemCalls[setItemCalls.length - 1];
      expect(lastCall).toEqual(['test.rapid', '400']);
    });
  });

  /**
   * Gap 3: Drag behavior at boundary conditions
   *
   * Tests that drag interactions work correctly when starting
   * from min or max boundary values.
   */
  describe('drag at boundary conditions', () => {
    it('should allow increasing width when starting at minimum', () => {
      mockLocalStorage.setItem('test.boundary.min', '200');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.boundary.min"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Starts at minimum
      expect(leftPane).toHaveStyle({ width: '200px' });

      // Mock getBoundingClientRect
      vi.spyOn(leftPane, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 200,
        bottom: 500,
        width: 200,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      // Drag to increase
      fireEvent.mouseDown(dragHandle, { clientX: 200 });
      fireEvent.mouseMove(document, { clientX: 350 });
      fireEvent.mouseUp(document);

      // Should allow increase
      expect(leftPane).toHaveStyle({ width: '350px' });
    });

    it('should allow decreasing width when starting at maximum', () => {
      mockLocalStorage.setItem('test.boundary.max', '600');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.boundary.max"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Starts at maximum
      expect(leftPane).toHaveStyle({ width: '600px' });

      // Mock getBoundingClientRect
      vi.spyOn(leftPane, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 600,
        bottom: 500,
        width: 600,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      // Drag to decrease
      fireEvent.mouseDown(dragHandle, { clientX: 600 });
      fireEvent.mouseMove(document, { clientX: 400 });
      fireEvent.mouseUp(document);

      // Should allow decrease
      expect(leftPane).toHaveStyle({ width: '400px' });
    });
  });

  /**
   * Gap 4: Graceful handling of localStorage exceptions
   *
   * Tests that the component handles localStorage errors
   * (e.g., in private browsing mode) without crashing.
   */
  describe('localStorage error handling', () => {
    it('should use default width when localStorage.getItem throws', () => {
      // Make getItem throw an error
      mockLocalStorage.getItem = vi.fn(() => {
        throw new Error('localStorage not available');
      });

      // Should not throw
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.error"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      // Should use default
      expect(leftPane).toHaveStyle({ width: '350px' });
    });

    it('should not throw when localStorage.setItem fails', () => {
      // Make setItem throw an error
      mockLocalStorage.setItem = vi.fn(() => {
        throw new Error('Quota exceeded');
      });

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.setError"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Adjust width via keyboard - should not throw
      dragHandle.focus();
      expect(() => {
        fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
      }).not.toThrow();

      // Width should still update in state
      expect(leftPane).toHaveStyle({ width: '360px' });
    });
  });

  /**
   * Gap 5: Integration - keyboard adjustment after mouse drag
   *
   * Ensures keyboard adjustments work correctly after a mouse
   * drag operation, testing the interaction between different
   * input modalities.
   */
  describe('keyboard after mouse drag integration', () => {
    it('should allow keyboard adjustment after completing a mouse drag', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.integration"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Mock getBoundingClientRect
      vi.spyOn(leftPane, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 350,
        bottom: 500,
        width: 350,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      // First: mouse drag
      fireEvent.mouseDown(dragHandle, { clientX: 350 });
      fireEvent.mouseMove(document, { clientX: 400 });
      fireEvent.mouseUp(document);

      expect(leftPane).toHaveStyle({ width: '400px' });

      // Then: keyboard adjustment
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowLeft' });

      // Should adjust from the new position
      expect(leftPane).toHaveStyle({ width: '390px' });
    });
  });
});
