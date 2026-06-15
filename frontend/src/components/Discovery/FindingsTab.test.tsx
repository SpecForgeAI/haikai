/**
 * FindingsTab Tests
 *
 * Spec: 2026-05-16 Discovery Findings -- Task Group 7.1.
 * Spec F 2026-06-02 Normalize Findings Review Actions -- review surface is
 * Approve / Reject / Defer; disposition field is `review_status` carrying
 * pending_review / approved / rejected / deferred.
 *
 * Coverage:
 *   1. Table renders rows for findings returned by `listFindings`
 *   2. Default grouping (severity then category) inserts visible group headers
 *   3. Toggling status filter triggers a re-fetch
 *   4. Clicking a row opens the detail drawer with linked-evidence /
 *      linked-candidate panels populated from the finding's `links`
 *   5. Clicking Approve inside the drawer calls `reviewFinding` with
 *      `review_status='approved'` and the new row state replaces the old one
 *      in the local list
 *   6. Reviewer-notes-only Save Notes path posts via `updateFinding` and
 *      the row's `reviewer_notes` is updated locally
 *   7. Summary counts update after a successful review action
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  DiscoveryFindingDto,
  DiscoveryFindingSearchResponse,
} from '../../api/findingsApi';

// ----------------------------------------------------------------------------
// Mocks for findingsApi -- the FindingsTab tests verify wiring, not URL
// shape (that's covered by findingsApi.test.ts).
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

describe('FindingsTab (Group 7.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFindings.mockReset();
    mockReviewFinding.mockReset();
    mockUpdateFinding.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders findings rows after listFindings resolves', async () => {
    const findings = [
      makeFinding({ id: 'f-1', title: 'F One', severity: 'high', category: 'ambiguity' }),
      makeFinding({
        id: 'f-2',
        title: 'F Two',
        severity: 'medium',
        category: 'evidence_gap',
        finding_type: 'evidence_gap',
      }),
    ];
    mockListFindings.mockResolvedValue(makeResponse(findings));

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('findings-table')).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('findings-row');
    expect(rows).toHaveLength(2);
    // Severity grouping puts HIGH before MEDIUM, so the first finding row
    // should be the high-severity one.
    expect(rows[0]).toHaveAttribute('data-finding-id', 'f-1');
    expect(rows[0]).toHaveTextContent('F One');
    expect(rows[1]).toHaveAttribute('data-finding-id', 'f-2');
    expect(rows[1]).toHaveTextContent('F Two');
  });

  it('renders severity + category group headers in severity-descending order', async () => {
    const findings = [
      makeFinding({ id: 'f-low', severity: 'low', category: 'ambiguity', title: 'low one' }),
      makeFinding({ id: 'f-crit', severity: 'critical', category: 'ambiguity', title: 'crit one' }),
      makeFinding({ id: 'f-med', severity: 'medium', category: 'evidence_gap', title: 'med one' }),
    ];
    mockListFindings.mockResolvedValue(makeResponse(findings));

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('findings-table')).toBeInTheDocument();
    });

    const severityHeaders = screen.getAllByTestId('findings-severity-group-header');
    // critical -> medium -> low
    expect(severityHeaders).toHaveLength(3);
    expect(severityHeaders[0]).toHaveTextContent(/critical/i);
    expect(severityHeaders[1]).toHaveTextContent(/medium/i);
    expect(severityHeaders[2]).toHaveTextContent(/low/i);

    // Each severity bucket has at least one category sub-header
    expect(screen.getAllByTestId('findings-category-group-header').length).toBeGreaterThanOrEqual(3);
  });

  it('changing the status filter re-fetches findings with that filter', async () => {
    // Initial fetch returns 2 findings
    mockListFindings.mockResolvedValue(makeResponse([
      makeFinding({ id: 'f-1', title: 'F One' }),
    ]));
    // Filter change triggers a second fetch
    mockListFindings.mockResolvedValue(makeResponse([
      makeFinding({ id: 'f-deferred', title: 'Deferred one', review_status: 'deferred' }),
    ]));

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    // Mount fires TWO effects (unfiltered summary + filtered table).
    await waitFor(() => expect(mockListFindings).toHaveBeenCalledTimes(2));

    const statusSelect = screen.getByTestId('findings-filter-status') as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'deferred' } });

    // Filter change re-fires the filtered effect only (unfiltered is keyed on
    // project/arch/run and unaffected). Total goes from 2 to 3.
    await waitFor(() => expect(mockListFindings).toHaveBeenCalledTimes(3));

    // Verify the filter was passed through to the API on the latest call.
    const latestCallArgs =
      mockListFindings.mock.calls[mockListFindings.mock.calls.length - 1];
    // Args: (projectId, architectureId, runId, filters)
    expect(latestCallArgs[0]).toBe(PROJECT_ID);
    expect(latestCallArgs[1]).toBe(ARCH_ID);
    expect(latestCallArgs[2]).toBe(RUN_ID);
    expect(latestCallArgs[3]).toMatchObject({ review_status: 'deferred' });
  });

  it('opens the detail drawer on row click with linked-items panels populated', async () => {
    const finding = makeFinding({
      id: 'f-detail',
      title: 'A detailed finding',
      links: [
        {
          id: 'l-cand-1',
          finding_id: 'f-detail',
          link_type: 'supports',
          target_type: 'discovery_candidate',
          target_id: 'cand-1',
          label: 'related candidate',
          created_at: '2026-05-16T00:00:00Z',
        },
        {
          id: 'l-ev-1',
          finding_id: 'f-detail',
          link_type: 'supports',
          target_type: 'discovery_evidence',
          target_id: 'ev-1',
          label: null,
          created_at: '2026-05-16T00:00:00Z',
        },
      ],
    });
    mockListFindings.mockResolvedValue(makeResponse([finding]));

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => expect(screen.getByTestId('findings-table')).toBeInTheDocument());

    const row = screen.getByTestId('findings-row');
    fireEvent.click(row);

    const drawer = await screen.findByTestId('finding-detail-drawer');
    expect(drawer).toBeInTheDocument();
    expect(screen.getByTestId('finding-detail-title')).toHaveTextContent('A detailed finding');

    // Linked candidates + linked evidence panels both render
    const candidatesGroup = screen.getByTestId(
      'finding-detail-links-group-discovery_candidate',
    );
    expect(candidatesGroup).toBeInTheDocument();
    expect(within(candidatesGroup).getByText(/cand-1/)).toBeInTheDocument();

    const evidenceGroup = screen.getByTestId(
      'finding-detail-links-group-discovery_evidence',
    );
    expect(evidenceGroup).toBeInTheDocument();
    expect(within(evidenceGroup).getByText(/ev-1/)).toBeInTheDocument();
  });

  it('clicking Approve calls reviewFinding with review_status=approved and updates the row', async () => {
    const initial = makeFinding({ id: 'f-approve', title: 'To approve', review_status: 'pending_review' });
    const updated: DiscoveryFindingDto = {
      ...initial,
      review_status: 'approved',
      previous_review_status: 'pending_review',
      reviewed_at: '2026-05-16T01:00:00Z',
      reviewer_notes: '',
    };
    mockListFindings.mockResolvedValue(makeResponse([initial]));
    mockReviewFinding.mockResolvedValueOnce(updated);

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => expect(screen.getByTestId('findings-table')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('findings-row'));
    await screen.findByTestId('finding-detail-drawer');
    // Summary counts before action: 1 total, 0 approved
    expect(
      screen.getByTestId('findings-summary-approved'),
    ).toHaveTextContent('0');

    fireEvent.click(screen.getByTestId('finding-action-approve'));

    await waitFor(() => expect(mockReviewFinding).toHaveBeenCalledTimes(1));
    // Args: (projectId, architectureId, runId, findingId, body)
    const args = mockReviewFinding.mock.calls[0];
    expect(args[0]).toBe(PROJECT_ID);
    expect(args[1]).toBe(ARCH_ID);
    expect(args[2]).toBe(RUN_ID);
    expect(args[3]).toBe('f-approve');
    expect(args[4].review_status).toBe('approved');

    // Summary counts update: approved = 1 after the optimistic local splice
    await waitFor(() =>
      expect(screen.getByTestId('findings-summary-approved')).toHaveTextContent('1'),
    );
  });

  it('Save Notes posts a notes-only PATCH via updateFinding', async () => {
    const initial = makeFinding({ id: 'f-notes', title: 'Notes target', reviewer_notes: '' });
    mockListFindings.mockResolvedValue(makeResponse([initial]));
    mockUpdateFinding.mockResolvedValueOnce({
      ...initial,
      reviewer_notes: 'new notes',
    });

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => expect(screen.getByTestId('findings-table')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('findings-row'));
    await screen.findByTestId('finding-detail-drawer');

    const textarea = screen.getByTestId('finding-detail-notes-textarea');
    fireEvent.change(textarea, { target: { value: 'new notes' } });

    fireEvent.click(screen.getByTestId('finding-action-save-notes'));

    await waitFor(() => expect(mockUpdateFinding).toHaveBeenCalledTimes(1));
    const args = mockUpdateFinding.mock.calls[0];
    expect(args[4]).toMatchObject({ reviewer_notes: 'new notes' });
    expect(mockReviewFinding).not.toHaveBeenCalled();
  });

  it('summary counts strip updates after a successful review action', async () => {
    const f1 = makeFinding({ id: 'f-a', severity: 'critical', review_status: 'pending_review', title: 'Crit' });
    const f2 = makeFinding({ id: 'f-b', severity: 'medium', review_status: 'deferred', title: 'M' });
    mockListFindings.mockResolvedValue(makeResponse([f1, f2]));
    mockReviewFinding.mockResolvedValueOnce({
      ...f1,
      review_status: 'approved',
      previous_review_status: 'pending_review',
      reviewed_at: '2026-05-16T02:00:00Z',
      reviewer_notes: '',
    });

    render(
      <FindingsTab projectId={PROJECT_ID} architectureId={ARCH_ID} runId={RUN_ID} />,
    );

    await waitFor(() => expect(screen.getByTestId('findings-table')).toBeInTheDocument());

    // Initial: total=2, critical+high=1 (the critical one), deferred=1
    expect(screen.getByTestId('findings-summary-total')).toHaveTextContent('2');
    expect(screen.getByTestId('findings-summary-critical-high')).toHaveTextContent('1');
    expect(screen.getByTestId('findings-summary-deferred')).toHaveTextContent('1');
    expect(screen.getByTestId('findings-summary-approved')).toHaveTextContent('0');

    // Open the critical finding's drawer (row with data-finding-id "f-a")
    const critRow = screen
      .getAllByTestId('findings-row')
      .find((r) => r.getAttribute('data-finding-id') === 'f-a');
    expect(critRow).toBeTruthy();
    fireEvent.click(critRow as Element);
    await screen.findByTestId('finding-detail-drawer');

    fireEvent.click(screen.getByTestId('finding-action-approve'));

    // After action: approved=1; the critical+high count stays at 1 (severity
    // doesn't change), deferred stays at 1 (the other finding).
    await waitFor(() =>
      expect(screen.getByTestId('findings-summary-approved')).toHaveTextContent('1'),
    );
    expect(screen.getByTestId('findings-summary-total')).toHaveTextContent('2');
    expect(screen.getByTestId('findings-summary-critical-high')).toHaveTextContent('1');
    expect(screen.getByTestId('findings-summary-deferred')).toHaveTextContent('1');
  });
});
