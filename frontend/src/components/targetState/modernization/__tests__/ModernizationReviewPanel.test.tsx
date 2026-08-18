/**
 * ModernizationReviewPanel tests — 2026-08-18 SCL pipeline
 * ("Intermediate modernization decisions").
 *
 * Deps-injection strategy mirrors `DecisionsFileUploadPanel.test.tsx`: the api
 * seam is shimmed via the panel's `deps` prop (the wire contract itself is
 * covered by `sclModernizationApi.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ModernizationReviewPanel,
  type ModernizationReviewPanelDeps,
} from '../ModernizationReviewPanel';
import {
  SclModernizationApiError,
  type SclModernizationConfirmPayload,
  type SclModernizationReview,
} from '../../../../api/sclModernizationApi';

const BASE = { projectId: 'p1', architectureId: 'arch-1' };

/** 2 families, 3 rows; the numerics row is UNMAPPED with an empty target. */
function reviewFixture(
  overrides: Partial<SclModernizationReview> = {},
): SclModernizationReview {
  return {
    scan_id: 'scan-1',
    target_architecture_id: 'target-1',
    rows: [
      {
        family: 'dates',
        matcher_key: 'org.joda.time.LocalDate',
        usage_count: 61,
        example_cites: [
          { symbol: 'OrderService#ship', source_path: 'src/OrderService.java' },
        ],
        matched_rule_code: null,
        from: 'org.joda.time.LocalDate',
        default_to: 'java.time.LocalDate',
        provenance: 'ruleset_default',
        notes: 'straight swap',
      },
      {
        family: 'dates',
        matcher_key: 'org.joda.time.DateTime',
        usage_count: 14,
        example_cites: [],
        matched_rule_code: 'modernize.dates.joda-datetime',
        from: 'org.joda.time.DateTime',
        default_to: 'java.time.OffsetDateTime',
        provenance: 'llm_proposed',
        notes: null,
        proposal_rationale: 'Offset-carrying replacement preserves zone info.',
      },
      {
        family: 'numerics',
        matcher_key: 'com.acme.WideId',
        usage_count: 7,
        example_cites: [],
        matched_rule_code: null,
        from: 'com.acme.WideId',
        default_to: null,
        provenance: 'unmapped',
        notes: null,
      },
    ],
    existing_decisions: [],
    ...overrides,
  };
}

function depsFor(review: SclModernizationReview | Error): {
  deps: ModernizationReviewPanelDeps;
  fetchMock: ReturnType<typeof vi.fn>;
  confirmMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock =
    review instanceof Error
      ? vi.fn().mockRejectedValue(review)
      : vi.fn().mockResolvedValue(review);
  const confirmMock = vi.fn().mockResolvedValue({ confirmed: 3, failed: [] });
  return {
    deps: {
      fetchModernizationReview:
        fetchMock as unknown as ModernizationReviewPanelDeps['fetchModernizationReview'],
      confirmModernizationDecisions:
        confirmMock as unknown as ModernizationReviewPanelDeps['confirmModernizationDecisions'],
    },
    fetchMock,
    confirmMock,
  };
}

describe('ModernizationReviewPanel', () => {
  it('renders family groups + blast-radius-sorted rows from the review', async () => {
    const { deps, fetchMock } = depsFor(reviewFixture());
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    await waitFor(() =>
      expect(screen.getByTestId('modernization-review-table')).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith('p1', 'arch-1');

    // Both family group headers, with row counts.
    expect(screen.getByTestId('modernization-group-dates')).toHaveTextContent('dates');
    expect(screen.getByTestId('modernization-group-dates')).toHaveTextContent('2 rows');
    expect(screen.getByTestId('modernization-group-numerics')).toHaveTextContent('1 row');

    // 3 rows total; dates group (total usage 75) sorts before numerics (7),
    // and within dates the 61-use row precedes the 14-use row.
    const rows = screen.getAllByTestId('modernization-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('org.joda.time.LocalDate');
    expect(rows[0]).toHaveTextContent('61 uses');
    expect(rows[1]).toHaveTextContent('org.joda.time.DateTime');
    expect(rows[2]).toHaveTextContent('com.acme.WideId');

    // Provenance badges (LLM rationale carried in the title attr).
    const badges = screen.getAllByTestId('modernization-provenance-badge');
    expect(badges[0]).toHaveTextContent('ruleset default');
    expect(badges[1]).toHaveTextContent('LLM proposed');
    expect(badges[1]).toHaveAttribute(
      'title',
      'Offset-carrying replacement preserves zone info.',
    );
    expect(badges[2]).toHaveTextContent('unmapped');

    // Targets prefilled from default_to; the unmapped row is empty.
    const inputs = screen.getAllByTestId(
      'modernization-target-input',
    ) as HTMLInputElement[];
    expect(inputs[0].value).toBe('java.time.LocalDate');
    expect(inputs[2].value).toBe('');
  });

  it('disables Confirm-all with a missing count while a target is empty; filling enables', async () => {
    const { deps } = depsFor(reviewFixture());
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);
    await waitFor(() =>
      expect(screen.getByTestId('modernization-confirm-all')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('modernization-confirm-all')).toBeDisabled();
    expect(screen.getByTestId('modernization-missing-count')).toHaveTextContent(
      '1 row still needs a target value',
    );

    const inputs = screen.getAllByTestId(
      'modernization-target-input',
    ) as HTMLInputElement[];
    fireEvent.change(inputs[2], { target: { value: 'java.math.BigInteger' } });

    expect(screen.getByTestId('modernization-confirm-all')).toBeEnabled();
    expect(screen.queryByTestId('modernization-missing-count')).toBeNull();
  });

  it('Confirm-all POSTs every row with derived codes + current input values, then shows success', async () => {
    const { deps, confirmMock, fetchMock } = depsFor(reviewFixture());
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);
    await waitFor(() =>
      expect(screen.getByTestId('modernization-confirm-all')).toBeInTheDocument(),
    );

    const inputs = screen.getAllByTestId(
      'modernization-target-input',
    ) as HTMLInputElement[];
    fireEvent.change(inputs[2], { target: { value: 'java.math.BigInteger' } });
    fireEvent.click(screen.getByTestId('modernization-confirm-all'));

    await waitFor(() =>
      expect(screen.getByTestId('modernization-confirm-success')).toBeInTheDocument(),
    );

    expect(confirmMock).toHaveBeenCalledTimes(1);
    const [projectId, architectureId, payload] = confirmMock.mock.calls[0] as [
      string,
      string,
      SclModernizationConfirmPayload,
    ];
    expect(projectId).toBe('p1');
    expect(architectureId).toBe('arch-1');
    expect(payload.target_architecture_id).toBe('target-1');
    expect(payload.rows.map((r) => r.code)).toEqual([
      // No matched rule -> derived slug; matched rule code wins verbatim.
      'modernize.dates.org-joda-time-localdate',
      'modernize.dates.joda-datetime',
      'modernize.numerics.com-acme-wideid',
    ]);
    expect(payload.rows.map((r) => r.to)).toEqual([
      'java.time.LocalDate',
      'java.time.OffsetDateTime',
      'java.math.BigInteger',
    ]);
    expect(payload.rows[0]).toMatchObject({
      family: 'dates',
      from: 'org.joda.time.LocalDate',
      provenance: 'ruleset_default',
      usage_count: 61,
      example_cites: [
        { symbol: 'OrderService#ship', source_path: 'src/OrderService.java' },
      ],
    });

    // Success reloads the review (initial load + post-confirm reload).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the confirmed tick + persisted answer summary for a row whose derived code exists', async () => {
    const { deps } = depsFor(
      reviewFixture({
        existing_decisions: [
          {
            decision_id: 'd-1',
            decision_code: 'modernize.dates.org-joda-time-localdate',
            answer_value: 'java.time.LocalDate',
            answer_summary: 'java.time.LocalDate (confirmed earlier)',
            scope_kind: 'architecture',
            created_at: '2026-08-18T00:00:00Z',
          },
        ],
      }),
    );
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    await waitFor(() =>
      expect(screen.getByTestId('modernization-confirmed-tick')).toBeInTheDocument(),
    );
    const ticks = screen.getAllByTestId('modernization-confirmed-tick');
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toHaveTextContent('confirmed');
    expect(ticks[0]).toHaveTextContent('java.time.LocalDate (confirmed earlier)');

    // The confirmed row stays editable (re-confirm supersedes).
    const inputs = screen.getAllByTestId(
      'modernization-target-input',
    ) as HTMLInputElement[];
    expect(inputs[0]).toBeEnabled();
  });

  it('renders the quiet no-scan banner on a 404', async () => {
    const { deps } = depsFor(new SclModernizationApiError('no scan', 404));
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    await waitFor(() =>
      expect(screen.getByTestId('modernization-review-no-scan')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('modernization-review-no-scan')).toHaveTextContent(
      'No structural scan yet — run the code scan first',
    );
    expect(screen.queryByTestId('modernization-review-error')).toBeNull();
    expect(screen.queryByTestId('modernization-review-table')).toBeNull();
  });

  it('renders the error banner on a non-404 failure', async () => {
    const { deps } = depsFor(new SclModernizationApiError('gateway exploded', 502));
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    await waitFor(() =>
      expect(screen.getByTestId('modernization-review-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('modernization-review-error')).toHaveTextContent(
      'gateway exploded',
    );
  });

  it('renders per-row failures inline when the confirm partially fails', async () => {
    const { deps, confirmMock } = depsFor(reviewFixture());
    confirmMock.mockResolvedValue({
      confirmed: 2,
      failed: [
        { code: 'modernize.numerics.com-acme-wideid', error: 'value rejected' },
      ],
    });
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);
    await waitFor(() =>
      expect(screen.getByTestId('modernization-confirm-all')).toBeInTheDocument(),
    );

    const inputs = screen.getAllByTestId(
      'modernization-target-input',
    ) as HTMLInputElement[];
    fireEvent.change(inputs[2], { target: { value: 'java.math.BigInteger' } });
    fireEvent.click(screen.getByTestId('modernization-confirm-all'));

    await waitFor(() =>
      expect(screen.getByTestId('modernization-row-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('modernization-row-error')).toHaveTextContent(
      'value rejected',
    );
    expect(screen.getByTestId('modernization-confirm-error')).toHaveTextContent(
      '1 row(s) failed',
    );
    expect(screen.queryByTestId('modernization-confirm-success')).toBeNull();
  });

  it('is collapsible: the toggle hides the body without unloading it', async () => {
    const { deps } = depsFor(reviewFixture());
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);
    await waitFor(() =>
      expect(screen.getByTestId('modernization-review-table')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('modernization-review-toggle'));
    expect(screen.queryByTestId('modernization-review-table')).toBeNull();

    fireEvent.click(screen.getByTestId('modernization-review-toggle'));
    expect(screen.getByTestId('modernization-review-table')).toBeInTheDocument();
  });
});
