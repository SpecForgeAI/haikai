/**
 * Per-Architecture In-Memory Cache -- Hotfix Tests (Bug 1)
 *
 * Hotfix 2026-05-01: Unsaved changes lost on architecture swap.
 *
 * Bug 1: when the user makes unsaved changes on architecture A, then swaps
 * to B, then back to A, the unsaved changes were lost because the AppShell
 * auto-load effect dispatched RESET_MODEL + re-fetched from the server.
 *
 * Fix: per-architecture in-memory cache in <AppShell> (a useRef Map keyed by
 * architectureId). When swapping back to a previously-visited architecture,
 * the cached model + loadedFileName are restored via LOAD_MODEL with no DB
 * fetch. Cache cleared on project change.
 *
 * Tests:
 *   1. Add entity to arch A, swap to B, swap back to A -> entity still
 *      present (and no second DB fetch for A).
 *   2. Cache cleared on project change -> swap to a previously-visited
 *      architecture under a NEW project triggers a fresh DB fetch.
 *   3. Save while on A (LOAD_MODEL re-dispatched with the saved model) ->
 *      cache entry updated, swap-away-and-back restores the saved state.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { useNavigate, useLocation } from 'react-router-dom';

// ============================================================================
// Mocks (must be set up BEFORE module-under-test imports)
// ============================================================================

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn(),
  };
});

vi.mock('../contexts/ProjectContext', async () => {
  const actual = await vi.importActual<typeof import('../contexts/ProjectContext')>(
    '../contexts/ProjectContext'
  );
  return {
    ...actual,
    useProject: vi.fn(),
    useProjectLoading: vi.fn(),
  };
});

vi.mock('../api/modelApi', async () => {
  const actual = await vi.importActual('../api/modelApi');
  return {
    ...actual,
    loadModelByProjectId: vi.fn(),
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

// Heavy view stubs.
vi.mock('../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub">DashboardView</div>,
}));
vi.mock('../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view-stub">MetaModelView</div>,
}));
vi.mock('../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view-stub">DiagramsView</div>,
}));
vi.mock('../components/ProductView/ProductView', () => ({
  ProductView: () => <div data-testid="product-view-stub">ProductView</div>,
}));
vi.mock('../components/LandingPage/LandingPage', () => ({
  LandingPage: () => <div data-testid="landing-page-stub">LandingPage</div>,
}));
vi.mock('../components/Organisation/CreateOrganisationModal', () => ({
  CreateOrganisationModal: () => null,
}));
// TopBar stub that includes children + state probes for cache assertions.
vi.mock('../components/TopBar/TopBar', () => ({
  TopBar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="top-bar-stub">
      <CacheAssertProbe />
      {children}
    </div>
  ),
}));

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { listArchitectures } from '../api/architecturesApi';
import { useProject, useProjectLoading } from '../contexts/ProjectContext';
import { loadModelByProjectId } from '../api/modelApi';
import {
  useArchitecture,
  useArchitectureDispatch,
} from '../contexts/ArchitectureContext';
import {
  renderWithFullApp,
  setupDefaultMocks,
  teardownDefaultMocks,
  buildProjectFixture,
  buildArchitectureFixture,
  DEFAULT_PROJECT_ID,
  DEFAULT_ARCH_ID,
} from './routing/testUtils';
import { emptyModel } from '../config/defaults';
import type { ArchitectureModel } from '../types/model';

// ============================================================================
// Probes
// ============================================================================

/**
 * Reads the current architecture state and exposes selected fields via DOM
 * test ids so tests can assert on cache restoration outcomes.
 *
 * Mounted inside the (mocked) <TopBar> stub so it lives within the
 * ArchitectureProvider tree without requiring custom router scaffolding.
 *
 * The probe also exposes a button per request so a test can dispatch
 * ADD_ENTITY into the reducer without needing the full UI palette.
 */
function CacheAssertProbe() {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  const apps = state.model?.metaModel?.entities?.applications ?? [];
  return (
    <>
      <div data-testid="probe-applications-count">{apps.length}</div>
      <div data-testid="probe-applications-names">
        {apps.map((a: { name: string }) => a.name).join(',')}
      </div>
      <div data-testid="probe-loaded-filename">{state.loadedFileName ?? ''}</div>
      <button
        data-testid="probe-add-application"
        onClick={() =>
          dispatch({
            type: 'ADD_ENTITY',
            entityType: 'applications',
            entity: {
              id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: 'UnsavedApp',
              description: '',
              tags: '',
              abbreviation: '',
            } as never,
          })
        }
      >
        add app
      </button>
      <button
        data-testid="probe-simulate-save"
        onClick={() =>
          // Simulate a successful save: saveModelToBackend dispatches
          // LOAD_MODEL with the prepared (saved) model. We mirror that here
          // by dispatching LOAD_MODEL with the current state.model so the
          // cache mirror effect picks up a "settled saved" snapshot.
          dispatch({
            type: 'LOAD_MODEL',
            payload: state.model,
            fileName: state.loadedFileName ?? 'saved',
          })
        }
      >
        simulate save
      </button>
    </>
  );
}

/**
 * Expose the current location pathname so tests can assert URL transitions.
 */
function PathnameProbe() {
  const loc = useLocation();
  return <div data-testid="current-pathname">{loc.pathname}</div>;
}

/**
 * Programmatic navigator probe -- exposes a function on window so tests can
 * navigate between architecture URLs without depending on a UI dropdown.
 */
function NavigatorProbe() {
  const nav = useNavigate();
  useEffect(() => {
    (window as unknown as { __testNav?: (path: string) => void }).__testNav = (
      path: string
    ) => nav(path);
    return () => {
      delete (window as unknown as { __testNav?: (path: string) => void }).__testNav;
    };
  }, [nav]);
  return null;
}

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_A_ID = DEFAULT_PROJECT_ID;
const PROJECT_B_ID = 'proj-uuid-second-project';
const ARCH_A = DEFAULT_ARCH_ID;
const ARCH_B = 'arch-uuid-second-architecture';

function buildModelWithApplications(names: string[]): ArchitectureModel {
  const model: ArchitectureModel = JSON.parse(JSON.stringify(emptyModel));
  for (const name of names) {
    (model.metaModel.entities.applications as unknown[]).push({
      id: `app-${name}`,
      name,
      description: '',
      tags: '',
      abbreviation: '',
    });
  }
  return model;
}

// ============================================================================
// Tests
// ============================================================================

describe('Per-Architecture In-Memory Cache (Hotfix Bug 1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
    vi.mocked(useProject).mockReturnValue(buildProjectFixture());
    vi.mocked(useProjectLoading).mockReturnValue(false);
    vi.mocked(listArchitectures).mockResolvedValue([
      buildArchitectureFixture({ id: ARCH_A, name: 'Architecture A' }),
      buildArchitectureFixture({ id: ARCH_B, name: 'Architecture B' }),
    ]);

    // Per-architecture model fixtures: A starts with one application, B is
    // empty. The mocked loadModelByProjectId returns the appropriate
    // fixture per (projectId, architectureId).
    vi.mocked(loadModelByProjectId).mockImplementation(
      async (_projectId: string, archId: string) => {
        if (archId === ARCH_A) return buildModelWithApplications(['SeedA']);
        if (archId === ARCH_B) return buildModelWithApplications(['SeedB']);
        return JSON.parse(JSON.stringify(emptyModel));
      }
    );
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Add entity to arch A, swap to B, swap back to A -> entity present.
  // No second DB fetch for A on swap-back.
  // ---------------------------------------------------------------------------
  it('preserves unsaved entity additions across an A -> B -> A architecture swap', async () => {
    const { unmount } = renderWithFullApp(
      `/projects/${PROJECT_A_ID}/architectures/${ARCH_A}/dashboard`,
      {
        extra: (
          <>
            <NavigatorProbe />
            <PathnameProbe />
          </>
        ),
      }
    );

    // Wait for A to load.
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-count')).toHaveTextContent('1');
      expect(screen.getByTestId('probe-applications-names')).toHaveTextContent('SeedA');
    });

    // Add an unsaved application via the probe.
    act(() => {
      screen.getByTestId('probe-add-application').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-count')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('probe-applications-names')).toHaveTextContent(
      'SeedA,UnsavedApp'
    );

    // Swap to B via URL navigation.
    act(() => {
      (window as unknown as { __testNav: (path: string) => void }).__testNav(
        `/projects/${PROJECT_A_ID}/architectures/${ARCH_B}/dashboard`
      );
    });

    // Wait for B to load (SeedB + no UnsavedApp).
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-names')).toHaveTextContent('SeedB');
    });

    const callsAfterSwapToB = vi.mocked(loadModelByProjectId).mock.calls.length;

    // Swap back to A.
    act(() => {
      (window as unknown as { __testNav: (path: string) => void }).__testNav(
        `/projects/${PROJECT_A_ID}/architectures/${ARCH_A}/dashboard`
      );
    });

    // The cached A must be restored INCLUDING the unsaved UnsavedApp.
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-count')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('probe-applications-names')).toHaveTextContent(
      'SeedA,UnsavedApp'
    );

    // No additional DB fetch for A (cache hit).
    expect(vi.mocked(loadModelByProjectId).mock.calls.length).toBe(callsAfterSwapToB);

    unmount();
  });

  // ---------------------------------------------------------------------------
  // Test 2: Cache cleared on project change. Re-visiting an architecture id
  // under a different project triggers a fresh DB fetch (no cross-project
  // contamination).
  // ---------------------------------------------------------------------------
  it('clears the cache on project change (no cross-project contamination)', async () => {
    // Render mounted under project A on architecture A.
    const { unmount } = renderWithFullApp(
      `/projects/${PROJECT_A_ID}/architectures/${ARCH_A}/dashboard`,
      {
        extra: (
          <>
            <NavigatorProbe />
            <PathnameProbe />
          </>
        ),
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-names')).toHaveTextContent('SeedA');
    });

    // Add unsaved data and verify cache holds it.
    act(() => {
      screen.getByTestId('probe-add-application').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-count')).toHaveTextContent('2');
    });

    // Now switch the active project to PROJECT_B (mocked).
    vi.mocked(useProject).mockReturnValue(
      buildProjectFixture({ id: PROJECT_B_ID, name: 'Second Project' })
    );

    // Navigate to PROJECT_B's architecture A URL. Same architectureId but a
    // different project -- the cache must NOT serve this from PROJECT_A's
    // entry.
    act(() => {
      (window as unknown as { __testNav: (path: string) => void }).__testNav(
        `/projects/${PROJECT_B_ID}/architectures/${ARCH_A}/dashboard`
      );
    });

    // Should fetch a fresh model for (PROJECT_B, ARCH_A). Pre-fix this
    // would also re-fetch (no cache regression). Post-fix the cache entry
    // for ARCH_A from PROJECT_A is cleared so the fetched fresh A model
    // (without UnsavedApp) is what surfaces.
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-count')).toHaveTextContent('1');
      expect(screen.getByTestId('probe-applications-names')).toHaveTextContent('SeedA');
    });

    // Crucially: the unsaved app from project A's session must NOT appear.
    expect(screen.getByTestId('probe-applications-names')).not.toHaveTextContent(
      'UnsavedApp'
    );

    unmount();
  });

  // ---------------------------------------------------------------------------
  // Test 3: Save while on A -> cache entry updated to match the saved state.
  // After save, swap A->B->A restores the saved state (not pre-save).
  // ---------------------------------------------------------------------------
  it('updates the cache entry for the active architecture on save (post-save state survives swap)', async () => {
    const { unmount } = renderWithFullApp(
      `/projects/${PROJECT_A_ID}/architectures/${ARCH_A}/dashboard`,
      {
        extra: (
          <>
            <NavigatorProbe />
            <PathnameProbe />
          </>
        ),
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-names')).toHaveTextContent('SeedA');
    });

    // Add an entity (would-be unsaved).
    act(() => {
      screen.getByTestId('probe-add-application').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-count')).toHaveTextContent('2');
    });

    // Simulate a successful save: saveModelToBackend re-dispatches
    // LOAD_MODEL with the prepared/saved model. The cache mirror effect
    // catches this and updates cache[A] to the saved state.
    act(() => {
      screen.getByTestId('probe-simulate-save').click();
    });

    // Swap A -> B (forces park) then back A. The restored state must be
    // the post-save state (still 2 applications).
    act(() => {
      (window as unknown as { __testNav: (path: string) => void }).__testNav(
        `/projects/${PROJECT_A_ID}/architectures/${ARCH_B}/dashboard`
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-names')).toHaveTextContent('SeedB');
    });

    act(() => {
      (window as unknown as { __testNav: (path: string) => void }).__testNav(
        `/projects/${PROJECT_A_ID}/architectures/${ARCH_A}/dashboard`
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('probe-applications-count')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('probe-applications-names')).toHaveTextContent(
      'SeedA,UnsavedApp'
    );

    unmount();
  });
});

