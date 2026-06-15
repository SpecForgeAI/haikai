/**
 * Multi-Architecture Selector + URL Routing -- Empty-View Toast Tests
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 5
 *
 * Hotfix 2026-05-01 Empty-View Toast Refers to Wrong Architecture (Bug 2)
 * Updated to reflect the corrected behaviour: the toast must defer
 * emptiness evaluation until AFTER the destination architecture's model
 * has been loaded (LOAD_MODEL dispatched). The previous implementation
 * evaluated against the model that was still in state from the source
 * architecture, producing two visible bugs:
 *   - A (non-empty) -> B (empty): no toast appeared because state.model
 *     was still A.
 *   - B (empty) -> A (non-empty): a toast incorrectly appeared because
 *     state.model was still B.
 * The tests now use an `ArchitectureAwareLoadModelProbe` that mirrors
 * <AppShell>'s behaviour by dispatching a per-architecture LOAD_MODEL
 * whenever activeArchitectureId changes.
 *
 * Tests:
 *   1. (Safety property d, part 1) Switching architectures keeps the user on
 *      the same view -- /.../diagrams stays /.../diagrams; only the
 *      :architectureId segment changes.
 *   2. (Safety property d, part 2) Switching to an architecture whose target
 *      view is empty fires the empty-view info toast: "Architecture <name>
 *      has no diagrams yet".
 *   3. Switching to an architecture whose target view is non-empty does NOT
 *      fire the empty-view toast.
 *   4. Dashboard is always treated as non-empty -- switching to the same
 *      project on dashboard never fires the toast.
 *   5. Initial mount does NOT fire the toast (only genuine architecture-id
 *      changes trigger it).
 *   6. Per-view useViewIsEmpty pure functions return the expected boolean
 *      for empty vs non-empty fixtures (metamodel, diagrams, product).
 *   7. (Hotfix Bug 2) Move B (empty) -> A (non-empty): no toast (the
 *      destination is non-empty even though the source was empty).
 */

import React, { ReactNode, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

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

import { listArchitectures, type Architecture } from '../api/architecturesApi';
import { useProject } from '../contexts/ProjectContext';
import {
  ArchitectureProvider,
  useArchitectureContext,
  useArchitectureDispatch,
} from '../contexts/ArchitectureContext';
import { ToastProvider } from '../contexts/ToastContext';
import { useEmptyArchitectureToast } from '../hooks/useEmptyArchitectureToast';
import {
  isMetaModelEmpty,
  isDiagramsEmpty,
  isProductEmpty,
} from '../hooks/useViewIsEmpty';
import { emptyModel } from '../config/defaults';
import type { ArchitectureModel, Diagram } from '../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-empty-toast';
const ARCH_DEFAULT_ID = 'arch-default-uuid';
const ARCH_TARGET_ID = 'arch-target-uuid';

function buildArchitecture(overrides: Partial<Architecture>): Architecture {
  return {
    id: 'arch-default',
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
    name: 'Empty Toast Test Project',
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

/**
 * Build an ArchitectureModel with a configurable subset of populated entities
 * / diagrams. By default everything is empty (deep-cloned from emptyModel so
 * tests can mutate without polluting one another).
 */
function buildModel(opts: {
  withDiagram?: boolean;
  withApplication?: boolean;
  withBusinessProcess?: boolean;
} = {}): ArchitectureModel {
  // Deep-clone emptyModel so tests stay isolated.
  const model: ArchitectureModel = JSON.parse(JSON.stringify(emptyModel));
  if (opts.withDiagram) {
    model.diagrams.push(buildDiagram('d1', 'D1'));
  }
  if (opts.withApplication) {
    (model.metaModel.entities.applications as unknown[]).push({
      id: 'app1',
      name: 'App',
    });
  }
  if (opts.withBusinessProcess) {
    (model.metaModel.entities.business_processes as unknown[]).push({
      id: 'bp1',
      name: 'BP',
    });
  }
  return model;
}

/**
 * Probe that mounts the empty-view toast hook so a test can drive
 * architecture switches.
 */
function ToastTriggerProbe() {
  useEmptyArchitectureToast();
  return null;
}

/**
 * Hotfix Bug 2: probe that mirrors <AppShell>'s auto-load behaviour by
 * dispatching a fresh LOAD_MODEL whenever the active architecture id
 * changes. Each architecture id maps to its own model fixture, so the
 * destination model genuinely "loads" after a switch -- which is what the
 * fixed empty-view toast hook waits for before evaluating emptiness.
 *
 * Pass the per-architecture model map; the probe picks the right one based
 * on the current activeArchitectureId from context.
 */
function ArchitectureAwareLoadModelProbe({
  modelByArchId,
  fileName,
}: {
  modelByArchId: Record<string, ArchitectureModel>;
  fileName: string;
}) {
  const dispatch = useArchitectureDispatch();
  const { activeArchitectureId } = useArchitectureContext();
  useEffect(() => {
    if (!activeArchitectureId) return;
    const model = modelByArchId[activeArchitectureId];
    if (!model) return;
    dispatch({ type: 'LOAD_MODEL', payload: model, fileName });
  }, [activeArchitectureId, modelByArchId, dispatch, fileName]);
  return null;
}

/**
 * Probe that exposes the active architecture id and a button that calls
 * setActiveArchitecture(id) so the test can simulate the user clicking a row
 * in the architecture selector. Also exposes the architectures-loaded count
 * so tests can wait for the async listArchitectures call to resolve before
 * triggering the switch (the toast looks up the architecture name from this
 * list).
 */
function SwitchProbe({ targetArchId }: { targetArchId: string }) {
  const ctx = useArchitectureContext();
  return (
    <>
      <div data-testid="architectures-count">
        {(ctx.architectures ?? []).length}
      </div>
      <button
        type="button"
        data-testid="switch-arch-button"
        onClick={() => ctx.setActiveArchitecture(targetArchId)}
      >
        switch
      </button>
    </>
  );
}

function PathnameProbe() {
  const loc = useLocation();
  return <div data-testid="current-pathname">{loc.pathname}</div>;
}

/**
 * Render the architecture-scoped scaffolding inside MemoryRouter +
 * ToastProvider + ArchitectureProvider. Mirrors the production wiring closely
 * enough that the hook under test sees a real architecture id from useParams.
 *
 * Hotfix Bug 2: tests now provide a per-architecture model map. The probe
 * dispatches LOAD_MODEL with the matching model whenever the active arch
 * id changes, mirroring <AppShell>'s behaviour and exercising the fixed
 * deferred-evaluation logic in `useEmptyArchitectureToast`.
 */
function renderArchitectureShell(opts: {
  initialPath: string;
  modelByArchId: Record<string, ArchitectureModel>;
  targetArchId: string;
  children?: ReactNode;
}) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[opts.initialPath]}>
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/*"
            element={
              <ArchitectureProvider>
                <ArchitectureAwareLoadModelProbe
                  modelByArchId={opts.modelByArchId}
                  fileName="seed-fixture"
                />
                <ToastTriggerProbe />
                <SwitchProbe targetArchId={opts.targetArchId} />
                <PathnameProbe />
                {opts.children}
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

describe('Multi-Architecture Selector + URL Routing -- Empty-View Toast (Task 5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitecture({ id: ARCH_DEFAULT_ID, name: 'Default' }),
      buildArchitecture({
        id: ARCH_TARGET_ID,
        name: 'Empty Target',
        createdAt: '2026-02-01T00:00:00Z',
      }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1 (Safety property d, part 1): same-view persistence on switch.
  // ---------------------------------------------------------------------------
  it('safety property (d) part 1: switching architectures stays on the same view -- only :architectureId changes', () => {
    renderArchitectureShell({
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      // Seed each arch with the same fixture so the URL assertion is the
      // only thing being measured here.
      modelByArchId: {
        [ARCH_DEFAULT_ID]: buildModel({ withApplication: true }),
        [ARCH_TARGET_ID]: buildModel({ withApplication: true }),
      },
      targetArchId: ARCH_TARGET_ID,
    });

    expect(screen.getByTestId('current-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`
    );

    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    expect(screen.getByTestId('current-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/diagrams`
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2 (Safety property d, part 2): switching to an empty target view
  // fires the info toast.
  //
  // Hotfix Bug 2: the source arch is now NON-empty (has a diagram) and the
  // destination arch is EMPTY -- the previous implementation produced no
  // toast in this scenario because it evaluated emptiness against the
  // source model. The fixed implementation defers evaluation to after the
  // destination LOAD_MODEL fires and correctly raises the toast.
  // ---------------------------------------------------------------------------
  it('safety property (d) part 2: switching to an architecture whose target view is empty fires the empty-view info toast', async () => {
    renderArchitectureShell({
      // Source has a diagram so it is non-empty; destination has none.
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      modelByArchId: {
        [ARCH_DEFAULT_ID]: buildModel({ withDiagram: true }),
        [ARCH_TARGET_ID]: buildModel({ /* no diagrams */ }),
      },
      targetArchId: ARCH_TARGET_ID,
    });

    // No toast on initial mount.
    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();

    // Wait for the architectures list to load so the toast can resolve the
    // architecture name for the message body. Without this wait the toast
    // falls back to "this architecture" because the list hasn't arrived
    // from the mocked listArchitectures promise.
    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    // After the switch, the toast must be visible with the parameterised
    // architecture name and the human-friendly view label.
    const toast = await screen.findByTestId('global-toast');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent('Architecture Empty Target has no diagrams yet');
  });

  // ---------------------------------------------------------------------------
  // Test 3: switching to a non-empty target view does NOT fire the toast.
  // ---------------------------------------------------------------------------
  it('does NOT fire the empty-view toast when the destination view is non-empty', async () => {
    renderArchitectureShell({
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      // Both architectures have a diagram so the diagrams view is never empty.
      modelByArchId: {
        [ARCH_DEFAULT_ID]: buildModel({ withDiagram: true }),
        [ARCH_TARGET_ID]: buildModel({ withDiagram: true }),
      },
      targetArchId: ARCH_TARGET_ID,
    });

    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    // Wait for any potential toast to settle, then assert none appeared.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 4: dashboard view never fires the empty-view toast on switch.
  // ---------------------------------------------------------------------------
  it('does NOT fire the empty-view toast when the active view is dashboard (always non-empty)', async () => {
    renderArchitectureShell({
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/dashboard`,
      // Even fully-empty models must not raise a toast on dashboard.
      modelByArchId: {
        [ARCH_DEFAULT_ID]: buildModel({ /* empty */ }),
        [ARCH_TARGET_ID]: buildModel({ /* empty */ }),
      },
      targetArchId: ARCH_TARGET_ID,
    });

    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    // URL still on dashboard, toast suppressed.
    expect(screen.getByTestId('current-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/dashboard`
    );
    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 5: initial mount must never fire the toast.
  // ---------------------------------------------------------------------------
  it('does NOT fire the empty-view toast on initial page load (only genuine architecture-id changes trigger it)', async () => {
    // Mount directly on an architecture-scoped URL with a fully-empty model.
    // If the trigger fired on first render this would surface the toast
    // because the model is empty.
    renderArchitectureShell({
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      modelByArchId: {
        [ARCH_DEFAULT_ID]: buildModel({ /* empty */ }),
        [ARCH_TARGET_ID]: buildModel({ /* empty */ }),
      },
      targetArchId: ARCH_TARGET_ID,
    });

    // Wait for the architectures list to load -- this is the point at
    // which the hook re-evaluates its dependency list. If the trigger
    // were buggy and fired after this re-evaluation it would surface
    // the toast here.
    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 6: per-view emptiness rules.
  // ---------------------------------------------------------------------------
  it('useViewIsEmpty pure helpers compute the expected boolean for empty vs non-empty fixtures', () => {
    const empty = buildModel({});
    const withDiagram = buildModel({ withDiagram: true });
    const withApp = buildModel({ withApplication: true });
    const withBP = buildModel({ withBusinessProcess: true });

    // metamodel
    expect(isMetaModelEmpty(empty)).toBe(true);
    expect(isMetaModelEmpty(withApp)).toBe(false);
    expect(isMetaModelEmpty(withBP)).toBe(false);
    expect(isMetaModelEmpty(null)).toBe(true);

    // diagrams
    expect(isDiagramsEmpty(empty)).toBe(true);
    expect(isDiagramsEmpty(withDiagram)).toBe(false);
    expect(isDiagramsEmpty(null)).toBe(true);

    // product (sensitive to business_processes / process_activities /
    // user_journeys; a stand-alone application does NOT count as product
    // content).
    expect(isProductEmpty(empty)).toBe(true);
    expect(isProductEmpty(withApp)).toBe(true);
    expect(isProductEmpty(withBP)).toBe(false);
    expect(isProductEmpty(null)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Hotfix Bug 2 Test 7: empty source -> non-empty destination must NOT fire.
  //
  // Pre-fix: this scenario produced a phantom toast claiming the
  // (non-empty) destination architecture was empty, because emptiness was
  // measured against the source model that was still in state.
  // ---------------------------------------------------------------------------
  it('hotfix bug 2: empty source -> non-empty destination does NOT fire the empty-view toast', async () => {
    renderArchitectureShell({
      initialPath: `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`,
      // Source is empty (no diagrams); destination has a diagram.
      modelByArchId: {
        [ARCH_DEFAULT_ID]: buildModel({ /* empty */ }),
        [ARCH_TARGET_ID]: buildModel({ withDiagram: true }),
      },
      targetArchId: ARCH_TARGET_ID,
    });

    await waitFor(() => {
      expect(screen.getByTestId('architectures-count')).toHaveTextContent('2');
    });

    act(() => {
      screen.getByTestId('switch-arch-button').click();
    });

    // Wait for the LOAD_MODEL for the destination to fire and the toast
    // hook to re-evaluate. No toast must be raised because the destination
    // is non-empty.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByTestId('global-toast')).not.toBeInTheDocument();
  });
});
