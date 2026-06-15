/**
 * DashboardView Component Tests
 *
 * Spec 2026-02-17: Dashboard Increment 1 -- Task Group 2
 * Task 2.1: 3 focused tests for the DashboardView component.
 *
 * UPDATED for Increment 3: The placeholder component has been completely rewritten
 * into a full data-driven dashboard layout. The original placeholder elements
 * (<h1>Dashboard</h1>, <p>Project delivery overview (coming soon).</p>) no longer
 * exist. These tests have been updated to validate the surviving Increment 1
 * contract -- specifically, the data-testid="dashboard-view" attribute and the
 * empty-state behavior when no project is selected.
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed PersonaPanelContext mock (context deleted)
 *
 * Tests:
 * 1. Verify DashboardView renders a container with data-testid="dashboard-view".
 * 2. Verify the component renders empty-state text when no project is selected.
 * 3. Verify the container uses the .container CSS class for layout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils/renderWithProviders';

// ============================================================================
// Mock setup (required because the rewritten DashboardView uses context hooks)
// ============================================================================

let mockActiveProject: { id: string; name: string } | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../api/dashboardApi', () => ({
  getDashboardSummary: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../components/DashboardView/DashboardView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ============================================================================
// Tests
// ============================================================================

let DashboardView: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockActiveProject = null;
  const mod = await import('../components/DashboardView/DashboardView');
  DashboardView = mod.DashboardView;
});

describe('Task Group 2: DashboardView Placeholder Component (Updated for Inc 3 Rewrite)', () => {
  it('Test 1: renders a container with data-testid="dashboard-view"', () => {
    renderWithRouter(<DashboardView />);
    const container = screen.getByTestId('dashboard-view');
    expect(container).toBeInTheDocument();
  });

  it('Test 2: renders empty-state text when no project is selected', () => {
    mockActiveProject = null;
    renderWithRouter(<DashboardView />);
    expect(screen.getByText('Select a project to view the dashboard.')).toBeInTheDocument();
  });

  it('Test 3: container div has the container CSS class applied', () => {
    renderWithRouter(<DashboardView />);
    const container = screen.getByTestId('dashboard-view');
    expect(container.className).toContain('container');
  });
});
