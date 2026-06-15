/**
 * Comprehensive Frontend Routing -- Diagrams Sub-Routes
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5 (Task 5.1)
 *
 * 2-8 focused tests for the `diagrams/:diagramId?` sub-route migration:
 *
 *   1. `useSelectedDiagramId()` (and `parseDiagramIdFromPathname`) return
 *      the URL segment value when present, null when absent. Plus pure
 *      parser unit-tests.
 *   2. Bare `/.../diagrams` mounts DiagramsView with no diagram selected
 *      (canvas not rendered; the empty-list message is shown when the
 *      model has zero diagrams).
 *   3. `/.../diagrams/<id>` mounts DiagramsView with that diagram selected
 *      (the URL -> reducer sync effect populates `state.selectedDiagramId`
 *      and the canvas renders).
 *   4. Selecting a diagram in the autocomplete navigates via `useNavigate`
 *      to `/.../diagrams/<id>` (no direct `dispatch SELECT_DIAGRAM` -- the
 *      URL leads, the reducer follows via the sync effect).
 *   5. Browser back/forward across diagram selections changes the active
 *      diagram without remounting DiagramsView's chrome (the AppShell +
 *      DiagramsView component instance stay mounted across the route
 *      change). Driven via a `<NavController>` probe that calls
 *      `useNavigate(-1 | 1)` because MemoryRouter does not surface the
 *      browser History API.
 *   6. Unknown `:diagramId` does NOT redirect -- the URL stays put and the
 *      canvas does not render (the design choice documented in the spec;
 *      the user sees the URL they navigated to).
 *
 * Notes:
 *   - We do NOT stub DiagramsView in this file because the test scope IS
 *     the DiagramsView routing behaviour. The Canvas (heavy) is stubbed so
 *     tests stay fast.
 *   - `state.selectedDiagramId` reads continue to drive Canvas / palette /
 *     inspector rendering in production; the URL drives the reducer via
 *     the sync effect inside DiagramsView.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';

// ============================================================================
// Mocks (must be set up BEFORE module-under-test imports)
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual('../../api/architecturesApi');
  return {
    ...actual,
    // Default to an empty list so provider-level fetches that run before a
    // test sets its own mockResolvedValue do not return undefined (.then crash).
    listArchitectures: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('../../contexts/ProjectContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/ProjectContext')>(
    '../../contexts/ProjectContext'
  );
  return {
    ...actual,
    useProject: vi.fn(),
    useProjectLoading: vi.fn(),
  };
});

vi.mock('../../api/modelApi', async () => {
  const actual = await vi.importActual('../../api/modelApi');
  return {
    ...actual,
    // Default: resolve an empty model so AppShell's load effect never calls
    // .then on undefined before a test installs its own mockResolvedValue.
    loadModelByProjectId: vi.fn(async () => {
      const { emptyModel } = await vi.importActual<typeof import('../../config/defaults')>('../../config/defaults');
      return JSON.parse(JSON.stringify(emptyModel));
    }),
  };
});

// Render portals inline so any toast / menu pops appear in the test DOM tree.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Heavy view stubs (per testUtils header recommendations). DiagramsView
// itself is INTENTIONALLY NOT stubbed in this file -- the diagrams sub-
// route behaviour is the system under test.
vi.mock('../../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub" />,
}));
vi.mock('../../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view-stub" />,
}));
vi.mock('../../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view-stub" />,
}));
vi.mock('../../components/LandingPage/LandingPage', () => ({
  LandingPage: () => <div data-testid="landing-page-stub" />,
}));
vi.mock('../../components/Organisation/CreateOrganisationModal', () => ({
  CreateOrganisationModal: () => null,
}));
vi.mock('../../components/TopBar/TopBar', () => ({
  TopBar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="top-bar-stub">{children}</div>
  ),
}));

// Stub the heavy Canvas so we can detect "canvas mounted" via a testid
// without paying its render cost.
vi.mock('../../components/DiagramsView/Canvas', () => ({
  Canvas: ({ diagramId }: { diagramId: string }) => (
    <div data-testid="canvas-stub" data-diagram-id={diagramId} />
  ),
}));

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import {
  parseDiagramIdFromPathname,
  useSelectedDiagramId,
} from '../../hooks/useCurrentView';
import {
  renderWithFullApp,
  setupDefaultMocks,
  teardownDefaultMocks,
  buildProjectFixture,
  DEFAULT_PROJECT_ID,
  DEFAULT_ARCH_ID,
} from './testUtils';

// ============================================================================
// Helpers
// ============================================================================

const DIAGRAMS_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/diagrams`;
const DIAGRAM_ID_A = 'diag-aaa-aaaa-1111';
const DIAGRAM_ID_B = 'diag-bbb-bbbb-2222';

/**
 * Probe component that exposes the current pathname for assertions, plus
 * the URL-derived selected diagram id via `useSelectedDiagramId`. Used to
 * prove that:
 *   (a) the URL has not been redirected away (deep-link assertion)
 *   (b) the URL-derived hook returns the expected value (safety property d)
 */
function PathnameProbe() {
  const location = useLocation();
  const id = useSelectedDiagramId();
  return (
    <>
      <div data-testid="pathname-probe">{location.pathname}</div>
      <div data-testid="selected-diagram-id-probe">{id ?? 'NULL'}</div>
    </>
  );
}

/**
 * Probe that exposes `useNavigate(delta)` to the test scope via a closure
 * `ref`. Used by the back/forward test to drive `navigate(-1)` /
 * `navigate(1)` since MemoryRouter does not honour `window.history.back()`.
 */
function makeNavController(navRef: { current: ((delta: number) => void) | null }) {
  return function NavController() {
    const navigate = useNavigate();
    React.useEffect(() => {
      navRef.current = (delta: number) => navigate(delta);
    }, [navigate]);
    return null;
  };
}

/**
 * Render the app at the supplied URL with a hydrated active project.
 */
function renderAtUrl(url: string) {
  vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  vi.mocked(useProjectLoading).mockReturnValue(false);
  return renderWithFullApp(url, { extra: <PathnameProbe /> });
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Diagrams Sub-Routes (Task 5.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: pure parser + hook unit tests.
  //
  // Validates the URL-segment extraction is correct for the canonical shape
  // and returns null for the bare list URL / unrelated URLs. Mirrors the
  // Group 1 / Group 4 parser test pattern.
  // ---------------------------------------------------------------------------
  it('parseDiagramIdFromPathname / useSelectedDiagramId return the :diagramId or null', async () => {
    // Pure parser.
    expect(parseDiagramIdFromPathname(`${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`)).toBe(
      DIAGRAM_ID_A
    );
    expect(parseDiagramIdFromPathname(`${DIAGRAMS_BASE}/${DIAGRAM_ID_A}/extra`)).toBe(
      DIAGRAM_ID_A
    );
    expect(parseDiagramIdFromPathname(DIAGRAMS_BASE)).toBeNull();
    expect(parseDiagramIdFromPathname('/')).toBeNull();
    expect(
      parseDiagramIdFromPathname(
        `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/metamodel/data`
      )
    ).toBeNull();
    // Sentinel rejection:
    expect(parseDiagramIdFromPathname(`${DIAGRAMS_BASE}/undefined`)).toBeNull();

    // Hook variant via the probe (rendered alongside the app at the URL).
    renderAtUrl(`${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`);
    await waitFor(() => {
      expect(screen.getByTestId('selected-diagram-id-probe').textContent).toBe(
        DIAGRAM_ID_A
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: bare `/.../diagrams` mounts DiagramsView with no canvas.
  //
  // The model is empty (default mock), so the empty-list message renders.
  // The pathname stays at the bare URL (no redirect to a default diagram).
  // ---------------------------------------------------------------------------
  it('bare /diagrams mounts DiagramsView with no diagram selected', async () => {
    renderAtUrl(DIAGRAMS_BASE);

    // The top bar shell mounts.
    await screen.findByTestId('top-bar-stub');

    // The pathname stays put (no redirect).
    expect(screen.getByTestId('pathname-probe').textContent).toBe(DIAGRAMS_BASE);

    // The URL-derived hook returns null.
    expect(screen.getByTestId('selected-diagram-id-probe').textContent).toBe('NULL');

    // Canvas does NOT render (no diagram selected).
    expect(screen.queryByTestId('canvas-stub')).not.toBeInTheDocument();

    // The empty-state message renders (default model has no diagrams).
    expect(screen.getByText(/No diagrams defined in this model/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 3: deep-link to `/diagrams/<id>` selects the diagram (canvas
  // visible).
  //
  // The model is seeded with two diagrams via the loadModelByProjectId
  // mock; the AppShell auto-load effect populates state.model.diagrams.
  // The URL -> reducer sync effect inside DiagramsView then dispatches
  // SELECT_DIAGRAM with the URL value, and the canvas mounts.
  // ---------------------------------------------------------------------------
  it('refresh on /diagrams/<id> renders the canvas with the specified diagram selected', async () => {
    const { loadModelByProjectId } = await import('../../api/modelApi');
    const { emptyModel } = await import('../../config/defaults');
    vi.mocked(loadModelByProjectId).mockResolvedValue({
      ...JSON.parse(JSON.stringify(emptyModel)),
      diagrams: [
        {
          id: DIAGRAM_ID_A,
          name: 'Diagram A',
          description: '',
          diagram_type: 'CONTEXT',
          settings: {},
          diagram_nodes: [],
          diagram_edges: [],
        },
        {
          id: DIAGRAM_ID_B,
          name: 'Diagram B',
          description: '',
          diagram_type: 'CONTEXT',
          settings: {},
          diagram_nodes: [],
          diagram_edges: [],
        },
      ],
    });

    renderAtUrl(`${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`);

    // Wait for the model load to settle and the URL -> reducer sync to fire.
    await waitFor(() => {
      const canvas = screen.queryByTestId('canvas-stub');
      expect(canvas).not.toBeNull();
      expect(canvas).toHaveAttribute('data-diagram-id', DIAGRAM_ID_A);
    });

    // The pathname stays put (no redirect).
    expect(screen.getByTestId('pathname-probe').textContent).toBe(
      `${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`
    );

    // The URL-derived hook still returns the id.
    expect(screen.getByTestId('selected-diagram-id-probe').textContent).toBe(
      DIAGRAM_ID_A
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: clicking a diagram in the autocomplete navigates to the new URL.
  //
  // Drives the assertion via the pathname probe rather than mocking
  // `useNavigate` -- this proves the autocomplete actually performs a real
  // route change rather than just calling a no-op handler.
  // ---------------------------------------------------------------------------
  it('selecting a diagram in the autocomplete navigates to /diagrams/<id>', async () => {
    const { loadModelByProjectId } = await import('../../api/modelApi');
    const { emptyModel } = await import('../../config/defaults');
    vi.mocked(loadModelByProjectId).mockResolvedValue({
      ...JSON.parse(JSON.stringify(emptyModel)),
      diagrams: [
        {
          id: DIAGRAM_ID_A,
          name: 'Diagram Alpha Unique',
          description: '',
          diagram_type: 'CONTEXT',
          settings: {},
          diagram_nodes: [],
          diagram_edges: [],
        },
        {
          id: DIAGRAM_ID_B,
          name: 'Diagram Beta Unique',
          description: '',
          diagram_type: 'CONTEXT',
          settings: {},
          diagram_nodes: [],
          diagram_edges: [],
        },
      ],
    });

    const { user } = renderAtUrl(DIAGRAMS_BASE);

    // Wait for model to load.
    await waitFor(() => {
      expect(screen.queryByText(/No diagrams defined/i)).not.toBeInTheDocument();
    });

    // Find and click the autocomplete input.
    const input = await screen.findByPlaceholderText(/Search diagrams/i);
    await user.click(input);
    await user.type(input, 'Alpha');

    // Click the matching option.
    const option = await screen.findByText(/Diagram Alpha Unique/i);
    await user.click(option);

    // Pathname probe reflects the new URL.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`
      );
    });

    // The URL-derived hook returns the id.
    expect(screen.getByTestId('selected-diagram-id-probe').textContent).toBe(
      DIAGRAM_ID_A
    );

    // Canvas is now mounted with the chosen diagram id.
    await waitFor(() => {
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute(
        'data-diagram-id',
        DIAGRAM_ID_A
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: back/forward across diagram selections changes the active
  // diagram. Safety property (e, partial) for diagrams.
  //
  // MemoryRouter does not surface the browser History API; we drive
  // back/forward via a `<NavController>` probe that exposes the router's
  // `useNavigate(-1 | 1)` to the test scope. Calling `navRef.current(-1)`
  // is functionally equivalent to a Back-button press for routing-history
  // purposes.
  //
  // Seeded entries: [B, bare, A] starting at index 2 (A).
  //   Back -> bare; Back -> B. Forward -> bare; Forward -> A.
  // ---------------------------------------------------------------------------
  it('back/forward switches between diagram selections without remounting chrome', async () => {
    const { loadModelByProjectId } = await import('../../api/modelApi');
    const { emptyModel } = await import('../../config/defaults');
    vi.mocked(loadModelByProjectId).mockResolvedValue({
      ...JSON.parse(JSON.stringify(emptyModel)),
      diagrams: [
        {
          id: DIAGRAM_ID_A,
          name: 'Diagram A',
          description: '',
          diagram_type: 'CONTEXT',
          settings: {},
          diagram_nodes: [],
          diagram_edges: [],
        },
        {
          id: DIAGRAM_ID_B,
          name: 'Diagram B',
          description: '',
          diagram_type: 'CONTEXT',
          settings: {},
          diagram_nodes: [],
          diagram_edges: [],
        },
      ],
    });
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);

    const navRef: { current: ((delta: number) => void) | null } = { current: null };
    const NavController = makeNavController(navRef);

    renderWithFullApp(`${DIAGRAMS_BASE}/${DIAGRAM_ID_B}`, {
      additionalEntries: [
        DIAGRAMS_BASE,
        `${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`,
      ],
      // Map: [0] = B (initial), [1] = bare, [2] = A. Start at index 2.
      // Back -> bare (index 1); Back -> B (index 0).
      initialIndex: 2,
      extra: (
        <>
          <PathnameProbe />
          <NavController />
        </>
      ),
    });

    // Started at A.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute(
        'data-diagram-id',
        DIAGRAM_ID_A
      );
    });

    // Capture the AppShell instance to assert it stays mounted across the
    // back/forward navigations.
    const topBarBefore = screen.getByTestId('top-bar-stub');

    // Wait for the navigator ref to be wired by the effect.
    await waitFor(() => expect(navRef.current).not.toBeNull());

    // Back -> bare /diagrams.
    navRef.current!(-1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(DIAGRAMS_BASE);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('canvas-stub')).not.toBeInTheDocument();
    });

    // Back -> /diagrams/B.
    navRef.current!(-1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${DIAGRAMS_BASE}/${DIAGRAM_ID_B}`
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute(
        'data-diagram-id',
        DIAGRAM_ID_B
      );
    });

    // Forward -> bare.
    navRef.current!(1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(DIAGRAMS_BASE);
    });

    // Forward -> /diagrams/A (back to where we started).
    navRef.current!(1);
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${DIAGRAMS_BASE}/${DIAGRAM_ID_A}`
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute(
        'data-diagram-id',
        DIAGRAM_ID_A
      );
    });

    // The AppShell + DiagramsView chrome stayed mounted across all
    // back/forward navigations -- providers / chrome do not remount.
    expect(screen.getByTestId('top-bar-stub')).toBe(topBarBefore);
  });

  // ---------------------------------------------------------------------------
  // Test 6: unknown diagramId in URL does NOT redirect (per spec).
  //
  // The URL -> reducer sync still dispatches SELECT_DIAGRAM with the
  // unknown id, but `state.model.diagrams.find(...)` returns undefined so
  // `diagram` is falsy and the canvas does not render. The URL is
  // preserved (no redirect, no 404).
  // ---------------------------------------------------------------------------
  it('unknown :diagramId stays on the URL with no canvas rendered', async () => {
    // Empty-model default; no diagram with this id exists.
    renderAtUrl(`${DIAGRAMS_BASE}/diag-does-not-exist`);

    // Top bar mounts.
    await screen.findByTestId('top-bar-stub');

    // The pathname is preserved -- no redirect to bare list.
    expect(screen.getByTestId('pathname-probe').textContent).toBe(
      `${DIAGRAMS_BASE}/diag-does-not-exist`
    );

    // URL-derived hook returns the unknown id (the URL is the contract,
    // not the model membership).
    expect(screen.getByTestId('selected-diagram-id-probe').textContent).toBe(
      'diag-does-not-exist'
    );

    // Canvas is NOT rendered (no matching diagram in the model).
    expect(screen.queryByTestId('canvas-stub')).not.toBeInTheDocument();

    // Sanity: NOT the 404 page.
    expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();
  });
});
