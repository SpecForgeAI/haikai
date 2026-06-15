/**
 * DashboardSkeleton Component Tests
 *
 * Spec 2026-02-18: Dashboard Increment 6 -- Task Group 4
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 4 (updated sub-section structure)
 * Task 4.4: Updated assertions for new Product (2 cards) + Technical (3 cards) sub-section layout.
 *
 * Tests:
 * 1. Renders correct number of skeleton cards (11: 2 Product + 3 Technical + 3 Pre-Coding + 3 Post-Coding)
 * 2. Renders header bar skeleton
 * 3. Renders scope bar and section heading skeletons
 * 4. Snapshot test
 *
 * Mocks: CSS module with Proxy identity mapping
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock CSS module to return identity mapping (same pattern as existing dashboard tests)
vi.mock('../components/DashboardView/DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, prop) => String(prop),
  }),
}));

import { DashboardSkeleton } from '../components/DashboardView/DashboardSkeleton';

// ============================================================================
// Tests
// ============================================================================

describe('DashboardSkeleton Component', () => {

  it('renders correct number of skeleton cards (11: 2 Product + 3 Technical + 3 Pre-Coding + 3 Post-Coding)', () => {
    const { container } = render(<DashboardSkeleton />);
    const skeletonCards = container.querySelectorAll('.skeletonCard');
    expect(skeletonCards.length).toBe(11);
  });

  it('renders header bar skeleton', () => {
    const { container } = render(<DashboardSkeleton />);
    const headerBar = container.querySelector('.skeletonHeaderBar');
    expect(headerBar).not.toBeNull();
  });

  it('renders scope bar and section heading skeletons', () => {
    const { container } = render(<DashboardSkeleton />);
    const scopeBar = container.querySelector('.skeletonScopeBar');
    expect(scopeBar).not.toBeNull();
    const sectionHeadings = container.querySelectorAll('.skeletonSectionHeading');
    expect(sectionHeadings.length).toBe(4);
  });

  it('renders two sub-section groups with correct labels', () => {
    const { container } = render(<DashboardSkeleton />);
    const subSectionGroups = container.querySelectorAll('.subSectionGroup');
    expect(subSectionGroups.length).toBe(2);

    const labels = container.querySelectorAll('.subSectionGroupLabel');
    expect(labels.length).toBe(2);
    expect(labels[0].textContent).toBe('Product');
    expect(labels[1].textContent).toBe('Technical');
  });

  it('snapshot test', () => {
    render(<DashboardSkeleton />);
    const element = screen.getByTestId('dashboard-skeleton');
    expect(element).toMatchSnapshot();
  });

});
