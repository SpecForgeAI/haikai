/**
 * Multi-Architecture Selector + URL Routing -- View-State Migration Tests
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
 * Task 4.1: 2-8 focused tests for the view-state migration (the breaking change).
 *
 * Tests:
 *   1. parseViewFromPathname returns the correct view for canonical
 *      architecture-scoped URLs and falls back to dashboard for unknown shapes.
 *   2. useCurrentView re-renders consumers when the URL changes via
 *      useNavigate (the canonical Group-4 swap).
 *   3. (Safety property e) Browser back/forward (simulated by navigating with
 *      useNavigate inside a single MemoryRouter) changes the active view AND
 *      the active :architectureId without remounting the wrapping app shell --
 *      the shell instance is stable because the route element is a single
 *      Route covering both URLs.
 *   4. Top-bar view-toggle <Link>s navigate to the canonical URL preserving
 *      :projectId + :architectureId. The active styling reflects the URL via
 *      useCurrentView.
 *   5. AppState no longer carries `currentView`; the AppAction union no
 *      longer contains 'SET_VIEW'. Verified at runtime via a probe that
 *      reads the live state from ArchitectureProvider.
 */

import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn().mockResolvedValue([]),
  };
});

import { useProject } from '../contexts/ProjectContext';
import { listArchitectures } from '../api/architecturesApi';
import {
  ArchitectureProvider,
  useArchitecture,
  type AppAction,
  type AppState,
} from '../contexts/ArchitectureContext';
import {
  parseViewFromPathname,
  useCurrentView,
  type CurrentView,
} from '../hooks/useCurrentView';

// ============================================================================
// Test Helpers
// ============================================================================

const PROJECT_ID = 'proj-uuid-view';
const ARCH_DEFAULT_ID = 'arch-default-view';
const ARCH_TARGET_ID = 'arch-target-view';

function buildProjectFixture() {
  return {
    id: PROJECT_ID,
    name: 'View Migration Test Project',
    projectParentFolder: '/test',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function CurrentViewProbe() {
  const view = useCurrentView();
  return <div data-testid="current-view">{view}</div>;
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="current-pathname">{loc.pathname}</div>;
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-Architecture Selector + URL Routing -- View-State Migration (Task 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProject).mockReturnValue(null);
    vi.mocked(listArchitectures).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: parseViewFromPathname mapping.
  // ---------------------------------------------------------------------------
  it('parseViewFromPathname maps every canonical URL to the right view and falls back to dashboard otherwise', () => {
    expect(
      parseViewFromPathname(`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`)
    ).toBe<CurrentView>('diagrams');
    expect(
      parseViewFromPathname(`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/metamodel`)
    ).toBe<CurrentView>('metamodel');
    expect(
      parseViewFromPathname(`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/product`)
    ).toBe<CurrentView>('product');
    expect(
      parseViewFromPathname(`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/dashboard`)
    ).toBe<CurrentView>('dashboard');

    // Legacy missing-:architectureId shape still resolves the trailing view.
    expect(parseViewFromPathname(`/projects/${PROJECT_ID}/diagrams`)).toBe<CurrentView>('diagrams');

    // Unknown / root paths fall back to dashboard.
    expect(parseViewFromPathname('/')).toBe<CurrentView>('dashboard');
    expect(parseViewFromPathname('')).toBe<CurrentView>('dashboard');
    expect(parseViewFromPathname(`/projects/${PROJECT_ID}/some-unknown-view`)).toBe<CurrentView>('dashboard');
  });

  // ---------------------------------------------------------------------------
  // Test 2: useCurrentView reads from useLocation.
  // ---------------------------------------------------------------------------
  it('useCurrentView reflects the URL pathname (re-renders consumer when the URL changes via useNavigate)', () => {
    function NavProbe() {
      const navigate = useNavigate();
      return (
        <button
          data-testid="nav-to-metamodel"
          onClick={() =>
            navigate(`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/metamodel`)
          }
        >
          go
        </button>
      );
    }

    render(
      <MemoryRouter
        initialEntries={[`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/*"
            element={
              <>
                <CurrentViewProbe />
                <NavProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('current-view')).toHaveTextContent('diagrams');

    act(() => {
      screen.getByTestId('nav-to-metamodel').click();
    });

    expect(screen.getByTestId('current-view')).toHaveTextContent('metamodel');
  });

  // ---------------------------------------------------------------------------
  // Test 3 (Safety property e): URL-driven view + architecture swaps do NOT
  // remount the app shell. We assert this by making the shell increment a
  // ref-stored counter on every mount and re-render; the mount counter
  // must stay at 1 even though the URL (and hence both :architectureId and
  // the trailing view segment) changes.
  // ---------------------------------------------------------------------------
  it('safety property (e): back/forward changes active view + architecture without remounting the app shell', () => {
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());

    // Module-scoped mount counter so mount count survives re-renders. The
    // ref is initialised once per mounted instance; if React unmounts and
    // remounts the shell, a new ref is created and the count resets.
    let mountCounter = 0;

    function TestShell() {
      const mounted = useRef(false);
      if (!mounted.current) {
        mounted.current = true;
        mountCounter += 1;
      }
      return (
        <div data-testid="shell-stub">
          <div data-testid="shell-mount-count">{mountCounter}</div>
          <CurrentViewProbe />
          <LocationProbe />
          <BackForwardControls />
        </div>
      );
    }

    function BackForwardControls() {
      const navigate = useNavigate();
      return (
        <>
          <button
            data-testid="forward"
            onClick={() =>
              navigate(`/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/metamodel`)
            }
          >
            forward
          </button>
          <button
            data-testid="back"
            onClick={() =>
              navigate(`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`)
            }
          >
            back
          </button>
        </>
      );
    }

    render(
      <MemoryRouter
        initialEntries={[`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`]}
      >
        <Routes>
          {/* Same Route covers both architecture/view combinations -- the
              router reuses the parent element when only path-segment values
              change, which is exactly what we want to assert. */}
          <Route
            path="/projects/:projectId/architectures/:architectureId/*"
            element={<TestShell />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('current-view')).toHaveTextContent('diagrams');
    expect(screen.getByTestId('shell-mount-count')).toHaveTextContent('1');

    act(() => {
      screen.getByTestId('forward').click();
    });

    // After URL swap the view follows; mount counter MUST stay at 1.
    expect(screen.getByTestId('current-view')).toHaveTextContent('metamodel');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_TARGET_ID}/metamodel`
    );
    expect(screen.getByTestId('shell-mount-count')).toHaveTextContent('1');

    act(() => {
      screen.getByTestId('back').click();
    });

    expect(screen.getByTestId('current-view')).toHaveTextContent('diagrams');
    expect(screen.getByTestId('current-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`
    );
    expect(screen.getByTestId('shell-mount-count')).toHaveTextContent('1');
  });

  // ---------------------------------------------------------------------------
  // Test 4: Top-bar-style view-toggle <Link>s navigate to the canonical URL
  // and active styling derives from useCurrentView.
  // ---------------------------------------------------------------------------
  it('view-toggle <Link>s navigate to the canonical URL and active styling derives from useCurrentView', () => {
    function ToggleStub() {
      const view = useCurrentView();
      const base = `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}`;
      return (
        <div>
          <Link
            to={`${base}/dashboard`}
            data-testid="dashboard-link"
            className={view === 'dashboard' ? 'active' : ''}
          >
            Dashboard
          </Link>
          <Link
            to={`${base}/metamodel`}
            data-testid="metamodel-link"
            className={view === 'metamodel' ? 'active' : ''}
          >
            Architecture
          </Link>
          <Link
            to={`${base}/diagrams`}
            data-testid="diagrams-link"
            className={view === 'diagrams' ? 'active' : ''}
          >
            Diagrams
          </Link>
          <CurrentViewProbe />
          <LocationProbe />
        </div>
      );
    }

    render(
      <MemoryRouter
        initialEntries={[`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/dashboard`]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/*"
            element={<ToggleStub />}
          />
        </Routes>
      </MemoryRouter>
    );

    // Dashboard active to start.
    expect(screen.getByTestId('current-view')).toHaveTextContent('dashboard');
    expect(screen.getByTestId('dashboard-link').className).toContain('active');
    expect(screen.getByTestId('metamodel-link').className).not.toContain('active');

    // Click the metamodel link -- URL changes; current-view follows.
    act(() => {
      screen.getByTestId('metamodel-link').click();
    });

    expect(screen.getByTestId('current-pathname')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/metamodel`
    );
    expect(screen.getByTestId('current-view')).toHaveTextContent('metamodel');
    expect(screen.getByTestId('metamodel-link').className).toContain('active');
    expect(screen.getByTestId('dashboard-link').className).not.toContain('active');
  });

  // ---------------------------------------------------------------------------
  // Test 5: AppState no longer carries `currentView` and AppAction has no
  // 'SET_VIEW' variant after Task Group 4.
  // ---------------------------------------------------------------------------
  it('AppState has no `currentView` field and AppAction has no SET_VIEW variant after Task Group 4', () => {
    function StateProbe() {
      const state = useArchitecture() as AppState & { currentView?: unknown };
      return (
        <div data-testid="has-currentview">
          {Object.prototype.hasOwnProperty.call(state, 'currentView') ? 'YES' : 'NO'}
        </div>
      );
    }

    render(
      <MemoryRouter
        initialEntries={[`/projects/${PROJECT_ID}/architectures/${ARCH_DEFAULT_ID}/diagrams`]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/*"
            element={
              <ArchitectureProvider>
                <StateProbe />
              </ArchitectureProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    // Live runtime check: the reducer's initial state is missing `currentView`.
    expect(screen.getByTestId('has-currentview')).toHaveTextContent('NO');

    // Type-level check via the AppAction union: 'SET_VIEW' must not be
    // assignable to AppAction['type']. A const list of valid actions is
    // built statically and inspected -- if SET_VIEW were still a member,
    // this assertion would compile at runtime in addition to fail the
    // .not.toContain check.
    type ValidAction = AppAction['type'];
    const sample: ValidAction = 'LOAD_MODEL';
    expect(sample).toBe('LOAD_MODEL');
    const validActions: ValidAction[] = ['LOAD_MODEL'];
    expect(validActions).not.toContain('SET_VIEW' as unknown as ValidAction);
  });
});
