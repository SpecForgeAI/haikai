/**
 * MigrationDeliveryReconciliationPanel + add-item modal -- net_new (D6)
 *
 * Spec: 2026-06-14 Non-Reconciling Work at Reconcile Time (D6) --
 * Task Groups 5 + 6 (frontend recognised badge + the net_new_operations
 * add-item field; the strategic gap tests for the genuinely-uncovered
 * FRONTEND seams).
 *
 * The auto-disposition pass, the match, and the holistic effect-test steering
 * are all covered GATEWAY-side (Groups 2-4); the AMS expected_net_new
 * validation round-trip is covered AMS-side (Group 1). The genuinely-uncovered
 * FRONTEND seams covered here:
 *   1. The panel surfaces an auto-dispositioned expected_net_new target_only
 *      break as VISIBLY RECOGNISED -- an "Expected -- net_new endpoint"
 *      label/badge PLUS the matched work-item reference read from
 *      detail_json.net_new_match (id/title + operation) -- NOT hidden.
 *   2. The recognised break RETAINS the human-override affordance (it is
 *      selectable + re-dispose-able via the existing disposition path -- D7),
 *      because expected_net_new is a machine-set state, not a human terminal.
 *   3. The add-item modal shows the net_new_operations input ONLY for
 *      provenance=net_new + kind=api, and submits the entered operations
 *      through addWorkItem.
 *
 * Conventions mirror MigrationDeliveryReconciliationPanel.test.tsx +
 * MigrationDeliveryDashboardAddItemAndProvenanceFilter.test.tsx: the CSS module
 * is mocked via a Proxy; the reconciliation api module is mocked so the render
 * is deterministic + offline; every dashboard side-fetch is a test-seam prop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the reconciliation api module (the HARD rule: mock the api module).
vi.mock('../../../../api/migrationReconciliationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationReconciliationApi')
  >('../../../../api/migrationReconciliationApi');
  return {
    ...actual,
    getReconciliationBreaks: vi.fn(),
    sendReconciliationBreaksAsBugs: vi.fn(),
    disposeReconciliationBreaks: vi.fn(),
    registerTargetCredentials: vi.fn(),
  };
});

import { MigrationDeliveryReconciliationPanel } from '../MigrationDeliveryReconciliationPanel';
import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';
import * as reconApi from '../../../../api/migrationReconciliationApi';
import type { MigrationReconciliationBreakDto } from '../../../../api/migrationReconciliationApi';
import type {
  MigrationDeliveryDashboardDto,
  AddWorkItemResult,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';
const BOOK_ID = 'book-1';

type AddFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).addWorkItem;

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// Group 5/6: the recognised "Expected -- net_new endpoint" badge + override
// ============================================================================

/**
 * An auto-dispositioned net_new target_only break: source_baseline_item_id is
 * null (target_only), the disposition is the new expected_net_new terminal,
 * needs_human is false, and detail_json carries the gateway-written
 * net_new_match audit note (id/title + matched operation).
 */
function makeExpectedNetNewBreak(): MigrationReconciliationBreakDto {
  return {
    id: 'nn1',
    run_id: RUN_ID,
    pinned_baseline_id: 'baseline-1',
    source_baseline_item_id: null,
    diff_item_id: 'diff-nn1',
    detail_json: {
      method: 'POST',
      path: '/accounts',
      summary: 'target_only: present in target, absent from the pinned baseline',
      operation: 'POST /accounts',
      net_new_match: {
        outcome: 'auto_recognised',
        matched_operation: 'POST /accounts',
        matched_work_item_id: 'wi-net-new-7',
        matched_book_item_id: 'NN-S7',
        matched_work_item_title: 'Add an account-opening endpoint',
        recognised_at: '2026-06-15T00:00:00Z',
        note:
          'Auto-recognised as an additive net_new endpoint: matched work item ' +
          '"Add an account-opening endpoint" (wi-net-new-7) via operation POST /accounts. ' +
          'The pinned current-state baseline is unchanged.',
      },
    },
    disposition_status: reconApi.BREAK_DISPOSITION.EXPECTED_NET_NEW,
    bug_id: null,
    attempt_count: 0,
    circuit_broken: false,
    needs_human: false,
    error_detail: null,
  };
}

describe('MigrationDeliveryReconciliationPanel -- expected_net_new recognised badge (D6)', () => {
  it('renders an auto-dispositioned expected_net_new break as visibly recognised with the matched work-item reference', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeExpectedNetNewBreak(),
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-nn1')).toBeInTheDocument(),
    );

    // The disposition badge reads as a first-class recognised state.
    const badge = screen.getByTestId('mdd-recon-break-disposition-nn1');
    expect(badge).toHaveAttribute('data-state', 'expected_net_new');
    expect(badge).toHaveTextContent(/Expected\s*[—-]\s*net_new endpoint/i);

    // The matched work-item reference (title + id + operation) is surfaced
    // inline -- NOT hidden, read from detail_json.net_new_match.
    const matched = screen.getByTestId('mdd-recon-break-net-new-match-nn1');
    expect(matched).toHaveTextContent('Add an account-opening endpoint');
    expect(matched).toHaveTextContent('wi-net-new-7');
    expect(matched).toHaveTextContent('POST /accounts');
  });

  it('retains the human-override affordance on an expected_net_new break (selectable + re-dispose-able)', async () => {
    vi.mocked(reconApi.getReconciliationBreaks)
      .mockResolvedValueOnce([makeExpectedNetNewBreak()])
      // refresh after the override re-dispose.
      .mockResolvedValue([
        {
          ...makeExpectedNetNewBreak(),
          disposition_status: reconApi.BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
        },
      ]);
    vi.mocked(reconApi.disposeReconciliationBreaks).mockResolvedValue({
      status: 'disposed',
      count: 1,
    });

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-nn1')).toBeInTheDocument(),
    );

    // expected_net_new is a MACHINE-set state, NOT a human terminal: the break
    // stays selectable so a human can re-classify a wrongly-matched endpoint.
    const checkbox = screen.getByTestId('mdd-recon-select-nn1');
    expect(checkbox).not.toBeDisabled();

    // Re-classify via the EXISTING disposition path (D7 -- no new mechanism).
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByTestId('mdd-recon-disposition-select'), {
      target: { value: reconApi.BREAK_DISPOSITION.INTENTIONAL_DEVIATION },
    });
    fireEvent.click(screen.getByTestId('mdd-recon-dispose-button'));

    await waitFor(() =>
      expect(reconApi.disposeReconciliationBreaks).toHaveBeenCalledTimes(1),
    );
    expect(reconApi.disposeReconciliationBreaks).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({
        breakIds: ['nn1'],
        disposition: reconApi.BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
      }),
    );
  });
});

// ============================================================================
// Group 5/6: the net_new_operations add-item field (net_new + api only)
// ============================================================================

function buildDashboard(): MigrationDeliveryDashboardDto {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-c',
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

const ADD_RESULT: AddWorkItemResult = {
  workItemId: 'wi-new-2',
  bookItemId: 'NN-S2',
  provenance: 'net_new',
  kind: 'api',
  message: 'Work item created.',
};

describe('MigrationDeliveryDashboard -- net_new_operations add-item field (D6)', () => {
  it('shows the net_new_operations input ONLY for net_new + api and submits the entered operations', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());
    const addFn = vi.fn().mockResolvedValue(ADD_RESULT);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        addWorkItemFn={addFn as unknown as AddFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-hierarchy-section')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('mdd-dashboard-add-item'));
    const modal = screen.getByTestId('mdd-add-item-modal');

    // Default is net_new + api -> the operations field is shown.
    expect(
      within(modal).getByTestId('mdd-add-item-net-new-operations'),
    ).toBeInTheDocument();

    // Switch kind to operational -> the field is HIDDEN (api-only).
    fireEvent.change(screen.getByTestId('mdd-add-item-kind'), {
      target: { value: 'operational' },
    });
    expect(
      within(modal).queryByTestId('mdd-add-item-net-new-operations'),
    ).not.toBeInTheDocument();

    // Switch provenance to carry_over (kind back to api) -> still HIDDEN
    // (net_new-only), matching the gateway/AMS stamp gate.
    fireEvent.change(screen.getByTestId('mdd-add-item-kind'), {
      target: { value: 'api' },
    });
    fireEvent.change(screen.getByTestId('mdd-add-item-provenance'), {
      target: { value: 'carry_over' },
    });
    expect(
      within(modal).queryByTestId('mdd-add-item-net-new-operations'),
    ).not.toBeInTheDocument();

    // Back to net_new + api -> shown again; enter two operations (one per line,
    // plus a blank line that should be trimmed away).
    fireEvent.change(screen.getByTestId('mdd-add-item-provenance'), {
      target: { value: 'net_new' },
    });
    fireEvent.change(screen.getByTestId('mdd-add-item-title'), {
      target: { value: 'Add an account-opening endpoint' },
    });
    fireEvent.change(
      within(modal).getByTestId('mdd-add-item-net-new-operations'),
      {
        target: { value: 'POST /accounts\n\n  GET /accounts/{id}  \n' },
      },
    );

    fireEvent.click(screen.getByTestId('mdd-add-item-submit'));

    await waitFor(() => expect(addFn).toHaveBeenCalledTimes(1));
    expect(addFn).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
      provenance: 'net_new',
      kind: 'api',
      title: 'Add an account-opening endpoint',
      description: '',
      netNewOperations: ['POST /accounts', 'GET /accounts/{id}'],
    });
  });
});
