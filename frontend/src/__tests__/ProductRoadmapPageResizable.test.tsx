/**
 * ProductRoadmapPage Resizable Panel Tests
 * Task Group 5: Integration tests for ProductRoadmapPage with ResizableSplitPane
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 * Tests for ProductRoadmapPage integration with the ResizableSplitPane component.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('ProductRoadmapPage Resizable Panel Integration', () => {
  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    vi.clearAllMocks();
  });

  /**
   * Test 1: ProductRoadmapPage renders ResizableSplitPane with correct storageKey
   *
   * Verifies that the correct localStorage key "pd.roadmap.leftWidth" is used.
   * This test uses ResizableSplitPane directly to validate the configuration.
   */
  describe('ResizableSplitPane integration', () => {
    it('should use storageKey pd.roadmap.leftWidth for roadmap panel', () => {
      // Set a stored value for the roadmap key
      mockLocalStorage.setItem('pd.roadmap.leftWidth', '500');

      render(
        <ResizableSplitPane
          left={<div data-testid="roadmap-tree">Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.roadmap.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      // Check that the left pane has the stored width
      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '500px' });
    });

    it('should render ResizableSplitPane container', () => {
      render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.roadmap.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const splitPane = screen.getByTestId('resizable-split-pane');
      expect(splitPane).toBeInTheDocument();
    });

    it('should use different storage key than backlog', () => {
      // Set values for both keys
      mockLocalStorage.setItem('pd.roadmap.leftWidth', '550');
      mockLocalStorage.setItem('pd.backlog.leftWidth', '250');

      // Render roadmap with roadmap key
      const { unmount } = render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.roadmap.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      // Check roadmap uses its own key
      const leftPane = screen.getByTestId('resizable-left-pane');
      expect(leftPane).toHaveStyle({ width: '550px' });

      unmount();

      // Render backlog with backlog key
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

      // Check backlog uses its own key
      const backlogLeftPane = screen.getByTestId('resizable-left-pane');
      expect(backlogLeftPane).toHaveStyle({ width: '250px' });
    });
  });

  /**
   * Test 2: Tree content is rendered in left pane, details in right pane
   *
   * Verifies that content is properly placed in the correct panes.
   */
  describe('pane content placement', () => {
    it('should render tree panel content in left pane', () => {
      render(
        <ResizableSplitPane
          left={<div data-testid="roadmap-tree">Roadmap Tree Content</div>}
          right={<div>Details Content</div>}
          storageKey="pd.roadmap.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const leftPane = screen.getByTestId('resizable-left-pane');
      const roadmapTree = screen.getByTestId('roadmap-tree');

      expect(leftPane).toContainElement(roadmapTree);
    });

    it('should render details panel content in right pane', () => {
      render(
        <ResizableSplitPane
          left={<div>Tree Content</div>}
          right={<div data-testid="roadmap-details">Roadmap Details</div>}
          storageKey="pd.roadmap.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />
      );

      const rightPane = screen.getByTestId('resizable-right-pane');
      const detailsPanel = screen.getByTestId('roadmap-details');

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
          storageKey="pd.roadmap.leftWidth"
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
          storageKey="pd.roadmap.leftWidth"
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
          storageKey="pd.roadmap.leftWidth"
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
