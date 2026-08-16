/**
 * ProductView -- Create Migration Delivery Plan launch button
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 *   agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md
 * Follow-up wiring (2026-06-03): the generation wizard was built + unit-tested
 * but never mounted behind a production button. This test covers ONLY the new
 * wiring -- that the launch button sits next to the existing "Upload Book of
 * Work" button and navigates to the architecture-scoped landing route. The
 * wizard / review / draft-list internals are covered by their own tests.
 *
 * Test strategy: render <ProductView/> at the roadmap URL inside a
 * <MemoryRouter>. `RoadmapTab` is stubbed so it publishes a synthetic
 * `roadmapControlState` (carrying `projectId`) up through the product outlet
 * context on mount -- this is what makes the roadmap control row (and the two
 * launch buttons) render. `useActiveArchitectureId` is mocked so the button's
 * navigation target is deterministic without mounting the real
 * ArchitectureProvider. A probe route at the landing URL proves navigation.
 */

import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  useOutletContext,
  useLocation,
} from 'react-router-dom';

const PROJECT_ID = 'proj-launch-1';
const ARCH_ID = 'arch-launch-1';

// --- Mock the CSS module so class-name lookups resolve to plain strings ----
vi.mock('../ProductView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// --- Mock AppConfig so the Mission tab / database gating is deterministic ---
vi.mock('../../../contexts/AppConfigContext', () => ({
  useIncludeDatabase: () => true,
}));

// --- Mock the active-architecture selector ---------------------------------
vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => ARCH_ID,
}));

// --- Mock bookOfWork upload API (imported by ProductView) ------------------
vi.mock('../../../api/bookOfWorkApi', () => ({
  uploadBookOfWork: vi.fn().mockResolvedValue(undefined),
}));

// --- Stub RoadmapTab: publish a synthetic control state on mount -----------
// The real RoadmapTab pulls in a heavy tree (panels, chat, model). We only
// need it to publish `roadmapControlState` so ProductView renders the control
// row + launch buttons.
interface ProductOutletContextLike {
  setRoadmapControlState: (state: unknown) => void;
}
vi.mock('../RoadmapTab', () => ({
  RoadmapTab: () => {
    const { setRoadmapControlState } =
      useOutletContext<ProductOutletContextLike>();
    useEffect(() => {
      setRoadmapControlState({
        importing: false,
        lastImportedMetadata: null,
        loadingMetadata: false,
        handleImport: () => {},
        isImportDisabled: false,
        projectId: PROJECT_ID,
        refreshWorkItems: async () => {},
      });
    }, [setRoadmapControlState]);
    return <div data-testid="roadmap-tab-stub" />;
  },
}));

// Stub the other tab bodies so they don't drag in heavy trees.
vi.mock('../MissionTab', () => ({ MissionTab: () => <div /> }));
vi.mock('../BacklogTab', () => ({ BacklogTab: () => <div /> }));
vi.mock('../ImplementTab', () => ({ ImplementTab: () => <div /> }));

import { ProductView } from '../ProductView';
// Imported AFTER the vi.mock above so this is the stubbed RoadmapTab.
import { RoadmapTab } from '../RoadmapTab';

/** Probe that records the pathname it renders at. */
function LandingProbe() {
  const location = useLocation();
  return <div data-testid="landing-probe">{location.pathname}</div>;
}

function renderProductViewAtRoadmap() {
  const base = `/projects/${PROJECT_ID}/architectures/${ARCH_ID}`;
  return render(
    <MemoryRouter initialEntries={[`${base}/product/roadmap`]}>
      <Routes>
        <Route path="/projects/:projectId/architectures/:architectureId">
          <Route path="product" element={<ProductView />}>
            <Route path="roadmap" element={<RoadmapTab />} />
            <Route
              path="backlog"
              element={<div data-testid="backlog-probe" />}
            />
          </Route>
          <Route path="migration-delivery-plan" element={<LandingProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProductView -- Create Migration Delivery Plan launch button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the launch button next to Upload Book of Work on the roadmap tab', async () => {
    renderProductViewAtRoadmap();

    // The control row only renders once RoadmapTab publishes control state.
    await waitFor(() =>
      expect(
        screen.getByTestId('upload-book-of-work-button'),
      ).toBeInTheDocument(),
    );
    const launch = screen.getByTestId('create-migration-delivery-plan-button');
    expect(launch).toBeInTheDocument();
    // 2026-08-16: navigation button, not a create action — the plan exists
    // after the first visit, so no "Create" verb.
    expect(launch).toHaveTextContent('Migration Delivery Plan');
    // Both buttons live in the same control-row button group (siblings).
    expect(launch.parentElement).toBe(
      screen.getByTestId('upload-book-of-work-button').parentElement,
    );
    // The upload button still exists (we did not remove it).
    expect(launch).not.toBe(screen.getByTestId('upload-book-of-work-button'));
  });

  it('navigates to the architecture-scoped migration-delivery-plan route on click', async () => {
    renderProductViewAtRoadmap();

    await waitFor(() =>
      expect(
        screen.getByTestId('create-migration-delivery-plan-button'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByTestId('create-migration-delivery-plan-button'),
    );

    await waitFor(() =>
      expect(screen.getByTestId('landing-probe')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('landing-probe')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/migration-delivery-plan`,
    );
  });
});
