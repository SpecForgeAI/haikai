/**
 * Dashboard UX Improvements -- Task Group 4 Tests
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 4
 * Task 4.1 / 4.6: 4 focused tests for skeleton and navigation changes
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7 (Task 7.3)
 * Mechanical updates for the SET_VIEW removal:
 *  - state.currentView no longer exists. The "default view is dashboard" check
 *    is replaced with a URL-driven assertion: useCurrentView returns 'dashboard'
 *    when the URL ends in /dashboard, mirroring how the URL-driven router
 *    determines the active view post-spec.
 *  - The skeleton + snapshot tests are unaffected; they don't touch state.
 *
 * Tests:
 * 1. DashboardSkeleton renders two sub-section groups (Product with 2 skeleton cards, Technical with 3 skeleton cards)
 * 2. DashboardSkeleton no longer uses .strategicGrid CSS class
 * 3. useCurrentView reports 'dashboard' when the URL is the canonical dashboard route
 * 4. DashboardSkeleton snapshot matches updated structure
 *
 * Mocks: CSS module with Proxy identity mapping
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock CSS module to return identity mapping (same pattern as existing dashboard tests)
vi.mock('../components/DashboardView/DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, prop) => String(prop),
  }),
}));

import { DashboardSkeleton } from '../components/DashboardView/DashboardSkeleton';
import { useCurrentView } from '../hooks/useCurrentView';

// ============================================================================
// Tests
// ============================================================================

describe('Dashboard UX Improvements - Task Group 4', () => {

  describe('DashboardSkeleton sub-section groups', () => {

    it('renders two sub-section groups: Product with 2 skeleton cards and Technical with 3 skeleton cards', () => {
      const { container } = render(<DashboardSkeleton />);

      // Find all sub-section groups
      const subSectionGroups = container.querySelectorAll('.subSectionGroup');
      expect(subSectionGroups.length).toBe(2);

      // First sub-section: Product with 2 cards
      const productGroup = subSectionGroups[0];
      const productLabel = productGroup.querySelector('.subSectionGroupLabel');
      expect(productLabel).not.toBeNull();
      expect(productLabel!.textContent).toBe('Product');
      const productCards = productGroup.querySelectorAll('.skeletonCard');
      expect(productCards.length).toBe(2);

      // Second sub-section: Technical with 3 cards
      const technicalGroup = subSectionGroups[1];
      const technicalLabel = technicalGroup.querySelector('.subSectionGroupLabel');
      expect(technicalLabel).not.toBeNull();
      expect(technicalLabel!.textContent).toBe('Technical');
      const technicalCards = technicalGroup.querySelectorAll('.skeletonCard');
      expect(technicalCards.length).toBe(3);
    });

    it('does not use .strategicGrid CSS class', () => {
      const { container } = render(<DashboardSkeleton />);

      // Ensure no element has the strategicGrid class
      const strategicGrid = container.querySelector('.strategicGrid');
      expect(strategicGrid).toBeNull();
    });

  });

  describe('Default view navigation', () => {
    // Spec 2026-05-02: state.currentView removed; the equivalent invariant is
    // that useCurrentView returns 'dashboard' for the canonical dashboard URL.
    it('useCurrentView returns "dashboard" for the canonical dashboard URL', () => {
      let capturedView: string | null = null;
      function ViewCapture() {
        capturedView = useCurrentView();
        return null;
      }

      render(
        <MemoryRouter
          initialEntries={['/projects/proj-1/architectures/arch-1/dashboard']}
        >
          <Routes>
            <Route
              path="/projects/:projectId/architectures/:architectureId/*"
              element={<ViewCapture />}
            />
          </Routes>
        </MemoryRouter>
      );

      expect(capturedView).toBe('dashboard');
    });

  });

  describe('DashboardSkeleton snapshot', () => {

    it('snapshot matches updated structure with Product and Technical sub-sections', () => {
      render(<DashboardSkeleton />);
      const element = screen.getByTestId('dashboard-skeleton');
      expect(element).toMatchSnapshot();
    });

  });

});
