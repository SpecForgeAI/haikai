/**
 * Comprehensive Frontend Routing -- Metamodel Sub-Routes
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4 (Task 4.1)
 *
 * 2-8 focused tests for the `metamodel/:domain?` sub-route migration:
 *
 *   1. Bare `/.../metamodel` redirects to `/.../metamodel/application`
 *      (the index-route default redirect lands the user on a canonical URL).
 *   2. `/.../metamodel/data` mounts MetaModelView with the data domain
 *      selected (asserted via the active-button styling on DomainSelector
 *      AND via the URL-derived useMetaModelDomain hook through a probe).
 *   3. All five valid domain URLs (`application`, `data`, `business`,
 *      `behavioural`, `ui`) mount the view without redirecting away.
 *      Parameterised via `it.each`. (`package-sets` is intentionally NOT a
 *      URL token — it is a tab inside the application domain only.)
 *   4. Clicking a DomainSelector button navigates via `useNavigate` to the
 *      new `/.../metamodel/<urlValue>` URL (no `dispatch SET_DOMAIN`
 *      direct call from the button -- the URL leads, the reducer follows
 *      via the sync effect inside MetaModelView).
 *   5. An invalid `:domain` token (e.g. `/.../metamodel/bogus`) renders a
 *      `<Navigate replace/>` to the default `/.../metamodel/application`
 *      URL (not the 404 page -- a bogus token inside a known view falls
 *      back to the default rather than 404'ing).
 *
 * Notes:
 *   - We do NOT stub MetaModelView in this file because the test scope IS
 *     the MetaModelView routing behaviour. The other heavy views remain
 *     stubbed (per the testUtils header comment recommendations) to keep
 *     the test fast.
 *   - Active-button assertion relies on the CSS module class name pattern
 *     (`*selected*`) emitted by the existing DomainSelector module. The
 *     test queries via title text + aria className substring so it stays
 *     robust to CSS module hashing.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';

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

// Heavy view stubs (per testUtils header recommendations). MetaModelView
// itself is INTENTIONALLY NOT stubbed in this file -- the metamodel
// sub-route behaviour is the system under test.
vi.mock('../../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub" />,
}));
vi.mock('../../components/DiagramsView/DiagramsView', () => ({
  DiagramsView: () => <div data-testid="diagrams-view-stub" />,
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

// MetaModelView pulls in heavy grid + chat trees. Stub the leaf-level
// children so the routing layer is the only thing exercised here.
vi.mock('../../components/Grid/Grid', () => ({
  Grid: ({ entityType }: { entityType: string }) => (
    <div data-testid="grid-stub" data-entity-type={entityType} />
  ),
}));
vi.mock('../../components/Grid/RelationshipGrid', () => ({
  RelationshipGrid: ({ relationshipType }: { relationshipType: string }) => (
    <div data-testid="relationship-grid-stub" data-rel-type={relationshipType} />
  ),
}));
vi.mock('../../components/MetaModelView/PackageSetsView', () => ({
  PackageSetsView: () => <div data-testid="package-sets-view-stub" />,
}));
vi.mock('../../components/UnifiedChat', () => ({
  UnifiedChatPanel: () => <div data-testid="unified-chat-panel-stub" />,
}));
vi.mock('../../hooks/useDiscoveryOrigins', () => ({
  useDiscoveryOrigins: () => ({}),
}));

// ============================================================================
// Imports of system-under-test (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
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

const META_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}/metamodel`;

/**
 * Probe component that exposes the current pathname for assertions. Used
 * to detect that an index-route redirect (or invalid-domain redirect) has
 * fired without relying on `MemoryRouter` history inspection.
 */
function PathnameProbe() {
  const location = useLocation();
  return <div data-testid="pathname-probe">{location.pathname}</div>;
}

/**
 * Convenience: render the app at the supplied URL with a hydrated active
 * project. Most tests in this file need a hydrated project so that
 * ProjectLayout does not redirect away from the metamodel URL.
 */
function renderAtUrl(url: string) {
  vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  vi.mocked(useProjectLoading).mockReturnValue(false);
  return renderWithFullApp(url, { extra: <PathnameProbe /> });
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Metamodel Sub-Routes (Task 4.1)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: bare `/.../metamodel` -> redirect to `/.../metamodel/application`.
  // ---------------------------------------------------------------------------
  it('bare /metamodel redirects to /metamodel/application', async () => {
    renderAtUrl(META_BASE);

    // The index route's <Navigate replace/> rewrites the URL to the default.
    // Use the pathname probe to assert the post-redirect URL.
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${META_BASE}/application`
      );
    });

    // MetaModelView should still mount (the redirect lands inside the same
    // parent route, so the MetaModelView element is rendered the whole time).
    expect(screen.getByTestId('top-bar-stub')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 2: deep-link to `/metamodel/data` selects the data domain.
  //
  // Asserted via the DomainSelector's active-button styling. The button's
  // `aria-title` matches the domain label, and the className contains
  // `selected` (CSS module class) for the active button.
  // ---------------------------------------------------------------------------
  it('refresh on /metamodel/data renders the view with the data domain selected', async () => {
    renderAtUrl(`${META_BASE}/data`);

    // Wait for MetaModelView to mount (DomainSelector renders five buttons,
    // one per domain. We look for the "Data" button by title and verify
    // its className contains `selected`.).
    const dataButton = await waitFor(() => {
      const btn = screen.getByTitle('Data');
      // Defensive: ensure it is the styled button, not a fallback element.
      expect(btn.tagName.toLowerCase()).toBe('button');
      return btn;
    });
    expect(dataButton.className).toMatch(/selected/);

    // Other buttons should NOT be selected.
    const businessButton = screen.getByTitle('Business');
    expect(businessButton.className).not.toMatch(/selected/);
  });

  // ---------------------------------------------------------------------------
  // Test 3: every legal URL token mounts the view without redirecting.
  //
  // Parameterised via `it.each` to keep the test count low while covering
  // all six locked URL tokens.
  // ---------------------------------------------------------------------------
  it.each([
    'application',
    'data',
    'business',
    'behavioural',
    'ui',
  ])('legal domain URL /metamodel/%s mounts the view and stays on the URL', async (urlToken) => {
    renderAtUrl(`${META_BASE}/${urlToken}`);

    // The pathname probe should still report the original URL (no redirect).
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${META_BASE}/${urlToken}`
      );
    });

    // The top bar shell mounts (proves we are still inside AppShell, not on
    // the 404 page).
    expect(screen.getByTestId('top-bar-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Test 4: clicking a DomainSelector button navigates to the new URL.
  //
  // Drives the assertion via the pathname probe rather than mocking
  // `useNavigate` -- this proves the DomainSelector actually performs a
  // real route change rather than just calling a no-op handler.
  // ---------------------------------------------------------------------------
  it('clicking a DomainSelector button navigates to /metamodel/<urlValue>', async () => {
    const { user } = renderAtUrl(`${META_BASE}/application`);

    // Wait for the mount.
    await screen.findByTitle('Application');

    // Click the Data button.
    await user.click(screen.getByTitle('Data'));

    // Pathname probe reflects the new URL (and not a query/hash mutation).
    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${META_BASE}/data`
      );
    });

    // The Data button is now selected; the Application button is not.
    expect(screen.getByTitle('Data').className).toMatch(/selected/);
    expect(screen.getByTitle('Application').className).not.toMatch(/selected/);
  });

  // ---------------------------------------------------------------------------
  // Test 5: invalid `:domain` token redirects to the default.
  //
  // The MetaModelView component renders `<Navigate replace/>` when the
  // URL token is not one of the six legal values. The redirect target is
  // the default applications URL.
  // ---------------------------------------------------------------------------
  it('invalid /metamodel/bogus redirects to /metamodel/application', async () => {
    renderAtUrl(`${META_BASE}/bogus`);

    await waitFor(() => {
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${META_BASE}/application`
      );
    });

    // Sanity: NOT the 404 page.
    expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('top-bar-stub')).toBeInTheDocument();
  });
});
