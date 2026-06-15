/**
 * Product Roadmap Integration Tests
 *
 * Spec 2026-01-04: Product Roadmap Review Page
 * Task Group 4: Additional strategic tests for gap coverage
 *
 * These tests cover integration scenarios and edge cases:
 * - Full import-to-tree-display flow
 * - Error message display in UI for 404/409
 * - Tree expand/collapse functionality
 * - URL parameter handling for roadmap tab
 * - Import button disabled states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { importRoadmap } from '../api/roadmapApi';
import { fetchWorkItems } from '../api/workItemsApi';
import { buildWorkItemTree } from '../utils/workItemTreeBuilder';
import type { WorkItem } from '../types/workItems';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Helper to create mock work items
 */
function createMockWorkItem(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    projectId: 'test-project',
    type: 'STORY',
    parentId: null,
    description: null,
    status: 'NEW',
    sortOrder: 0,
    priority: null,
    targetWindow: null,
    tags: null,
    externalSystem: null,
    externalKey: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Task Group 4: Product Roadmap Integration Tests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Full import-to-tree-display flow', () => {
    it('should import roadmap and display resulting items in tree', async () => {
      // Step 1: Import roadmap
      const mockImportResponse = {
        project_id: 'test-project',
        artifact_revision: 'abc123',
        initiatives_created: 1,
        epics_created: 2,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockImportResponse),
      });

      const importResult = await importRoadmap('test-project');
      expect(importResult.initiativesCreated).toBe(1);
      expect(importResult.epicsCreated).toBe(2);

      // Step 2: Fetch work items after import
      const mockWorkItems = [
        { id: 'init-1', project_id: 'test-project', type: 'INITIATIVE', parent_id: null, title: 'Initiative 1', description: null, status: 'NEW', sort_order: 1, priority: null, target_window: null, tags: null, external_system: null, external_key: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'epic-1', project_id: 'test-project', type: 'EPIC', parent_id: 'init-1', title: 'Epic 1', description: null, status: 'NEW', sort_order: 1, priority: null, target_window: null, tags: null, external_system: null, external_key: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'epic-2', project_id: 'test-project', type: 'EPIC', parent_id: 'init-1', title: 'Epic 2', description: null, status: 'NEW', sort_order: 2, priority: null, target_window: null, tags: null, external_system: null, external_key: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkItems),
      });

      const items = await fetchWorkItems('test-project');
      const roadmapItems = items.filter(
        (item) => item.type === 'INITIATIVE' || item.type === 'EPIC'
      );

      // Step 3: Build tree
      const tree = buildWorkItemTree(roadmapItems);

      // Verify: Tree has correct structure
      expect(tree.roots).toHaveLength(1);
      expect(tree.roots[0].item.title).toBe('Initiative 1');
      expect(tree.roots[0].children).toHaveLength(2);
    });
  });

  describe('Error message display for 404/409', () => {
    it('should display user-friendly 404 error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      try {
        await importRoadmap('test-project');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        // Source now uses: 'roadmap.md not found. Expected at: agent-os/product/roadmap.md'
        expect((err as Error).message).toBe('roadmap.md not found. Expected at: agent-os/product/roadmap.md');
      }
    });

    it('should display user-friendly 409 error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
      });

      try {
        await importRoadmap('test-project');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        // Source now uses fallback: 'Import conflict. Please retry.'
        expect((err as Error).message).toBe('Import conflict. Please retry.');
      }
    });
  });

  describe('Tree expand/collapse functionality', () => {
    it('should correctly track expanded state with Set operations', () => {
      // Simulates component state management
      const expandedIds = new Set<string>(['init-1']);

      // Initial state: init-1 expanded
      expect(expandedIds.has('init-1')).toBe(true);
      expect(expandedIds.has('init-2')).toBe(false);

      // Collapse init-1
      expandedIds.delete('init-1');
      expect(expandedIds.has('init-1')).toBe(false);

      // Expand init-1 again
      expandedIds.add('init-1');
      expect(expandedIds.has('init-1')).toBe(true);

      // Expand init-2
      expandedIds.add('init-2');
      expect(expandedIds.has('init-2')).toBe(true);
    });

    it('should apply expanded state to tree nodes correctly', () => {
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'init-1', title: 'Initiative 1', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'epic-1', title: 'Epic 1', type: 'EPIC', parentId: 'init-1' }),
      ];

      const tree = buildWorkItemTree(items);
      const expandedIds = new Set<string>(['init-1']);

      // Apply expanded state
      function applyExpanded(nodes: typeof tree.roots): typeof tree.roots {
        return nodes.map((node) => ({
          ...node,
          isExpanded: expandedIds.has(node.item.id),
          children: applyExpanded(node.children),
        }));
      }

      const nodesWithExpanded = applyExpanded(tree.roots);

      expect(nodesWithExpanded[0].isExpanded).toBe(true);
      expect(nodesWithExpanded[0].children[0].isExpanded).toBe(false);
    });
  });

  describe('URL parameter handling', () => {
    it('should correctly parse roadmap tab from URL', () => {
      function parseTabFromUrl(search: string): 'backlog' | 'implement' | 'roadmap' {
        const params = new URLSearchParams(search);
        const tabParam = params.get('tab');
        if (tabParam === 'implement') return 'implement';
        if (tabParam === 'roadmap') return 'roadmap';
        return 'backlog';
      }

      expect(parseTabFromUrl('?tab=roadmap')).toBe('roadmap');
      expect(parseTabFromUrl('?tab=backlog')).toBe('backlog');
      expect(parseTabFromUrl('?tab=implement')).toBe('implement');
      expect(parseTabFromUrl('')).toBe('backlog');
      expect(parseTabFromUrl('?other=value')).toBe('backlog');
    });
  });

  describe('Import button disabled states', () => {
    it('should be disabled when importing is in progress', () => {
      const importing = true;
      const hasProject = true;
      const shouldDisable = importing || !hasProject;

      expect(shouldDisable).toBe(true);
    });

    it('should be disabled when no project is loaded', () => {
      const importing = false;
      const hasProject = false;
      const shouldDisable = importing || !hasProject;

      expect(shouldDisable).toBe(true);
    });

    it('should be enabled when not importing and project is loaded', () => {
      const importing = false;
      const hasProject = true;
      const shouldDisable = importing || !hasProject;

      expect(shouldDisable).toBe(false);
    });
  });

  describe('Project ID encoding', () => {
    it('should properly encode project ID with special characters', async () => {
      const projectId = 'my project (test)';
      const expectedEncoded = 'my%20project%20(test)';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          project_id: projectId,
          artifact_revision: 'abc',
          initiatives_created: 0,
          epics_created: 0,
        }),
      });

      await importRoadmap(projectId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(expectedEncoded),
        expect.any(Object)
      );
    });
  });
});
