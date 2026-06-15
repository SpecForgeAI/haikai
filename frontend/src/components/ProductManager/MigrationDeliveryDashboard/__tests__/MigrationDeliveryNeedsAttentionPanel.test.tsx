/**
 * MigrationDeliveryNeedsAttentionPanel tests
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 10.9 -- Needs-attention panel + filters + Addition A coverage.
 *
 * Tests in this file (matching spec.md tests 25-30):
 *   1. (test 25) Filters narrow the panel rows by workstream + type.
 *   2. (test 26) Insufficient-context rows render `missingInputs[]` inline.
 *   3. (test 27) Both bulk-regenerate buttons disabled when zero matching
 *                rows; enabled otherwise.
 *   4. (test 28) Bulk regenerate honours ONLY needs-attention panel filters;
 *                hierarchy tree state is ignored (Q-4).
 *   5. (test 29) Bulk regenerate calls `startBatchGeneration` with
 *                `{ regenerateAll: true, targetWorkItemIds }` and shows the
 *                in-flight banner.
 *   6. (test 30) On batch completion, the parent's `onBatchComplete`
 *                callback fires (triggers full re-fetch in the dashboard).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock specGenerationApi BEFORE importing the component under test.
const mockStartBatch = vi.fn();
vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    startBatchGeneration: (...args: unknown[]) => mockStartBatch(...args),
  };
});

// Mock getMigrationDeliveryDashboard so any incidental import does not hit fetch.
const mockGetDashboard = vi.fn();
vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    getMigrationDeliveryDashboard: (...args: unknown[]) =>
      mockGetDashboard(...args),
  };
});

import { MigrationDeliveryNeedsAttentionPanel } from '../MigrationDeliveryNeedsAttentionPanel';
import type {
  MigrationDeliveryNeedsAttentionItemDto,
  MigrationDeliveryWorkstreamSummaryDto,
} from '../../../../api/migrationDeliveryDashboardApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function makeRow(
  overrides: Partial<MigrationDeliveryNeedsAttentionItemDto>,
): MigrationDeliveryNeedsAttentionItemDto {
  return {
    bookItemId: 'bi-x',
    workItemId: 'wi-x',
    type: 'failed',
    priorityRank: 1,
    title: 'A story',
    workstream: 'order-service',
    specGenerationStatus: 'failed',
    specGenerationConfidence: null,
    implementationStatus: 'not_started',
    reason: 'Generation failed',
    missingInputs: null,
    ...overrides,
  };
}

const ROWS: MigrationDeliveryNeedsAttentionItemDto[] = [
  // Two failed rows in different workstreams
  makeRow({
    bookItemId: 'bi-failed-1',
    workItemId: 'wi-failed-1',
    type: 'failed',
    title: 'Failed order story',
    workstream: 'order-service',
    reason: 'LLM error',
  }),
  makeRow({
    bookItemId: 'bi-failed-2',
    workItemId: 'wi-failed-2',
    type: 'failed',
    title: 'Failed payment story',
    workstream: 'payment-service',
    reason: 'LLM error',
  }),
  // One insufficient-context row with missingInputs entries
  makeRow({
    bookItemId: 'bi-insufficient-1',
    workItemId: 'wi-insufficient-1',
    type: 'insufficient_context',
    title: 'Insufficient ctx order story',
    workstream: 'order-service',
    specGenerationStatus: 'insufficient_context',
    reason: 'Spec generated with too few inputs',
    missingInputs: [
      { kind: 'mapping', id: 'map-1', reason: 'Mapping for order entity missing' },
      { kind: 'baseline', id: null, reason: 'No baseline contract found' },
    ],
  }),
  // One blocked row
  makeRow({
    bookItemId: 'bi-blocked-1',
    workItemId: 'wi-blocked-1',
    type: 'blocked',
    title: 'Blocked payment story',
    workstream: 'payment-service',
    reason: 'Story explicitly blocked',
    missingInputs: null,
  }),
];

const WORKSTREAMS: MigrationDeliveryWorkstreamSummaryDto[] = [
  {
    workstream: 'order-service',
    totalStoryCount: 5,
    savedToBacklogCount: 5,
    specGeneratedCount: 2,
    implementationActiveCount: 1,
    evidenceCoveredCount: 0,
    needsAttentionCount: 2,
  },
  {
    workstream: 'payment-service',
    totalStoryCount: 4,
    savedToBacklogCount: 4,
    specGeneratedCount: 1,
    implementationActiveCount: 0,
    evidenceCoveredCount: 0,
    needsAttentionCount: 2,
  },
];

function makeBatchResult() {
  return {
    perStoryResults: [],
    persistedCount: 0,
    resultsCouldNotPersist: 0,
    unpersistedResults: [],
    nextBatchStart: 0,
    summary: {
      generated: 0,
      generated_with_warnings: 0,
      insufficient_context: 0,
      failed: 0,
      skipped_blocked: 0,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockStartBatch.mockResolvedValue(makeBatchResult());
});

function renderPanel(
  overrides: {
    needsAttention?: MigrationDeliveryNeedsAttentionItemDto[];
    workstreamSummaries?: MigrationDeliveryWorkstreamSummaryDto[];
    onBatchComplete?: () => void;
  } = {},
) {
  const onBatchComplete = overrides.onBatchComplete ?? vi.fn();
  render(
    <MigrationDeliveryNeedsAttentionPanel
      projectId={PROJECT_ID}
      bookOfWorkId={BOOK_ID}
      needsAttention={overrides.needsAttention ?? ROWS}
      workstreamSummaries={overrides.workstreamSummaries ?? WORKSTREAMS}
      onBatchComplete={onBatchComplete}
    />,
  );
  return { onBatchComplete };
}

function selectFilter(testId: string, value: string) {
  const select = screen.getByTestId(testId) as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
}

// ----------------------------------------------------------------------------
// Test 1 (spec.md test 25): filters narrow the panel rows by workstream + type
// ----------------------------------------------------------------------------

describe('MigrationDeliveryNeedsAttentionPanel -- filters (test 25)', () => {
  it('narrows by workstream', async () => {
    renderPanel();

    // All four rows visible initially.
    expect(
      screen.getByTestId('mdd-needs-attention-row-bi-failed-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-needs-attention-row-bi-failed-2'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-needs-attention-row-bi-insufficient-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-needs-attention-row-bi-blocked-1'),
    ).toBeInTheDocument();

    selectFilter('mdd-needs-attention-filter-workstream', 'order-service');

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-needs-attention-row-bi-failed-1'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('mdd-needs-attention-row-bi-insufficient-1'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-failed-2'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-blocked-1'),
      ).not.toBeInTheDocument();
    });
  });

  it('narrows by type', async () => {
    renderPanel();

    selectFilter('mdd-needs-attention-filter-type', 'failed');

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-needs-attention-row-bi-failed-1'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('mdd-needs-attention-row-bi-failed-2'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-insufficient-1'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-blocked-1'),
      ).not.toBeInTheDocument();
    });
  });

  it('combines workstream + type filters', async () => {
    renderPanel();

    selectFilter('mdd-needs-attention-filter-workstream', 'payment-service');
    selectFilter('mdd-needs-attention-filter-type', 'failed');

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-needs-attention-row-bi-failed-2'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-failed-1'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-insufficient-1'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-blocked-1'),
      ).not.toBeInTheDocument();
    });
  });
});

// ----------------------------------------------------------------------------
// Test 2 (spec.md test 26): insufficient-context rows render missingInputs[]
// ----------------------------------------------------------------------------

describe('MigrationDeliveryNeedsAttentionPanel -- missingInputs inline (test 26 / Addition C)', () => {
  it('renders inline missingInputs entries for insufficient_context rows', () => {
    renderPanel();

    const missingInputsBlock = screen.getByTestId(
      'mdd-needs-attention-row-bi-insufficient-1-missing-inputs',
    );
    expect(missingInputsBlock).toBeInTheDocument();

    // Entry 0: kind=mapping, id=map-1
    expect(
      screen.getByTestId(
        'mdd-needs-attention-row-bi-insufficient-1-missing-inputs-entry-0',
      ),
    ).toHaveTextContent(/mapping/i);
    expect(
      screen.getByTestId(
        'mdd-needs-attention-row-bi-insufficient-1-missing-inputs-entry-0',
      ),
    ).toHaveTextContent(/map-1/);
    expect(
      screen.getByTestId(
        'mdd-needs-attention-row-bi-insufficient-1-missing-inputs-entry-0',
      ),
    ).toHaveTextContent(/Mapping for order entity missing/);

    // Entry 1: kind=baseline, id=null (no id rendered)
    expect(
      screen.getByTestId(
        'mdd-needs-attention-row-bi-insufficient-1-missing-inputs-entry-1',
      ),
    ).toHaveTextContent(/baseline/i);
    expect(
      screen.getByTestId(
        'mdd-needs-attention-row-bi-insufficient-1-missing-inputs-entry-1',
      ),
    ).toHaveTextContent(/No baseline contract found/);
  });

  it('does NOT render the missingInputs block on non-insufficient rows', () => {
    renderPanel();

    expect(
      screen.queryByTestId(
        'mdd-needs-attention-row-bi-failed-1-missing-inputs',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        'mdd-needs-attention-row-bi-blocked-1-missing-inputs',
      ),
    ).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// Test 3 (spec.md test 27): both bulk-regen buttons disabled when zero
// matching rows; enabled otherwise.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryNeedsAttentionPanel -- bulk-regen disabled state (test 27)', () => {
  it('enables both buttons when matching rows exist for both types', () => {
    renderPanel();

    expect(
      screen.getByTestId('mdd-needs-attention-bulk-regen-failed'),
    ).not.toBeDisabled();
    expect(
      screen.getByTestId('mdd-needs-attention-bulk-regen-insufficient'),
    ).not.toBeDisabled();
  });

  it('disables failed button when zero failed rows after filter', async () => {
    renderPanel();

    // Filter to type=insufficient_context -> no failed rows in the
    // filtered set.
    selectFilter('mdd-needs-attention-filter-type', 'insufficient_context');

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-needs-attention-bulk-regen-failed'),
      ).toBeDisabled();
      expect(
        screen.getByTestId('mdd-needs-attention-bulk-regen-insufficient'),
      ).not.toBeDisabled();
    });
  });

  it('disables insufficient-context button when zero insufficient rows', async () => {
    renderPanel();

    selectFilter('mdd-needs-attention-filter-type', 'failed');

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-needs-attention-bulk-regen-insufficient'),
      ).toBeDisabled();
      expect(
        screen.getByTestId('mdd-needs-attention-bulk-regen-failed'),
      ).not.toBeDisabled();
    });
  });

  it('disables both buttons when the panel is empty', () => {
    renderPanel({ needsAttention: [] });

    expect(
      screen.getByTestId('mdd-needs-attention-bulk-regen-failed'),
    ).toBeDisabled();
    expect(
      screen.getByTestId('mdd-needs-attention-bulk-regen-insufficient'),
    ).toBeDisabled();
  });
});

// ----------------------------------------------------------------------------
// Test 4 (spec.md test 28): bulk regenerate honours ONLY needs-attention
// panel filters (workstream + type); hierarchy tree state is ignored.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryNeedsAttentionPanel -- bulk regen honours only panel filters (test 28, Q-4)', () => {
  it('passes only the workstream-filtered failed ids to startBatchGeneration', async () => {
    renderPanel();

    // Narrow to order-service workstream. Only one failed row remains
    // (wi-failed-1); wi-failed-2 belongs to payment-service and must NOT
    // be in targetWorkItemIds.
    selectFilter('mdd-needs-attention-filter-workstream', 'order-service');

    await waitFor(() => {
      expect(
        screen.queryByTestId('mdd-needs-attention-row-bi-failed-2'),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mdd-needs-attention-bulk-regen-failed'));

    await waitFor(() => {
      expect(mockStartBatch).toHaveBeenCalled();
    });
    const callArg = mockStartBatch.mock.calls[0][0];
    expect(callArg.projectId).toBe(PROJECT_ID);
    expect(callArg.bookOfWorkId).toBe(BOOK_ID);
    expect(callArg.regenerateAll).toBe(true);
    expect(callArg.targetWorkItemIds).toEqual(['wi-failed-1']);
    // Crucially, wi-failed-2 is NOT in the whitelist.
    expect(callArg.targetWorkItemIds).not.toContain('wi-failed-2');
  });
});

// ----------------------------------------------------------------------------
// Test 5 (spec.md test 29): bulk regen calls startBatchGeneration with
// regenerateAll: true and shows the in-flight banner.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryNeedsAttentionPanel -- bulk regen call shape + in-flight banner (test 29)', () => {
  it('calls startBatchGeneration with regenerateAll=true and the target ids', async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId('mdd-needs-attention-bulk-regen-failed'));

    await waitFor(() => {
      expect(mockStartBatch).toHaveBeenCalled();
    });
    const callArg = mockStartBatch.mock.calls[0][0];
    expect(callArg).toMatchObject({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
      regenerateAll: true,
    });
    expect(callArg.targetWorkItemIds).toEqual(
      expect.arrayContaining(['wi-failed-1', 'wi-failed-2']),
    );
  });

  it('renders the in-flight banner while the bulk regen is in flight', async () => {
    // Hold the promise pending so we can assert the in-flight state.
    let resolveBatch: ((v: unknown) => void) | null = null;
    mockStartBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve;
        }),
    );

    renderPanel();

    fireEvent.click(
      screen.getByTestId('mdd-needs-attention-bulk-regen-insufficient'),
    );

    // The in-flight banner appears.
    await screen.findByTestId('mdd-needs-attention-bulk-in-flight-banner');

    // Both bulk-regen buttons are disabled while a batch is in flight.
    expect(
      screen.getByTestId('mdd-needs-attention-bulk-regen-failed'),
    ).toBeDisabled();
    expect(
      screen.getByTestId('mdd-needs-attention-bulk-regen-insufficient'),
    ).toBeDisabled();

    // Resolve the promise so the test cleans up.
    resolveBatch?.(makeBatchResult());
    await waitFor(() => {
      expect(
        screen.queryByTestId('mdd-needs-attention-bulk-in-flight-banner'),
      ).not.toBeInTheDocument();
    });
  });
});

// ----------------------------------------------------------------------------
// Test 6 (spec.md test 30 / integration test 36 frontend half): on batch
// completion the parent's onBatchComplete fires (full re-fetch); no row
// patching.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryNeedsAttentionPanel -- onBatchComplete fires post-batch (test 30 / Q-7)', () => {
  it('calls the onBatchComplete prop exactly once after the batch resolves', async () => {
    const onBatchComplete = vi.fn();
    renderPanel({ onBatchComplete });

    fireEvent.click(screen.getByTestId('mdd-needs-attention-bulk-regen-failed'));

    await waitFor(() => {
      expect(mockStartBatch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onBatchComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT call onBatchComplete when the batch throws', async () => {
    const onBatchComplete = vi.fn();
    mockStartBatch.mockRejectedValueOnce(new Error('Bulk regenerate failed'));

    renderPanel({ onBatchComplete });

    fireEvent.click(screen.getByTestId('mdd-needs-attention-bulk-regen-failed'));

    await waitFor(() => {
      expect(mockStartBatch).toHaveBeenCalled();
    });
    // Wait long enough that any pending then() would have fired.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-needs-attention-bulk-error'),
      ).toHaveTextContent(/Bulk regenerate failed/);
    });
    expect(onBatchComplete).not.toHaveBeenCalled();
  });
});
