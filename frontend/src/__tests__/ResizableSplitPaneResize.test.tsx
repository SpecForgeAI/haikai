/**
 * ResizableSplitPane Window Resize Tests
 * Task Group 3: Window resize handling tests for ResizableSplitPane
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 * Tests for window resize behavior: re-clamping width and localStorage persistence.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

describe('ResizableSplitPane Window Resize Handling', () => {
  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: On window resize, stored width is re-clamped if it exceeds available space
   *
   * Verifies that when the window is resized and the current width exceeds
   * the maximum constraint, it is automatically clamped to the valid range.
   */
  describe('width re-clamping on window resize', () => {
    it('should re-clamp width when it exceeds max after resize', () => {
      // Start with width at 500px (within 200-600 range)
      mockLocalStorage.setItem('test.resize.leftWidth', '500');

      const { rerender } = render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resize.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '500px' });

      // Simulate window resize by re-rendering with smaller max
      rerender(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resize.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={400}  // Max is now smaller
        />
      );

      // Dispatch resize event
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      // Width should be clamped to new max (400px)
      expect(leftPane).toHaveStyle({ width: '400px' });
    });

    it('should re-clamp width when it falls below min after resize', () => {
      // Start with width at 250px (within 200-600 range)
      mockLocalStorage.setItem('test.resizeMin.leftWidth', '250');

      const { rerender } = render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resizeMin.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '250px' });

      // Simulate window resize by re-rendering with larger min
      rerender(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resizeMin.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={300}  // Min is now larger
          maxLeftWidthPx={600}
        />
      );

      // Dispatch resize event
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      // Width should be clamped to new min (300px)
      expect(leftPane).toHaveStyle({ width: '300px' });
    });

    it('should not change width if already within valid range after resize', () => {
      // Start with width at 400px (within 200-600 range)
      mockLocalStorage.setItem('test.resizeValid.leftWidth', '400');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resizeValid.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '400px' });

      // Clear setItem calls from initial render
      mockLocalStorage.setItem.mockClear();

      // Dispatch resize event
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      // Width should remain at 400px
      expect(leftPane).toHaveStyle({ width: '400px' });

      // localStorage should NOT be updated since width didn't change
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });
  });

  /**
   * Test 2: Re-clamped width is persisted to localStorage
   *
   * Verifies that when width is re-clamped due to window resize,
   * the new clamped value is persisted to localStorage.
   */
  describe('localStorage persistence on resize', () => {
    it('should persist re-clamped width to localStorage', () => {
      // Start with width at 550px (within 200-600 range)
      mockLocalStorage.setItem('test.resizePersist.leftWidth', '550');

      const { rerender } = render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resizePersist.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '550px' });

      // Clear setItem calls from initial render
      mockLocalStorage.setItem.mockClear();

      // Simulate window resize by re-rendering with smaller max
      rerender(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resizePersist.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={450}  // Max is now smaller than current width
        />
      );

      // Dispatch resize event
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      // Width should be clamped to new max (450px) and persisted
      expect(leftPane).toHaveStyle({ width: '450px' });
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('test.resizePersist.leftWidth', '450');
    });

    it('should not persist to localStorage if width was not changed', () => {
      // Start with width at 350px (well within range)
      mockLocalStorage.setItem('test.resizeNoChange.leftWidth', '350');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.resizeNoChange.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '350px' });

      // Clear setItem calls from initial render
      mockLocalStorage.setItem.mockClear();

      // Dispatch resize event without changing constraints
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      // Width should remain at 350px
      expect(leftPane).toHaveStyle({ width: '350px' });

      // localStorage should NOT be updated
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });
  });

  /**
   * Test: Cleanup on unmount
   */
  describe('cleanup on unmount', () => {
    it('should remove resize listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.cleanup.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      unmount();

      // Should have removed the resize event listener
      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });
  });
});
