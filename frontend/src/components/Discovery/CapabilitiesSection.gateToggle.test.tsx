/**
 * CapabilitiesSection — carry_over gate TOGGLE (frontend-action-driven).
 *
 * Spec: 2026-06-14 D4 — Carry-over Completeness Gate — Task Group 5 (strategic
 * gap fill).
 *
 * Group 3's gateway tests already prove the SERVER-SIDE gate toggles given
 * coverage inputs (startMigration BLOCKS on an un-actioned capability, UNBLOCKS
 * after a cited source_capability_id, UNBLOCKS after a dismissed disposition),
 * and Group 2 proves the pure roll-up / behaviourBearing=false rules. Those are
 * NOT re-tested here.
 *
 * The genuinely-uncovered cross-stack seam is the FRONTEND-ACTION-DRIVEN toggle:
 * that a cite / dismiss action on the extended Capabilities view triggers a
 * coverage REFETCH whose NEW per-item status FLIPS the rendered status column
 * (un-actioned -> cited-by-story / dismissed) and clears the gate-summary line.
 * This is the UI-side analogue of the gateway gate-toggle, end to end through
 * the api seam.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders';
import type { DiscoveryCapabilityDto } from '../../api/capabilitiesApi';
import type {
  CarryOverCoverageResult,
  CoverageStatus,
} from '../../api/carryOverCoverageApi';

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

import { CapabilitiesSection } from './CapabilitiesSection';

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

function coverageWith(status: CoverageStatus): CarryOverCoverageResult {
  const item = {
    kind: 'capability' as const,
    id: 'cap-1',
    status,
    behaviourBearing: true,
    label: 'cap-1',
  };
  const unaccounted = status === 'un-actioned' ? [item] : [];
  return {
    items: [item],
    mustAccount: [item],
    unaccounted,
    accountedCount: 1 - unaccounted.length,
    totalMustAccount: 1,
    ok: unaccounted.length === 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListCapabilitiesByRun.mockResolvedValue([makeCapability()]);
  mockCiteCapability.mockResolvedValue({ work_item_id: 'wi-1' });
  mockDismissCarryOverItem.mockResolvedValue({ ok: true });
});

describe('CapabilitiesSection gate toggle (D4 Group 5)', () => {
  it('cite flips the column un-actioned -> cited-by-story and clears the gate summary', async () => {
    // First coverage fetch: un-actioned (gating). After cite: cited-by-story.
    mockGetCarryOverCoverage
      .mockResolvedValueOnce(coverageWith('un-actioned'))
      .mockResolvedValue(coverageWith('cited-by-story'));

    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    // Initially un-actioned + the gate summary reports the un-accounted item.
    expect(
      await screen.findByTestId('capability-coverage-cap-1'),
    ).toHaveTextContent(/un-actioned/i);
    expect(screen.getByTestId('capabilities-gate-summary')).toHaveTextContent(
      /un-accounted/i,
    );

    fireEvent.click(screen.getByTestId('capability-cite-cap-1'));

    // After the cite-driven refetch the column flips and the gate clears.
    await waitFor(() =>
      expect(
        screen.getByTestId('capability-coverage-cap-1'),
      ).toHaveTextContent(/cited-by-story/i),
    );
    expect(screen.getByTestId('capabilities-gate-summary')).toHaveTextContent(
      /accounted for/i,
    );
  });

  it('dismiss(reason) flips the column un-actioned -> dismissed and clears the gate summary', async () => {
    mockGetCarryOverCoverage
      .mockResolvedValueOnce(coverageWith('un-actioned'))
      .mockResolvedValue(coverageWith('dismissed'));

    renderWithProviders(
      <CapabilitiesSection
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        bookId={BOOK_ID}
      />,
    );

    expect(
      await screen.findByTestId('capability-coverage-cap-1'),
    ).toHaveTextContent(/un-actioned/i);

    fireEvent.click(screen.getByTestId('capability-dismiss-cap-1'));
    fireEvent.change(
      screen.getByTestId('capability-dismiss-reason-cap-1'),
      { target: { value: 'Retired in target.' } },
    );
    fireEvent.click(screen.getByTestId('capability-dismiss-confirm-cap-1'));

    await waitFor(() =>
      expect(
        screen.getByTestId('capability-coverage-cap-1'),
      ).toHaveTextContent(/dismissed/i),
    );
    expect(screen.getByTestId('capabilities-gate-summary')).toHaveTextContent(
      /accounted for/i,
    );
  });
});
