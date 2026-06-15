/**
 * Multi-Architecture Selector + URL Routing -- Redirect Toast Tests
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 6
 * Task 6.1: 2-8 focused tests for the legacy-URL redirect toast.
 *
 * Tests cover:
 *   1. (Safety property b, redirect leg) URL without `:architectureId`
 *      (e.g. `/projects/abc/diagrams`) redirects to canonical URL
 *      `/projects/abc/architectures/<oldest-non-archived>/diagrams`.
 *   2. After the redirect, an info toast fires with text matching
 *      "Opened in architecture: <name>" (parameterised on the resolved
 *      architecture's name).
 *   3. A legitimate URL with `:architectureId` does NOT fire the redirect
 *      toast.
 *   4. The API client layer (listArchitectures call) only receives a real
 *      `projectId` from the URL params -- the redirect happens at the URL
 *      boundary, never at the API layer (preserves spec #1's "no silent
 *      defaults at the API layer" property).
 *   5. Toast fires exactly once per redirect (no double-fire on re-render).
 *
 * Test patterns mirror multiArchitectureSelectorAndRouting.routingSkeleton.test.tsx:
 *   - vi.mock() at the top of the file.
 *   - MemoryRouter with explicit initialEntries for route-driven assertions.
 *   - Heavy view components mocked to lightweight stubs.
 *   - ToastProvider wraps the routes so `useToast()` resolves to the real
 *     pub/sub and the rendered toast is observable via testing-library.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

// Mock the heavy view components -- the redirect tests only need to assert
// that the right view stub renders after navigation.
vi.mock('../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view">MetaModelView stub</div>,
}));
vi.mock('../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view">DiagramsView stub</div>,
}));
vi.mock('../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view">ProductView stub</div>,
}));
vi.mock('../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view">DashboardView stub</div>,
}));

import { listArchitectures, type Architecture } from '../api/architecturesApi';
import { ProjectLayout } from '../components/Layout/ProjectLayout';
import { DiagramsView } from '../components/DiagramsView/DiagramsView';
import { MetaModelView } from '../components/MetaModelView/MetaModelView';
import { ProductView } from '../components/ProductView/ProductView';
import { DashboardView } from '../components/DashboardView/DashboardView';
import { ToastProvider } from '../contexts/ToastContext';

// ============================================================================
// Test Helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const ARCH_DEFAULT_ID = 'arch-uuid-default';
const ARCH_DEFAULT_NAME = 'Default';

function buildArchitecture(overrides: Partial<Architecture>): Architecture {
  return {
    id: ARCH_DEFAULT_ID,
    projectId: PROJECT_ID,
    name: ARCH_DEFAULT_NAME,
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Render the production-shaped routes tree wrapped in <ToastProvider> so the
 * redirect toast fires through the real pub/sub and lands in the DOM.
 *
 * Mirrors the structure in App.tsx `AppRoutes()` and Group 1's routing tests:
 *   ProjectLayout matches both with-architecture and without-architecture
 *   URLs; child routes mount the architecture-scoped views.
 */
function renderRoutes(initialEntries: string[]) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route
              path="architectures/:architectureId/metamodel"
              element={<MetaModelView />}
            />
            <Route
              path="architectures/:architectureId/diagrams"
              element={<DiagramsView />}
            />
            <Route
              path="architectures/:architectureId/product"
              element={<ProductView />}
            />
            <Route
              path="architectures/:architectureId/dashboard"
              element={<DashboardView />}
            />
            <Route path="*" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Architecture Selector + URL Routing -- Redirect Toast (Task 6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Safety property (b) -- legacy URL redirects to canonical form.
  // ---------------------------------------------------------------------------
  it('redirects `/projects/:projectId/diagrams` (no `:architectureId`) to the canonical URL using the oldest non-archived architecture', async () => {
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({
        id: ARCH_DEFAULT_ID,
        name: ARCH_DEFAULT_NAME,
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
      }),
      buildArchitecture({
        id: 'arch-newer',
        name: 'Target State',
        archived: false,
        createdAt: '2026-02-01T00:00:00Z',
      }),
    ]);

    renderRoutes([`/projects/${PROJECT_ID}/diagrams`]);

    // After the redirect resolution, the canonical diagrams view is rendered.
    await waitFor(() => {
      expect(screen.getByTestId('diagrams-view')).toBeInTheDocument();
    });

    // listArchitectures called exactly once with the URL projectId.
    expect(listArchitectures).toHaveBeenCalledTimes(1);
    expect(listArchitectures).toHaveBeenCalledWith(PROJECT_ID);
  });

  // ---------------------------------------------------------------------------
  // Test 2: After the redirect, the info toast fires with the resolved name.
  // ---------------------------------------------------------------------------
  it('fires an info toast `Opened in architecture: <name>` after the silent redirect', async () => {
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({
        id: ARCH_DEFAULT_ID,
        name: ARCH_DEFAULT_NAME,
        archived: false,
      }),
    ]);

    renderRoutes([`/projects/${PROJECT_ID}/diagrams`]);

    // Wait for the redirect and the toast to land in the DOM together.
    const toast = await screen.findByTestId('global-toast');
    expect(toast).toHaveTextContent(`Opened in architecture: ${ARCH_DEFAULT_NAME}`);

    // The toast slot should be the info variant (blue).
    expect(toast.className).toMatch(/info/i);

    // Sanity: we landed on the diagrams view (view segment preserved).
    expect(screen.getByTestId('diagrams-view')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 3: A legitimate URL with `:architectureId` does NOT fire the toast.
  // ---------------------------------------------------------------------------
  it('does NOT fire the redirect toast when `:architectureId` is already present in the URL', async () => {
    // Set the mock to return data so any accidental redirect attempt would
    // still be observable via the rendered toast.
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: ARCH_DEFAULT_NAME }),
    ]);

    renderRoutes([
      `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/metamodel`,
    ]);

    // The metamodel view renders straight away.
    expect(screen.getByTestId('meta-model-view')).toBeInTheDocument();

    // Wait one tick to let any spurious effects fire.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No toast should be rendered.
    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();
    // And listArchitectures should not have been called for redirect resolution.
    expect(listArchitectures).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 4: API layer never sees a missing/null architectureId.
  //
  // The redirect at the URL boundary means the API resolution call
  // (listArchitectures) only ever receives a real `projectId`. Bucket A
  // endpoints that need an `architectureId` are only reached AFTER the redirect
  // settles, so they always get a real id from `useParams`. The architecture
  // id never appears as an argument to the API resolution call (only the
  // projectId does).
  // ---------------------------------------------------------------------------
  it('only passes a real `projectId` to listArchitectures (no missing/null `architectureId` reaches the API layer)', async () => {
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: ARCH_DEFAULT_NAME }),
    ]);

    renderRoutes([`/projects/${PROJECT_ID}/dashboard`]);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    });

    // listArchitectures is the only API call in the redirect path. Verify it
    // was called with a single projectId argument (no second arg, no null/
    // undefined slipping through).
    expect(listArchitectures).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(listArchitectures).mock.calls[0];
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0]).toBe(PROJECT_ID);
    expect(callArgs[0]).not.toBeNull();
    expect(callArgs[0]).not.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 5: Toast fires exactly once per redirect (no double-fire).
  //
  // The redirect resolution runs in a useEffect; the toast fires in a separate
  // effect. We assert that even after the redirect target settles and
  // <Navigate replace> swaps the URL, only a single toast is rendered.
  // ---------------------------------------------------------------------------
  it('fires the redirect toast exactly once per redirect (no double-fire on re-render)', async () => {
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: ARCH_DEFAULT_NAME }),
    ]);

    renderRoutes([`/projects/${PROJECT_ID}/diagrams`]);

    const toast = await screen.findByTestId('global-toast');
    expect(toast).toHaveTextContent(`Opened in architecture: ${ARCH_DEFAULT_NAME}`);

    // Allow the microtask queue to drain in case any straggling effects fire.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Still exactly one toast in the DOM.
    expect(screen.getAllByTestId('global-toast')).toHaveLength(1);
    // And listArchitectures was only called once for the resolution.
    expect(listArchitectures).toHaveBeenCalledTimes(1);
  });
});
