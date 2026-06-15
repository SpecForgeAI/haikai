/**
 * ResizableSplitPane Component Tests
 * Task Group 1: Core functionality tests for ResizableSplitPane
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 * Tests for rendering, drag behavior, localStorage persistence, and constraints.
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

describe('ResizableSplitPane Component', () => {
  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    vi.clearAllMocks();
  });

  /**
   * Test 1: Component renders left and right children correctly
   *
   * Verifies that the ResizableSplitPane correctly renders both the left
   * and right pane content passed as props.
   */
  describe('renders left and right children correctly', () => {
    it('should render both left and right pane content', () => {
      render(
        <ResizableSplitPane
          left={<div data-testid="left-content">Left Panel Content</div>}
          right={<div data-testid="right-content">Right Panel Content</div>}
          storageKey="test.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      expect(screen.getByTestId('left-content')).toBeInTheDocument();
      expect(screen.getByText('Left Panel Content')).toBeInTheDocument();
      expect(screen.getByTestId('right-content')).toBeInTheDocument();
      expect(screen.getByText('Right Panel Content')).toBeInTheDocument();
    });

    it('should render drag handle between panes', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      expect(dragHandle).toBeInTheDocument();
    });

    it('should set default left pane width when no localStorage value exists', () => {
      render(
        <ResizableSplitPane
          left={<div data-testid="left-pane">Left</div>}
          right={<div>Right</div>}
          storageKey="test.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '350px' });
    });
  });

  /**
   * Test 2: Drag handle is rendered with separator role and correct attributes
   *
   * Verifies that the drag handle has the correct ARIA role and is focusable,
   * which implies it can be interacted with (including cursor change on hover).
   */
  describe('drag handle accessibility and structure', () => {
    it('should render drag handle with separator role and tabIndex', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      expect(dragHandle).toBeInTheDocument();
      expect(dragHandle).toHaveAttribute('tabindex', '0');
      expect(dragHandle).toHaveAttribute('aria-orientation', 'vertical');
    });

    it('should have drag handle with correct test id', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByTestId('resizable-drag-handle');
      expect(dragHandle).toBeInTheDocument();
    });
  });

  /**
   * Test 3: Left pane width respects min/max constraints during simulated drag
   *
   * Verifies that the left pane width is clamped to min/max values during drag.
   */
  describe('width constraints during drag', () => {
    it('should clamp width to minimum during drag', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.clamp.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Mock getBoundingClientRect for the left pane
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

      // Start drag
      fireEvent.mouseDown(dragHandle, { clientX: 350 });

      // Drag to a position that would result in width below minimum (100px)
      fireEvent.mouseMove(document, { clientX: 100 });

      // The width should be clamped to minimum (200px)
      expect(leftPane).toHaveStyle({ width: '200px' });

      // End drag
      fireEvent.mouseUp(document);
    });

    it('should clamp width to maximum during drag', () => {
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

      // Mock getBoundingClientRect for the left pane
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

      // Start drag
      fireEvent.mouseDown(dragHandle, { clientX: 350 });

      // Drag to a position that would result in width above maximum (800px)
      fireEvent.mouseMove(document, { clientX: 800 });

      // The width should be clamped to maximum (600px)
      expect(leftPane).toHaveStyle({ width: '600px' });

      // End drag
      fireEvent.mouseUp(document);
    });
  });

  /**
   * Test 4: localStorage is read on mount and written after drag ends
   *
   * Verifies that the component reads the stored width from localStorage on mount
   * and persists the new width after drag ends.
   */
  describe('localStorage persistence', () => {
    it('should read stored width from localStorage on mount', () => {
      mockLocalStorage.setItem('test.stored.leftWidth', '400');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.stored.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '400px' });
    });

    it('should persist width to localStorage after drag ends', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.persist.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const leftPane = screen.getByTestId('resizable-left-pane');

      // Mock getBoundingClientRect for the left pane
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

      // Start drag
      fireEvent.mouseDown(dragHandle, { clientX: 350 });

      // Drag to new position (450px)
      fireEvent.mouseMove(document, { clientX: 450 });

      // End drag
      fireEvent.mouseUp(document);

      // Verify localStorage was updated
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('test.persist.leftWidth', '450');
    });

    it('should clamp stored value from localStorage to valid range', () => {
      // Store an invalid value that exceeds max
      mockLocalStorage.setItem('test.clampStored.leftWidth', '900');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.clampStored.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      // Should be clamped to max (600px)
      expect(leftPane).toHaveStyle({ width: '600px' });
    });

    it('should use default when localStorage has invalid value', () => {
      // Store an invalid non-numeric value
      mockLocalStorage.setItem('test.invalid.leftWidth', 'not-a-number');

      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.invalid.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      // Should use default (350px)
      expect(leftPane).toHaveStyle({ width: '350px' });
    });
  });

  /**
   * Test: Text selection prevention during drag
   *
   * Verifies that text selection is disabled during drag and restored after.
   */
  describe('text selection prevention during drag', () => {
    it('should apply user-select none class during drag', () => {
      render(
        <ResizableSplitPane
          left={<div>Left</div>}
          right={<div>Right</div>}
          storageKey="test.select.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      const container = screen.getByTestId('resizable-split-pane');

      // Initially no dragging class
      expect(container).not.toHaveClass('dragging');

      // Start drag
      fireEvent.mouseDown(dragHandle, { clientX: 350 });

      // Should have dragging class
      expect(container).toHaveClass('dragging');

      // End drag
      fireEvent.mouseUp(document);

      // Should not have dragging class
      expect(container).not.toHaveClass('dragging');
    });
  });
});
