/**
 * MigrationDeliveryDashboard — carry_over review surface wiring (D4 closing pass).
 *
 * Spec: 2026-06-14 D4 — Carry-over Completeness Gate — closes the dashboard
 * wiring gap left after Task Group 4: the Migrate panel surfaced the
 * `carry_over_not_accounted` block but the dashboard never passed
 * `onReviewCarryOver`, so a blocked user had nowhere to go. This proves the loop
 * is now closed in-app:
 *
 *   blocked  →  click the deep-link  →  the BOOK-SCOPED Capabilities review
 *   surface opens (CapabilitiesSection mounted with the dashboard's bookId +
 *   currentArchitectureId → the carry-over coverage is fetched)  →  cite a
 *   capability  →  close the surface  →  the Migrate panel re-checks the gate
 *   (the stale server-side carry_over block clears so the user can retry).
 *
 * The carryOverCoverageApi + capabilitiesApi modules are mocked (HARD rule); all
 * dashboard side-fetches are stubbed via test-seam props so the render is
 * deterministic + offline. The gateway owns the real URL/gate behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test-utils/renderWithProviders';
import type {
  MigrationDeliveryDashboardDto,
  TriggerMigrateResult,
} from '../../../../api/migrationDeliveryDashboardApi';
import type { DiscoveryCapabilityDto } from '../../../../api/capabilitiesApi';
import type { CarryOverCoverageResult } from '../../../../api/carryOverCoverageApi';

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('../../../Discovery/CapabilitiesSection.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// The mounted CapabilitiesSection (book-scoped) reads capabilities + carry-over
// coverage and fires the cite action; mock both api modules.
const mockListCapabilitiesByProjectAndArchitecture = vi.fn();
const mockListCapabilitiesByRun = vi.fn();
const mockGetCarryOverCoverage = vi.fn();
const mockCiteCapability = vi.fn();
const mockDismissCarryOverItem = vi.fn();
const mockGenerateAllCapabilityStories = vi.fn();

vi.mock('../../../../api/capabilitiesApi', async () => {
  const actual =
    await vi.importActual<typeof import('../../../../api/capabilitiesApi')>(
      '../../../../api/capabilitiesApi',
    );
  return {
    ...actual,
    listCapabilitiesByRun: (...args: unknown[]) =>
      mockListCapabilitiesByRun(...args),
    listCapabilitiesByProjectAndArchitecture: (...args: unknown[]) =>
      mockListCapabilitiesByProjectAndArchitecture(...args),
  };
});

vi.mock('../../../../api/carryOverCoverageApi', async () => {
  const actual =
    await vi.importActual<typeof import('../../../../api/carryOverCoverageApi')>(
      '../../../../api/carryOverCoverageApi',
    );
  return {
    ...actual,
    getCarryOverCoverage: (...args: unknown[]) =>
      mockGetCarryOverCoverage(...args),
    citeCapability: (...args: unknown[]) => mockCiteCapability(...args),
    dismissCarryOverItem: (...args: unknown[]) =>
      mockDismissCarryOverItem(...args),
    generateAllCapabilityStories: (...args: unknown[]) =>
      mockGenerateAllCapabilityStories(...args),
  };
});

import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const ARCH_ID = 'arch-c';

type TriggerFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).triggerMigrate;
type FetchRunFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).getLatestMigrationExecutionRun;

/** A minimal, all-ready dashboard (so the Migrate button is enabled). */
function buildDashboard(): MigrationDeliveryDashboardDto {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: ARCH_ID,
    targetArchitectureId: 'arch-t',
    title: 'Book A',
    status: 'generated',
    generatedAt: '2026-06-14T00:00:00Z',
    summary: {
      totalInitiativeCount: 0,
      totalEpicCount: 0,
      totalFeatureCount: 0,
      totalStoryCount: 0,
      needsAttentionCount: 0,
    },
    hierarchy: [],
    workstreamSummaries: [],
    specGenerationSummary: {
      notAttemptedCount: 0,
      generatedCount: 0,
      generatedWithWarningsCount: 0,
      insufficientContextCount: 0,
      failedCount: 0,
      skippedBlockedCount: 0,
    },
    backlogSaveSummary: { savedCount: 0, notSavedToBacklogCount: 0 },
    implementationSummary: {
      notStartedCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
      completedCount: 0,
      activeCount: 0,
    },
    evidenceSummary: {
      evidenceReferenceCount: 0,
      discoveryFindingReferenceCount: 0,
      apiBaselineReferenceCount: 0,
      mappingReferenceCount: 0,
      architectureReferenceCount: 0,
      anyCoverageCount: 0,
    },
    needsAttention: [],
    warnings: [],
  };
}

function makeCapability(
  overrides: Partial<DiscoveryCapabilityDto> = {},
): DiscoveryCapabilityDto {
  return {
    id: 'cap-1',
    run_id: 'run-1',
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Daily Risk Hierarchy Load Pipeline',
    kind: 'batch_pipeline',
    summary: null,
    review_status: 'approved',
    previous_review_status: null,
    confidence: 0.9,
    detail_json: { behaviourBearing: true },
    source: 'discoveryV3Pipeline',
    created_by_stage: 'synthesis',
    created_at: '2026-06-14T00:00:00Z',
    updated_at: '2026-06-14T00:00:00Z',
    members: [],
    ...overrides,
  };
}

function makeCoverage(
  items: CarryOverCoverageResult['items'],
): CarryOverCoverageResult {
  const mustAccount = items.filter((i) => i.behaviourBearing);
  const unaccounted = mustAccount.filter((i) => i.status === 'un-actioned');
  return {
    items,
    mustAccount,
    unaccounted,
    accountedCount: mustAccount.length - unaccounted.length,
    totalMustAccount: mustAccount.length,
    ok: unaccounted.length === 0,
  };
}

function sideFetchSeams() {
  return {
    fetchStaleSpecSummary: vi
      .fn()
      .mockResolvedValue({ staleCount: 0, staleWorkItemIds: [] }),
    fetchReadyToRetry: vi
      .fn()
      .mockResolvedValue({ count: 0, specGenerationIds: [], specs: [] }),
    fetchBookOfWorkDraft: vi
      .fn()
      .mockResolvedValue({ generationSummary: null, bookOfWork: { items: [] } }),
  } as const;
}

const CARRY_OVER_BLOCKED: TriggerMigrateResult = {
  status: 'blocked',
  reasons: [
    {
      code: 'carry_over_not_accounted',
      message:
        'Behaviour-bearing carry_over capability "cap-1" is neither cited by a story nor dismissed.',
      workItemId: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListCapabilitiesByProjectAndArchitecture.mockResolvedValue([
    makeCapability(),
  ]);
  mockListCapabilitiesByRun.mockResolvedValue([makeCapability()]);
  mockGetCarryOverCoverage.mockResolvedValue(
    makeCoverage([
      {
        kind: 'capability',
        id: 'cap-1',
        status: 'un-actioned',
        behaviourBearing: true,
        label: 'cap-1',
      },
    ]),
  );
  mockCiteCapability.mockResolvedValue({ work_item_id: 'wi-1' });
  mockDismissCarryOverItem.mockResolvedValue({ ok: true });
});

// ----------------------------------------------------------------------------
// Helper: render the dashboard, drive Migrate to the server-blocked carry_over
// state, and return the wired mocks.
// ----------------------------------------------------------------------------

async function renderBlockedDashboard() {
  const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());
  const fetchRun = vi.fn().mockResolvedValue(null);
  const triggerFn = vi.fn().mockResolvedValue(CARRY_OVER_BLOCKED);

  renderWithProviders(
    <MigrationDeliveryDashboard
      projectId={PROJECT_ID}
      bookId={BOOK_ID}
      fetchDashboard={fetchDashboard}
      hasActiveCurrentBaseline
      company="acme"
      project="billing"
      triggerMigrateFn={triggerFn as unknown as TriggerFn}
      fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
      {...sideFetchSeams()}
    />,
    { initialEntries: [`/projects/${PROJECT_ID}/architectures/${ARCH_ID}/x`] },
  );

  await waitFor(() =>
    expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('mdd-migrate-button'));
  fireEvent.click(screen.getByTestId('mdd-migrate-confirm-yes'));
  await waitFor(() => expect(triggerFn).toHaveBeenCalledTimes(1));
  // The stale server-side carry_over block is now showing.
  await screen.findByTestId('mdd-migrate-server-blocked');

  return { fetchRun, triggerFn };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('MigrationDeliveryDashboard — carry_over review surface wiring (D4)', () => {
  it('clicking the blocked deep-link opens the BOOK-SCOPED Capabilities review surface', async () => {
    await renderBlockedDashboard();

    // Before the click the review surface is not mounted, so no coverage fetch.
    expect(mockGetCarryOverCoverage).not.toHaveBeenCalled();

    // The deep-link is clickable.
    const link = screen.getByTestId('mdd-migrate-carry-over-link');
    expect(link.tagName).toBe('BUTTON');
    fireEvent.click(link);

    // The book-scoped Capabilities review surface mounts: it fetches the
    // book-scoped carry-over coverage (proving it was mounted WITH the bookId)
    // and renders the coverage-status column for the capability.
    await waitFor(() =>
      expect(mockGetCarryOverCoverage).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID),
    );
    // Architecture-wide capability list (book review spans the runs the coverage
    // covers; no single run id), proving currentArchitectureId reached it.
    expect(
      mockListCapabilitiesByProjectAndArchitecture,
    ).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID);

    expect(
      await screen.findByTestId('capabilities-section'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('capability-coverage-cap-1'),
    ).toHaveTextContent(/un-actioned/i);
  });

  it('after a cite on the review surface and closing it, the Migrate gate is re-checked (stale block cleared)', async () => {
    const { fetchRun } = await renderBlockedDashboard();

    fireEvent.click(screen.getByTestId('mdd-migrate-carry-over-link'));
    await screen.findByTestId('capabilities-section');

    // Cite the capability on the review surface.
    fireEvent.click(await screen.findByTestId('capability-cite-cap-1'));
    await waitFor(() =>
      expect(mockCiteCapability).toHaveBeenCalledWith(
        PROJECT_ID,
        BOOK_ID,
        expect.objectContaining({ source_capability_id: 'cap-1' }),
      ),
    );

    // Close the review surface -> the dashboard bumps the panel refresh so the
    // gate is re-checked and the STALE server-side carry_over block clears (the
    // user can now retry Migrate, which the gateway re-validates as accounted).
    fetchRun.mockClear();
    fireEvent.click(screen.getByTestId('mdd-carry-over-review-close'));

    await waitFor(() =>
      expect(
        screen.queryByTestId('capabilities-section'),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('mdd-migrate-server-blocked'),
      ).not.toBeInTheDocument(),
    );
    // The gate was re-checked on close (run re-read).
    expect(fetchRun).toHaveBeenCalled();
  });
});
