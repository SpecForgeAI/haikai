/**
 * Multi-Architecture Selector + URL Routing -- End-to-End / Gap-Fill Tests
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 7
 * Task 7.4: up to 10 strategic tests filling end-to-end gaps left by the
 * focused per-group tests in Groups 1-6.
 *
 * The per-group tests (each with 4-6 cases, 31 total) cover the five safety
 * properties at the unit level. This file fills the remaining gaps:
 *
 *   T1. Full pipeline: selector + URL + context + view all work together
 *       against a production-shaped Routes tree (combines Groups 2 + 3 + 4).
 *   T2. Same-view persistence across all four canonical view segments
 *       (extends the diagrams-only assertion in Group 5 test 1).
 *   T3. Empty-view toast fires for the metamodel view when its data is empty
 *       on switch (extends the diagrams-only Group 5 test 2 to a second view).
 *   T4. Empty-view toast fires for the product view when its data is empty
 *       on switch (extends the diagrams-only Group 5 test 2 to a third view).
 *   T5. Legacy-URL redirect chain is end-to-end across all four canonical
 *       view segments (extends Group 6 test 1 from /diagrams only).
 *   T6. Selector dropdown lookup -> click -> URL change -> view re-renders
 *       integrated with the architecture provider's `architectures` list
 *       being the data source for both the dropdown and the toast resolver
 *       (combines Groups 2 + 3 in one render).
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` at top of file.
 *   - <MemoryRouter> for route-driven assertions.
 *   - Heavy view components mocked to lightweight stubs that include data-attrs
 *     for the active architecture id read from useParams -- this is how we
 *     observe "the view re-rendered against the new architecture".
 *   - <ToastProvider> wraps everything so toasts are observable in the DOM.
 *   - Mocks for ProjectContext + listArchitectures are shared.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams, useLocation } from 'react-router-dom';

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

vi.mock('../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

// Render portals inline so the selector menu appears in the test DOM tree.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock heavy view components to lightweight stubs that surface the active
// architecture id from useParams. This is what makes "view re-rendered against
// new architecture" observable in the DOM.
vi.mock('../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => {
    const { architectureId } = useParams();
    return (
      <div data-testid="meta-model-view" data-arch-id={architectureId ?? ''}>
        MetaModelView arch={architectureId ?? '<none>'}
      </div>
    );
  },
}));
vi.mock('../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => {
    const { architectureId } = useParams();
    return (
      <div data-testid="diagrams-view" data-arch-id={architectureId ?? ''}>
        DiagramsView arch={architectureId ?? '<none>'}
      </div>
    );
  },
}));
vi.mock('../components/ProductView/ProductView', () => ({
  ProductView: () => {
    const { architectureId } = useParams();
    return (
      <div data-testid="product-view" data-arch-id={architectureId ?? ''}>
        ProductView arch={architectureId ?? '<none>'}
      </div>
    );
  },
}));
vi.mock('../components/DashboardView/DashboardView', () => ({
  DashboardView: () => {
    const { architectureId } = useParams();
    return (
      <div data-testid="dashboard-view" data-arch-id={architectureId ?? ''}>
        DashboardView arch={architectureId ?? '<none>'}
      </div>
    );
  },
}));

import { listArchitectures, type Architecture } from '../api/architecturesApi';
import { useProject } from '../contexts/ProjectContext';
import { ProjectLayout } from '../components/Layout/ProjectLayout';
import { DiagramsView } from '../components/DiagramsView/DiagramsView';
import { MetaModelView } from '../components/MetaModelView/MetaModelView';
import { ProductView } from '../components/ProductView/ProductView';
import { DashboardView } from '../components/DashboardView/DashboardView';
import { ToastProvider } from '../contexts/ToastContext';
import {
  ArchitectureProvider,
  useArchitectureContext,
  useArchitectureDispatch,
} from '../contexts/ArchitectureContext';
import { ArchitectureSelector } from '../components/TopBar/ArchitectureSelector';
import { useEmptyArchitectureToast } from '../hooks/useEmptyArchitectureToast';
import { emptyModel } from '../config/defaults';
import type { ArchitectureModel, Diagram } from '../types/model';

// ============================================================================
// Helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-7-4';
const ARCH_DEFAULT_ID = 'arch-uuid-default';
const ARCH_TARGET_ID = 'arch-uuid-target';

function buildArchitecture(overrides: Partial<Architecture>): Architecture {
  return {
    id: ARCH_DEFAULT_ID,
    projectId: PROJECT_ID,
    name: 'Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildProjectFixture() {
  return {
    id: PROJECT_ID,
    name: 'Gap-Fill Test Project',
    projectParentFolder: '/test',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function buildDiagram(id: string, name: string): Diagram {
  return {
    id,
    name,
    diagram_nodes: [],
    diagram_edges: [],
    decorations: [],
    label_decorations: [],
  } as unknown as Diagram;
}

function buildModel(opts: { withDiagram?: boolean; withApplication?: boolean; withBusinessProcess?: boolean } = {}): ArchitectureModel {
  const model: ArchitectureModel = JSON.parse(JSON.stringify(emptyModel));
  if (opts.withDiagram) model.diagrams.push(buildDiagram('d1', 'D1'));
  if (opts.withApplication) (model.metaModel.entities.applications as unknown[]).push({ id: 'a1', name: 'App' });
  if (opts.withBusinessProcess) (model.metaModel.entities.business_processes as unknown[]).push({ id: 'bp1', name: 'BP' });
  return model;
}

/**
 * Render the production-shaped routes tree wrapped in <ToastProvider> so
 * tests can observe both the URL-driven view rendering and any toast that
 * fires (redirect or empty-view).
 */
function renderRoutes(initialEntries: string[]) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route path="architectures/:architectureId/metamodel" element={<MetaModelView />} />
            <Route path="architectures/:architectureId/diagrams" element={<DiagramsView />} />
            <Route path="architectures/:architectureId/product" element={<ProductView />} />
            <Route path="architectures/:architectureId/dashboard" element={<DashboardView />} />
            <Route path="*" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

/**
 * Probe that mounts the empty-view toast effect plus a button that triggers
 * setActiveArchitecture(targetId) so a test can simulate the user clicking a
 * row in the selector. Used by the empty-view toast tests below.
 */
function ToastTriggerProbe({ targetId, model, fileName }: { targetId: string; model: ArchitectureModel; fileName: string }) {
  useEmptyArchitectureToast();
  const ctx = useArchitectureContext();
  const dispatch = useArchitectureDispatch();
  // Hotfix Bug 2 (2026-05-01): re-dispatch LOAD_MODEL on every
  // architectureId change so the destination model reference changes
  // (matching <AppShell>'s production behaviour). The fixed empty-view
  // toast hook waits for the model reference to change before evaluating
  // emptiness, so a probe that dispatches only once on mount would never
  // trigger the toast.
  React.useEffect(() => {
    if (!ctx.activeArchitectureId) return;
    // Deep clone so the reducer sees a NEW model reference, mirroring the
    // production case where each architecture's fetch returns a distinct
    // payload object.
    const fresh = JSON.parse(JSON.stringify(model)) as ArchitectureModel;
    dispatch({ type: 'LOAD_MODEL', payload: fresh, fileName });
  }, [dispatch, model, fileName, ctx.activeArchitectureId]);
  return (
    <>
      <div data-testid="architectures-count">{(ctx.architectures ?? []).length}</div>
      <button data-testid="switch-arch-button" onClick={() => ctx.setActiveArchitecture(targetId)}>
        switch
      </button>
    </>
  );
}

function PathnameProbe() {
  const loc = useLocation();
  return <div data-testid="probe-pathname">{loc.pathname}</div>;
}

/**
 * Render the architecture-scoped shell with the empty-view toast trigger
 * mounted, mirroring how AppShell wires it in production. The view route
 * matches the production tree so the trailing view segment drives which
 * useViewIsEmpty() rule applies.
 */
function renderShellForEmptyToast(opts: {
  initialPath: string;
  model: ArchitectureModel;
  targetArchId: string;
}) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[opts.initialPath]}>
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/*"
            element={
              <ArchitectureProvider>
                <ToastTriggerProbe
                  targetId={opts.targetArchId}
                  model={opts.model}
                  fileName="seed-fixture"
                />
                <PathnameProbe />
              </ArchitectureProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Architecture Selector + URL Routing -- E2E / Gap-Fill (Task 7.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: 'Default', createdAt: '2026-01-01T00:00:00Z' }),
      buildArchitecture({ id: ARCH_TARGET_ID, name: 'Target State', createdAt: '2026-02-01T00:00:00Z' }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // T1: Full pipeline -- selector renders with active id from URL, click row,
  // URL changes, context propagates, view re-renders against new architecture.
  // ---------------------------------------------------------------------------
  it('T1 full pipeline: selector reflects URL id, clicking a row updates URL + view re-renders against new architecture', async () => {
    render(
      <ToastProvider>
        <MemoryRouter
          initialEntries={[`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`]}
        >
          <Routes>
            <Route
              path="/projects/:projectId/architectures/:architectureId/*"
              element={
                <ArchitectureProvider>
                  <ArchitectureSelector />
                  <DiagramsView />
                  <PathnameProbe />
                </ArchitectureProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    // Initially: selector shows Default; the diagrams view is mounted with the
    // default architecture id.
    await waitFor(() => {
      expect(screen.getByTestId('architecture-selector-trigger')).toHaveTextContent('Default');
    });
    expect(screen.getByTestId('diagrams-view')).toHaveAttribute('data-arch-id', ARCH_DEFAULT_ID);
    expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`
    );

    // Open the dropdown, click the Target State row.
    act(() => {
      fireEvent.click(screen.getByTestId('architecture-selector-trigger'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId(`architecture-selector-row-${ARCH_TARGET_ID}`));
    });

    // URL changed; selector follows; view re-rendered with the new arch id.
    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/diagrams`
      );
    });
    expect(screen.getByTestId('architecture-selector-trigger')).toHaveTextContent('Target State');
    expect(screen.getByTestId('diagrams-view')).toHaveAttribute('data-arch-id', ARCH_TARGET_ID);
  });

  // ---------------------------------------------------------------------------
  // T2: Same-view persistence on switch across all four view segments.
  // Group 5 only covered /diagrams. Confirm the invariant holds for the other
  // three views as well.
  // ---------------------------------------------------------------------------
  it('T2 same-view persistence: switching architectures only changes :architectureId across all four canonical views', async () => {
    // Spec 2026-05-02 Task 7.4 -- consolidates the four-view sweep into a
    // single test (cap of 10 new tests for this group). Iterates through each
    // canonical view segment, mounts a fresh shell and asserts the swap.
    for (const view of ['metamodel', 'diagrams', 'product', 'dashboard'] as const) {
      const { unmount } = renderShellForEmptyToast({
        initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/${view}`,
        // Seed with non-empty model so the empty-view toast does not interfere.
        model: buildModel({ withDiagram: true, withBusinessProcess: true, withApplication: true }),
        targetArchId: ARCH_TARGET_ID,
      });

      await waitFor(() => {
        expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
      });

      act(() => {
        screen.getByTestId('switch-arch-button').click();
      });

      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/${view}`
      );

      unmount();
    }
  });

  // ---------------------------------------------------------------------------
  // T3: Empty-view toast on switch when target view is metamodel and empty.
  // ---------------------------------------------------------------------------
  it('T3 empty-view toast fires for the metamodel view when its data is empty on architecture switch', async () => {
    renderShellForEmptyToast({
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/metamodel`,
      // Empty model -- metamodel reads as empty.
      model: buildModel({}),
      targetArchId: ARCH_TARGET_ID,
    });

    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    const toast = await screen.findByTestId('global-toast');
    // Toast text is parameterised on the view label and architecture name.
    expect(toast).toHaveTextContent(/Architecture Target State has no/i);
    expect(toast).toHaveTextContent(/architecture/i);
  });

  // ---------------------------------------------------------------------------
  // T4: Empty-view toast on switch when target view is product and empty.
  // ---------------------------------------------------------------------------
  it('T4 empty-view toast fires for the product view when its data is empty on architecture switch', async () => {
    renderShellForEmptyToast({
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/product`,
      // Empty model -- product reads as empty (no business processes, journeys etc).
      model: buildModel({}),
      targetArchId: ARCH_TARGET_ID,
    });

    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    const toast = await screen.findByTestId('global-toast');
    expect(toast).toHaveTextContent(/Architecture Target State has no/i);
    expect(toast).toHaveTextContent(/product/i);
  });

  // ---------------------------------------------------------------------------
  // T5: Legacy-URL redirect chain is end-to-end across all four view segments.
  // Group 6 test 1 only covered /diagrams. Confirm the canonical URL for each
  // view segment redirects correctly.
  // ---------------------------------------------------------------------------
  it('T5 legacy URL redirect chain works for the metamodel, product, and dashboard view segments (extends Group 6 beyond /diagrams)', async () => {
    // Spec 2026-05-02 Task 7.4 -- consolidates a multi-view sweep into one test
    // to stay within the 10-new-test budget. Iterates the three view segments
    // not already covered by the Group 6 test (which exercises /diagrams).
    const cases: Array<[string, string]> = [
      ['metamodel', 'meta-model-view'],
      ['product', 'product-view'],
      ['dashboard', 'dashboard-view'],
    ];

    for (const [view, expectedTestId] of cases) {
      const { unmount } = renderRoutes([`/projects/${PROJECT_ID}/${view}`]);

      // After redirect resolves, the matching view stub renders with the
      // resolved (oldest non-archived) architecture id.
      await waitFor(() => {
        expect(screen.getByTestId(expectedTestId)).toBeInTheDocument();
      });
      expect(screen.getByTestId(expectedTestId)).toHaveAttribute('data-arch-id', ARCH_DEFAULT_ID);

      // Toast fires for the redirect.
      const toast = await screen.findByTestId('global-toast');
      expect(toast).toHaveTextContent('Opened in architecture: Default');

      unmount();
    }
  });

  // ---------------------------------------------------------------------------
  // T6: Bare /projects/:id (no view, no architecture) redirects to canonical
  // dashboard URL with the resolved architecture id. This is the worst-case
  // legacy URL: "I have a project bookmark with no view at all."
  // ---------------------------------------------------------------------------
  it('T6 bare /projects/:projectId (no view, no architecture) redirects to /architectures/<id>/dashboard', async () => {
    renderRoutes([`/projects/${PROJECT_ID}`]);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    });
    expect(screen.getByTestId('dashboard-view')).toHaveAttribute('data-arch-id', ARCH_DEFAULT_ID);

    const toast = await screen.findByTestId('global-toast');
    expect(toast).toHaveTextContent('Opened in architecture: Default');
  });

  // ---------------------------------------------------------------------------
  // T7 (Spec 2026-06-06): self-healing active architecture. When the URL carries
  // an architecture id that is NOT one of the project's non-archived
  // architectures (e.g. a stale id left over from a previously-active project
  // after a create/switch), the ArchitectureProvider auto-selects the project's
  // default (oldest non-archived) architecture so there is ALWAYS a valid active
  // architecture -- no "..."/"-" placeholder, no architecture-scoped action
  // running against nothing selected.
  // ---------------------------------------------------------------------------
  it('T7 self-healing: a stale/unknown active architecture id is replaced (in history) with the default (oldest non-archived), preserving the view', async () => {
    const STALE_ID = 'arch-uuid-stale-from-previous-project';
    render(
      <ToastProvider>
        <MemoryRouter
          initialEntries={[`/projects/${PROJECT_ID}/architectures/${STALE_ID}/dashboard`]}
        >
          <Routes>
            <Route
              path="/projects/:projectId/architectures/:architectureId/*"
              element={
                <ArchitectureProvider>
                  <ArchitectureSelector />
                  <PathnameProbe />
                </ArchitectureProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );

    // The guard replaces the unknown id with the default (oldest non-archived)
    // architecture, preserving the trailing view segment.
    await waitFor(() => {
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent(
        `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/dashboard`
      );
    });
    // ...and the selector now shows a real architecture name, not "..."/"-".
    expect(screen.getByTestId('architecture-selector-trigger')).toHaveTextContent('Default');
  });
});
