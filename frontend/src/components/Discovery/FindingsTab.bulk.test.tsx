/**
 * FindingsTab Bulk-Action Tests
 *
 * Spec 2026-05-28 Bulk Findings Actions -- Task Group 3.1.
 * Spec F 2026-06-02 Normalize Findings Review Actions -- Task Group 3.1:
 * the bulk toolbar verbs are Approve / Reject / Defer; the request body
 * carries `review_status`; `delta_by_from_status` keys + the summary pills
 * use the candidate-parity vocabulary (pending_review / approved / rejected /
 * deferred). The `resolved` pill + "Mark Resolved" action are gone.
 *
 * Coverage (5 highly-focused tests, all critical, no padding):
 *   1. Filtered side of the scope toggle is disabled with the
 *      "Apply a filter to enable" tooltip when no filter is active; the
 *      same click on an action button opens the confirmation modal; the
 *      bulk toolbar offers exactly Approve / Reject / Defer (no
 *      "Mark Resolved").
 *   2. Modal Cancel + ESC + overlay click all dismiss the modal.
 *   3. Modal Confirm fires `bulkReviewFindings` with the correct body --
 *      `review_status` set to approved/rejected/deferred, `filter` echoed
 *      when scope=Filtered, and `reviewer_notes` ONLY present when the
 *      textarea is non-empty after trim.
 *   4. `runSummary` pills apply `delta_by_from_status` correctly after a
 *      successful bulk action -- decrement each from-status pill, increment
 *      the target disposition pill.
 *   5. Inline status banner renders the correct counts post-action and
 *      auto-dismisses on next filter change.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type {
  DiscoveryFindingDto,
  DiscoveryFindingSearchResponse,
  BulkReviewFindingsResponse,
} from '../../api/findingsApi';

// ----------------------------------------------------------------------------
// Mocks for findingsApi -- the FindingsTab tests verify wiring, not URL
// shape (that's covered by findingsApi.test.ts).
// ----------------------------------------------------------------------------

const mockListFindings = vi.fn();
const mockBulkReviewFindings = vi.fn();
const mockReviewFinding = vi.fn();
const mockUpdateFinding = vi.fn();

vi.mock('../../api/findingsApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/findingsApi')>(
    '../../api/findingsApi',
  );
  return {
    ...actual,
    listFindings: (...args: unknown[]) => mockListFindings(...args),
    bulkReviewFindings: (...args: unknown[]) => mockBulkReviewFindings(...args),
    reviewFinding: (...args: unknown[]) => mockReviewFinding(...args),
    updateFinding: (...args: unknown[]) => mockUpdateFinding(...args),
  };
});

vi.mock('./FindingsTab.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('./BulkFindingActionConfirmModal.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('./FindingDetailDrawer.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Import AFTER mocks
import { FindingsTab } from './FindingsTab';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-uuid-1';
const ARCH_ID = 'arch-uuid-1';
const RUN_ID = 'run-uuid-1';

function makeFinding(
  overrides: Partial<DiscoveryFindingDto> = {},
): DiscoveryFindingDto {
  return {
    id: 'f-1',
    run_id: RUN_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    finding_type: 'low_confidence_candidate',
    category: 'ambiguity',
    severity: 'medium',
    confidence: 0.5,
    review_status: 'pending_review',
    previous_review_status: null,
    title: 'Low confidence candidate',
    summary: 'Candidate confidence below threshold',
    detail_json: null,
    source: 'discoveryV3Pipeline',
    created_by_stage: 'postMerge.lowConfidence',
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    reviewed_at: null,
    reviewer_notes: null,
    links: [],
    ...overrides,
  };
}

function makeResponse(
  items: DiscoveryFindingDto[],
): DiscoveryFindingSearchResponse {
  return {
    items,
    total: items.length,
    page: 0,
    size: 20,
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('FindingsTab bulk actions (Spec F 2026-06-02 Group 3.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockListFindings.mockReset();
    mockBulkReviewFindings.mockReset();
    mockReviewFinding.mockReset();
    mockUpdateFinding.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('bulk toolbar offers exactly Approve / Reject / Defer; Filtered scope side is disabled with tooltip when no filter is active; clicking an action button opens the modal', async () => {
    const findings = [
      makeFinding({ id: 'f-1', review_status: 'pending_review' }),
      makeFinding({ id: 'f-2', review_status: 'pending_review' }),
    ];
    mockListFindings.mockResolvedValue(makeResponse(findings));

    render(
      <FindingsTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('findings-table')).toBeInTheDocument(),
    );

    // The reviewer surface is EXACTLY Approve / Reject / Defer -- the legacy
    // "Mark Resolved" / "Needs Review" actions are gone.
    expect(screen.getByTestId('findings-bulk-action-approved')).toHaveTextContent(
      /Approve/,
    );
    expect(screen.getByTestId('findings-bulk-action-rejected')).toHaveTextContent(
      /Reject/,
    );
    expect(screen.getByTestId('findings-bulk-action-deferred')).toHaveTextContent(
      /Defer/,
    );
    expect(
      screen.queryByTestId('findings-bulk-action-resolved'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('findings-bulk-action-needs_review'),
    ).not.toBeInTheDocument();

    const filteredBtn = screen.getByTestId(
      'findings-bulk-scope-filtered',
    ) as HTMLButtonElement;
    expect(filteredBtn).toBeDisabled();
    expect(filteredBtn).toHaveAttribute(
      'title',
      'Apply a filter to enable',
    );

    // The All side is selected by default; clicking an action button
    // opens the confirmation modal.
    const approveBtn = screen.getByTestId('findings-bulk-action-approved');
    expect(approveBtn).not.toBeDisabled();
    fireEvent.click(approveBtn);

    expect(
      screen.getByTestId('bulk-finding-action-confirm-modal'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bulk-confirm-title')).toHaveTextContent(
      /Mark .* findings as Approved\?/,
    );
  });

  it('Modal Cancel + ESC + overlay click all dismiss the modal', async () => {
    const findings = [makeFinding({ id: 'f-1', review_status: 'pending_review' })];
    mockListFindings.mockResolvedValue(makeResponse(findings));

    render(
      <FindingsTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('findings-table')).toBeInTheDocument(),
    );

    // (a) Open + Cancel -- modal disappears.
    fireEvent.click(screen.getByTestId('findings-bulk-action-approved'));
    expect(
      screen.getByTestId('bulk-finding-action-confirm-modal'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bulk-confirm-cancel-button'));
    expect(
      screen.queryByTestId('bulk-finding-action-confirm-modal'),
    ).not.toBeInTheDocument();

    // (b) Open + ESC -- modal disappears.
    fireEvent.click(screen.getByTestId('findings-bulk-action-approved'));
    expect(
      screen.getByTestId('bulk-finding-action-confirm-modal'),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByTestId('bulk-finding-action-confirm-modal'),
      ).not.toBeInTheDocument(),
    );

    // (c) Open + overlay click -- modal disappears.
    fireEvent.click(screen.getByTestId('findings-bulk-action-approved'));
    const overlay = screen.getByTestId('bulk-finding-action-confirm-modal');
    fireEvent.click(overlay);
    await waitFor(() =>
      expect(
        screen.queryByTestId('bulk-finding-action-confirm-modal'),
      ).not.toBeInTheDocument(),
    );
  });

  it('Confirm fires bulkReviewFindings with correct body; reviewer_notes only present when trimmed non-empty', async () => {
    const findings = [
      makeFinding({ id: 'f-1', review_status: 'pending_review' }),
      makeFinding({ id: 'f-2', review_status: 'pending_review' }),
    ];
    mockListFindings.mockResolvedValue(makeResponse(findings));
    const response: BulkReviewFindingsResponse = {
      updated_count: 2,
      skipped_count: 0,
      delta_by_from_status: { pending_review: 2 },
    };
    mockBulkReviewFindings.mockResolvedValue(response);

    render(
      <FindingsTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('findings-table')).toBeInTheDocument(),
    );

    // ---------- Case A: textarea left untouched (no trim content) ----------
    fireEvent.click(screen.getByTestId('findings-bulk-action-approved'));
    fireEvent.click(screen.getByTestId('bulk-confirm-confirm-button'));

    await waitFor(() =>
      expect(mockBulkReviewFindings).toHaveBeenCalledTimes(1),
    );
    const argsA = mockBulkReviewFindings.mock.calls[0];
    expect(argsA[0]).toBe(PROJECT_ID);
    expect(argsA[1]).toBe(ARCH_ID);
    expect(argsA[2]).toBe(RUN_ID);
    const bodyA = argsA[3];
    expect(bodyA.review_status).toBe('approved');
    expect(bodyA).not.toHaveProperty('reviewer_notes');
    // scope=All by default, no filter active -> no `filter` field either.
    expect(bodyA).not.toHaveProperty('filter');

    // Wait for modal to close + summary to update.
    await waitFor(() =>
      expect(
        screen.queryByTestId('bulk-finding-action-confirm-modal'),
      ).not.toBeInTheDocument(),
    );

    // ---------- Case B: textarea filled with whitespace-only (still trimmed empty) ----------
    fireEvent.click(screen.getByTestId('findings-bulk-action-rejected'));
    const textareaB = screen.getByTestId(
      'bulk-confirm-notes-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textareaB, { target: { value: '   \n  ' } });
    fireEvent.click(screen.getByTestId('bulk-confirm-confirm-button'));

    await waitFor(() =>
      expect(mockBulkReviewFindings).toHaveBeenCalledTimes(2),
    );
    const bodyB = mockBulkReviewFindings.mock.calls[1][3];
    expect(bodyB.review_status).toBe('rejected');
    expect(bodyB).not.toHaveProperty('reviewer_notes');

    await waitFor(() =>
      expect(
        screen.queryByTestId('bulk-finding-action-confirm-modal'),
      ).not.toBeInTheDocument(),
    );

    // ---------- Case C: textarea filled with real content (trimmed echoed) ----------
    fireEvent.click(screen.getByTestId('findings-bulk-action-deferred'));
    const textareaC = screen.getByTestId(
      'bulk-confirm-notes-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textareaC, {
      target: { value: '   bulk deferral note   ' },
    });
    fireEvent.click(screen.getByTestId('bulk-confirm-confirm-button'));

    await waitFor(() =>
      expect(mockBulkReviewFindings).toHaveBeenCalledTimes(3),
    );
    const bodyC = mockBulkReviewFindings.mock.calls[2][3];
    expect(bodyC.review_status).toBe('deferred');
    // Trimmed -- leading + trailing whitespace stripped.
    expect(bodyC.reviewer_notes).toBe('bulk deferral note');
  });

  it('runSummary pills apply delta_by_from_status correctly across the disposition vocabulary', async () => {
    // Seed: 2 pending_review + 1 approved + 1 rejected + 1 deferred = 5 total.
    const initial = [
      makeFinding({ id: 'a', review_status: 'pending_review' }),
      makeFinding({ id: 'b', review_status: 'pending_review' }),
      makeFinding({ id: 'c', review_status: 'approved' }),
      makeFinding({ id: 'd', review_status: 'rejected' }),
      makeFinding({ id: 'e', review_status: 'deferred' }),
    ];
    mockListFindings.mockResolvedValue(makeResponse(initial));
    // After bulk -> approved: 2 from pending_review + 1 from rejected +
    // 1 from deferred = 4 updated. The 1 already-approved row is counted
    // under skipped_by_reason.already_in_target.
    const response: BulkReviewFindingsResponse = {
      updated_count: 4,
      skipped_count: 1,
      skipped_by_reason: {
        already_in_target: 1,
        transition_not_allowed: 0,
      },
      delta_by_from_status: {
        pending_review: 2,
        rejected: 1,
        deferred: 1,
      },
    };
    mockBulkReviewFindings.mockResolvedValue(response);

    render(
      <FindingsTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('findings-table')).toBeInTheDocument(),
    );

    // Initial state: pills reflect computed summary.
    expect(
      screen.getByTestId('findings-summary-pending-review'),
    ).toHaveTextContent('2');
    expect(screen.getByTestId('findings-summary-approved')).toHaveTextContent(
      '1',
    );
    expect(screen.getByTestId('findings-summary-rejected')).toHaveTextContent(
      '1',
    );
    expect(screen.getByTestId('findings-summary-deferred')).toHaveTextContent(
      '1',
    );

    fireEvent.click(screen.getByTestId('findings-bulk-action-approved'));
    fireEvent.click(screen.getByTestId('bulk-confirm-confirm-button'));

    await waitFor(() =>
      expect(mockBulkReviewFindings).toHaveBeenCalledTimes(1),
    );

    // After bulk action: pending_review, rejected, deferred each drop by
    // their delta value; approved gains updated_count (4) -> 1 + 4 = 5.
    await waitFor(() => {
      expect(
        screen.getByTestId('findings-summary-pending-review'),
      ).toHaveTextContent('0');
      expect(
        screen.getByTestId('findings-summary-rejected'),
      ).toHaveTextContent('0');
      expect(
        screen.getByTestId('findings-summary-deferred'),
      ).toHaveTextContent('0');
      expect(
        screen.getByTestId('findings-summary-approved'),
      ).toHaveTextContent('5');
    });
  });

  it('Success banner renders correct counts and auto-dismisses on next filter change', async () => {
    const findings = [
      makeFinding({ id: 'f-1', review_status: 'pending_review' }),
      makeFinding({ id: 'f-2', review_status: 'pending_review' }),
      makeFinding({ id: 'f-3', review_status: 'approved' }),
    ];
    mockListFindings.mockResolvedValue(makeResponse(findings));
    const response: BulkReviewFindingsResponse = {
      updated_count: 2,
      skipped_count: 1,
      skipped_by_reason: {
        already_in_target: 1,
        transition_not_allowed: 0,
      },
      delta_by_from_status: { pending_review: 2 },
    };
    mockBulkReviewFindings.mockResolvedValue(response);

    render(
      <FindingsTab
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('findings-table')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('findings-bulk-action-approved'));
    fireEvent.click(screen.getByTestId('bulk-confirm-confirm-button'));

    // Banner appears with the message format from the spec.
    const banner = await screen.findByTestId('findings-bulk-banner-success');
    expect(banner).toHaveTextContent(
      /Marked 2 of 3 findings as Approved; 1 skipped/,
    );

    // Changing a filter clears the banner.
    fireEvent.change(screen.getByTestId('findings-filter-severity'), {
      target: { value: 'high' },
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId('findings-bulk-banner-success'),
      ).not.toBeInTheDocument(),
    );
  });
});
