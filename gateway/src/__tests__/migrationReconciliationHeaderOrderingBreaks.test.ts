/**
 * Gateway Task Group 3 tests -- Spec 2026-06-17 Reconcile Full-Response Fidelity
 * & Distinct Break Types.
 *
 * Covers the gateway's role in the header / ordering break dimensions:
 *   - `isDiffItemABreak` registers the NEW dimensions as breaks
 *     (`header_value_drift` / `header_presence_drift` / `body_ordering_drift`)
 *     and STILL registers status/body drift, while a clean
 *     `status_match && body_match && header_match` is NOT a break;
 *   - `diffItemToBreak` carries `header_classification` + the derived
 *     `break_types` SET onto `detail_json` for the frontend badges;
 *   - the post-diff `expected_volatile` auto-disposition pass (R-volatile):
 *       * a pure ALLOWLISTED-header-VALUE drift alone auto-disposes to
 *         `expected_volatile` (the comparator tagged the entry `declared`);
 *       * MIXED (a volatile allowlisted-header value + a REAL non-volatile body
 *         change) STAYS OPEN (load-bearing MIXED-stays-open);
 *       * a header presence/absence (`header_presence_drift`) STAYS OPEN
 *         (never tolerated);
 *       * a non-allowlisted header value change (no `declared` tag) STAYS OPEN;
 *       * no regression of the existing net-new / volatile-body behaviour.
 *
 * MIRRORS `migrationReconciliationVolatileAutoDisposition.test.ts`: all deps
 * mocked (no AMS / validation-service network), the break-store PATCH asserted
 * on the mock.
 */

// Silence the logger.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  triggerFullBaselineReconcile,
  ReconciliationDriverDeps,
  DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
} from '../services/migrationReconciliationDriver';
import {
  ReconciliationDiffItem,
  ReconciliationResult,
  isDiffItemABreak,
} from '../services/migrationReconciliationValidationClient';
import { MigrationExecutionRun } from '../services/migrationExecutionRunClient';
import {
  BREAK_DISPOSITION,
  MigrationReconciliationBreak,
} from '../services/migrationReconciliationBreakClient';
import { ReconcileBookOfWorkItem } from '../services/migrationReconciliationNetNewMatch';

const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';
const BOOK_ID = 'book-1';
const PINNED_BASELINE_ID = 'baseline-current-1';
const ARCH_ID = 'arch-1';
const TARGET_URL = 'https://target.example.test';

function deployedRun(overrides: Partial<MigrationExecutionRun> = {}): MigrationExecutionRun {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    book_of_work_id: BOOK_ID,
    status: 'deployed',
    pinned_current_baseline_id: PINNED_BASELINE_ID,
    target_base_url: TARGET_URL,
    ...overrides,
  };
}

/** A header diff entry, mirroring the validation-service HeaderDiffEntry shape. */
type HeaderEntry = {
  path: string;
  kind: 'presence' | 'value';
  headerName: string;
  volatilitySource?: string;
};

/** Build a paired diff_item with optional header + body diff metadata. */
function diffItem(
  id: string,
  args: {
    statusClassification?: string;
    bodyClassification?: string | null;
    headerClassification?: string | null;
    bodyEntries?: Array<{ path: string; kind: string; volatilitySource?: string }>;
    headerEntries?: HeaderEntry[];
    volatilitySources?: string[];
  },
): ReconciliationDiffItem {
  const blob: Record<string, unknown> = {};
  if (args.bodyEntries && args.bodyEntries.length > 0) blob.entries = args.bodyEntries;
  if (args.headerEntries && args.headerEntries.length > 0) blob.header_entries = args.headerEntries;
  if (args.volatilitySources && args.volatilitySources.length > 0) {
    blob.volatility_sources = args.volatilitySources;
  }
  return {
    id,
    method: 'GET',
    path: `/things/${id}`,
    scenario_name: 'default',
    source_baseline_item_id: `src-${id}`,
    target_baseline_item_id: `tgt-${id}`,
    status_classification: args.statusClassification ?? 'status_match',
    body_classification: args.bodyClassification ?? 'body_match',
    header_classification: args.headerClassification ?? null,
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: Object.keys(blob).length > 0 ? blob : null,
    notes: null,
  };
}

function buildDeps(args: {
  diffItems: ReconciliationDiffItem[];
  bookItems?: ReconcileBookOfWorkItem[];
  overrides?: Partial<ReconciliationDriverDeps>;
}): {
  deps: ReconciliationDriverDeps;
  createBreaks: jest.Mock;
  patchBreak: jest.Mock;
} {
  const createBreaks = jest.fn(
    async (_p: string, _r: string, breaks: MigrationReconciliationBreak[]) =>
      breaks.map((b, i) => ({ ...b, id: `brk-${b.diff_item_id ?? i}` })),
  );
  const patchBreak = jest.fn().mockResolvedValue({});
  const loadBookOfWork = jest.fn().mockResolvedValue(args.bookItems ?? []);

  const reconcileResult: ReconciliationResult = {
    ok: true,
    sessionId: 'sess-1',
    diffId: 'diff-1',
    targetBaselineId: 'tgt-bl-1',
    diffItems: args.diffItems,
    error: null,
  };

  const deps: ReconciliationDriverDeps = {
    createReconciliationBreaks: createBreaks,
    getReconciliationBreaksForRun: jest.fn().mockResolvedValue([]),
    getReconciliationBreaksByBugId: jest.fn().mockResolvedValue([]),
    markReconciliationBreaksSent: jest.fn().mockResolvedValue([]),
    patchReconciliationBreak: patchBreak,
    incrementReconciliationBreakAttempt: jest.fn().mockResolvedValue({}),
    tripReconciliationBreakCircuitBreaker: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    runHeadlessReconcile: jest.fn().mockResolvedValue(reconcileResult),
    validationDeps: {} as ReconciliationDriverDeps['validationDeps'],
    resolveArchitectureForBaseline: jest.fn().mockResolvedValue(ARCH_ID),
    getTargetCredentials: jest.fn().mockReturnValue({ type: 'none' }),
    implRequest: jest.fn(),
    circuitBreakerMaxAttempts: DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
    loadReconcileBookOfWork: loadBookOfWork,
    ...args.overrides,
  };
  return { deps, createBreaks, patchBreak };
}

/** The LAST PATCH for a break id (mirrors AMS last-write semantics). */
function patchFor(patchBreak: jest.Mock, breakId: string): MigrationReconciliationBreak | undefined {
  const calls = patchBreak.mock.calls.filter((c) => c[1] === breakId);
  return calls.length > 0 ? (calls[calls.length - 1][2] as MigrationReconciliationBreak) : undefined;
}

// ============================================================================
// isDiffItemABreak -- the break filter now registers the new dimensions.
// ============================================================================

describe('isDiffItemABreak registers the new dimensions (Spec 2026-06-17)', () => {
  it('a clean status_match && body_match && header_match is NOT a break', () => {
    expect(
      isDiffItemABreak(
        diffItem('clean', {
          statusClassification: 'status_match',
          bodyClassification: 'body_match',
          headerClassification: 'header_match',
        }),
      ),
    ).toBe(false);
    // null header (dimension skipped -- graceful degrade) is also clean.
    expect(
      isDiffItemABreak(
        diffItem('clean-null', {
          statusClassification: 'status_match',
          bodyClassification: 'body_match',
          headerClassification: null,
        }),
      ),
    ).toBe(false);
  });

  it('still flags status drift and body value/shape drift (no regression)', () => {
    expect(
      isDiffItemABreak(diffItem('s', { statusClassification: 'status_drift', headerClassification: 'header_match' })),
    ).toBe(true);
    expect(
      isDiffItemABreak(diffItem('bv', { bodyClassification: 'body_value_drift', headerClassification: 'header_match' })),
    ).toBe(true);
    expect(
      isDiffItemABreak(diffItem('bs', { bodyClassification: 'body_shape_drift', headerClassification: 'header_match' })),
    ).toBe(true);
  });

  it('flags header_value_drift, header_presence_drift, and body_ordering_drift', () => {
    expect(isDiffItemABreak(diffItem('hv', { headerClassification: 'header_value_drift' }))).toBe(true);
    expect(isDiffItemABreak(diffItem('hp', { headerClassification: 'header_presence_drift' }))).toBe(true);
    expect(isDiffItemABreak(diffItem('ord', { bodyClassification: 'body_ordering_drift' }))).toBe(true);
  });
});

// ============================================================================
// diffItemToBreak -- carries header_classification + break_types onto detail.
// ============================================================================

describe('break detail_json carries the per-dimension break_type set + header_classification', () => {
  it('a multi-dimension diff (status + headers + body-value) carries the full break_type set', async () => {
    const diffItems = [
      diffItem('multi', {
        statusClassification: 'status_drift',
        bodyClassification: 'body_value_drift',
        headerClassification: 'header_presence_drift',
        headerEntries: [{ path: '/x-new', kind: 'presence', headerName: 'X-New' }],
        bodyEntries: [{ path: '/total', kind: 'value_changed' }],
      }),
    ];
    const { deps, createBreaks } = buildDeps({ diffItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);

    const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
    const detail = (created[0].detail_json ?? {}) as Record<string, unknown>;
    expect(detail.header_classification).toBe('header_presence_drift');
    const breakTypes = detail.break_types as string[];
    expect(new Set(breakTypes)).toEqual(new Set(['status', 'headers', 'body-value']));
  });

  it('a single-dimension ordering diff carries exactly [ordering]', async () => {
    const diffItems = [diffItem('ord', { bodyClassification: 'body_ordering_drift' })];
    const { deps, createBreaks } = buildDeps({ diffItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);

    const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
    const detail = (created[0].detail_json ?? {}) as Record<string, unknown>;
    expect(detail.break_types).toEqual(['ordering']);
  });
});

// ============================================================================
// Header-value volatility auto-disposition + MIXED-stays-open (R-volatile).
// ============================================================================

describe('header-value volatility auto-disposition (R-volatile)', () => {
  it('a PURE allowlisted-header-VALUE drift alone auto-disposes to expected_volatile', async () => {
    // The comparator tags the allowlisted (Date) value change `declared` and
    // keeps body_match -- a pure-volatile header break (create-then-auto-dispose).
    const diffItems = [
      diffItem('hv-vol', {
        statusClassification: 'status_match',
        bodyClassification: 'body_match',
        headerClassification: 'header_value_drift',
        headerEntries: [{ path: '/date', kind: 'value', headerName: 'Date', volatilitySource: 'declared' }],
        volatilitySources: ['declared'],
      }),
    ];
    const { deps, createBreaks, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(1);

    // Created open first (visible + auditable), then PATCHed to expected_volatile.
    const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
    expect(created[0].disposition_status).toBe(BREAK_DISPOSITION.OPEN);

    const patch = patchFor(patchBreak, 'brk-hv-vol');
    expect(patch?.disposition_status).toBe(BREAK_DISPOSITION.EXPECTED_VOLATILE);
    expect(patch?.needs_human).toBe(false);
    const audit = ((patch?.detail_json ?? {}) as Record<string, unknown>).volatility_match as Record<
      string,
      unknown
    >;
    expect(audit.outcome).toBe('expected_volatile');
    // The tolerated header name is recorded in the audit trail.
    expect(audit.tolerated_header_names as string[]).toContain('Date');
  });

  it('MIXED (volatile allowlisted-header value + REAL body change) STAYS OPEN', async () => {
    // Date header value tolerated (declared) BUT a real /total body value also
    // diverged -> body_value_drift survives -> the break must STAY OPEN.
    const diffItems = [
      diffItem('hv-mixed', {
        statusClassification: 'status_match',
        bodyClassification: 'body_value_drift',
        headerClassification: 'header_value_drift',
        headerEntries: [{ path: '/date', kind: 'value', headerName: 'Date', volatilitySource: 'declared' }],
        bodyEntries: [{ path: '/total', kind: 'value_changed' }],
        volatilitySources: ['declared'],
      }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(0);

    const patch = patchFor(patchBreak, 'brk-hv-mixed');
    // NOT moved off open.
    expect(patch?.disposition_status).toBeUndefined();
    const audit = ((patch?.detail_json ?? {}) as Record<string, unknown>).volatility_match as Record<
      string,
      unknown
    >;
    expect(audit.outcome).toBe('mixed');
  });

  it('a header presence/absence (header_presence_drift) STAYS OPEN (never tolerated)', async () => {
    const diffItems = [
      diffItem('hp', {
        statusClassification: 'status_match',
        bodyClassification: 'body_match',
        headerClassification: 'header_presence_drift',
        headerEntries: [{ path: '/x-trace-id', kind: 'presence', headerName: 'X-Trace-Id' }],
      }),
    ];
    const { deps, createBreaks, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(0);

    // The break IS created (registered) and stays OPEN -- a header presence/absence
    // is NEVER tolerated. It carries no volatile source (the comparator tags no
    // `declared`), so the strict pass leaves it untouched (open), never disposed.
    const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
    expect(created).toHaveLength(1);
    expect(created[0].disposition_status).toBe(BREAK_DISPOSITION.OPEN);
    const patch = patchFor(patchBreak, 'brk-hp');
    expect(patch?.disposition_status).not.toBe(BREAK_DISPOSITION.EXPECTED_VOLATILE);
  });

  it('a NON-allowlisted header value change (Content-Type, no declared tag) STAYS OPEN', async () => {
    const diffItems = [
      diffItem('ct', {
        statusClassification: 'status_match',
        bodyClassification: 'body_match',
        headerClassification: 'header_value_drift',
        // No volatilitySource tag -> the comparator did NOT allowlist it.
        headerEntries: [{ path: '/content-type', kind: 'value', headerName: 'Content-Type' }],
      }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(0);

    // A non-allowlisted header value change carries no `declared` tag -> no
    // volatile source -> the strict pass leaves the break untouched (OPEN); it is
    // NEVER auto-disposed to expected_volatile.
    const patch = patchFor(patchBreak, 'brk-ct');
    expect(patch?.disposition_status).not.toBe(BREAK_DISPOSITION.EXPECTED_VOLATILE);
  });

  it('no regression: a pure volatile BODY drift still auto-disposes to expected_volatile', async () => {
    const diffItems = [
      diffItem('body-vol', {
        statusClassification: 'status_drift', // surface it regardless of body classification
        bodyClassification: 'body_match',
        headerClassification: null,
        bodyEntries: [{ path: '/createdAt', kind: 'value_changed', volatilitySource: 'probed' }],
        volatilitySources: ['probed'],
      }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(1);
    expect(patchFor(patchBreak, 'brk-body-vol')?.disposition_status).toBe(
      BREAK_DISPOSITION.EXPECTED_VOLATILE,
    );
  });
});
