/**
 * MigrationDeliveryPlanRoute tests
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 *   agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md
 * Follow-up wiring (2026-06-03): the generation wizard + draft list were built
 * + unit-tested but never mounted behind a production route. This test covers
 * ONLY the new wiring:
 *   1. The landing route renders the wizard (modal) + the draft list, and feeds
 *      the project's architectures (from `listArchitectures`) into the wizard's
 *      Stage-1 pickers.
 *   2. On `onGenerationComplete`, the route navigates to the architecture-scoped
 *      review URL for the returned draft id.
 *   3. Clicking a draft-list row navigates to the review URL for that draft id.
 *
 * The wizard / review / draft-list internals are covered by their own tests;
 * we do not re-drive the 7 stages here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const PROJECT_ID = 'proj-route-1';
const ARCH_ID = 'arch-route-1';
const TARGET_ARCH_ID = 'arch-route-2';

// --- Mock CSS modules pulled in by the wizard + draft list -----------------
vi.mock('../MigrationDeliveryPlanWizard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// --- Mock architectures API -------------------------------------------------
const mockListArchitectures = vi.fn();
vi.mock('../../../../api/architecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architecturesApi')
  >('../../../../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: (...args: unknown[]) => mockListArchitectures(...args),
  };
});

// --- Mock the draft-list API (called on mount by the list view) ------------
const mockListMigrationBookOfWorks = vi.fn();
vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    listMigrationBookOfWorks: (...args: unknown[]) =>
      mockListMigrationBookOfWorks(...args),
  };
});

// --- Mock the gateway generate call (wizard Stage-7 Generate button) -------
const mockGenerateMigrationDeliveryPlan = vi.fn();
vi.mock('../../../../api/migrationDeliveryPlanApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryPlanApi')
  >('../../../../api/migrationDeliveryPlanApi');
  return {
    ...actual,
    generateMigrationDeliveryPlan: (...args: unknown[]) =>
      mockGenerateMigrationDeliveryPlan(...args),
  };
});

// --- Mock the discovery-context fetcher (wizard Stage-1 self-fetch) ---------
// The route mounts the REAL wizard. The wizard only fetches context once an
// architecture is picked; we pre-select current via the route, so stub it so
// no real fetch fires.
vi.mock('../../../../api/migrationDiscoveryContextApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDiscoveryContextApi')
  >('../../../../api/migrationDiscoveryContextApi');
  return {
    ...actual,
    // Literal values only -- vi.mock factories are hoisted above the
    // top-level const declarations, so no outer variables may be referenced
    // here. The resolved content is irrelevant to the wiring assertions.
    fetchMigrationDiscoveryContext: vi.fn().mockResolvedValue({
      projectId: 'proj-route-1',
      currentArchitectureId: 'arch-route-1',
      targetArchitectureId: null,
      generatedAt: '2026-05-17T10:00:00Z',
    }),
  };
});

import { MigrationDeliveryPlanRoute } from '../MigrationDeliveryPlanRoute';
import type { Architecture } from '../../../../api/architecturesApi';
import type { MigrationBookOfWorkDraft } from '../../../../api/migrationBookOfWorkApi';

function buildArchitecture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: ARCH_ID,
    projectId: PROJECT_ID,
    name: 'Current architecture',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildDraft(
  overrides: Partial<MigrationBookOfWorkDraft> = {},
): MigrationBookOfWorkDraft {
  return {
    id: 'draft-existing-1',
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    status: 'draft',
    title: 'Existing plan',
    summary: 'Summary',
    generationInputs: null,
    generationSummary: null,
    qualityAssessment: null,
    bookOfWork: { items: [] },
    createdAt: '2026-05-17T10:00:00Z',
    updatedAt: '2026-05-17T10:00:00Z',
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    ...overrides,
  };
}

/** Probe that records the pathname it renders at (the review URL target). */
function ReviewProbe() {
  const location = useLocation();
  return <div data-testid="review-probe">{location.pathname}</div>;
}

function renderRoute() {
  const base = `/projects/${PROJECT_ID}/architectures/${ARCH_ID}`;
  return render(
    <MemoryRouter initialEntries={[`${base}/migration-delivery-plan`]}>
      <Routes>
        <Route path="/projects/:projectId/architectures/:architectureId">
          <Route
            path="migration-delivery-plan"
            element={<MigrationDeliveryPlanRoute />}
          />
          <Route
            path="migration-books-of-work/:bookId/review"
            element={<ReviewProbe />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('MigrationDeliveryPlanRoute (follow-up wiring)', () => {
  beforeEach(() => {
    mockListArchitectures.mockReset();
    mockListMigrationBookOfWorks.mockReset();
    mockGenerateMigrationDeliveryPlan.mockReset();
  });

  it('renders the generation wizard (modal) and feeds the project architectures into Stage 1', async () => {
    mockListArchitectures.mockResolvedValueOnce([
      buildArchitecture(),
      buildArchitecture({ id: TARGET_ARCH_ID, name: 'Target architecture' }),
    ]);
    mockListMigrationBookOfWorks.mockResolvedValueOnce([]);

    renderRoute();

    // The wizard modal renders (renders nothing when open=false; here open).
    await waitFor(() =>
      expect(screen.getByTestId('mdp-wizard')).toBeInTheDocument(),
    );
    // listArchitectures was called for this project.
    await waitFor(() =>
      expect(mockListArchitectures).toHaveBeenCalledWith(PROJECT_ID),
    );
    // Architecture names appear as <option>s in the Stage-1 pickers. Both the
    // current AND target selects render the same option set, so the label
    // appears more than once -- assert at least one is present.
    await waitFor(() =>
      expect(
        screen.getAllByRole('option', { name: 'Target architecture' }).length,
      ).toBeGreaterThan(0),
    );
    // The current-arch select is pre-selected to the route's architectureId.
    const currentSelect = screen.getByTestId(
      'mdp-wizard-current-arch',
    ) as HTMLSelectElement;
    expect(currentSelect.value).toBe(ARCH_ID);
  });

  it('renders the existing-drafts list', async () => {
    mockListArchitectures.mockResolvedValueOnce([buildArchitecture()]);
    mockListMigrationBookOfWorks.mockResolvedValueOnce([buildDraft()]);

    renderRoute();

    await waitFor(() =>
      expect(screen.getByTestId('draft-list-view')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('draft-list-row-draft-existing-1'),
      ).toBeInTheDocument(),
    );
  });

  it('navigates to the review URL when the wizard completes generation', async () => {
    mockListArchitectures.mockResolvedValueOnce([
      buildArchitecture(),
      buildArchitecture({ id: TARGET_ARCH_ID, name: 'Target architecture' }),
    ]);
    mockListMigrationBookOfWorks.mockResolvedValueOnce([]);

    // Drive the wizard to completion through the real component; the gateway
    // generate call is mocked to return a new draft id.
    mockGenerateMigrationDeliveryPlan.mockResolvedValueOnce({
      draftId: 'draft-generated-1',
      summary: 'Generated',
    });

    renderRoute();

    await waitFor(() =>
      expect(screen.getByTestId('mdp-wizard')).toBeInTheDocument(),
    );

    // Drive the wizard: current arch is pre-selected; pick a target, advance
    // through the stages, then Generate. We mock generate via the API module.
    fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
      target: { value: TARGET_ARCH_ID },
    });
    // Stage 1 -> 2
    fireEvent.click(screen.getByTestId('mdp-wizard-next'));
    // Stage 2 requires >=1 intent.
    fireEvent.click(
      screen.getByTestId('mdp-wizard-intent-unsure_infer_from_context'),
    );
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // 2 -> 3
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // 3 -> 4
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // 4 -> 5
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // 5 -> 6
    fireEvent.click(screen.getByTestId('mdp-wizard-next')); // 6 -> 7
    fireEvent.click(screen.getByTestId('mdp-wizard-generate'));

    await waitFor(() =>
      expect(screen.getByTestId('review-probe')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('review-probe')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/migration-books-of-work/draft-generated-1/review`,
    );
  });

  it('navigates to the review URL when an existing draft row is clicked', async () => {
    mockListArchitectures.mockResolvedValueOnce([buildArchitecture()]);
    mockListMigrationBookOfWorks.mockResolvedValueOnce([buildDraft()]);

    renderRoute();

    await waitFor(() =>
      expect(
        screen.getByTestId('draft-list-row-draft-existing-1'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('draft-list-row-draft-existing-1'));

    await waitFor(() =>
      expect(screen.getByTestId('review-probe')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('review-probe')).toHaveTextContent(
      `/projects/${PROJECT_ID}/architectures/${ARCH_ID}/migration-books-of-work/draft-existing-1/review`,
    );
  });
});
