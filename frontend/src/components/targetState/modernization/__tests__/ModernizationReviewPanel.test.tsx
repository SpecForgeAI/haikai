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
  retryMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock =
    review instanceof Error
      ? vi.fn().mockRejectedValue(review)
      : vi.fn().mockResolvedValue(review);
  const confirmMock = vi.fn().mockResolvedValue({ confirmed: 3, failed: [] });
  const retryMock =
    review instanceof Error
      ? vi.fn().mockRejectedValue(review)
      : vi.fn().mockResolvedValue(review);
  return {
    deps: {
      fetchModernizationReview:
        fetchMock as unknown as ModernizationReviewPanelDeps['fetchModernizationReview'],
      confirmModernizationDecisions:
        confirmMock as unknown as ModernizationReviewPanelDeps['confirmModernizationDecisions'],
      retryModernizationProposals:
        retryMock as unknown as ModernizationReviewPanelDeps['retryModernizationProposals'],
    },
    fetchMock,
    confirmMock,
    retryMock,
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

    // Success reloads the review (initial load + post-confirm reload), and
    // the success copy reports the DISTINCT-code count (Kiro third bug: 98
    // writes silently landing as 96 codes is now visible — and blocked).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('modernization-confirm-success')).toHaveTextContent(
      '(3 distinct codes)',
    );
  });

  it('REFUSES a batch where two rows derive the same code (supersede-by-code would drop one)', async () => {
    // 'Foo Bar' and 'Foo.Bar' both slug to foo-bar -> the same derived code.
    const colliding = reviewFixture({
      rows: [
        {
          family: 'types',
          matcher_key: 'typeReference:Foo Bar',
          usage_count: 4,
          example_cites: [],
          matched_rule_code: null,
          from: 'Foo Bar',
          default_to: 'foo.bar.One',
          provenance: 'ruleset_default',
          notes: null,
        },
        {
          family: 'types',
          matcher_key: 'typeReference:Foo.Bar',
          usage_count: 2,
          example_cites: [],
          matched_rule_code: null,
          from: 'Foo.Bar',
          default_to: 'foo.bar.Two',
          provenance: 'ruleset_default',
          notes: null,
        },
      ],
    });
    const { deps, confirmMock } = depsFor(colliding);
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);
    await waitFor(() =>
      expect(screen.getByTestId('modernization-confirm-all')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('modernization-confirm-all'));

    await waitFor(() =>
      expect(screen.getByTestId('modernization-confirm-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('modernization-confirm-error')).toHaveTextContent(
      'decision-code collision',
    );
    expect(screen.getByTestId('modernization-confirm-error')).toHaveTextContent(
      'modernize.types.foo-bar <- [Foo Bar, Foo.Bar]',
    );
    // NOTHING was posted — no silent overwrite.
    expect(confirmMock).not.toHaveBeenCalled();
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

  it('lands READ-ONLY when fully confirmed; Re-open edits; re-save returns to review (2026-08-30)', async () => {
    // Every row's derived code is confirmed; the DateTime row's PERSISTED
    // value deliberately differs from the ruleset default. answer_value is
    // the REAL confirm-write JSON envelope — the panel must extract `.to`,
    // never paste the blob into the inputs.
    const envelope = (from: string, to: string) =>
      JSON.stringify({
        from,
        to,
        family: 'x',
        provenance: 'ruleset_default',
        usage_count: 1,
        example_cites: [],
      });
    const allConfirmed = reviewFixture({
      existing_decisions: [
        {
          decision_id: 'd-1',
          decision_code: 'modernize.dates.org-joda-time-localdate',
          answer_value: envelope('org.joda.time.LocalDate', 'java.time.LocalDate'),
          answer_summary: null,
          scope_kind: 'architecture',
          created_at: '2026-08-30T00:00:00Z',
        },
        {
          decision_id: 'd-2',
          decision_code: 'modernize.dates.joda-datetime',
          answer_value: envelope('org.joda.time.DateTime', 'java.time.ZonedDateTime'),
          answer_summary: null,
          scope_kind: 'architecture',
          created_at: '2026-08-30T00:00:00Z',
        },
        {
          decision_id: 'd-3',
          decision_code: 'modernize.numerics.com-acme-wideid',
          answer_value: envelope('com.acme.WideId', 'java.math.BigInteger'),
          answer_summary: null,
          scope_kind: 'architecture',
          created_at: '2026-08-30T00:00:00Z',
        },
      ],
    });
    const { deps, confirmMock } = depsFor(allConfirmed);
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    // Read-only review mode: targets as text, no inputs, no Confirm-all.
    await waitFor(() =>
      expect(
        screen.getAllByTestId('modernization-target-readonly'),
      ).toHaveLength(3),
    );
    expect(screen.queryByTestId('modernization-target-input')).toBeNull();
    expect(screen.queryByTestId('modernization-confirm-all')).toBeNull();
    expect(screen.getByTestId('modernization-review-mode-note')).toBeInTheDocument();

    // The PERSISTED `.to` renders (extracted from the envelope — no JSON
    // blob), not the ruleset default.
    const readonlyValues = screen
      .getAllByTestId('modernization-target-readonly')
      .map((el) => el.textContent);
    expect(readonlyValues).toEqual([
      'java.time.LocalDate',
      'java.time.ZonedDateTime', // default_to was java.time.OffsetDateTime
      'java.math.BigInteger',
    ]);

    // Re-open -> editable again, seeded from the persisted values.
    fireEvent.click(screen.getByTestId('modernization-reopen'));
    const inputs = screen.getAllByTestId(
      'modernization-target-input',
    ) as HTMLInputElement[];
    expect(inputs).toHaveLength(3);
    expect(inputs[1].value).toBe('java.time.ZonedDateTime');
    expect(screen.getByTestId('modernization-confirm-all')).toBeEnabled();

    // Re-save: confirm posts the (persisted-seeded) values, and the reload —
    // still fully confirmed — lands back in read-only review mode.
    fireEvent.click(screen.getByTestId('modernization-confirm-all'));
    await waitFor(() =>
      expect(screen.getByTestId('modernization-reopen')).toBeInTheDocument(),
    );
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('modernization-target-input')).toBeNull();
  });

  it('stays EDITABLE when only some rows are confirmed', async () => {
    const { deps } = depsFor(
      reviewFixture({
        existing_decisions: [
          {
            decision_id: 'd-1',
            decision_code: 'modernize.dates.org-joda-time-localdate',
            answer_value: 'java.time.LocalDate',
            answer_summary: null,
            scope_kind: 'architecture',
            created_at: '2026-08-30T00:00:00Z',
          },
        ],
      }),
    );
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    await waitFor(() =>
      expect(screen.getByTestId('modernization-review-table')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('modernization-reopen')).toBeNull();
    expect(screen.getAllByTestId('modernization-target-input')).toHaveLength(3);
    expect(screen.getByTestId('modernization-confirm-all')).toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // 2026-08-30 proposal honesty round: loud failed pass + Retry All
  // -------------------------------------------------------------------------

  it('banners a FAILED proposal pass loudly; the inline retry regenerates and fills the rows', async () => {
    const failed = reviewFixture({
      proposal_pass: {
        status: 'failed',
        source: 'none',
        eligible: 1,
        proposed: 0,
        error: 'rate limited',
        generated_at: null,
      },
    });
    const { deps, retryMock } = depsFor(failed);
    // The retry succeeds: proposals regenerated, the unmapped row now filled.
    retryMock.mockResolvedValue(
      reviewFixture({
        rows: reviewFixture().rows.map((row) =>
          row.matcher_key === 'com.acme.WideId'
            ? {
                ...row,
                default_to: 'java.math.BigInteger',
                provenance: 'llm_proposed' as const,
                proposal_rationale: 'fresh',
              }
            : row,
        ),
        proposal_pass: {
          status: 'ok',
          source: 'generated',
          eligible: 1,
          proposed: 1,
          error: null,
          generated_at: '2026-08-30T10:00:00Z',
        },
      }),
    );
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    const banner = await screen.findByTestId('modernization-proposals-failed');
    expect(banner).toHaveTextContent('AI proposals unavailable');
    expect(banner).toHaveTextContent('rate limited');
    expect(banner).toHaveTextContent('Retry rather than typing them by hand');

    fireEvent.click(screen.getByTestId('modernization-proposals-failed-retry'));
    await waitFor(() =>
      expect(screen.queryByTestId('modernization-proposals-failed')).toBeNull(),
    );
    expect(retryMock).toHaveBeenCalledWith('p1', 'arch-1');
    // The regenerated proposal seeded the previously-empty row.
    const inputs = screen.getAllByTestId(
      'modernization-target-input',
    ) as HTMLInputElement[];
    expect(inputs[2].value).toBe('java.math.BigInteger');
  });

  it('a failed REGENERATE over a surviving cache banners the softer copy', async () => {
    const { deps } = depsFor(
      reviewFixture({
        proposal_pass: {
          status: 'failed',
          source: 'cache',
          eligible: 1,
          proposed: 1,
          error: 'relay down',
          generated_at: '2026-08-29T09:00:00Z',
        },
      }),
    );
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    const banner = await screen.findByTestId('modernization-proposals-failed');
    expect(banner).toHaveTextContent('showing the previously saved proposals');
    expect(banner).toHaveTextContent('relay down');
  });

  it('offers Retry All in the footer when the pass had eligible rows; a retry failure keeps the table', async () => {
    const { deps, retryMock } = depsFor(
      reviewFixture({
        proposal_pass: {
          status: 'ok',
          source: 'cache',
          eligible: 1,
          proposed: 1,
          error: null,
          generated_at: '2026-08-29T09:00:00Z',
        },
      }),
    );
    retryMock.mockRejectedValue(new Error('gateway 502'));
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);

    const retryAll = await screen.findByTestId('modernization-retry-all');
    fireEvent.click(retryAll);

    await waitFor(() =>
      expect(screen.getByTestId('modernization-retry-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('modernization-retry-error')).toHaveTextContent(
      'gateway 502',
    );
    // The table never blanked.
    expect(screen.getByTestId('modernization-review-table')).toBeInTheDocument();
    expect(screen.getAllByTestId('modernization-target-input')).toHaveLength(3);
  });

  it('hides Retry All when the pass reports no eligible rows (or is absent — older gateway)', async () => {
    const { deps } = depsFor(reviewFixture()); // no proposal_pass at all
    render(<ModernizationReviewPanel {...BASE} deps={deps} />);
    await waitFor(() =>
      expect(screen.getByTestId('modernization-review-table')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('modernization-retry-all')).toBeNull();
    expect(screen.queryByTestId('modernization-proposals-failed')).toBeNull();
  });
});
