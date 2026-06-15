/**
 * CapabilitiesSection — carry_over completeness gate (D4) tests.
 *
 * Spec: 2026-06-14 D4 — Carry-over Completeness Gate — Task Group 4.1.
 *
 * Covers the D4 extension to the D2 read-only Capabilities-in-Findings view:
 *   (a) the per-capability COVERAGE-STATUS column (un-actioned / cited-by-story /
 *       dismissed), sourced from GET .../carry-over-coverage;
 *   (b) the per-capability CITE ("Create story") action → citeCapability +
 *       a coverage refetch;
 *   (c) the per-capability DISMISS action with a MANDATORY reason →
 *       dismissCarryOverItem + a coverage refetch;
 *   (d) the "Generate all capability stories" BATCH trigger →
 *       generateAllCapabilityStories + a coverage refetch.
 *
 * The api module is mocked (HARD rule); URL shape is owned by the gateway tests.
 * When NO `bookId` is supplied the section stays the pure read-only D2 view (no
 * coverage fetch, no actions) — the existing FindingsTab discovery callers
 * are unaffected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import type { DiscoveryCapabilityDto } from '../../api/capabilitiesApi';
import type { CarryOverCoverageResult } from '../../api/carryOverCoverageApi';

// ----------------------------------------------------------------------------
// Mocks — capabilitiesApi (the list read) + carryOverCoverageApi (D4 read +
// actions). Real DTO helpers (readCapabilityDetail) are kept via importActual.
// ----------------------------------------------------------------------------

const mockListCapabilitiesByRun = vi.fn();
const mockGetCarryOverCoverage = vi.fn();
const mockCiteCapability = vi.fn();
const mockDismissCarryOverItem = vi.fn();
const mockGenerateAllCapabilityStories = vi.fn();

vi.mock('../../api/capabilitiesApi', async () => {
  const actual =
    await vi.importActual<typeof import('../../api/capabilitiesApi')>(
      '../../api/capabilitiesApi',
    );
  return {
    ...actual,
    listCapabilitiesByRun: (...args: unknown[]) =>
      mockListCapabilitiesByRun(...args),
  };
});

vi.mock('../../api/carryOverCoverageApi', async () => {
  const actual =
    await vi.importActual<typeof import('../../api/carryOverCoverageApi')>(
      '../../api/carryOverCoverageApi',
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

vi.mock('./CapabilitiesSection.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Import AFTER mocks
import { CapabilitiesSection } from './CapabilitiesSection';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const RUN_ID = 'run-1';
const BOOK_ID = 'book-1';

function makeCapability(
  overrides: Partial<DiscoveryCapabilityDto> = {},
): DiscoveryCapabilityDto {
  return {
    id: 'cap-1',
    run_id: RUN_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'Daily Risk Hierarchy Load Pipeline',
    kind: 'batch_pipeline',
    summary: 'Loads the daily risk hierarchy.',
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

beforeEach(() => {
  vi.clearAllMocks();
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
  mockGenerateAllCapabilityStories.mockResolvedValue({
    citedCount: 1,
    skippedCount: 0,
    failures: [],
  });
});

// ----------------------------------------------------------------------------
// (a) Coverage-status column
// ----------------------------------------------------------------------------

describe('CapabilitiesSection carry_over coverage column (D4 Group 4)', () => {
  it('renders the per-capability coverage status from carry-over-coverage', async () => {
    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    await waitFor(() =>
      expect(mockGetCarryOverCoverage).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID),
    );

    const statusCell = await screen.findByTestId('capability-coverage-cap-1');
    expect(statusCell).toHaveTextContent(/un-actioned/i);
  });

  it('renders cited-by-story and dismissed statuses', async () => {
    mockListCapabilitiesByRun.mockResolvedValue([
      makeCapability({ id: 'cap-cited' }),
      makeCapability({ id: 'cap-dismissed' }),
    ]);
    mockGetCarryOverCoverage.mockResolvedValue(
      makeCoverage([
        {
          kind: 'capability',
          id: 'cap-cited',
          status: 'cited-by-story',
          behaviourBearing: true,
          label: 'cap-cited',
        },
        {
          kind: 'capability',
          id: 'cap-dismissed',
          status: 'dismissed',
          behaviourBearing: true,
          label: 'cap-dismissed',
        },
      ]),
    );

    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    expect(
      await screen.findByTestId('capability-coverage-cap-cited'),
    ).toHaveTextContent(/cited-by-story/i);
    expect(
      await screen.findByTestId('capability-coverage-cap-dismissed'),
    ).toHaveTextContent(/dismissed/i);
  });

  it('does NOT fetch coverage or render actions when no bookId is supplied (read-only D2 view)', async () => {
    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
      />,
    );

    await waitFor(() =>
      expect(mockListCapabilitiesByRun).toHaveBeenCalled(),
    );
    expect(mockGetCarryOverCoverage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('capability-cite-cap-1')).toBeNull();
    expect(
      screen.queryByTestId('capabilities-generate-all-stories'),
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// (b) Cite action
// ----------------------------------------------------------------------------

describe('CapabilitiesSection cite action (D4 Group 4)', () => {
  it('cites a capability via citeCapability and refreshes coverage', async () => {
    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    const citeBtn = await screen.findByTestId('capability-cite-cap-1');
    // First coverage fetch happened on mount.
    await waitFor(() =>
      expect(mockGetCarryOverCoverage).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(citeBtn);

    await waitFor(() =>
      expect(mockCiteCapability).toHaveBeenCalledWith(
        PROJECT_ID,
        BOOK_ID,
        expect.objectContaining({
          source_capability_id: 'cap-1',
          title: 'Daily Risk Hierarchy Load Pipeline',
        }),
      ),
    );
    // Refresh after the action.
    await waitFor(() =>
      expect(mockGetCarryOverCoverage).toHaveBeenCalledTimes(2),
    );
  });
});

// ----------------------------------------------------------------------------
// (c) Dismiss action (mandatory reason)
// ----------------------------------------------------------------------------

describe('CapabilitiesSection dismiss action (D4 Group 4)', () => {
  it('dismisses a capability with a mandatory reason and refreshes coverage', async () => {
    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    const dismissBtn = await screen.findByTestId('capability-dismiss-cap-1');
    fireEvent.click(dismissBtn);

    // The reason prompt appears; type a reason and confirm.
    const reasonInput = await screen.findByTestId('capability-dismiss-reason-cap-1');
    fireEvent.change(reasonInput, {
      target: { value: 'Dead batch — retired in target.' },
    });
    fireEvent.click(screen.getByTestId('capability-dismiss-confirm-cap-1'));

    await waitFor(() =>
      expect(mockDismissCarryOverItem).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          kind: 'capability',
          id: 'cap-1',
          architecture_id: ARCH_ID,
          reason: 'Dead batch — retired in target.',
        }),
      ),
    );
    await waitFor(() =>
      expect(mockGetCarryOverCoverage).toHaveBeenCalledTimes(2),
    );
  });

  it('blocks dismiss confirm while the reason is empty (mandatory reason)', async () => {
    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    fireEvent.click(await screen.findByTestId('capability-dismiss-cap-1'));
    const confirm = await screen.findByTestId('capability-dismiss-confirm-cap-1');
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mockDismissCarryOverItem).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// (d) Batch trigger
// ----------------------------------------------------------------------------

describe('CapabilitiesSection generate-all batch (D4 Group 4)', () => {
  it('runs the batch via generateAllCapabilityStories and refreshes coverage', async () => {
    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    const batchBtn = await screen.findByTestId('capabilities-generate-all-stories');
    fireEvent.click(batchBtn);

    await waitFor(() =>
      expect(mockGenerateAllCapabilityStories).toHaveBeenCalledWith(
        PROJECT_ID,
        BOOK_ID,
      ),
    );
    await waitFor(() =>
      expect(mockGetCarryOverCoverage).toHaveBeenCalledTimes(2),
    );
  });
});
