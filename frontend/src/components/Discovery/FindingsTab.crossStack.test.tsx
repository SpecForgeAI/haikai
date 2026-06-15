/**
 * Cross-stack gap-fill tests for FindingsTab + FindingDetailDrawer.
 *
 * Spec: 2026-05-16 Discovery Findings -- Task Group 8.
 * Spec F 2026-06-02 Normalize Findings Review Actions -- disposition field is
 * `review_status`; reviewer surface is Approve / Reject / Defer; transitions
 * are unrestricted (any->any) so AMS no longer returns a status-transition
 * rejection -- the drawer's error-surfacing contract is pinned here against a
 * generic AMS error instead.
 *
 * Per-group tests already in place (`FindingsTab.test.tsx`,
 * `DiscoveryRunDetailView.test.tsx`, `findingsApi.test.ts`) cover:
 *   - URL construction for every client method
 *   - table render, severity grouping, row click, drawer open
 *   - approve action wiring + summary count updates
 *   - reviewer-notes-only PATCH via updateFinding
 *
 * What is NOT covered:
 *   - Empty-state when listFindings returns zero findings (task 8.3.7)
 *   - A structured AMS error surfaced inside the drawer on a failed review
 *     (task 8.3.5: AMS rejection rendered to user)
 *   - Drawer error path on a 400 invalid_link_target during a review (D6
 *     errors are server-side, but the drawer's error-display contract is
 *     currently asserted by the per-group tests only for happy-path. Pinning
 *     the error surface protects against a regression where
 *     FindingsApiError.body.code stops being shown.)
 *
 * This file fills exactly those three gaps; the FindingsTab and drawer
 * coverage above is intentionally not duplicated.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type {
  DiscoveryFindingDto,
  DiscoveryFindingSearchResponse,
} from '../../api/findingsApi';

// ----------------------------------------------------------------------------
// Mocks for findingsApi
// ----------------------------------------------------------------------------

const mockListFindings = vi.fn();
const mockReviewFinding = vi.fn();
const mockUpdateFinding = vi.fn();

vi.mock('../../api/findingsApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/findingsApi')>(
    '../../api/findingsApi',
  );
  return {
    ...actual,
    listFindings: (...args: unknown[]) => mockListFindings(...args),
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
vi.mock('./FindingDetailDrawer.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Import AFTER mocks
import { FindingsTab } from './FindingsTab';
import { FindingsApiError } from '../../api/findingsApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-uuid-1';
const ARCH_ID = 'arch-uuid-1';
const RUN_ID = 'run-uuid-1';

function makeFinding(overrides: Partial<DiscoveryFindingDto> = {}): DiscoveryFindingDto {
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

function makeResponse(items: DiscoveryFindingDto[]): DiscoveryFindingSearchResponse {
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

describe('FindingsTab cross-stack gap-fill (Group 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFindings.mockReset();
    mockReviewFinding.mockReset();
    mockUpdateFinding.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Test 1 (priority 8.3.7): empty-state when the run has zero findings.
  // FindingsTab MUST render the empty-state without crashing, and the
  // summary counts strip MUST show zero totals.
  // ===========================================================================
  it('renders the empty-state and zero-summary strip when listFindings returns []', async () => {
    mockListFindings.mockResolvedValue(makeResponse([]));

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    // Empty-state visible, table NOT rendered.
    const empty = await screen.findByTestId('findings-empty');
    expect(empty).toBeInTheDocument();
    expect(screen.queryByTestId('findings-table')).not.toBeInTheDocument();

    // Summary counts all zero (component must not throw on zero-length).
    expect(screen.getByTestId('findings-summary-total')).toHaveTextContent('0');
    expect(screen.getByTestId('findings-summary-critical-high')).toHaveTextContent('0');
    expect(screen.getByTestId('findings-summary-pending-review')).toHaveTextContent('0');
    expect(screen.getByTestId('findings-summary-approved')).toHaveTextContent('0');
    expect(screen.getByTestId('findings-summary-rejected')).toHaveTextContent('0');
    expect(screen.getByTestId('findings-summary-deferred')).toHaveTextContent('0');
  });

  // ===========================================================================
  // Test 2 (priority 8.3.5): a structured AMS error from the review endpoint
  // reaches the drawer's submit-error display. This is the cross-stack
  // assertion that the structured AMS error body survives the gateway
  // pass-through and the FindingsApiError typing. (Under Spec F transitions
  // are unrestricted, so the error is a generic AMS failure, not a
  // status-transition rejection.)
  // ===========================================================================
  it('surfaces a structured AMS error message inside the drawer when reviewFinding rejects', async () => {
    const finding = makeFinding({
      id: 'f-rejected',
      review_status: 'rejected',
      title: 'Already rejected',
    });
    mockListFindings.mockResolvedValue(makeResponse([finding]));

    // Simulate AMS returning a structured error body through the gateway as a
    // typed error (e.g. a transient persistence failure).
    const apiError = new FindingsApiError(500, {
      code: 'internal_error',
      message: 'Could not persist the review action',
    });
    mockReviewFinding.mockRejectedValueOnce(apiError);

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('findings-table')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('findings-row'));
    await screen.findByTestId('finding-detail-drawer');

    // Click Approve to trigger the reviewFinding call (mocked to reject) and
    // assert the error body's message renders. The drawer surface doesn't
    // itself enforce any rules; AMS owns persistence.
    fireEvent.click(screen.getByTestId('finding-action-approve'));

    // Drawer should surface the AMS error message in submitError state.
    // We look for the message text rather than coupling to a private test id.
    await waitFor(() => {
      expect(
        screen.getByText(/Could not persist the review action/i),
      ).toBeInTheDocument();
    });

    // Critically the row stays in the table -- no partial UI mutation.
    expect(screen.getByTestId('findings-row')).toBeInTheDocument();
    // And the summary counts didn't shift (disposition didn't change).
    expect(screen.getByTestId('findings-summary-approved')).toHaveTextContent('0');
  });

  // ===========================================================================
  // Test 3 (priority 8.3.9): reviewer-notes-only PATCH via the drawer's
  // "Save Notes" button. The per-group test already verifies the call goes
  // through `updateFinding` -- this test pins the COMPLEMENT: the PATCH
  // payload does NOT include review_status, confidence, severity, or any
  // other mutable field. This is the boxed-Double-pitfall guard end-to-end.
  // ===========================================================================
  it('Save Notes PATCH carries ONLY reviewer_notes (no review_status, no confidence, no severity)', async () => {
    const initial = makeFinding({
      id: 'f-notes-only',
      title: 'Notes guard',
      confidence: 0.77,
      severity: 'high',
      review_status: 'deferred',
      reviewer_notes: null,
    });
    mockListFindings.mockResolvedValue(makeResponse([initial]));
    mockUpdateFinding.mockResolvedValueOnce({
      ...initial,
      reviewer_notes: 'just a note',
    });

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('findings-table')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('findings-row'));
    await screen.findByTestId('finding-detail-drawer');

    fireEvent.change(screen.getByTestId('finding-detail-notes-textarea'), {
      target: { value: 'just a note' },
    });
    fireEvent.click(screen.getByTestId('finding-action-save-notes'));

    await waitFor(() => expect(mockUpdateFinding).toHaveBeenCalledTimes(1));
    expect(mockReviewFinding).not.toHaveBeenCalled();

    const [, , , , patchBody] = mockUpdateFinding.mock.calls[0];
    const body = patchBody as Record<string, unknown>;

    // ONLY reviewer_notes -- absolutely no review_status, confidence, severity, etc.
    expect(Object.keys(body).sort()).toEqual(['reviewer_notes']);
    expect(body.reviewer_notes).toBe('just a note');

    // The row's reviewer_notes is updated locally (no full refetch).
    // (Verified indirectly: the textarea reflects the persisted notes.)
    await waitFor(() => {
      const ta = screen.getByTestId(
        'finding-detail-notes-textarea',
      ) as HTMLTextAreaElement;
      expect(ta.value).toBe('just a note');
    });
  });
});
