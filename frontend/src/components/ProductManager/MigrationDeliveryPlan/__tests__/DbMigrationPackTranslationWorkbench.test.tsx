/**
 * DbMigrationPackTranslationsTab — WORKBENCH tests
 *
 * Spec: 2026-09-09 Stored Proc & Function Behaviour Program — Spec 4
 * (Translation Workbench Loop), frontend step 6.
 *
 *   (a) the header reports the target build (built / not built / building)
 *       and the pinned proc baseline (pinned / not pinned) with the cap;
 *   (b) the routine table renders the seven row states from fixtures and the
 *       filter narrows to "Needs you";
 *   (c) Translate & reconcile prompts for target credentials ONCE, POSTs the
 *       loop, polls loop-status, and reuses the held credentials afterwards;
 *   (d) the reviewer shows the failing scenarios and the attempt history,
 *       Guidance & retry posts the guidance, a 409 from Approve renders its
 *       reason inline, and Waive posts scope + reason.
 *
 * Rulings asserted here: the loop is AUTOMATIC (there is no manual-step
 * control), human intervention is guidance-only (NO draft editing affordance
 * exists), approval is evidence-gated, and staleness never locks a button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROJECT_ID = 'proj-wb-1';
const PACK_ID = 'pack-wb-1';

// --- Mock CSS modules --------------------------------------------------------
vi.mock('../DbMigrationPack.module.css', () => ({
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
const mockListTranslations = vi.fn();
const mockBuildStatus = vi.fn();
const mockStartBuild = vi.fn();
const mockBaselineStatus = vi.fn();
const mockLoopStatus = vi.fn();
const mockTranslateAndReconcile = vi.fn();
const mockRetryLoop = vi.fn();
const mockReconcile = vi.fn();
const mockWaive = vi.fn();
const mockApproveAllReconciled = vi.fn();
const mockAttempts = vi.fn();
const mockParityReport = vi.fn();
const mockReview = vi.fn();
const mockTranslateAll = vi.fn();
const mockApproveAll = vi.fn();

vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPackTranslations: (...a: unknown[]) => mockListTranslations(...a),
    getDbMigrationPackTargetBuildStatus: (...a: unknown[]) => mockBuildStatus(...a),
    startDbMigrationPackTargetBuild: (...a: unknown[]) => mockStartBuild(...a),
    getDbMigrationPackProcBaselineStatus: (...a: unknown[]) =>
      mockBaselineStatus(...a),
    getDbMigrationPackLoopStatus: (...a: unknown[]) => mockLoopStatus(...a),
    translateAndReconcileDbMigrationPack: (...a: unknown[]) =>
      mockTranslateAndReconcile(...a),
    retryDbMigrationPackTranslationLoop: (...a: unknown[]) => mockRetryLoop(...a),
    reconcileDbMigrationPackTranslation: (...a: unknown[]) => mockReconcile(...a),
    waiveDbMigrationPackTranslation: (...a: unknown[]) => mockWaive(...a),
    approveAllReconciledDbMigrationPackTranslations: (...a: unknown[]) =>
      mockApproveAllReconciled(...a),
    listDbMigrationPackTranslationAttempts: (...a: unknown[]) => mockAttempts(...a),
    getDbMigrationPackTranslationParityReport: (...a: unknown[]) =>
      mockParityReport(...a),
    reviewDbMigrationPackTranslation: (...a: unknown[]) => mockReview(...a),
    translateAllDbMigrationPackTranslations: (...a: unknown[]) =>
      mockTranslateAll(...a),
    approveAllDbMigrationPackTranslations: (...a: unknown[]) => mockApproveAll(...a),
  };
});

import DbMigrationPackTranslationsTab from '../DbMigrationPackTranslationsTab';
import type {
  DbMigrationPackTranslationCoverageSummary,
  DbMigrationPackTranslationDto,
} from '../../../../api/dbMigrationPackApi';

// --- Fixtures -----------------------------------------------------------------

const SOURCE_TSQL =
  'CREATE PROCEDURE dbo.calc_tier_band @band int AS\nSELECT band, isnull(weight, 0) FROM dbo.tier_rows';
const DRAFT_PLPGSQL =
  'CREATE OR REPLACE FUNCTION dbo.calc_tier_band(band int)\nRETURNS TABLE(band int, weight numeric) AS $$\nSELECT band, coalesce(weight, 0) FROM dbo.tier_rows;\n$$ LANGUAGE sql;';

function routine(
  overrides: Partial<DbMigrationPackTranslationDto> &
    Pick<DbMigrationPackTranslationDto, 'id' | 'object_ref'>,
): DbMigrationPackTranslationDto {
  return {
    pack_id: PACK_ID,
    translation_key: `stored_procedure--${overrides.object_ref}`,
    kind: 'stored_procedure',
    disposition: 'translate',
    drop_reason: null,
    pipeline_state: 'drafted',
    source_body: SOURCE_TSQL,
    source_body_hash: 'hash-wb',
    truncated: false,
    legacy_redacted: false,
    draft_content: DRAFT_PLPGSQL,
    judge_verdict_json: { verdict: 'equivalent', confidence: 0.88, flags: [] },
    review_status: 'unreviewed',
    reviewer_notes: null,
    created_at: '2026-09-09T09:00:00Z',
    translated_at: '2026-09-09T09:10:00Z',
    reviewed_at: null,
    routine_id: `routine-${overrides.id}`,
    ...overrides,
  } as DbMigrationPackTranslationDto;
}

/** The seven row states from the approved mock. */
const ROWS: DbMigrationPackTranslationDto[] = [
  routine({
    id: 'tr-a',
    object_ref: 'dbo.upd_ledger_roll',
    loop_status: 'reconciled',
    current_attempt_no: 1,
    best_attempt_no: 1,
    verdict_json: { status: 'reconciled', scenarios: 9, scenarios_failing: 0 },
  }),
  routine({
    id: 'tr-b',
    object_ref: 'dbo.calc_tier_band',
    loop_status: 'exhausted',
    current_attempt_no: 3,
    best_attempt_no: 2,
    verdict_json: {
      status: 'divergent',
      scenarios: 6,
      scenarios_failing: 2,
      attempts: 3,
      signatures: ['result_sets:weight', 'return_status'],
    },
  }),
  routine({
    id: 'tr-c',
    object_ref: 'dbo.purge_stale_holds',
    loop_status: 'unverified',
    current_attempt_no: 1,
    verdict_json: { status: 'unverified', reason: 'no scenarios in the baseline' },
  }),
  routine({
    id: 'tr-d',
    object_ref: 'dbo.fn_norm_weight',
    kind: 'function',
    loop_status: 'reconciled',
    review_status: 'approved',
    current_attempt_no: 2,
    best_attempt_no: 2,
    verdict_json: { status: 'reconciled', scenarios: 4, scenarios_failing: 0 },
  }),
  routine({
    id: 'tr-e',
    object_ref: 'dbo.rebuild_slot_index',
    loop_status: 'apply_failed',
    current_attempt_no: 1,
    verdict_json: {
      status: 'apply_failed',
      scenarios: 5,
      apply_error: '42883: function does not exist',
    },
  }),
  routine({
    id: 'tr-g',
    object_ref: 'dbo.post_tier_summary',
    loop_status: 'blocked_by_callee',
    current_attempt_no: 1,
    verdict_json: { scenarios: 7, blocked_by: ['dbo.calc_tier_band'] },
  }),
  routine({
    id: 'tr-f',
    object_ref: 'dbo.legacy_fee_split',
    disposition: 'rewrite_in_app',
    loop_status: 'dispositioned',
    current_attempt_no: null,
    verdict_json: null,
  }),
];

const COVERAGE: DbMigrationPackTranslationCoverageSummary = {
  total: 7,
  pending: 0,
  translating: 0,
  drafted: 7,
  failed: 0,
  needs_manual: 0,
  rewrite_in_app: 1,
  dropped: 0,
  approved: 1,
  rejected: 0,
  needs_rework: 0,
  unreviewed: 6,
};

const IDLE_LOOP = {
  inFlight: false,
  phase: null,
  routines: 0,
  done: 0,
  startedAt: null,
  error: null,
  events: [],
  results: null,
};

const ATTEMPTS = [
  {
    id: 'at-1',
    attemptNo: 1,
    verdict: 'divergent',
    draftContent: 'SELECT band, weight FROM dbo.tier_rows;',
    judgeVerdict: { verdict: 'equivalent', confidence: 0.71 },
    applyResult: { ok: true },
    parityReportId: 'rep-1',
    evidenceRungs: { rung: 'none', divergent: 4, error: null },
    guidanceText: null,
    createdAt: '2026-09-09T09:11:00Z',
  },
  {
    id: 'at-2',
    attemptNo: 2,
    verdict: 'divergent',
    draftContent: 'SELECT band, coalesce(weight, 0) FROM dbo.tier_rows;',
    judgeVerdict: { verdict: 'equivalent', confidence: 0.83 },
    applyResult: { ok: true },
    parityReportId: 'rep-2',
    evidenceRungs: { rung: 'one', divergent: 2, error: null },
    guidanceText: null,
    createdAt: '2026-09-09T09:12:00Z',
  },
  {
    id: 'at-3',
    attemptNo: 3,
    verdict: 'divergent',
    draftContent: DRAFT_PLPGSQL,
    judgeVerdict: { verdict: 'equivalent', confidence: 0.9 },
    applyResult: { ok: true },
    parityReportId: 'rep-3',
    evidenceRungs: { rung: 'cluster', divergent: 2, error: null },
    guidanceText: 'Keep the zero-row branch returning 0 rows, not a null row.',
    createdAt: '2026-09-09T09:13:00Z',
  },
];

const PARITY_REPORT = {
  scenarios: [
    {
      scenarioName: 'band_zero_rows',
      scenarioType: 'zero_row',
      verdict: 'divergent',
      signature: 'result_sets:weight',
      unverifiableReason: null,
      waived: false,
      dimensions: [
        {
          dimension: 'result_sets',
          verdict: 'divergent',
          advisory: false,
          detail: 'row 1 column weight differs',
          firstDivergence: 'set 0 / row 1 / weight',
          examples: [
            { where: 'set 0 / row 1 / weight', expected: '0', actual: 'null' },
          ],
        },
      ],
    },
    {
      scenarioName: 'band_raise_error',
      scenarioType: 'error_path',
      verdict: 'divergent',
      signature: 'return_status',
      unverifiableReason: null,
      waived: false,
      dimensions: [
        {
          dimension: 'return_status',
          verdict: 'divergent',
          advisory: false,
          detail: null,
          firstDivergence: 'return_status',
          examples: [{ where: 'return_status', expected: '-6', actual: '0' }],
        },
      ],
    },
    {
      scenarioName: 'band_happy',
      scenarioType: 'happy',
      verdict: 'match',
      signature: null,
      unverifiableReason: null,
      waived: false,
      dimensions: [],
    },
  ],
  summary: {
    status: 'divergent',
    divergent: 2,
    unverifiable: 0,
    scenarios: 6,
    signatures: [
      {
        signature: 'result_sets:weight',
        count: 1,
        scenarioNames: ['band_zero_rows'],
      },
    ],
  },
};

function renderTab() {
  return render(
    <DbMigrationPackTranslationsTab projectId={PROJECT_ID} packId={PACK_ID} />,
  );
}

/** Fill + submit the target connection block in whichever modal is open. */
function submitTargetCredentials() {
  fireEvent.change(screen.getByTestId('db-pack-wb-target-host'), {
    target: { value: 'pg.internal' },
  });
  fireEvent.change(screen.getByTestId('db-pack-wb-target-database'), {
    target: { value: 'ledger_tgt' },
  });
  fireEvent.change(screen.getByTestId('db-pack-wb-target-username'), {
    target: { value: 'svc_build' },
  });
  fireEvent.change(screen.getByTestId('db-pack-wb-target-password'), {
    target: { value: 'pw-1' },
  });
  fireEvent.click(screen.getByTestId('db-pack-wb-target-modal-submit'));
}

const EXPECTED_TARGET_DB = {
  dbType: 'postgres',
  host: 'pg.internal',
  port: 5432,
  database: 'ledger_tgt',
  schema: null,
  username: 'svc_build',
  password: 'pw-1',
};

beforeEach(() => {
  for (const mock of [
    mockListTranslations,
    mockBuildStatus,
    mockStartBuild,
    mockBaselineStatus,
    mockLoopStatus,
    mockTranslateAndReconcile,
    mockRetryLoop,
    mockReconcile,
    mockWaive,
    mockApproveAllReconciled,
    mockAttempts,
    mockParityReport,
    mockReview,
    mockTranslateAll,
    mockApproveAll,
  ]) {
    mock.mockReset();
  }
  mockListTranslations.mockResolvedValue({
    translations: ROWS,
    coverage: COVERAGE,
  });
  mockBuildStatus.mockResolvedValue({ inFlight: null, latest: null });
  mockBaselineStatus.mockResolvedValue({
    pinned: false,
    baselineId: null,
    scenarios: 0,
    routines: 0,
  });
  mockLoopStatus.mockResolvedValue(IDLE_LOOP);
  mockAttempts.mockResolvedValue([]);
  mockParityReport.mockResolvedValue(null);
});

describe('Translation workbench — header (a)', () => {
  it('reports "not built" and "no pinned proc baseline" honestly, with the attempt cap', async () => {
    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-wb-target-status')).toHaveTextContent(
        'Target DB: not built',
      ),
    );
    expect(screen.getByTestId('db-pack-wb-baseline-status')).toHaveTextContent(
      'no pinned proc baseline — capture first',
    );
    expect(screen.getByTestId('db-pack-wb-attempt-cap')).toHaveTextContent(
      'Attempt cap: 4',
    );
    expect(screen.getByTestId('db-pack-wb-build-target')).toBeInTheDocument();
  });

  it('reports the built target with its pack version, the pinned baseline counts, and per-phase progress', async () => {
    mockBuildStatus.mockResolvedValue({
      inFlight: null,
      latest: {
        id: 'build-1',
        status: 'succeeded',
        phases: {
          schema: {
            status: 'succeeded',
            startedAt: null,
            endedAt: null,
            detail: null,
            error: null,
          },
          data: {
            status: 'succeeded',
            startedAt: null,
            endedAt: null,
            detail: '41 tables',
            error: null,
          },
          translations: {
            status: 'succeeded',
            startedAt: null,
            endedAt: null,
            detail: null,
            error: null,
          },
        },
        packVersion: '7',
        startedAt: '2026-09-09T13:40:00Z',
        endedAt: '2026-09-09T14:02:00Z',
        error: null,
      },
    });
    mockBaselineStatus.mockResolvedValue({
      pinned: true,
      baselineId: 'base-1',
      scenarios: 212,
      routines: 38,
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-wb-target-status')).toHaveTextContent(
        'from pack v7',
      ),
    );
    expect(screen.getByTestId('db-pack-wb-target-status')).toHaveTextContent(
      'built',
    );
    expect(screen.getByTestId('db-pack-wb-baseline-status')).toHaveTextContent(
      'pinned, 212 scenarios across 38 routines',
    );
    expect(screen.getByTestId('db-pack-wb-build-phases')).toHaveTextContent(
      'data: succeeded (41 tables)',
    );
  });

  it('shows the in-flight phase while a build runs', async () => {
    mockBuildStatus.mockResolvedValue({
      inFlight: { phase: 'data', startedAt: null, buildId: 'build-2' },
      latest: null,
    });

    renderTab();

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-wb-target-status')).toHaveTextContent(
        'building: data',
      ),
    );
    // A build in flight is the ONE thing that disables the workbench actions.
    expect(screen.getByTestId('db-pack-wb-translate-reconcile')).toBeDisabled();
  });

  it('Build target… collects the target block, keeps rebuild OFF with its note, and POSTs the build', async () => {
    mockStartBuild.mockResolvedValue({ buildId: 'build-3', accepted: true });
    renderTab();

    fireEvent.click(await screen.findByTestId('db-pack-wb-build-target'));
    const modal = await screen.findByTestId('db-pack-wb-target-modal');
    expect(modal).toHaveAttribute('data-variant', 'build');
    expect(screen.getByTestId('db-pack-wb-target-rebuild')).not.toBeChecked();
    expect(
      screen.getByTestId('db-pack-wb-target-rebuild-note'),
    ).toHaveTextContent('The server refuses rebuild today');

    submitTargetCredentials();

    await waitFor(() => expect(mockStartBuild).toHaveBeenCalledTimes(1));
    expect(mockStartBuild).toHaveBeenCalledWith(PROJECT_ID, PACK_ID, {
      targetDb: EXPECTED_TARGET_DB,
      sourceDb: null,
      rebuild: false,
    });
  });
});

describe('Translation workbench — routine table (b)', () => {
  it('renders the seven row states with honest verdicts and review states', async () => {
    renderTab();

    const rowA = await screen.findByTestId('db-pack-wb-row-tr-a');
    expect(rowA).toHaveTextContent('dbo.upd_ledger_roll');
    expect(rowA).toHaveTextContent('proc');
    expect(rowA).toHaveTextContent('reconciled');
    expect(rowA).toHaveTextContent('match 9 of 9');
    expect(screen.getByTestId('db-pack-wb-approve-tr-a')).toBeInTheDocument();

    const rowB = screen.getByTestId('db-pack-wb-row-tr-b');
    expect(rowB).toHaveTextContent('exhausted');
    expect(rowB).toHaveTextContent('3 of 3');
    expect(rowB).toHaveTextContent('divergent 2');
    expect(rowB).toHaveTextContent('needs you');

    const rowC = screen.getByTestId('db-pack-wb-row-tr-c');
    expect(rowC).toHaveTextContent('translated, unverified');
    expect(rowC).toHaveTextContent('no scenarios');
    expect(rowC).toHaveTextContent('waiver needed');

    const rowD = screen.getByTestId('db-pack-wb-row-tr-d');
    expect(rowD).toHaveTextContent('func');
    expect(rowD).toHaveTextContent('match 4 of 4');
    expect(rowD).toHaveTextContent('approved');

    const rowE = screen.getByTestId('db-pack-wb-row-tr-e');
    expect(rowE).toHaveTextContent('apply failed');
    expect(rowE).toHaveTextContent('needs you');

    const rowG = screen.getByTestId('db-pack-wb-row-tr-g');
    expect(rowG).toHaveTextContent('blocked by dbo.calc_tier_band');
    expect(rowG).toHaveTextContent('waiting');

    const rowF = screen.getByTestId('db-pack-wb-row-tr-f');
    expect(rowF).toHaveTextContent('dispositioned');
    expect(rowF).toHaveTextContent('rewrite_in_app');
    expect(rowF).toHaveTextContent('none');
  });

  it('the "Needs you" filter narrows to exhausted / apply_failed / unverified', async () => {
    renderTab();
    await screen.findByTestId('db-pack-wb-row-tr-a');

    fireEvent.change(screen.getByTestId('db-pack-wb-filter'), {
      target: { value: 'needs-you' },
    });

    expect(screen.getByTestId('db-pack-wb-row-tr-b')).toBeInTheDocument();
    expect(screen.getByTestId('db-pack-wb-row-tr-c')).toBeInTheDocument();
    expect(screen.getByTestId('db-pack-wb-row-tr-e')).toBeInTheDocument();
    expect(screen.queryByTestId('db-pack-wb-row-tr-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('db-pack-wb-row-tr-d')).not.toBeInTheDocument();
    expect(screen.queryByTestId('db-pack-wb-row-tr-g')).not.toBeInTheDocument();
    expect(screen.queryByTestId('db-pack-wb-row-tr-f')).not.toBeInTheDocument();

    // Blocked is its own bucket — never counted as a divergence.
    fireEvent.change(screen.getByTestId('db-pack-wb-filter'), {
      target: { value: 'blocked' },
    });
    expect(screen.getByTestId('db-pack-wb-row-tr-g')).toBeInTheDocument();
    expect(screen.queryByTestId('db-pack-wb-row-tr-b')).not.toBeInTheDocument();
  });

  it('Approve all reconciled calls the evidence-gated bulk route', async () => {
    mockApproveAllReconciled.mockResolvedValue({
      approvedCount: 1,
      eligibleCount: 1,
      failed: [
        { routine: 'dbo.purge_stale_holds', reason: 'unverified — waiver required' },
      ],
      emission: null,
    });
    renderTab();

    const button = await screen.findByTestId('db-pack-wb-approve-all-reconciled');
    expect(button.textContent).toContain('Approve all reconciled (1)');
    fireEvent.click(button);

    await waitFor(() =>
      expect(mockApproveAllReconciled).toHaveBeenCalledWith(PROJECT_ID, PACK_ID),
    );
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-translations-notice')).toHaveTextContent(
        'Approved 1 of 1 reconciled routine(s).',
      ),
    );
    expect(screen.getByTestId('db-pack-translations-notice')).toHaveTextContent(
      'waiver required',
    );
  });
});

describe('Translation workbench — translate & reconcile (c)', () => {
  it('prompts for target credentials once, POSTs the loop, polls loop-status, then reuses the credentials', async () => {
    mockTranslateAndReconcile.mockResolvedValue({ accepted: true });
    renderTab();

    await screen.findByTestId('db-pack-wb-row-tr-a');
    const pollsBefore = mockLoopStatus.mock.calls.length;

    fireEvent.click(screen.getByTestId('db-pack-wb-translate-reconcile'));

    const modal = await screen.findByTestId('db-pack-wb-target-modal');
    expect(modal).toHaveAttribute('data-variant', 'connect');
    submitTargetCredentials();

    await waitFor(() =>
      expect(mockTranslateAndReconcile).toHaveBeenCalledWith(PROJECT_ID, PACK_ID, {
        targetDb: EXPECTED_TARGET_DB,
      }),
    );
    // Polls loop-status straight after the 202.
    await waitFor(() =>
      expect(mockLoopStatus.mock.calls.length).toBeGreaterThan(pollsBefore),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('db-pack-wb-target-modal'),
      ).not.toBeInTheDocument(),
    );

    // Second run: the held credentials are reused, NO second prompt.
    fireEvent.click(screen.getByTestId('db-pack-wb-translate-reconcile'));
    await waitFor(() =>
      expect(mockTranslateAndReconcile).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByTestId('db-pack-wb-target-modal')).not.toBeInTheDocument();
  });

  it('tells the user LOUDLY when routines exhaust the attempt cap', async () => {
    mockLoopStatus.mockResolvedValue({
      ...IDLE_LOOP,
      routines: 2,
      done: 2,
      events: [
        {
          at: '2026-09-09T14:20:00Z',
          routine: 'dbo.calc_tier_band',
          phase: 'reconciling',
          detail: '2 divergent',
        },
      ],
      results: [
        {
          translationId: 'tr-b',
          routine: 'dbo.calc_tier_band',
          finalStatus: 'exhausted',
          attempts: 3,
          bestAttemptNo: 2,
          blockedBy: [],
          error: null,
        },
        {
          translationId: 'tr-a',
          routine: 'dbo.upd_ledger_roll',
          finalStatus: 'reconciled',
          attempts: 1,
          bestAttemptNo: 1,
          blockedBy: [],
          error: null,
        },
      ],
    });

    renderTab();

    const banner = await screen.findByTestId('db-pack-wb-loop-exhausted');
    expect(banner).toHaveTextContent('1 routine(s) hit the attempt cap of 4');
    expect(banner).toHaveTextContent('dbo.calc_tier_band (best attempt 2)');
    expect(screen.getByTestId('db-pack-wb-loop-events')).toHaveTextContent(
      'reconciling',
    );
  });
});

describe('Translation workbench — reviewer evidence (d)', () => {
  beforeEach(() => {
    mockAttempts.mockResolvedValue(ATTEMPTS);
    mockParityReport.mockResolvedValue(PARITY_REPORT);
  });

  async function openReviewerForB() {
    renderTab();
    fireEvent.click(await screen.findByTestId('db-pack-translation-review-tr-b'));
    await screen.findByTestId('db-pack-translation-reviewer');
    await waitFor(() =>
      expect(mockAttempts).toHaveBeenCalledWith(PROJECT_ID, PACK_ID, 'tr-b'),
    );
  }

  it('shows the behaviour verdict, the failing scenarios with expected vs actual, and the attempt history', async () => {
    await openReviewerForB();

    // Behaviour verdict + surviving failure signatures.
    const verdict = await screen.findByTestId('db-pack-wb-verdict');
    expect(verdict).toHaveTextContent('exhausted');
    expect(verdict).toHaveTextContent('divergent 2');
    expect(screen.getByTestId('db-pack-wb-signatures')).toHaveTextContent(
      'result_sets:weight',
    );

    // Failing scenarios ONLY (the matching one is not listed).
    const failing = await screen.findByTestId('db-pack-wb-failing-scenarios');
    expect(failing).toHaveTextContent('Failing scenarios (2)');
    expect(failing).toHaveTextContent('band_zero_rows');
    expect(failing).toHaveTextContent('band_raise_error');
    expect(failing).not.toHaveTextContent('band_happy');
    expect(
      screen.getByTestId('db-pack-wb-dimension-0-0-0'),
    ).toHaveTextContent('set 0 / row 1 / weight');
    expect(screen.getByTestId('db-pack-wb-dimension-0-0-0')).toHaveTextContent('0');
    expect(
      screen.getByTestId('db-pack-wb-dimension-0-0-0'),
    ).toHaveTextContent('null');

    // Attempt history + diff vs the previous attempt.
    const attempts = screen.getByTestId('db-pack-wb-attempts');
    expect(attempts).toHaveTextContent('Attempt history (3)');
    expect(screen.getByTestId('db-pack-wb-attempt-1')).toHaveTextContent('none');
    expect(screen.getByTestId('db-pack-wb-attempt-2')).toHaveTextContent('one');
    expect(screen.getByTestId('db-pack-wb-attempt-3')).toHaveTextContent('cluster');
    expect(screen.getByTestId('db-pack-wb-attempt-3')).toHaveTextContent(
      'Keep the zero-row branch',
    );

    fireEvent.click(screen.getByTestId('db-pack-wb-attempt-diff-toggle-2'));
    expect(screen.getByTestId('db-pack-wb-attempt-diff-2')).toHaveTextContent(
      'coalesce(weight, 0)',
    );
  });

  it('Guidance & retry posts the guidance for the NEXT attempt (no draft editing exists)', async () => {
    mockRetryLoop.mockResolvedValue({ accepted: true });
    await openReviewerForB();

    // The ONLY writable control in the reviewer is guidance / notes — the
    // draft panes are read-only (decision 16).
    fireEvent.change(screen.getByTestId('db-pack-wb-guidance'), {
      target: { value: 'Return 0 rows for the empty band, never a null row.' },
    });
    fireEvent.click(screen.getByTestId('db-pack-wb-retry'));

    // Credentials are prompted once, then the retry fires.
    await screen.findByTestId('db-pack-wb-target-modal');
    submitTargetCredentials();

    await waitFor(() =>
      expect(mockRetryLoop).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        'tr-b',
        EXPECTED_TARGET_DB,
        'Return 0 rows for the empty band, never a null row.',
      ),
    );
  });

  it('renders the server 409 reason inline when Approve is refused', async () => {
    mockReview.mockRejectedValue(
      Object.assign(
        new Error(
          'dbo.calc_tier_band is not reconciled: 2 scenarios still divergent and no waiver covers them',
        ),
        { status: 409 },
      ),
    );
    await openReviewerForB();

    fireEvent.click(screen.getByTestId('db-pack-translation-approve'));

    const reason = await screen.findByTestId('db-pack-wb-approve-reason');
    expect(reason).toHaveTextContent('is not reconciled');
    expect(reason).toHaveTextContent('no waiver covers them');
    // The generic error banner is NOT used for the gated approve.
    expect(
      screen.queryByTestId('db-pack-translations-error'),
    ).not.toBeInTheDocument();
  });

  it('Waive posts scope + scenario + reason, and refuses to fire without a reason', async () => {
    mockWaive.mockResolvedValue({
      waiver: { id: 'w-1' },
      target: 'dbo.calc_tier_band::band_raise_error',
    });
    await openReviewerForB();

    fireEvent.click(screen.getByTestId('db-pack-wb-waive'));
    fireEvent.change(screen.getByTestId('db-pack-wb-waive-scope'), {
      target: { value: 'scenario' },
    });
    fireEvent.change(await screen.findByTestId('db-pack-wb-waive-scenario'), {
      target: { value: 'band_raise_error' },
    });

    // No reason yet — the call never fires.
    fireEvent.click(screen.getByTestId('db-pack-wb-waive-confirm'));
    expect(mockWaive).not.toHaveBeenCalled();
    expect(screen.getByTestId('db-pack-wb-waive-error')).toHaveTextContent(
      'A reason is required',
    );

    fireEvent.change(screen.getByTestId('db-pack-wb-waive-reason'), {
      target: { value: 'Error number carriage agreed as advisory for this path.' },
    });
    fireEvent.click(screen.getByTestId('db-pack-wb-waive-confirm'));

    await waitFor(() =>
      expect(mockWaive).toHaveBeenCalledWith(PROJECT_ID, PACK_ID, 'tr-b', {
        scope: 'scenario',
        scenario: 'band_raise_error',
        reason: 'Error number carriage agreed as advisory for this path.',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-translations-notice')).toHaveTextContent(
        'never fully reconciled',
      ),
    );
  });
});
