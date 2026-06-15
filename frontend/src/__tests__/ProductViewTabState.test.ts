/**
 * ProductView Tab State Tests
 * Spec 2026-01-10: Preserve Implement Tab State Across Product & Delivery Tab Switches
 * Task Group 2: Tests for ProductView tab switch state behavior
 *
 * Tests for ProductView component's integration with ProductUiStateContext
 * for preserving work item ID across tab switches.
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode, useState, useCallback, useMemo } from 'react';
import {
  ProductUiStateProvider,
  useProductUiState,
  deriveProjectKey,
} from '../contexts/ProductUiStateContext';

/**
 * Helper wrapper component for testing hooks within provider
 */
function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ProductUiStateProvider, null, children);
  };
}

/**
 * Simulate ProductView's tab handling logic
 * This hook mimics the core logic of handleWorkOnThis and handleTabChange
 * as implemented in ProductView.tsx
 */
function useProductViewTabLogic(loadedFileName: string | null) {
  const projectKey = deriveProjectKey(loadedFileName);
  const context = useProductUiState();

  // Local state similar to ProductView
  const [activeTab, setActiveTab] = useState<'backlog' | 'implement' | 'roadmap'>('backlog');
  const [urlWorkItemId, setUrlWorkItemId] = useState<string | null>(null);

  // Simulate handleWorkOnThis - navigates to implement with a work item
  const handleWorkOnThis = useCallback((itemId: string) => {
    setUrlWorkItemId(itemId);
    setActiveTab('implement');
    // Store the work item ID in context
    if (projectKey) {
      context.setLastImplementWorkItemId(projectKey, itemId);
    }
  }, [context, projectKey]);

  // Simulate handleTabChange - switches tab without URL work item
  const handleTabChange = useCallback((tab: 'backlog' | 'implement' | 'roadmap') => {
    setActiveTab(tab);
    if (tab !== 'implement') {
      // Clear URL work item when leaving implement, but DON'T clear context
      setUrlWorkItemId(null);
    }
  }, []);

  // Compute effective work item ID when on implement tab
  const effectiveWorkItemId = useMemo(() => {
    if (activeTab !== 'implement') {
      return null;
    }
    // URL takes precedence, then fall back to context
    if (urlWorkItemId) {
      return urlWorkItemId;
    }
    if (projectKey) {
      return context.getLastImplementWorkItemId(projectKey);
    }
    return null;
  }, [activeTab, urlWorkItemId, context, projectKey]);

  return {
    activeTab,
    urlWorkItemId,
    effectiveWorkItemId,
    handleWorkOnThis,
    handleTabChange,
    projectKey,
  };
}

describe('ProductView Tab State Behavior', () => {
  /**
   * Test 1: handleWorkOnThis stores workItemId via setLastImplementWorkItemId
   */
  describe('handleWorkOnThis stores workItemId', () => {
    it('should store work item ID in context when navigating to implement', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogic('test-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Simulate clicking "Work on this" in backlog
      act(() => {
        result.current.tabLogic.handleWorkOnThis('work-item-123');
      });

      // Verify the work item ID is stored in context
      expect(result.current.context.getLastImplementWorkItemId('test-project.json')).toBe('work-item-123');
      // Verify tab switched to implement
      expect(result.current.tabLogic.activeTab).toBe('implement');
      // Verify URL work item is set
      expect(result.current.tabLogic.urlWorkItemId).toBe('work-item-123');
    });

    it('should update stored work item ID when navigating to different work item', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogic('my-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Navigate to first work item
      act(() => {
        result.current.tabLogic.handleWorkOnThis('item-1');
      });
      expect(result.current.context.getLastImplementWorkItemId('my-project.json')).toBe('item-1');

      // Navigate to second work item
      act(() => {
        result.current.tabLogic.handleWorkOnThis('item-2');
      });
      expect(result.current.context.getLastImplementWorkItemId('my-project.json')).toBe('item-2');
    });
  });

  /**
   * Test 2: Tab switch to Backlog/Roadmap does NOT clear stored lastImplementWorkItemId
   */
  describe('tab switch preserves lastImplementWorkItemId', () => {
    it('should preserve stored work item ID when switching to Backlog', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogic('project-alpha.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Navigate to implement with a work item
      act(() => {
        result.current.tabLogic.handleWorkOnThis('preserved-item');
      });

      // Switch to backlog
      act(() => {
        result.current.tabLogic.handleTabChange('backlog');
      });

      // URL work item should be cleared
      expect(result.current.tabLogic.urlWorkItemId).toBeNull();
      // But context should still have the stored work item ID
      expect(result.current.context.getLastImplementWorkItemId('project-alpha.json')).toBe('preserved-item');
    });

    it('should preserve stored work item ID when switching to Roadmap', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogic('project-beta.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Navigate to implement with a work item
      act(() => {
        result.current.tabLogic.handleWorkOnThis('roadmap-preserved-item');
      });

      // Switch to roadmap
      act(() => {
        result.current.tabLogic.handleTabChange('roadmap');
      });

      // URL work item should be cleared
      expect(result.current.tabLogic.urlWorkItemId).toBeNull();
      // But context should still have the stored work item ID
      expect(result.current.context.getLastImplementWorkItemId('project-beta.json')).toBe('roadmap-preserved-item');
    });

    it('should preserve stored work item ID through multiple tab switches', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogic('multi-switch-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Navigate to implement with a work item
      act(() => {
        result.current.tabLogic.handleWorkOnThis('persistent-item');
      });

      // Switch through multiple tabs
      act(() => {
        result.current.tabLogic.handleTabChange('backlog');
      });
      act(() => {
        result.current.tabLogic.handleTabChange('roadmap');
      });
      act(() => {
        result.current.tabLogic.handleTabChange('backlog');
      });

      // Context should still have the stored work item ID
      expect(result.current.context.getLastImplementWorkItemId('multi-switch-project.json')).toBe('persistent-item');
    });
  });

  /**
   * Test 3: Entering Implement tab with null URL workItemId resolves from getLastImplementWorkItemId
   */
  describe('effectiveWorkItemId resolution from context', () => {
    it('should resolve effectiveWorkItemId from context when URL is null', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogic('resolve-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // First, navigate via handleWorkOnThis to set up stored state
      act(() => {
        result.current.tabLogic.handleWorkOnThis('stored-item');
      });

      // Switch away from implement
      act(() => {
        result.current.tabLogic.handleTabChange('backlog');
      });

      // Verify URL work item is cleared
      expect(result.current.tabLogic.urlWorkItemId).toBeNull();

      // Switch back to implement via tab click (not handleWorkOnThis)
      act(() => {
        result.current.tabLogic.handleTabChange('implement');
      });

      // effectiveWorkItemId should resolve from context
      expect(result.current.tabLogic.effectiveWorkItemId).toBe('stored-item');
    });
  });

  /**
   * Test 4: Entering Implement with URL workItemId uses URL value (URL takes precedence)
   */
  describe('URL workItemId takes precedence', () => {
    it('should use URL workItemId when both URL and context have values', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogic('precedence-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // First, navigate to one work item
      act(() => {
        result.current.tabLogic.handleWorkOnThis('context-item');
      });

      // Now navigate to a different work item via handleWorkOnThis
      act(() => {
        result.current.tabLogic.handleWorkOnThis('url-item');
      });

      // Both URL and effective should be the URL item
      expect(result.current.tabLogic.urlWorkItemId).toBe('url-item');
      expect(result.current.tabLogic.effectiveWorkItemId).toBe('url-item');
    });
  });

  /**
   * Test 5: Entering Implement with no stored state shows empty state (effectiveWorkItemId is null)
   */
  describe('empty state when no stored work item', () => {
    it('should return null effectiveWorkItemId when no stored state exists', () => {
      const { result } = renderHook(
        () => ({
          tabLogic: useProductViewTabLogic('empty-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Switch directly to implement without ever using handleWorkOnThis
      act(() => {
        result.current.tabLogic.handleTabChange('implement');
      });

      // effectiveWorkItemId should be null
      expect(result.current.tabLogic.effectiveWorkItemId).toBeNull();
    });

    it('should return null effectiveWorkItemId when no project is loaded', () => {
      const { result } = renderHook(
        () => ({
          tabLogic: useProductViewTabLogic(null),
        }),
        { wrapper: createWrapper() }
      );

      // Switch to implement with no project loaded
      act(() => {
        result.current.tabLogic.handleTabChange('implement');
      });

      // effectiveWorkItemId should be null
      expect(result.current.tabLogic.effectiveWorkItemId).toBeNull();
      // projectKey should be empty string
      expect(result.current.tabLogic.projectKey).toBe('');
    });
  });

  /**
   * Test: Project isolation - different projects have different stored work items
   */
  describe('project isolation', () => {
    it('should isolate stored work item IDs between different projects', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
        }),
        { wrapper: createWrapper() }
      );

      // Store work item for project A
      act(() => {
        result.current.context.setLastImplementWorkItemId('project-a.json', 'item-from-a');
      });

      // Store work item for project B
      act(() => {
        result.current.context.setLastImplementWorkItemId('project-b.json', 'item-from-b');
      });

      // Verify isolation
      expect(result.current.context.getLastImplementWorkItemId('project-a.json')).toBe('item-from-a');
      expect(result.current.context.getLastImplementWorkItemId('project-b.json')).toBe('item-from-b');
    });
  });
});
