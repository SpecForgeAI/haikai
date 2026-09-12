/**
 * DbMigrationPackTranslationsTab (+ side-by-side reviewer) tests
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts —
 * Task Group 5 (Task 5.1).
 *
 * Focused coverage ONLY (per the task limits):
 *   (a) the Translations tab (mounted as the fourth DbMigrationPackView
 *       section tab) renders the object list (name, kind, body size,
 *       disposition, pipeline state, review status, judge confidence) plus
 *       the coverage-summary chips from a mocked payload;
 *   (b) per-object Translate and bulk Translate-all both invoke the API
 *       (never individual-only) and a `failed` row offers Retry;
 *   (c) setting disposition `drop` requires a reason before the API call
 *       fires;
 *   (d) the side-by-side reviewer renders source T-SQL left / draft
 *       PL/pgSQL right with the judge verdict, confidence, and the
 *       construct/concern/severity flags table;
 *   (e) approve posts the review action with notes, and a `needs_manual`
 *       (truncated) row shows the terminal warning with NO review controls;
 *   (f) a `legacy_redacted` draft shows the "literals collapsed at capture —
 *       re-scan recommended" banner.
 *
 * NO in-app SQL editing exists anywhere — asserted implicitly: the reviewer
 * renders read-only panes only (no textarea/input carries draft content).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROJECT_ID = 'proj-pack-1';
const ARCH_ID = 'arch-pack-1';
const PACK_ID = 'pack-1';

// --- Mock CSS modules --------------------------------------------------------
vi.mock('../DbMigrationPack.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock(
  '../../MigrationDeliveryDashboard/MigrationDeliveryDashboard.module.css',
  () => ({
    default: new Proxy(
      {},
      { get: (_t: object, prop: string | symbol) => String(prop) },
    ),
  }),
);

// --- Mock the pack API module ------------------------------------------------
const mockListPacks = vi.fn();
const mockGetPack = vi.fn();
const mockListFiles = vi.fn();
const mockListTranslations = vi.fn();
const mockTranslateAll = vi.fn();
const mockTranslateOne = vi.fn();
const mockRetry = vi.fn();
const mockSetDisposition = vi.fn();
const mockReview = vi.fn();
const mockApproveAll = vi.fn();
// Workbench header reads (2026-09-09 Spec 4) — the tab polls these on mount,
// so they are stubbed here to keep this suite network-free. The pre-workbench
// fixtures carry no `routine_id` / `loop_status`, so no routine row exists and
// the attempt / parity-report reads never fire.
const mockBuildStatus = vi.fn();
const mockReconcileStatus = vi.fn();
const mockStartReconcile = vi.fn();
const mockBaselineStatus = vi.fn();
const mockLoopStatus = vi.fn();
const mockAttempts = vi.fn();
const mockParityReport = vi.fn();

vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPacks: (...args: unknown[]) => mockListPacks(...args),
    getDbMigrationPack: (...args: unknown[]) => mockGetPack(...args),
    listDbMigrationPackFiles: (...args: unknown[]) => mockListFiles(...args),
    listDbMigrationPackTranslations: (...args: unknown[]) =>
      mockListTranslations(...args),
    translateAllDbMigrationPackTranslations: (...args: unknown[]) =>
      mockTranslateAll(...args),
    translateDbMigrationPackTranslation: (...args: unknown[]) =>
      mockTranslateOne(...args),
    retryDbMigrationPackTranslation: (...args: unknown[]) =>
      mockRetry(...args),
    setDbMigrationPackTranslationDisposition: (...args: unknown[]) =>
      mockSetDisposition(...args),
    reviewDbMigrationPackTranslation: (...args: unknown[]) =>
      mockReview(...args),
    approveAllDbMigrationPackTranslations: (...args: unknown[]) =>
      mockApproveAll(...args),
    getDbMigrationPackTargetBuildStatus: (...args: unknown[]) =>
      mockBuildStatus(...args),
    getDbMigrationPackTargetReconcileStatus: (...args: unknown[]) =>
      mockReconcileStatus(...args),
    startDbMigrationPackTargetReconcile: (...args: unknown[]) =>
      mockStartReconcile(...args),
    getDbMigrationPackProcBaselineStatus: (...args: unknown[]) =>
      mockBaselineStatus(...args),
    getDbMigrationPackLoopStatus: (...args: unknown[]) => mockLoopStatus(...args),
    listDbMigrationPackTranslationAttempts: (...args: unknown[]) =>
      mockAttempts(...args),
    getDbMigrationPackTranslationParityReport: (...args: unknown[]) =>
      mockParityReport(...args),
  };
});

// --- Mock the book-of-work API (epic picker source inside the full view) -----
const mockListBooks = vi.fn();
vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    listMigrationBookOfWorks: (...args: unknown[]) => mockListBooks(...args),
  };
});

import { DbMigrationPackView } from '../DbMigrationPackView';
import DbMigrationPackTranslationsTab from '../DbMigrationPackTranslationsTab';
import type {
  DbMigrationPackTranslationCoverageSummary,
  DbMigrationPackTranslationDto,
  DbMigrationPackWithStaleness,
} from '../../../../api/dbMigrationPackApi';

// --- Fixtures -----------------------------------------------------------------

const SOURCE_TSQL =
  'CREATE PROCEDURE dbo.sp_calc AS\nSELECT getdate(), isnull(qty, 0) FROM dbo.orders';
const DRAFT_PLPGSQL =
  'CREATE OR REPLACE FUNCTION dbo.sp_calc() RETURNS void AS $$\nSELECT now(), coalesce(qty, 0) FROM dbo.orders;\n$$ LANGUAGE sql;';

function buildTranslation(
  overrides: Partial<DbMigrationPackTranslationDto> = {},
): DbMigrationPackTranslationDto {
  return {
    id: 'tr-drafted',
    pack_id: PACK_ID,
    translation_key: 'stored_procedure--dbo.sp_calc',
    object_ref: 'dbo.sp_calc',
    kind: 'stored_procedure',
    disposition: 'translate',
    drop_reason: null,
    pipeline_state: 'drafted',
    source_body: SOURCE_TSQL,
    source_body_hash: 'hash-a',
    truncated: false,
    legacy_redacted: false,
    draft_content: DRAFT_PLPGSQL,
    judge_verdict_json: {
      verdict: 'equivalent',
      confidence: 0.92,
      flags: [
        {
          construct: 'getdate()',
          concern: 'timezone semantics differ between now() and getdate()',
          severity: 'low',
        },
      ],
    },
    review_status: 'unreviewed',
    reviewer_notes: null,
    created_at: '2026-06-11T10:00:00Z',
    translated_at: '2026-06-11T11:00:00Z',
    reviewed_at: null,
    ...overrides,
  };
}

const ROWS: DbMigrationPackTranslationDto[] = [
  buildTranslation(),
  buildTranslation({
    id: 'tr-pending',
    translation_key: 'view--dbo.v_orders',
    object_ref: 'dbo.v_orders',
    kind: 'view',
    pipeline_state: 'pending',
    draft_content: null,
    judge_verdict_json: null,
    translated_at: null,
  }),
  buildTranslation({
    id: 'tr-failed',
    translation_key: 'trigger--dbo.trg_audit',
    object_ref: 'dbo.trg_audit',
    kind: 'trigger',
    pipeline_state: 'failed',
    draft_content: null,
    judge_verdict_json: null,
    translated_at: null,
  }),
  buildTranslation({
    id: 'tr-manual',
    translation_key: 'stored_procedure--dbo.sp_huge',
    object_ref: 'dbo.sp_huge',
    kind: 'stored_procedure',
    pipeline_state: 'needs_manual',
    truncated: true,
    draft_content: null,
    judge_verdict_json: null,
    translated_at: null,
  }),
];

const COVERAGE: DbMigrationPackTranslationCoverageSummary = {
  total: 4,
  pending: 1,
  translating: 0,
  drafted: 1,
  failed: 1,
  needs_manual: 1,
  rewrite_in_app: 0,
  dropped: 0,
  approved: 0,
  rejected: 0,
  needs_rework: 0,
  unreviewed: 3,
};

function buildPack(): DbMigrationPackWithStaleness {
  return {
    id: PACK_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    status: 'generated',
    stale_reason: null,
    input_snapshot_hash: 'hash-1',
    generated_at: '2026-06-11T10:00:00Z',
    work_item_id: 'epic-db-1',
    translated_count: 2,
    skipped_count: 1,
    flagged_count: 1,
    seed_margin: 1000,
    manifest_json: null,
    created_at: '2026-06-11T10:00:00Z',
    updated_at: '2026-06-11T10:00:00Z',
    is_stale: false,
    staleness_reason: null,
  };
}

function renderTab() {
  return render(
    <DbMigrationPackTranslationsTab projectId={PROJECT_ID} packId={PACK_ID} />,
  );
}

beforeEach(() => {
  mockListPacks.mockReset();
  mockGetPack.mockReset();
  mockListFiles.mockReset();
  mockListTranslations.mockReset();
  mockTranslateAll.mockReset();
  mockTranslateOne.mockReset();
  mockRetry.mockReset();
  mockSetDisposition.mockReset();
  mockReview.mockReset();
  mockListBooks.mockReset();
  mockListBooks.mockResolvedValue([]);
  mockBuildStatus.mockReset();
  mockBaselineStatus.mockReset();
  mockLoopStatus.mockReset();
  mockAttempts.mockReset();
  mockParityReport.mockReset();
  mockBuildStatus.mockResolvedValue({ inFlight: null, latest: null });
  mockReconcileStatus.mockReset();
  mockStartReconcile.mockReset();
  mockReconcileStatus.mockResolvedValue({ inFlight: null, last: null, latestReport: null, latestReportError: null });
  mockBaselineStatus.mockResolvedValue({
    pinned: false,
    baselineId: null,
    scenarios: 0,
    routines: 0,
  });
  mockLoopStatus.mockResolvedValue({
    inFlight: false,
    phase: null,
    routines: 0,
    done: 0,
    startedAt: null,
    error: null,
    events: [],
    results: null,
  });
  mockAttempts.mockResolvedValue([]);
  mockParityReport.mockResolvedValue(null);
  mockListTranslations.mockResolvedValue({
    translations: ROWS,
    coverage: COVERAGE,
  });
});

describe('DbMigrationPackTranslationsTab (Task 5.1)', () => {
  it('(a) renders the object list + coverage chips from the mocked payload via the fourth section tab', async () => {
    mockListPacks.mockResolvedValue([buildPack()]);
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue([]);

    render(
      <DbMigrationPackView projectId={PROJECT_ID} architectureId={ARCH_ID} />,
    );

    // The Translations tab exists as the fourth section tab.
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-section-translations'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('db-pack-section-translations'));

    // Coverage chips (drafted / approved / rewrite-in-app / dropped /
    // failed / needs-manual counts).
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translations-coverage'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('db-pack-translation-coverage-drafted'),
    ).toHaveTextContent('1 drafted');
    expect(
      screen.getByTestId('db-pack-translation-coverage-approved'),
    ).toHaveTextContent('0 approved');
    expect(
      screen.getByTestId('db-pack-translation-coverage-rewrite-in-app'),
    ).toHaveTextContent('0 rewrite in app');
    expect(
      screen.getByTestId('db-pack-translation-coverage-dropped'),
    ).toHaveTextContent('0 dropped');
    expect(
      screen.getByTestId('db-pack-translation-coverage-failed'),
    ).toHaveTextContent('1 failed');
    expect(
      screen.getByTestId('db-pack-translation-coverage-needs-manual'),
    ).toHaveTextContent('1 needs manual');

    // Object list row: name, kind, body size, disposition, pipeline state,
    // review status, judge confidence.
    const draftedRow = screen.getByTestId('db-pack-translation-row-tr-drafted');
    expect(draftedRow).toHaveTextContent('dbo.sp_calc');
    expect(draftedRow).toHaveTextContent('stored_procedure');
    expect(draftedRow).toHaveTextContent(`${SOURCE_TSQL.length} B`);
    expect(draftedRow).toHaveTextContent('drafted');
    expect(draftedRow).toHaveTextContent('unreviewed');
    expect(draftedRow).toHaveTextContent('0.92');

    // Fidelity warning indicator on the truncated row.
    expect(
      screen.getByTestId('db-pack-translation-row-tr-manual'),
    ).toHaveTextContent('truncated');
  });

  it('(b) per-object Translate + bulk Translate-all invoke the API, and a failed row offers Retry', async () => {
    mockTranslateOne.mockResolvedValue({ outcomes: [], coverage: COVERAGE });
    mockRetry.mockResolvedValue({ outcomes: [], coverage: COVERAGE });
    mockTranslateAll.mockResolvedValue({
      outcomes: [
        {
          translation_id: 'tr-pending',
          translation_key: 'view--dbo.v_orders',
          object_ref: 'dbo.v_orders',
          previous_state: 'pending',
          new_state: 'drafted',
          error: null,
        },
        {
          translation_id: 'tr-failed',
          translation_key: 'trigger--dbo.trg_audit',
          object_ref: 'dbo.trg_audit',
          previous_state: 'failed',
          new_state: 'failed',
          error: 'judge call failed after retry',
        },
      ],
      coverage: COVERAGE,
    });

    renderTab();
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-row-tr-pending'),
      ).toBeInTheDocument(),
    );

    // Per-object Translate on the pending row.
    fireEvent.click(
      screen.getByTestId('db-pack-translation-translate-tr-pending'),
    );
    await waitFor(() =>
      expect(mockTranslateOne).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        'tr-pending',
      ),
    );

    // The failed row offers Retry (never translate-only).
    fireEvent.click(screen.getByTestId('db-pack-translation-retry-tr-failed'));
    await waitFor(() =>
      expect(mockRetry).toHaveBeenCalledWith(PROJECT_ID, PACK_ID, 'tr-failed'),
    );

    // The needs_manual row has NO translate action (excluded from runs).
    expect(
      screen.queryByTestId('db-pack-translation-translate-tr-manual'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('db-pack-translation-retry-tr-manual'),
    ).not.toBeInTheDocument();

    // Bulk Translate-all + per-object outcomes surfaced in the notice.
    fireEvent.click(screen.getByTestId('db-pack-translate-all'));
    await waitFor(() =>
      expect(mockTranslateAll).toHaveBeenCalledWith(PROJECT_ID, PACK_ID),
    );
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-translations-notice')).toHaveTextContent(
        'dbo.trg_audit: judge call failed after retry',
      ),
    );
  });

  it('(c) disposition drop requires a reason before the API call fires', async () => {
    mockSetDisposition.mockResolvedValue({
      translation: buildTranslation({
        id: 'tr-drafted',
        disposition: 'drop',
        drop_reason: 'obsolete report proc',
      }),
      emission: null,
    });

    renderTab();
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-row-tr-drafted'),
      ).toBeInTheDocument(),
    );

    // Choosing drop opens the reason input — NO API call yet.
    fireEvent.change(
      screen.getByTestId('db-pack-translation-disposition-tr-drafted'),
      { target: { value: 'drop' } },
    );
    expect(mockSetDisposition).not.toHaveBeenCalled();

    // Confirming with an empty reason is rejected client-side.
    fireEvent.click(
      screen.getByTestId('db-pack-translation-drop-confirm-tr-drafted'),
    );
    expect(mockSetDisposition).not.toHaveBeenCalled();
    expect(screen.getByTestId('db-pack-translations-error')).toHaveTextContent(
      'reason',
    );

    // With a reason the call fires with disposition + drop_reason.
    fireEvent.change(
      screen.getByTestId('db-pack-translation-drop-reason-tr-drafted'),
      { target: { value: 'obsolete report proc' } },
    );
    fireEvent.click(
      screen.getByTestId('db-pack-translation-drop-confirm-tr-drafted'),
    );
    await waitFor(() =>
      expect(mockSetDisposition).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        'tr-drafted',
        'drop',
        'obsolete report proc',
      ),
    );
  });

  it('(d) the side-by-side reviewer renders source T-SQL left / draft PL/pgSQL right with verdict + flags', async () => {
    renderTab();
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-row-tr-drafted'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('db-pack-translation-review-tr-drafted'));

    const reviewer = await screen.findByTestId('db-pack-translation-reviewer');
    expect(reviewer).toBeInTheDocument();

    // Source T-SQL pane (left) and draft PL/pgSQL pane (right).
    expect(screen.getByTestId('db-pack-translation-source')).toHaveTextContent(
      'CREATE PROCEDURE dbo.sp_calc',
    );
    expect(screen.getByTestId('db-pack-translation-draft')).toHaveTextContent(
      'CREATE OR REPLACE FUNCTION dbo.sp_calc()',
    );

    // Judge verdict + confidence + the construct/concern/severity flags table.
    const verdict = screen.getByTestId('db-pack-translation-verdict');
    expect(verdict).toHaveTextContent('equivalent');
    expect(verdict).toHaveTextContent('0.92');
    const flagRow = screen.getByTestId('db-pack-translation-flag-0');
    expect(flagRow).toHaveTextContent('getdate()');
    expect(flagRow).toHaveTextContent('timezone semantics differ');
    expect(flagRow).toHaveTextContent('low');
  });

  it('(e) approve posts the review action with notes; a needs_manual row shows the terminal warning with NO review controls', async () => {
    const approvedRow = buildTranslation({
      review_status: 'approved',
      reviewer_notes: 'Looks equivalent.',
      reviewed_at: '2026-06-11T12:00:00Z',
    });
    mockReview.mockResolvedValue({
      translation: approvedRow,
      emission: { approved_count: 1, emitted_file_paths: [], changed: true },
    });
    // The post-review coverage re-fetch returns the PERSISTED state.
    mockListTranslations.mockResolvedValue({
      translations: [approvedRow, ...ROWS.slice(1)],
      coverage: { ...COVERAGE, approved: 1, unreviewed: 2 },
    });

    renderTab();
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-row-tr-drafted'),
      ).toBeInTheDocument(),
    );

    // Approve with notes on the drafted row.
    fireEvent.click(screen.getByTestId('db-pack-translation-review-tr-drafted'));
    fireEvent.change(
      await screen.findByTestId('db-pack-translation-review-notes'),
      { target: { value: 'Looks equivalent.' } },
    );
    fireEvent.click(screen.getByTestId('db-pack-translation-approve'));
    await waitFor(() =>
      expect(mockReview).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        'tr-drafted',
        'approve',
        'Looks equivalent.',
      ),
    );
    // Reviewed-at shows after the action.
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-reviewed-at'),
      ).toHaveTextContent('2026-06-11T12:00:00Z'),
    );

    // needs_manual (truncated) row: terminal warning, NO review controls.
    fireEvent.click(screen.getByTestId('db-pack-translation-review-tr-manual'));
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-truncated-banner'),
      ).toHaveTextContent('Body truncated at capture'),
    );
    expect(
      screen.queryByTestId('db-pack-translation-approve'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('db-pack-translation-reject'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('db-pack-translation-needs-rework'),
    ).not.toBeInTheDocument();
  });

  it('(f) a legacy_redacted draft shows the "literals collapsed at capture — re-scan recommended" banner', async () => {
    mockListTranslations.mockResolvedValue({
      translations: [
        buildTranslation({ id: 'tr-legacy', legacy_redacted: true }),
      ],
      coverage: { ...COVERAGE, total: 1 },
    });

    renderTab();
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-row-tr-legacy'),
      ).toBeInTheDocument(),
    );

    // Indicator chip in the list row too.
    expect(
      screen.getByTestId('db-pack-translation-row-tr-legacy'),
    ).toHaveTextContent('legacy literals');

    fireEvent.click(screen.getByTestId('db-pack-translation-review-tr-legacy'));
    await waitFor(() =>
      expect(
        screen.getByTestId('db-pack-translation-legacy-banner'),
      ).toHaveTextContent('literals collapsed at capture — re-scan recommended'),
    );
    // Legacy-redacted is reviewable (warned, not blocked).
    expect(screen.getByTestId('db-pack-translation-approve')).toBeInTheDocument();
  });
  it('Approve all (2026-08-08): ONE bulk call; count mirrors the approve gate; not-approvable rows surface honestly', async () => {
    // Fixture ROWS: tr-drafted is the ONLY drafted+unreviewed translate row
    // carrying a judge verdict (pending/failed/needs_manual are ineligible).
    mockApproveAll.mockResolvedValue({
      approved_count: 1,
      eligible_count: 1,
      not_approvable: [
        { translation_key: 'view--dbo.v_orders', pipeline_state: 'pending', reason: "pipeline state 'pending' — translate it first" },
      ],
      failed: [],
      emission: { approved_count: 1, emitted_file_paths: [], changed: true },
    });
    renderTab();

    const button = await screen.findByTestId('db-pack-approve-all');
    expect(button.textContent).toContain('Approve all (1)');
    fireEvent.click(button);

    await waitFor(() => expect(mockApproveAll).toHaveBeenCalledTimes(1));
    expect(mockApproveAll).toHaveBeenCalledWith(PROJECT_ID, PACK_ID);
    // Bulk = one call, never a per-row review loop.
    expect(mockReview).not.toHaveBeenCalled();
    const notice = await screen.findByTestId('db-pack-translations-notice');
    expect(notice.textContent).toContain('Approved 1 translation(s)');
    expect(notice.textContent).toContain('1 unreviewed row(s) are not approvable');
  });
});

describe('DbMigrationPackTranslationsTab — Reconcile target (2026-09-12)', () => {
  it('shows "not reconciled", opens the reconcile modal, and starts the reconcile with the entered credentials', async () => {
    mockStartReconcile.mockResolvedValue({ accepted: true });
    renderTab();
    const status = await screen.findByTestId('db-pack-wb-reconcile-status');
    expect(status.textContent).toContain('Target parity: not reconciled');

    fireEvent.click(screen.getByTestId('db-pack-wb-reconcile-target'));
    const modal = await screen.findByTestId('db-pack-wb-target-modal');
    expect(modal.getAttribute('data-variant')).toBe('reconcile');
    fireEvent.change(screen.getByTestId('db-pack-wb-target-host'), { target: { value: 'pg' } });
    fireEvent.change(screen.getByTestId('db-pack-wb-target-port'), { target: { value: '5432' } });
    fireEvent.change(screen.getByTestId('db-pack-wb-target-database'), { target: { value: 'target' } });
    fireEvent.change(screen.getByTestId('db-pack-wb-target-username'), { target: { value: 'u' } });
    fireEvent.change(screen.getByTestId('db-pack-wb-target-password'), { target: { value: 'p' } });
    fireEvent.click(screen.getByTestId('db-pack-wb-target-modal-submit'));

    await waitFor(() => expect(mockStartReconcile).toHaveBeenCalledTimes(1));
    expect(mockStartReconcile.mock.calls[0][0]).toBe('proj-pack-1');
    expect(mockStartReconcile.mock.calls[0][2]).toMatchObject({ targetDb: { host: 'pg', database: 'target', username: 'u' }, sourceDb: null });
    await waitFor(() => expect(screen.queryByTestId('db-pack-wb-target-modal')).toBeNull());
  });

  it('renders the latest parity report: status, counts, and the divergent / unverifiable tables', async () => {
    mockReconcileStatus.mockResolvedValue({
      inFlight: null,
      last: { status: 'succeeded', reportId: 'rep-1', parityStatus: 'divergent', tables: 3, error: null, startedAt: null, endedAt: null },
      latestReport: {
        id: 'rep-1',
        status: 'divergent',
        createdAt: '2026-09-12T10:00:00Z',
        summary: { tables: 3, matchFull: 1, matchSampled: 0, divergent: 1, unverifiable: 1, status: 'divergent' },
        tables: [
          { schema: 'dbo', table: 'orders', verdict: 'match', depth: 'full', divergenceClass: null, reason: null, sourceCount: 10, targetCount: 10, rowsCompared: 10, cellDivergences: 0 },
          { schema: 'dbo', table: 'books', verdict: 'divergent', depth: 'full', divergenceClass: 'count_mismatch', reason: null, sourceCount: 12, targetCount: 11, rowsCompared: 11, cellDivergences: 0 },
          { schema: 'dbo', table: 'audit', verdict: 'unverifiable', depth: 'none', divergenceClass: null, reason: 'no key', sourceCount: null, targetCount: null, rowsCompared: 0, cellDivergences: 0 },
        ],
      },
      latestReportError: null,
    });
    renderTab();
    const status = await screen.findByTestId('db-pack-wb-reconcile-status');
    expect(status.textContent).toContain('divergent — 1 divergent / 1 unverifiable of 3 table(s)');
    const rows = screen.getByTestId('db-pack-wb-reconcile-tables');
    expect(rows.textContent).toContain('dbo.books — divergent (count_mismatch) · source 12 / target 11 rows');
    expect(rows.textContent).toContain('dbo.audit — unverifiable');
    expect(rows.textContent).toContain('no key');
    expect(screen.queryByTestId('db-pack-wb-reconcile-table-orders')).toBeNull();
  });

  it('while a reconcile is in flight the button is disabled and the header shows the phase', async () => {
    mockReconcileStatus.mockResolvedValue({
      inFlight: { phase: 'comparing 65 table(s)', startedAt: '2026-09-12T10:00:00Z', tables: 65 },
      last: null,
      latestReport: null,
      latestReportError: null,
    });
    renderTab();
    const status = await screen.findByTestId('db-pack-wb-reconcile-status');
    expect(status.textContent).toContain('reconciling: comparing 65 table(s)');
    expect((screen.getByTestId('db-pack-wb-reconcile-target') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('db-pack-wb-reconcile-target').textContent).toBe('Reconciling…');
  });
});
