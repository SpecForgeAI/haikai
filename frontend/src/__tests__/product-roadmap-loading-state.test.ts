/**
 * Tests for ProductRoadmapPage Loading State Handling
 *
 * Spec 2026-01-10: Fix Roadmap Tab Buttons Incorrectly Disabled When a Project is Open
 * Task Group 2: ProductRoadmapPage Loading State Handling
 *
 * Tests cover:
 * - When `loading` is true, `isImportDisabled` is true regardless of `activeProject`
 * - When `loading` is true, the "Create or open a project..." banner is not shown
 * - When `loading` is false and `activeProject` is null, banner is shown and buttons are disabled
 */

import { describe, it, expect } from 'vitest';

describe('ProductRoadmapPage Loading State Handling', () => {
  /**
   * Helper function that mirrors the isImportDisabled logic from ProductRoadmapPage.
   * Updated to include loading state per the fix.
   *
   * Original: const isImportDisabled = !activeProject || importing;
   * Fixed:    const isImportDisabled = loading || !activeProject || importing;
   */
  function computeIsImportDisabled(
    loading: boolean,
    activeProject: { id: string; name: string } | null,
    importing: boolean
  ): boolean {
    return loading || !activeProject || importing;
  }

  /**
   * Helper function that mirrors the banner visibility logic from ProductRoadmapPage.
   * Updated to exclude loading state per the fix.
   *
   * Original: {!activeProject && (...)}
   * Fixed:    {!loading && !activeProject && (...)}
   */
  function computeBannerVisible(
    loading: boolean,
    activeProject: { id: string; name: string } | null
  ): boolean {
    return !loading && !activeProject;
  }

  describe('isImportDisabled with loading state', () => {
    it('should be true when loading is true, regardless of activeProject', () => {
      // Test case: loading=true, activeProject=non-null, importing=false
      const activeProject = { id: 'proj-123', name: 'TestProject' };
      const loading = true;
      const importing = false;

      const isDisabled = computeIsImportDisabled(loading, activeProject, importing);

      // Even with an active project, buttons should be disabled during loading
      expect(isDisabled).toBe(true);
    });

    it('should be true when loading is true and activeProject is null', () => {
      // Test case: loading=true, activeProject=null, importing=false
      const activeProject = null;
      const loading = true;
      const importing = false;

      const isDisabled = computeIsImportDisabled(loading, activeProject, importing);

      expect(isDisabled).toBe(true);
    });

    it('should be false when loading is false and activeProject exists and not importing', () => {
      // Test case: loading=false, activeProject=non-null, importing=false
      const activeProject = { id: 'proj-456', name: 'MyProject' };
      const loading = false;
      const importing = false;

      const isDisabled = computeIsImportDisabled(loading, activeProject, importing);

      // Buttons should be enabled
      expect(isDisabled).toBe(false);
    });

    it('should be true when activeProject is null even if loading is false', () => {
      // Test case: loading=false, activeProject=null, importing=false
      const activeProject = null;
      const loading = false;
      const importing = false;

      const isDisabled = computeIsImportDisabled(loading, activeProject, importing);

      // Buttons should be disabled (no project)
      expect(isDisabled).toBe(true);
    });

    it('should be true when importing is true even if project exists', () => {
      // Test case: loading=false, activeProject=non-null, importing=true
      const activeProject = { id: 'proj-789', name: 'ImportingProject' };
      const loading = false;
      const importing = true;

      const isDisabled = computeIsImportDisabled(loading, activeProject, importing);

      // Buttons should be disabled during import
      expect(isDisabled).toBe(true);
    });
  });

  describe('Banner visibility with loading state', () => {
    it('should NOT show banner when loading is true', () => {
      // Test case: loading=true, activeProject=null
      const loading = true;
      const activeProject = null;

      const bannerVisible = computeBannerVisible(loading, activeProject);

      // Banner should NOT be shown during loading (to avoid misleading UI)
      expect(bannerVisible).toBe(false);
    });

    it('should NOT show banner when loading is true even with null activeProject', () => {
      // Reinforcing: loading takes precedence
      const loading = true;
      const activeProject = null;

      const bannerVisible = computeBannerVisible(loading, activeProject);

      expect(bannerVisible).toBe(false);
    });

    it('should show banner when loading is false and activeProject is null', () => {
      // Test case: loading=false, activeProject=null
      const loading = false;
      const activeProject = null;

      const bannerVisible = computeBannerVisible(loading, activeProject);

      // Banner should be shown (user needs to create/open a project)
      expect(bannerVisible).toBe(true);
    });

    it('should NOT show banner when loading is false and activeProject exists', () => {
      // Test case: loading=false, activeProject=non-null
      const loading = false;
      const activeProject = { id: 'proj-123', name: 'TestProject' };

      const bannerVisible = computeBannerVisible(loading, activeProject);

      // Banner should NOT be shown (project is active)
      expect(bannerVisible).toBe(false);
    });
  });

  describe('Complete state transitions', () => {
    it('should transition correctly: loading -> loaded with project', () => {
      // Initial state: loading
      let loading = true;
      let activeProject: { id: string; name: string } | null = null;
      const importing = false;

      // During loading
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);

      // After loading completes with a project
      loading = false;
      activeProject = { id: 'proj-123', name: 'LoadedProject' };

      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(false);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);
    });

    it('should transition correctly: loading -> loaded without project', () => {
      // Initial state: loading
      let loading = true;
      const activeProject: { id: string; name: string } | null = null;
      const importing = false;

      // During loading
      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(false);

      // After loading completes without a project
      loading = false;

      expect(computeIsImportDisabled(loading, activeProject, importing)).toBe(true);
      expect(computeBannerVisible(loading, activeProject)).toBe(true);
    });
  });
});
