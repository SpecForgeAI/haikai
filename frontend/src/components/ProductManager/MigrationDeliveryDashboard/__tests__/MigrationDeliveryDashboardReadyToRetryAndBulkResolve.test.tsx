/**
 * MigrationDeliveryDashboard -- Ready-to-Retry card + Bulk-Resolve modal tests
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 7.1.
 *
 * Seven focused tests covering the dashboard-level surfaces:
 *
 *   1. Ready-to-retry card renders the count from `getReadyToRetry`.
 *   2. Clicking the count (or the "View ready stories" link) filters the
 *      hierarchy tree to the ready-to-retry work-item ids.
 *   3. "Retry all" button calls `retryBatch` with ALL ready work-item ids.
 *   4. `retryBatch` `requiresConfirmation` response opens a cost-preview
 *      modal; the follow-up confirm POSTs with `confirmed=true`.
 *   5. Bulk-resolve modal: Preview button calls `bulkResolve` with
 *      `commit=false` and renders the preview; Commit is only enabled once
 *      a preview has been rendered.
 *   6. Bulk-resolve Commit button calls `bulkResolve` with `commit=true`
 *      and refreshes the dashboard (re-fetching ready-to-retry + dashboard).
 *   7. File upload widget displays the selected file name (UI affordance
 *      for the future OAS / WSDL parser; manual entries remain the v1
 *      path).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

// Mock the CSS module so class lookups never blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// ----------------------------------------------------------------------------
// Mock the migration delivery dashboard API client BEFORE component imports.
// Use the `requireActual` spread pattern so unrelated exports stay live.
// ----------------------------------------------------------------------------

const mockGetDashboard = vi.fn();
const mockGetStaleSpecSummary = vi.fn();

vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    getMigrationDeliveryDashboard: (...args: unknown[]) =>
      mockGetDashboard(...args),
    getStaleSpecSummary: (...args: unknown[]) =>
      mockGetStaleSpecSummary(...args),
  };
});

// Mock the missing-input resolutions API client. We override `bulkResolve`,
// `getReadyToRetry`, and `retryBatch` and steer their responses per test.
const mockGetReadyToRetry = vi.fn();
const mockRetryBatch = vi.fn();
const mockBulkResolve = vi.fn();

vi.mock('../../../../api/missingInputResolutionsApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/missingInputResolutionsApi')
  >('../../../../api/missingInputResolutionsApi');
  return {
    ...actual,
    getReadyToRetry: (...args: unknown[]) => mockGetReadyToRetry(...args),
    retryBatch: (...args: unknown[]) => mockRetryBatch(...args),
    bulkResolve: (...args: unknown[]) => mockBulkResolve(...args),
  };
});

import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';
import type { MigrationDeliveryDashboardDto } from '../../../../api/migrationDeliveryDashboardApi';
import type {
  ReadyToRetryResponse,
  RetryBatchResult,
  BulkResolveResponse,
} from '../../../../api/missingInputResolutionsApi';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-7';
const BOOK_ID = 'book-7';

function buildDashboardFixture(
  overrides: Partial<MigrationDeliveryDashboardDto> = {},
): MigrationDeliveryDashboardDto {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-current-uuid',
    targetArchitectureId: 'arch-target-uuid',
    title: 'Test Book',
    status: 'generated',
    generatedAt: '2026-05-20T00:00:00Z',
    summary: {
      totalInitiativeCount: 1,
      totalEpicCount: 1,
      totalFeatureCount: 1,
      totalStoryCount: 3,
      needsAttentionCount: 2,
    },
    hierarchy: [
      {
        id: 'init-1',
        parentId: null,
        type: 'initiative',
        title: 'Init A',
        workstream: 'auth',
        sequenceOrder: 1,
        workItemId: null,
        backlogStatus: 'not_saved_to_backlog',
        specGenerationStatus: null,
        specGenerationConfidence: null,
        implementationStatus: null,
        evidenceStatus: 'none',
        needsAttentionCount: 0,
        missingInputsCount: null,
        children: [
          {
            id: 'story-1',
            parentId: 'init-1',
            type: 'story',
            title: 'Ready story 1',
            workstream: 'auth',
            sequenceOrder: 1,
            workItemId: 'wi-ready-1',
            backlogStatus: 'saved',
            specGenerationStatus: 'insufficient_context',
            specGenerationConfidence: null,
            implementationStatus: 'not_started',
            evidenceStatus: 'none',
            needsAttentionCount: 1,
            missingInputsCount: 2,
            children: [],
          },
          {
            id: 'story-2',
            parentId: 'init-1',
            type: 'story',
            title: 'Ready story 2',
            workstream: 'auth',
            sequenceOrder: 2,
            workItemId: 'wi-ready-2',
            backlogStatus: 'saved',
            specGenerationStatus: 'insufficient_context',
            specGenerationConfidence: null,
            implementationStatus: 'not_started',
            evidenceStatus: 'none',
            needsAttentionCount: 1,
            missingInputsCount: 1,
            children: [],
          },
          {
            id: 'story-3',
            parentId: 'init-1',
            type: 'story',
            title: 'Other story',
            workstream: 'auth',
            sequenceOrder: 3,
            workItemId: 'wi-other',
            backlogStatus: 'saved',
            specGenerationStatus: 'generated',
            specGenerationConfidence: 'medium',
            implementationStatus: 'not_started',
            evidenceStatus: 'none',
            needsAttentionCount: 0,
            missingInputsCount: null,
            children: [],
          },
        ],
      },
    ],
    workstreamSummaries: [],
    specGenerationSummary: {
      notAttemptedCount: 0,
      generatedCount: 1,
      generatedWithWarningsCount: 0,
      insufficientContextCount: 2,
      failedCount: 0,
      skippedBlockedCount: 0,
    },
    backlogSaveSummary: { savedCount: 3, notSavedToBacklogCount: 0 },
    implementationSummary: {
      notStartedCount: 3,
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
    ...overrides,
  };
}

function buildReadyToRetry(workItemIds: string[]): ReadyToRetryResponse {
  return {
    count: workItemIds.length,
    specGenerationIds: workItemIds.map((w) => `spec-${w}`),
    specs: workItemIds.map((w) => ({
      specGenerationId: `spec-${w}`,
      workItemId: w,
      title: `Story ${w}`,
      totalKeys: 2,
      missingInputKeyCount: 2,
      resolvedKeys: 2,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStaleSpecSummary.mockResolvedValue({
    staleCount: 0,
    staleWorkItemIds: [],
  });
});

// ============================================================================
// Test 1 -- Ready-to-retry card renders count from getReadyToRetry
// ============================================================================

describe('MigrationDeliveryDashboard -- ready-to-retry card', () => {
  it('renders the ready-to-retry count from the fetcher', async () => {
    mockGetDashboard.mockResolvedValueOnce(buildDashboardFixture());
    mockGetReadyToRetry.mockResolvedValueOnce(
      buildReadyToRetry(['wi-ready-1', 'wi-ready-2']),
    );

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-summary-card-ready-to-retry-value'),
      ).toHaveTextContent('2');
    });
    // "Retry all (2)" affordance is enabled when count > 0.
    expect(
      screen.getByTestId('mdd-ready-to-retry-retry-all'),
    ).not.toBeDisabled();
  });
});

// ============================================================================
// Test 2 -- View ready stories filters the hierarchy tree
// ============================================================================

describe('MigrationDeliveryDashboard -- view ready stories filter', () => {
  it('clicking "View ready stories" prunes the hierarchy tree to ready work-item ids', async () => {
    mockGetDashboard.mockResolvedValueOnce(buildDashboardFixture());
    mockGetReadyToRetry.mockResolvedValueOnce(
      buildReadyToRetry(['wi-ready-1']),
    );

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    // Wait for the dashboard to settle (ready card present).
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-summary-card-ready-to-retry-value'),
      ).toHaveTextContent('1');
    });

    // Before filter -- all three stories should be present.
    expect(screen.getByTestId('mdd-hierarchy-node-story-1')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-node-story-2')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-node-story-3')).toBeInTheDocument();

    // Click "View ready stories" link.
    fireEvent.click(
      screen.getByTestId('mdd-ready-to-retry-view-ready-stories'),
    );

    // Filter indicator appears.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-hierarchy-filter-indicator'),
      ).toBeInTheDocument();
    });

    // Story-1 stays (it's ready); story-2 and story-3 are pruned.
    expect(screen.getByTestId('mdd-hierarchy-node-story-1')).toBeInTheDocument();
    expect(screen.queryByTestId('mdd-hierarchy-node-story-2')).toBeNull();
    expect(screen.queryByTestId('mdd-hierarchy-node-story-3')).toBeNull();
  });
});

// ============================================================================
// Test 3 -- "Retry all" calls retryBatch with all ready ids
// ============================================================================

describe('MigrationDeliveryDashboard -- retry all', () => {
  it('"Retry all" calls retryBatch with every ready-to-retry workItemId', async () => {
    mockGetDashboard.mockResolvedValue(buildDashboardFixture());
    mockGetReadyToRetry.mockResolvedValue(
      buildReadyToRetry(['wi-ready-1', 'wi-ready-2']),
    );
    const noConfirmationResult: RetryBatchResult = {
      perStoryResults: [],
      persistedCount: 0,
      summary: {},
    };
    mockRetryBatch.mockResolvedValueOnce(noConfirmationResult);

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-ready-to-retry-retry-all'),
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('mdd-ready-to-retry-retry-all'));

    await waitFor(() => expect(mockRetryBatch).toHaveBeenCalledTimes(1));
    expect(mockRetryBatch).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        workItemIds: ['wi-ready-1', 'wi-ready-2'],
        bookOfWorkId: BOOK_ID,
        confirmed: false,
      }),
    );
  });
});

// ============================================================================
// Test 4 -- requiresConfirmation triggers cost-preview modal + confirm path
// ============================================================================

describe('MigrationDeliveryDashboard -- retry confirmation modal', () => {
  it('opens the cost-preview modal when retryBatch returns requiresConfirmation', async () => {
    mockGetDashboard.mockResolvedValue(buildDashboardFixture());
    mockGetReadyToRetry.mockResolvedValue(
      buildReadyToRetry(['wi-ready-1', 'wi-ready-2']),
    );
    // First call -- gateway gates the retry.
    mockRetryBatch.mockResolvedValueOnce({
      requiresConfirmation: true,
      threshold: 'cost-preview/stories>=5-or-tokens>50k',
      costPreview: {
        estimatedTokens: 60000,
        estimatedWallClockSeconds: 120,
      },
    });
    // Second call -- user confirmed.
    mockRetryBatch.mockResolvedValueOnce({
      perStoryResults: [],
      persistedCount: 0,
      summary: {},
    });

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-ready-to-retry-retry-all'),
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('mdd-ready-to-retry-retry-all'));

    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-ready-to-retry-confirm-modal'),
      ).toBeInTheDocument();
    });
    const list = screen.getByTestId('mdd-ready-to-retry-cost-preview-list');
    expect(list).toHaveTextContent(/60,000/);
    expect(list).toHaveTextContent(/120s/);

    // Confirm.
    fireEvent.click(screen.getByTestId('mdd-ready-to-retry-confirm-ok'));

    await waitFor(() => expect(mockRetryBatch).toHaveBeenCalledTimes(2));
    expect(mockRetryBatch.mock.calls[1][1]).toMatchObject({
      workItemIds: ['wi-ready-1', 'wi-ready-2'],
      confirmed: true,
    });
  });
});

// ============================================================================
// Test 5 -- Bulk-resolve preview path
// ============================================================================

describe('MigrationDeliveryDashboard -- bulk-resolve modal preview', () => {
  it('Preview calls bulkResolve with commit=false; Commit is disabled until preview returns', async () => {
    mockGetDashboard.mockResolvedValueOnce(buildDashboardFixture());
    mockGetReadyToRetry.mockResolvedValueOnce(buildReadyToRetry([]));
    const previewResponse: BulkResolveResponse = {
      resolutions: [
        {
          key: 'aaaaaaaaaaaaaaaa',
          missingInputType: 'api_contract',
          descriptor: 'PaymentsService::createPayment',
          affectedSpecIds: ['spec-1', 'spec-2'],
          resolutionPayload: null,
        },
      ],
      previewOnly: true,
      committed: false,
      totalSpecsAffected: 2,
    };
    mockBulkResolve.mockResolvedValueOnce(previewResponse);

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-dashboard-bulk-resolve')).toBeInTheDocument(),
    );

    // Open the modal.
    fireEvent.click(screen.getByTestId('mdd-dashboard-bulk-resolve'));
    expect(screen.getByTestId('mdd-bulk-resolve-modal')).toBeInTheDocument();

    // Commit is disabled until a preview has been rendered.
    expect(screen.getByTestId('mdd-bulk-resolve-commit')).toBeDisabled();

    // Fill in the first draft row (api_contract -> service + operation).
    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-draft-service-0'), {
      target: { value: 'PaymentsService' },
    });
    fireEvent.change(
      screen.getByTestId('mdd-bulk-resolve-draft-operation-0'),
      { target: { value: 'createPayment' } },
    );

    // Click Preview.
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));

    await waitFor(() => expect(mockBulkResolve).toHaveBeenCalledTimes(1));
    expect(mockBulkResolve).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        commit: false,
        items: expect.arrayContaining([
          expect.objectContaining({
            type: 'api_contract',
            serviceName: 'PaymentsService',
            operationName: 'createPayment',
          }),
        ]),
      }),
    );

    // Preview table renders + commit is now enabled.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-bulk-resolve-preview-table'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('mdd-bulk-resolve-commit')).not.toBeDisabled();
    expect(
      within(
        screen.getByTestId('mdd-bulk-resolve-preview-row-aaaaaaaaaaaaaaaa'),
      ).getByText('2'),
    ).toBeInTheDocument();
  });
});

// ============================================================================
// Test 6 -- Bulk-resolve commit path + refreshes dashboard
// ============================================================================

describe('MigrationDeliveryDashboard -- bulk-resolve modal commit', () => {
  it('Commit button calls bulkResolve with commit=true and refreshes the dashboard', async () => {
    mockGetDashboard.mockResolvedValue(buildDashboardFixture());
    mockGetReadyToRetry.mockResolvedValue(buildReadyToRetry([]));
    const previewResponse: BulkResolveResponse = {
      resolutions: [
        {
          key: 'aaaaaaaaaaaaaaaa',
          missingInputType: 'api_contract',
          descriptor: 'PaymentsService::createPayment',
          affectedSpecIds: ['spec-1'],
          resolutionPayload: null,
        },
      ],
      previewOnly: true,
      committed: false,
      totalSpecsAffected: 1,
    };
    const commitResponse: BulkResolveResponse = {
      ...previewResponse,
      previewOnly: false,
      committed: true,
    };
    mockBulkResolve
      .mockResolvedValueOnce(previewResponse)
      .mockResolvedValueOnce(commitResponse);

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(1);
    });

    // Snapshot pre-commit dashboard fetch count.
    const fetchCountBeforeCommit = mockGetDashboard.mock.calls.length;
    const readyFetchCountBeforeCommit = mockGetReadyToRetry.mock.calls.length;

    fireEvent.click(screen.getByTestId('mdd-dashboard-bulk-resolve'));
    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-draft-service-0'), {
      target: { value: 'PaymentsService' },
    });
    fireEvent.change(
      screen.getByTestId('mdd-bulk-resolve-draft-operation-0'),
      { target: { value: 'createPayment' } },
    );

    // Preview first.
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-bulk-resolve-preview-table'),
      ).toBeInTheDocument(),
    );

    // Commit.
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-commit'));

    await waitFor(() => expect(mockBulkResolve).toHaveBeenCalledTimes(2));
    expect(mockBulkResolve.mock.calls[1][1]).toMatchObject({ commit: true });

    // Modal closed.
    await waitFor(() =>
      expect(screen.queryByTestId('mdd-bulk-resolve-modal')).toBeNull(),
    );

    // Dashboard refresh fired (both dashboard + ready-to-retry re-fetched).
    await waitFor(() => {
      expect(mockGetDashboard.mock.calls.length).toBeGreaterThan(
        fetchCountBeforeCommit,
      );
      expect(mockGetReadyToRetry.mock.calls.length).toBeGreaterThan(
        readyFetchCountBeforeCommit,
      );
    });
  });
});

// ============================================================================
// Test 7 -- File upload widget displays selected file name (UI affordance)
// ============================================================================

describe('MigrationDeliveryDashboard -- bulk-resolve file upload affordance', () => {
  it('displays the selected file name (v1 placeholder; manual entries remain the active path)', async () => {
    mockGetDashboard.mockResolvedValueOnce(buildDashboardFixture());
    mockGetReadyToRetry.mockResolvedValueOnce(buildReadyToRetry([]));

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-dashboard-bulk-resolve')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mdd-dashboard-bulk-resolve'));

    const fileInput = screen.getByTestId(
      'mdd-bulk-resolve-file-input',
    ) as HTMLInputElement;
    const f = new File(['fake-oas-bytes'], 'payments.oas.yaml', {
      type: 'application/yaml',
    });
    fireEvent.change(fileInput, { target: { files: [f] } });

    expect(
      await screen.findByTestId('mdd-bulk-resolve-file-name'),
    ).toHaveTextContent('payments.oas.yaml');
  });
});
