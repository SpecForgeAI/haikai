/**
 * Comprehensive Frontend Routing -- TopBar Nav Button Sweep
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 9 (Task 9.4)
 *
 * Cross-tier verification: every TopBar nav button click results in the
 * canonical-URL navigation, and the URL change is what drives the
 * active-button styling on the next render. This is safety property (c) --
 * "every TopBar nav button click results in window.location.pathname
 * changing" -- with FULL coverage across all four nav buttons (Group 1
 * already covers ONE button as a smoke test).
 *
 * Parameterised via `it.each` to keep the test count low while covering
 * every nav button exposed by `TopBar`. The TopBar itself is NOT stubbed
 * here (the buttons ARE the SUT).
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
    loadModelByProjectId: vi.fn(),
    loadModelByFilename: vi.fn(),
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

// Heavy view stubs (TopBar is intentionally NOT stubbed -- it is the SUT).
vi.mock('../../components/DashboardView/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view-stub" />,
}));
vi.mock('../../components/MetaModelView/MetaModelView', () => ({
  MetaModelView: () => <div data-testid="meta-model-view-stub" />,
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
vi.mock('../../components/UnifiedChat', () => ({
  UnifiedChatPanel: () => <div data-testid="unified-chat-stub" />,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
import { listArchitectures } from '../../api/architecturesApi';
import {
  renderWithFullApp,
  setupDefaultMocks,
  teardownDefaultMocks,
  buildProjectFixture,
  buildArchitectureFixture,
  DEFAULT_PROJECT_ID,
  DEFAULT_ARCH_ID,
} from './testUtils';

// ============================================================================
// Helpers
// ============================================================================

const ARCH_BASE = `/projects/${DEFAULT_PROJECT_ID}/architectures/${DEFAULT_ARCH_ID}`;

function PathnameProbe() {
  const location = useLocation();
  return <div data-testid="pathname-probe">{location.pathname}</div>;
}

function renderAtUrl(url: string) {
  vi.mocked(useProject).mockReturnValue(buildProjectFixture());
  vi.mocked(useProjectLoading).mockReturnValue(false);
  vi.mocked(listArchitectures).mockResolvedValue([buildArchitectureFixture()]);
  return renderWithFullApp(url, { extra: <PathnameProbe /> });
}

// ============================================================================
// Tests
// ============================================================================

describe('Comprehensive Frontend Routing -- TopBar Nav Button Sweep (Task 9.4)', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    teardownDefaultMocks();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1 (parameterised): every TopBar nav button click changes the URL
  // to the canonical architecture-scoped URL for that view.
  //
  // Starts the app on `/dashboard` and clicks each of the four nav buttons
  // in turn. The pathname probe asserts the URL changed; the active styling
  // assertion proves the URL drives styling (no stale `state.currentView`).
  //
  // The four buttons exposed by TopBar:
  //   - dashboard-nav-button     -> /dashboard
  //   - product-nav-button       -> /product
  //   - architecture-nav-button  -> /metamodel
  //   - diagrams-nav-button      -> /diagrams
  // ---------------------------------------------------------------------------
  it.each([
    {
      buttonTestId: 'product-nav-button',
      expectedSegment: 'product',
    },
    {
      buttonTestId: 'architecture-nav-button',
      expectedSegment: 'metamodel',
    },
    {
      buttonTestId: 'diagrams-nav-button',
      expectedSegment: 'diagrams',
    },
    {
      buttonTestId: 'dashboard-nav-button',
      expectedSegment: 'dashboard',
    },
  ])(
    'clicking $buttonTestId navigates to $expectedSegment (URL changes; active styling follows URL)',
    async ({ buttonTestId, expectedSegment }) => {
      // Start each test on `/metamodel` so that clicking `architecture-nav-button`
      // (which targets `/metamodel`) still produces a NAV (otherwise the
      // assertion would race against the no-op condition). The wider test
      // covers all four buttons; we navigate from a non-target URL each
      // time.
      const startUrl =
        expectedSegment === 'dashboard' ? `${ARCH_BASE}/diagrams` : `${ARCH_BASE}/dashboard`;
      const { user } = renderAtUrl(startUrl);

      // The starting view mounts.
      await waitFor(() => {
        expect(screen.getByTestId('pathname-probe').textContent).toBe(startUrl);
      });

      // Find the nav button by testid (real TopBar -- buttons exist).
      const button = await screen.findByTestId(buttonTestId);
      expect(button).toBeInTheDocument();

      // Click it.
      await user.click(button);

      // Pathname switches to the canonical view URL.
      await waitFor(() => {
        expect(screen.getByTestId('pathname-probe').textContent).toBe(
          `${ARCH_BASE}/${expectedSegment}`
        );
      });

      // Active-button styling reflects the URL on the next render.
      // The TopBar applies the `.active` class (CSS module) to whichever
      // button matches `useCurrentView()`. We query via testid + className
      // substring `active` to stay robust to CSS module hashing.
      await waitFor(() => {
        const refreshed = screen.getByTestId(buttonTestId);
        expect(refreshed.className).toMatch(/active/);
      });
    }
  );
});
