/**
 * Comprehensive Frontend Routing -- Test Utilities
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3
 *
 * `renderWithFullApp(initialUrl)` mounts the FULL `<AppContent>` (the inner
 * provider tree + `<AppRoutes/>`, extracted from `<App>` for this purpose)
 * under a `<MemoryRouter initialEntries={[initialUrl]}>`. This is the
 * canonical helper for every routing test in this spec (Groups 3-9) and is
 * specifically designed to catch the entire class of bug fixed by Group 1 --
 * namely, providers reading `useParams()` outside the route tree.
 *
 * Production `<App>` mounts `<BrowserRouter><AppContent/></BrowserRouter>`;
 * the helper swaps in `<MemoryRouter>` so tests can drive routing via
 * initial entries without depending on `window.location`.
 *
 * ============================================================================
 * Required mocks (callers MUST set these up at the top of their test files
 * BEFORE importing `renderWithFullApp` -- vi.mock factories run before
 * module evaluation, so calling `setupDefaultMocks()` from `beforeEach` is
 * the correct pattern):
 *
 *   vi.mock('../../api/modelApi', async () => {
 *     const actual = await vi.importActual('../../api/modelApi');
 *     return { ...actual, loadModelByProjectId: vi.fn() };
 *   });
 *   vi.mock('../../api/architecturesApi', async () => {
 *     const actual = await vi.importActual('../../api/architecturesApi');
 *     return { ...actual, listArchitectures: vi.fn() };
 *   });
 *   vi.mock('../../contexts/ProjectContext', async () => {
 *     const actual = await vi.importActual('../../contexts/ProjectContext');
 *     return { ...actual, useProject: vi.fn(), useProjectLoading: vi.fn() };
 *   });
 *
 * Heavy view stubs are recommended (architectures-scoped views pull in large
 * trees of canvas / chat / palette code that slow tests dramatically):
 *
 *   vi.mock('../../components/DashboardView/DashboardView', () => ({
 *     DashboardView: () => <div data-testid="dashboard-view-stub" />
 *   }));
 *   vi.mock('../../components/MetaModelView/MetaModelView', () => ({
 *     MetaModelView: () => <div data-testid="meta-model-view-stub" />
 *   }));
 *   vi.mock('../../components/DiagramsView/DiagramsView', () => ({
 *     DiagramsView: () => <div data-testid="diagrams-view-stub" />
 *   }));
 *   vi.mock('../../components/ProductView/ProductView', () => ({
 *     ProductView: () => <div data-testid="product-view-stub" />
 *   }));
 *   vi.mock('../../components/LandingPage/LandingPage', () => ({
 *     LandingPage: () => <div data-testid="landing-page-stub" />
 *   }));
 *   vi.mock('../../components/Organisation/CreateOrganisationModal', () => ({
 *     CreateOrganisationModal: () => null
 *   }));
 *   vi.mock('../../components/TopBar/TopBar', () => ({
 *     TopBar: ({ children }: { children?: React.ReactNode }) => (
 *       <div data-testid="top-bar-stub">{children}</div>
 *     ),
 *   }));
 *
 * Per project memory: `UnifiedChatPanel` requires `ArchitectureContext`,
 * `PendingActionContext`, `ModalActionContext` mocks; the helper does NOT
 * stub these because individual tests rarely exercise the chat panel. Stub
 * `TopBar` (as above) when chat behaviour is irrelevant, otherwise wire the
 * three contexts.
 *
 * ============================================================================
 * Async-mount expectation (READ THIS):
 *
 * `<AppConfigProvider>` returns `null` while its `/api/bootstrap` fetch is
 * in flight. This means the FIRST render of any tree mounted via this helper
 * is empty -- no providers, no routes, no testIds. Callers MUST wait for
 * the bootstrap-stubbed fetch to resolve before asserting on any rendered
 * content:
 *
 *   const { getByTestId } = renderWithFullApp('/projects/p/architectures/a/dashboard');
 *   await waitFor(() => expect(getByTestId('dashboard-view-stub')).toBeInTheDocument());
 *
 * `setupDefaultMocks()` (see below) installs a `global.fetch` stub that
 * resolves `/api/bootstrap` immediately, so the await is typically
 * single-tick.
 * ============================================================================
 */

import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { AppContent } from '../../App';
import {
  listArchitectures,
  type Architecture,
} from '../../api/architecturesApi';
import { loadModelByProjectId } from '../../api/modelApi';
import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import type { ProjectDto } from '../../api/projectsApi';
import { emptyModel } from '../../config/defaults';

// ============================================================================
// Public types
// ============================================================================

export interface RenderWithFullAppOptions {
  /**
   * Additional `MemoryRouter` initial entries beyond the URL. Useful for
   * tests that need to seed a back-history (e.g. back-forward tests in
   * Group 9). The first entry is always the `initialUrl` argument.
   */
  additionalEntries?: string[];
  /**
   * Index into the `MemoryRouter` initialEntries array that the router
   * should display first. Defaults to 0 (the `initialUrl`).
   */
  initialIndex?: number;
  /**
   * Optional extra children rendered alongside `<AppContent/>`. Typically
   * used to mount probe components (e.g. a `<PathnameProbe/>` that exposes
   * the current `useLocation().pathname` for assertions).
   */
  extra?: React.ReactNode;
}

export interface RenderWithFullAppResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
}

// ============================================================================
// Default fixtures
// ============================================================================

export const DEFAULT_PROJECT_ID = 'proj-uuid-routing-default';
export const DEFAULT_ARCH_ID = 'arch-uuid-routing-default';

/**
 * Build a default `Architecture` DTO. Tests can override individual fields by
 * passing an overrides object.
 */
export function buildArchitectureFixture(
  overrides: Partial<Architecture> = {}
): Architecture {
  return {
    id: DEFAULT_ARCH_ID,
    projectId: DEFAULT_PROJECT_ID,
    name: 'Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Build a default `ProjectDto`. Tests can override individual fields by
 * passing an overrides object.
 */
export function buildProjectFixture(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: DEFAULT_PROJECT_ID,
    name: 'Routing Test Project',
    projectParentFolder: '/test',
    projectHierarchy: null,
    organisationId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    // Spec 2026-06-12: the Implement routes are gated on the project's
    // workspace-init flag (ImplementationInitGate). Routing tests exercise
    // routing, not the gate, so the fixture defaults to init-succeeded.
    implementationInitSuccess: true,
    ...overrides,
  } as ProjectDto;
}

// ============================================================================
// Default mocks setup
// ============================================================================

/**
 * Holds the original `global.fetch` so `teardownDefaultMocks()` can restore
 * it after each test.
 */
let originalFetch: typeof global.fetch | undefined;

/**
 * Install the standard mock surface every routing test needs:
 *   - `global.fetch` stubbed to resolve `/api/bootstrap` immediately so
 *     `<AppConfigProvider>` unblocks on the first tick.
 *   - `loadModelByProjectId` returns an empty model so the AppShell auto-load
 *     effect does not throw.
 *   - `getActiveProject` (via the `useProject` mock) returns `null` by
 *     default so the bare `/` URL renders the LandingPage. Tests that need
 *     a hydrated project should call:
 *
 *       vi.mocked(useProject).mockReturnValue(buildProjectFixture());
 *
 *   - `useProjectLoading` returns `false`.
 *   - `listArchitectures` returns one Default architecture so
 *     `<ProjectLayout>`'s missing-architecture redirect resolves.
 *
 * Callers MUST have set up the corresponding `vi.mock(...)` factories at
 * the top of their test file (see header comment) before this is called --
 * `vi.mock` factories run before module evaluation, so they cannot be
 * called from within `setupDefaultMocks`. This helper only configures the
 * already-mocked function bodies.
 */
export function setupDefaultMocks(): void {
  vi.clearAllMocks();

  // Stub /api/bootstrap so AppConfigProvider unblocks immediately.
  // Other unknown URLs return 404 so callers swallow them gracefully.
  if (originalFetch === undefined) {
    originalFetch = global.fetch;
  }
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes('/api/bootstrap')) {
      return new Response(
        JSON.stringify({ include_delivery: true, include_database: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof global.fetch;

  vi.mocked(loadModelByProjectId).mockResolvedValue(
    JSON.parse(JSON.stringify(emptyModel))
  );
  // Default: no active project -> bare `/` lands on the LandingPage.
  vi.mocked(useProject).mockReturnValue(null);
  vi.mocked(useProjectLoading).mockReturnValue(false);
  vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);
}

/**
 * Restore the original `global.fetch`. Call from `afterEach`.
 */
export function teardownDefaultMocks(): void {
  if (originalFetch !== undefined) {
    global.fetch = originalFetch;
    originalFetch = undefined;
  }
}

// ============================================================================
// renderWithFullApp helper
// ============================================================================

/**
 * Mount the full `<AppContent>` under a `<MemoryRouter>` seeded with
 * `initialUrl`. Returns the full RTL render result plus a `user` event
 * handle (`userEvent.setup()`).
 *
 * IMPORTANT (async mount): `<AppConfigProvider>` returns null while
 * `/api/bootstrap` is in flight. Use `await waitFor(...)` /
 * `findBy*` queries to wait for the route tree to mount before asserting.
 * `setupDefaultMocks()` resolves the bootstrap fetch immediately so the wait
 * is single-tick.
 *
 * @param initialUrl - the URL the router should mount with
 * @param options - additional MemoryRouter entries, initialIndex, or extra
 *                  probe children
 * @returns the RTL render result extended with `user`
 */
export function renderWithFullApp(
  initialUrl: string,
  options: RenderWithFullAppOptions = {}
): RenderWithFullAppResult {
  const { additionalEntries = [], initialIndex, extra } = options;
  const entries = [initialUrl, ...additionalEntries];

  const result = render(
    <MemoryRouter initialEntries={entries} initialIndex={initialIndex ?? 0}>
      {extra}
      <AppContent />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  return { ...result, user };
}

/**
 * Planned routing test files (placeholder list -- Groups 4-9):
 *
 *   - `frontend/src/__tests__/routing/coldStart.test.tsx`     (Group 9)
 *   - `frontend/src/__tests__/routing/subRoutes.test.tsx`     (Group 9)
 *   - `frontend/src/__tests__/routing/topBarNav.test.tsx`     (Group 9)
 *   - `frontend/src/__tests__/routing/backForward.test.tsx`   (Group 9)
 *   - `frontend/src/__tests__/routing/notFound.test.tsx`      (Group 9 if Group 2 didn't reach it)
 *   - `frontend/src/__tests__/routing/architectureProviderUrlDerivation.test.tsx` (Group 3, see below)
 */
