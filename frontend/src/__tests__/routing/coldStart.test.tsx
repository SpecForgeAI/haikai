/**
 * Comprehensive Frontend Routing -- Cold-Start Refresh Sweep
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 9 (Task 9.4)
 *
 * Cross-tier verification: refreshing the page on every top-level URL from
 * the locked URL list lands on the correct view inside the AppShell, with
 * the URL-derived architecture id available immediately and no empty
 * TopBar shell. This is safety property (d) -- "refreshing on any URL
 * renders the correct view + sub-state" -- exercised at the TOP-LEVEL
 * route granularity (per-sub-route coverage lives in `subRoutes.test.tsx`).
 *
 * Parameterised via `it.each` to keep the test count low while covering
 * all five top-level architecture-scoped URLs.
 *
 * Pre-existing failures listed in project memory + spec are out of scope
 * and are NOT addressed here.
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
    listArchitectures: vi.fn(),
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

// Heavy view stubs -- expose the URL-derived architecture id from each view
// stub so we can assert the provider hydrates the id in time for the view
// to read it (Group 1 safety property a).
vi.mock('../../components/DashboardView/DashboardView', async () => {
  const archCtx = await vi.importActual<
    typeof import('../../contexts/ArchitectureContext')
  >('../../contexts/ArchitectureContext');
  return {
    DashboardView: () => {
      const id = archCtx.useActiveArchitectureId();
      return (
        <div data-testid="dashboard-view-stub" data-arch-id={id ?? 'NULL'} />
      );
    },
  };
});
vi.mock('../../components/MetaModelView/MetaModelView', async () => {
  const archCtx = await vi.importActual<
    typeof import('../../contexts/ArchitectureContext')
  >('../../contexts/ArchitectureContext');
  return {
    MetaModelView: () => {
      const id = archCtx.useActiveArchitectureId();
      return (
        <div data-testid="meta-model-view-stub" data-arch-id={id ?? 'NULL'} />
      );
    },
  };
});
vi.mock('../../components/DiagramsView/DiagramsView', async () => {
  const archCtx = await vi.importActual<
    typeof import('../../contexts/ArchitectureContext')
  >('../../contexts/ArchitectureContext');
  return {
    DiagramsView: () => {
      const id = archCtx.useActiveArchitectureId();
      return (
        <div data-testid="diagrams-view-stub" data-arch-id={id ?? 'NULL'} />
      );
    },
  };
});
vi.mock('../../components/ProductView/ProductView', async () => {
  const archCtx = await vi.importActual<
    typeof import('../../contexts/ArchitectureContext')
  >('../../contexts/ArchitectureContext');
  return {
    ProductView: () => {
      const id = archCtx.useActiveArchitectureId();
      return (
        <div data-testid="product-view-stub" data-arch-id={id ?? 'NULL'} />
      );
    },
  };
});
// Discovery list/detail pages are V1 stripped-down -- stub the heavy detail
// fetches so the cold-start mount completes without firing real network.
vi.mock('../../api/discoveryApi', async () => {
  const actual = await vi.importActual('../../api/discoveryApi');
  return {
    ...actual,
    getDiscoveryRuns: vi.fn(() => Promise.resolve([])),
    getDiscoveryRun: vi.fn(),
    getDiscoveryCandidateCount: vi.fn(() => Promise.resolve({ count: 0 })),
    getDiscoveryCandidates: vi.fn(),
    getDiscoveryRunSummary: vi.fn().mockResolvedValue({
      latest_run_id: null,
      latest_run_status: null,
      latest_run_created_at: null,
      total_candidates: 0,
      candidate_counts_by_status: {},
      entities_saved: 0,
      entity_type_coverage: 0,
    }),
  };
});

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
vi.mock('../../components/UnifiedChat', () => ({
  UnifiedChatPanel: () => <div data-testid="unified-chat-stub" />,
}));

// ============================================================================
// Imports (after mocks)
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

const ARCH_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}`;

/**
 * Probe component exposing the current pathname for assertions.
 */
function PathnameProbe() {
  const location = useLocation();
  return <div data-testid="pathname-probe">{location.pathname}</div>;
}

function renderAtUrl(url: string) {
  vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  vi.mocked(useProjectLoading).mockReturnValue(false);
  return renderWithFullApp(url, { extra: <PathnameProbe /> });
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- Cold-Start Top-Level URL Sweep (Task 9.4)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1 (parameterised): refresh on every top-level URL renders the correct
  // view inside the AppShell, with the URL-derived architecture id available
  // (no empty shell, no NULL arch id, no 404).
  //
  // Covers safety property (d, top-level) and reinforces (a) at every entry
  // point. The discovery URL maps to the `/discovery` index route which mounts
  // DiscoveryListPage (a real component, not stubbed -- verified by its
  // testid).
  // ---------------------------------------------------------------------------
  it.each([
    { url: 'dashboard', viewTestId: 'dashboard-view-stub' },
    { url: 'metamodel', viewTestId: 'meta-model-view-stub' },
    { url: 'diagrams', viewTestId: 'diagrams-view-stub' },
    { url: 'product', viewTestId: 'product-view-stub' },
    { url: 'discovery', viewTestId: 'discovery-list-page' },
  ])(
    'cold-start refresh on /$url mounts the correct view inside AppShell with the URL-derived arch id',
    async ({ url, viewTestId }) => {
      renderAtUrl(`${ARCH_BASE}/${url}`);

      // The AppShell renders.
      await screen.findByTestId('top-bar-stub');

      // The expected view mounts inside the shell.
      await waitFor(() => {
        expect(screen.getByTestId(viewTestId)).toBeInTheDocument();
      });

      // No 404 page rendered (URL was matched).
      expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();

      // For the four stubbed top-level views, the URL-derived arch id is
      // present immediately (proves Group 1 fix is wired end-to-end).
      // The discovery list page does not carry the probe attribute (it is
      // a real component, not a stub), so we skip the data-arch-id check
      // for it -- the absence of the 404 page already proves the URL was
      // matched.
      if (viewTestId !== 'discovery-list-page') {
        const view = screen.getByTestId(viewTestId);
        expect(view.getAttribute('data-arch-id')).toBe(DEFAULT_ARCH_ID);
      }

      // Pathname stays put (no redirect away from the requested URL).
      expect(screen.getByTestId('pathname-probe').textContent).toBe(
        `${ARCH_BASE}/${url}`
      );
    }
  );
});
