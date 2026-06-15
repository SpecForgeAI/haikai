/**
 * ResizableSplitPane Keyboard Accessibility Tests
 * Task Group 2: Keyboard navigation tests for ResizableSplitPane
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 * Tests for keyboard accessibility: focus, arrow keys, shift+arrow keys.
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

describe('ResizableSplitPane Keyboard Accessibility', () => {
  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    vi.clearAllMocks();
  });

  /**
   * Test 1: Drag handle is focusable with visible focus ring
   *
   * Verifies that the drag handle can receive focus via Tab key
   * and has the proper ARIA attributes for accessibility.
   */
  describe('drag handle focusability', () => {
    it('should be focusable with tabIndex 0', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.keyboard.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      expect(dragHandle).toHaveAttribute('tabindex', '0');
    });

    it('should have correct ARIA attributes for accessibility', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.aria.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      expect(dragHandle).toHaveAttribute('aria-valuenow', '350');
      expect(dragHandle).toHaveAttribute('aria-valuemin', '200');
      expect(dragHandle).toHaveAttribute('aria-valuemax', '600');
      expect(dragHandle).toHaveAttribute('aria-orientation', 'vertical');
      expect(dragHandle).toHaveAttribute('aria-label', 'Resize panels');
    });

    it('should receive focus when focused programmatically', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.focus.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      dragHandle.focus();
      expect(document.activeElement).toBe(dragHandle);
    });
  });

  /**
   * Test 2: Left/right arrow keys adjust width by 10px (clamped)
   *
   * Verifies that pressing left/right arrow keys adjusts the width
   * by 10px increments, respecting min/max constraints.
   */
  describe('arrow key width adjustment', () => {
    it('should increase width by 10px when pressing right arrow', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.arrowRight.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Focus the handle and press right arrow
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });

      // Width should increase by 10px
      expect(leftPane).toHaveStyle({ width: '360px' });
    });

    it('should decrease width by 10px when pressing left arrow', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.arrowLeft.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Focus the handle and press left arrow
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowLeft' });

      // Width should decrease by 10px
      expect(leftPane).toHaveStyle({ width: '340px' });
    });

    it('should clamp width to minimum when pressing left arrow at min boundary', () => {
      mockLocalStorage.setItem('test.clampMin.leftWidth', '205');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.clampMin.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Initial width is 205
      expect(leftPane).toHaveStyle({ width: '205px' });

      // Focus and press left arrow - should clamp to 200 (not 195)
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowLeft' });

      expect(leftPane).toHaveStyle({ width: '200px' });

      // Pressing left again should stay at 200
      fireEvent.keyDown(dragHandle, { key: 'ArrowLeft' });
      expect(leftPane).toHaveStyle({ width: '200px' });
    });

    it('should clamp width to maximum when pressing right arrow at max boundary', () => {
      mockLocalStorage.setItem('test.clampMax.leftWidth', '595');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.clampMax.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Initial width is 595
      expect(leftPane).toHaveStyle({ width: '595px' });

      // Focus and press right arrow - should clamp to 600 (not 605)
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });

      expect(leftPane).toHaveStyle({ width: '600px' });

      // Pressing right again should stay at 600
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
      expect(leftPane).toHaveStyle({ width: '600px' });
    });

    it('should persist width to localStorage after arrow key adjustment', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.arrowPersist.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');

      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });

      // Should persist the new width (360px)
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('test.arrowPersist.leftWidth', '360');
    });
  });

  /**
   * Test 3: Shift+arrow keys adjust width by 50px (clamped and persisted)
   *
   * Verifies that pressing shift+left/right arrow keys adjusts the width
   * by 50px increments, respecting min/max constraints and persisting to localStorage.
   */
  describe('shift+arrow key width adjustment', () => {
    it('should increase width by 50px when pressing shift+right arrow', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.shiftRight.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Focus the handle and press shift+right arrow
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight', shiftKey: true });

      // Width should increase by 50px
      expect(leftPane).toHaveStyle({ width: '400px' });
    });

    it('should decrease width by 50px when pressing shift+left arrow', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.shiftLeft.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Focus the handle and press shift+left arrow
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowLeft', shiftKey: true });

      // Width should decrease by 50px
      expect(leftPane).toHaveStyle({ width: '300px' });
    });

    it('should clamp to minimum when shift+left would go below min', () => {
      mockLocalStorage.setItem('test.shiftClampMin.leftWidth', '230');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.shiftClampMin.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Initial width is 230
      expect(leftPane).toHaveStyle({ width: '230px' });

      // Shift+left would go to 180, but should clamp to 200
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowLeft', shiftKey: true });

      expect(leftPane).toHaveStyle({ width: '200px' });
    });

    it('should clamp to maximum when shift+right would go above max', () => {
      mockLocalStorage.setItem('test.shiftClampMax.leftWidth', '570');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.shiftClampMax.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Initial width is 570
      expect(leftPane).toHaveStyle({ width: '570px' });

      // Shift+right would go to 620, but should clamp to 600
      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowRight', shiftKey: true });

      expect(leftPane).toHaveStyle({ width: '600px' });
    });

    it('should persist width to localStorage after shift+arrow adjustment', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.shiftPersist.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');

      dragHandle.focus();
      fireEvent.keyDown(dragHandle, { key: 'ArrowLeft', shiftKey: true });

      // Should persist the new width (300px)
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('test.shiftPersist.leftWidth', '300');
    });
  });

  /**
   * Test: Other keys are ignored
   */
  describe('other key handling', () => {
    it('should not change width for non-arrow keys', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.otherKeys.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      dragHandle.focus();

      // Press various non-arrow keys
      fireEvent.keyDown(dragHandle, { key: 'Enter' });
      expect(leftPane).toHaveStyle({ width: '350px' });

      fireEvent.keyDown(dragHandle, { key: 'Space' });
      expect(leftPane).toHaveStyle({ width: '350px' });

      fireEvent.keyDown(dragHandle, { key: 'Tab' });
      expect(leftPane).toHaveStyle({ width: '350px' });
    });
  });
});
