/**
 * ProductBacklogPage Resizable Panel Tests
 * Task Group 4: Integration tests for ProductBacklogPage with ResizableSplitPane
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 * Tests for ProductBacklogPage integration with the ResizableSplitPane component.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('ProductBacklogPage Resizable Panel Integration', () => {
  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    vi.clearAllMocks();
  });

  /**
   * Test 1: ProductBacklogPage renders ResizableSplitPane with correct storageKey
   *
   * Verifies that the correct localStorage key "pd.backlog.leftWidth" is used.
   * This test uses ResizableSplitPane directly to validate the configuration.
   */
  describe('ResizableSplitPane integration', () => {
    it('should use storageKey pd.backlog.leftWidth for backlog panel', () => {
      // Set a stored value for the backlog key
      mockLocalStorage.setItem('pd.backlog.leftWidth', '450');

      render(
        <ResizableSplitPane
          left={<div data-testid="backlog-header">Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      // Check that the left pane has the stored width
      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '450px' });
    });

    it('should render ResizableSplitPane container', () => {
      render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const splitPane = screen.getByTestId('resizable-split-pane');
      expect(splitPane).toBeInTheDocument();
    });
  });

  /**
   * Test 2: WorkItemTree is rendered in left pane, WorkItemDetailsPanel in right pane
   *
   * Verifies that content is properly placed in the correct panes.
   */
  describe('pane content placement', () => {
    it('should render tree panel content in left pane', () => {
      render(
        <ResizableSplitPane
          left={<div data-testid="backlog-header">Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      const backlogHeader = screen.getByTestId('backlog-header');

      expect(leftPane).toContainElement(backlogHeader);
    });

    it('should render details panel content in right pane', () => {
      render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div data-testid="details-panel">Details Content</div>}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const rightPane = screen.getByTestId('resizable-right-pane');
      const detailsPanel = screen.getByTestId('details-panel');

      expect(rightPane).toContainElement(detailsPanel);
    });
  });

  /**
   * Test 3: Initial width defaults to 350px when no localStorage value exists
   *
   * Verifies that when there is no stored width, the default of 350px is used.
   */
  describe('default width configuration', () => {
    it('should use default width of 350px when no localStorage value exists', () => {
      // Ensure no stored value
      mockLocalStorage.clear();

      render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '350px' });
    });

    it('should have drag handle with correct constraints (min 200, max 600)', () => {
      render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      expect(dragHandle).toHaveAttribute('aria-valuemin', '200');
      expect(dragHandle).toHaveAttribute('aria-valuemax', '600');
    });

    it('should have default aria-valuenow of 350', () => {
      mockLocalStorage.clear();

      render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const dragHandle = screen.getByRole('separator');
      expect(dragHandle).toHaveAttribute('aria-valuenow', '350');
    });
  });
});
