/**
 * Tests for the Group-4 post-diff `expected_volatile` auto-disposition pass
 * (Spec 2026-06-16, Reconcile-Time Determinism & Volatile-Value Handling).
 *
 * MIRRORS `migrationReconciliationNetNewAutoDisposition.test.ts`. The
 * api-migration-validation-service diff stays VOLATILITY-AGNOSTIC at
 * break-creation: it only ANNOTATES tolerated value/order entries with a
 * `volatilitySource` tag + surfaces the DISTINCT set on
 * `body_diff_json.volatility_sources`. This GATEWAY-ONLY pass runs AFTER
 * `runHeadlessReconcile` and AFTER the breaks are created, reads the metadata off
 * the break's `detail_json.body_diff_json`, and:
 *  - divergence ENTIRELY on {probed, probed_partial, endpoint_signal, declared}
 *    paths -> PATCH `expected_volatile`, needs_human=false, audit note (paths +
 *    sources);
 *  - heuristic-only justification -> down-rank to `info`, stays open;
 *  - MIXED (a non-volatile entry survived -> body_value_drift/body_shape_drift) ->
 *    stays `open` (the no-override guard, G3);
 *  - `non_json` / `not_probed` / `null` -> strict, NO auto-disposition;
 *  - INVARIANT (G2): no break ever DISAPPEARS -- every outcome is a visible
 *    terminal (`expected_volatile`) or a visible open break (`info` / untouched).
 *
 * Plus the retroactive human-declared-path re-disposition (`declareVolatilePaths`)
 * and the human-override-back-to-`open` path (`disposeBreaks`).
 *
 * All deps are mocked (no AMS round-trip, no validation-service network, no live
 * LLM). The break-store writes (`patchReconciliationBreak`) are asserted on the
 * mock.
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  triggerFullBaselineReconcile,
  declareVolatilePaths,
  disposeBreaks,
  ReconciliationDriverDeps,
  DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
} from '../services/migrationReconciliationDriver';
import {
  ReconciliationDiffItem,
  ReconciliationResult,
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

/** A deployed run with a pinned baseline + target URL + book of work. */
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

/** A diff entry, mirroring the validation-service BodyDiffEntry wire shape. */
type Entry = {
  path: string;
  kind: 'value_changed' | 'key_added' | 'key_removed' | 'type_changed';
  volatilitySource?: string;
};

/**
 * A paired (source<->target) diff item with a body_diff_json envelope. The
 * `bodyClassification` reflects what the validation-service comparator would have
 * set: `body_match` when the body diverged ONLY on tolerated paths; a real drift
 * classification when a non-volatile entry survived.
 */
function bodyDiffItem(
  id: string,
  args: {
    bodyClassification: string | null;
    entries: Entry[];
    volatilitySources?: string[];
  },
): ReconciliationDiffItem {
  const bodyDiffJson =
    args.entries.length > 0
      ? {
          entries: args.entries,
          ...(args.volatilitySources && args.volatilitySources.length > 0
            ? { volatility_sources: args.volatilitySources }
            : {}),
        }
      : null;
  return {
    id,
    method: 'GET',
    path: `/things/${id}`,
    scenario_name: 'default',
    source_baseline_item_id: `src-${id}`,
    target_baseline_item_id: `tgt-${id}`,
    // A break that diverges only on tolerated paths is still surfaced (status
    // matched, body classed body_match but body_diff_json non-null). To make it
    // a BREAK for `isDiffItemABreak`, give it a status_drift so it surfaces
    // regardless of the body classification (we are testing the volatility pass,
    // not the break filter).
    status_classification: 'status_drift',
    body_classification: args.bodyClassification,
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: bodyDiffJson,
    notes: null,
  };
}

/** A purely-volatile break (body_match, only tolerated entries). */
function volatileOnlyItem(id: string, source: string, path = `/things/${id}`): ReconciliationDiffItem {
  const item = bodyDiffItem(id, {
    bodyClassification: 'body_match',
    entries: [{ path, kind: 'value_changed', volatilitySource: source }],
    volatilitySources: [source],
  });
  item.path = path;
  return item;
}

/** Build the reconcile-driver deps surface (echoes created breaks with ids). */
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

/** Find the PATCH call (if any) that targeted a given break id. */
function patchFor(patchBreak: jest.Mock, breakId: string): MigrationReconciliationBreak | undefined {
  // The LAST patch for the id wins (mirrors AMS last-write semantics).
  const calls = patchBreak.mock.calls.filter((c) => c[1] === breakId);
  return calls.length > 0 ? (calls[calls.length - 1][2] as MigrationReconciliationBreak) : undefined;
}

describe('expected_volatile auto-disposition pass (Group 4)', () => {
  it.each(['probed', 'probed_partial', 'endpoint_signal', 'declared'])(
    'auto-dispositions a break diverging ENTIRELY on a %s path to expected_volatile (needs_human=false, audit note)',
    async (source) => {
      const diffItems = [volatileOnlyItem('di-1', source, '/things/di-1')];
      const { deps, createBreaks, patchBreak } = buildDeps({ diffItems });

      const result = await triggerFullBaselineReconcile(deployedRun(), deps);
      expect(result.status).toBe('reconciled');
      if (result.status === 'reconciled') {
        expect(result.expectedVolatileCount).toBe(1);
      }

      // The break WAS created first (create-then-auto-dispose; visible + auditable).
      const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
      expect(created[0].disposition_status).toBe(BREAK_DISPOSITION.OPEN);

      // Then PATCHed to expected_volatile + needs_human=false with an audit note.
      const patch = patchFor(patchBreak, 'brk-di-1');
      expect(patch?.disposition_status).toBe(BREAK_DISPOSITION.EXPECTED_VOLATILE);
      expect(patch?.needs_human).toBe(false);
      const detail = (patch?.detail_json ?? {}) as Record<string, unknown>;
      const audit = (detail.volatility_match ?? {}) as Record<string, unknown>;
      expect(audit.outcome).toBe('expected_volatile');
      expect(audit.sources as string[]).toContain(source);
      expect(audit.paths as string[]).toContain('/things/di-1');
    },
  );

  it('MIXED divergence (a non-volatile value survived -> body_value_drift) stays open [G3 no-override]', async () => {
    // A volatile timestamp PLUS a genuine non-volatile regression: the comparator
    // tolerated the timestamp (tagged probed) but left the real value diff, so it
    // classed the body `body_value_drift` and surfaced `volatility_sources`.
    const diffItems = [
      bodyDiffItem('di-mixed', {
        bodyClassification: 'body_value_drift',
        entries: [
          { path: '/createdAt', kind: 'value_changed', volatilitySource: 'probed' },
          { path: '/total', kind: 'value_changed' }, // a REAL regression, untolerated
        ],
        volatilitySources: ['probed'],
      }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(0);

    const patch = patchFor(patchBreak, 'brk-di-mixed');
    // The break is NOT moved off open (a real break survives).
    expect(patch?.disposition_status).toBeUndefined();
    // The partial allowance is still recorded so the human sees it.
    const detail = (patch?.detail_json ?? {}) as Record<string, unknown>;
    const audit = (detail.volatility_match ?? {}) as Record<string, unknown>;
    expect(audit.outcome).toBe('mixed');
  });

  it('SHAPE diff on a volatile path still breaks (shape never tolerated)', async () => {
    // The body added a key (shape drift). The comparator NEVER tolerates shape,
    // so it left body_shape_drift; even with a volatile value alongside, the
    // surviving shape entry means the break stays open.
    const diffItems = [
      bodyDiffItem('di-shape', {
        bodyClassification: 'body_shape_drift',
        entries: [
          { path: '/createdAt', kind: 'value_changed', volatilitySource: 'probed' },
          { path: '/newField', kind: 'key_added' }, // SHAPE -- always a break
        ],
        volatilitySources: ['probed'],
      }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);
    const patch = patchFor(patchBreak, 'brk-di-shape');
    expect(patch?.disposition_status).not.toBe(BREAK_DISPOSITION.EXPECTED_VOLATILE);
    const audit = ((patch?.detail_json ?? {}) as Record<string, unknown>).volatility_match as
      | Record<string, unknown>
      | undefined;
    expect(audit?.outcome).toBe('mixed');
  });

  it('justified ONLY by heuristic paths -> down-ranks to info, stays open (never auto-terminal)', async () => {
    const diffItems = [volatileOnlyItem('di-heur', 'heuristic', '/updatedAt')];
    const { deps, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(0);

    const patch = patchFor(patchBreak, 'brk-di-heur');
    expect(patch?.disposition_status).toBe(BREAK_DISPOSITION.INFO);
    // info is NOT terminal -- it is just a down-ranked, still-open break.
    expect(patch?.disposition_status).not.toBe(BREAK_DISPOSITION.EXPECTED_VOLATILE);
    const audit = ((patch?.detail_json ?? {}) as Record<string, unknown>).volatility_match as
      | Record<string, unknown>
      | undefined;
    expect(audit?.outcome).toBe('info');
  });

  it('a heuristic mixed with an auto-terminal source -> still down-ranks to info (a guess never carries it terminal)', async () => {
    const diffItems = [
      bodyDiffItem('di-mix-trust', {
        bodyClassification: 'body_match',
        entries: [
          { path: '/createdAt', kind: 'value_changed', volatilitySource: 'probed' },
          { path: '/guessAt', kind: 'value_changed', volatilitySource: 'heuristic' },
        ],
        volatilitySources: ['probed', 'heuristic'],
      }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);
    const patch = patchFor(patchBreak, 'brk-di-mix-trust');
    expect(patch?.disposition_status).toBe(BREAK_DISPOSITION.INFO);
  });

  it('NO auto-disposition for non_json / not_probed / null envelopes (strict)', async () => {
    const diffItems = [
      // null envelope: a real value drift with NO volatility metadata.
      bodyDiffItem('di-null', {
        bodyClassification: 'body_value_drift',
        entries: [{ path: '/total', kind: 'value_changed' }],
      }),
      // non_json / not_probed never reach the entry tag set -> no volatility_sources.
      bodyDiffItem('di-strict', {
        bodyClassification: 'body_value_drift',
        entries: [{ path: '/amount', kind: 'value_changed' }],
      }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(0);

    // Neither break is touched by the volatility pass.
    expect(patchFor(patchBreak, 'brk-di-null')?.disposition_status).toBeUndefined();
    expect(patchFor(patchBreak, 'brk-di-strict')?.disposition_status).toBeUndefined();
    // No volatility audit note was written either.
    const nullDetail = (patchFor(patchBreak, 'brk-di-null')?.detail_json ?? null) as Record<
      string,
      unknown
    > | null;
    expect(nullDetail).toBeNull();
  });

  it('G2 INVARIANT: no break disappears -- every break is expected_volatile (terminal) OR open (info/untouched)', async () => {
    const diffItems = [
      volatileOnlyItem('di-vol', 'probed', '/a'), // -> expected_volatile (terminal)
      volatileOnlyItem('di-heur', 'heuristic', '/b'), // -> info (open)
      bodyDiffItem('di-mixed', {
        bodyClassification: 'body_value_drift',
        entries: [
          { path: '/c', kind: 'value_changed', volatilitySource: 'declared' },
          { path: '/d', kind: 'value_changed' },
        ],
        volatilitySources: ['declared'],
      }), // -> mixed (open)
      bodyDiffItem('di-strict', {
        bodyClassification: 'body_value_drift',
        entries: [{ path: '/e', kind: 'value_changed' }],
      }), // -> none (open, untouched)
    ];
    const { deps, createBreaks, patchBreak } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');

    // Count-of-created == count-of-surviving. The pass NEVER deletes a break;
    // it only PATCHes existing ones.
    const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
    expect(created).toHaveLength(4);

    // Resolve the final disposition of each break (created-open unless PATCHed).
    const finalDisposition = (id: string): string => {
      const patch = patchFor(patchBreak, id);
      return (patch?.disposition_status as string | undefined) ?? BREAK_DISPOSITION.OPEN;
    };

    const dispositions = ['di-vol', 'di-heur', 'di-mixed', 'di-strict'].map((id) =>
      finalDisposition(`brk-${id}`),
    );

    // EVERY break is either expected_volatile (visible terminal) or a still-open
    // state (open / info). NONE is dropped, dismissed, or otherwise hidden.
    const allowed = new Set<string>([
      BREAK_DISPOSITION.EXPECTED_VOLATILE,
      BREAK_DISPOSITION.INFO,
      BREAK_DISPOSITION.OPEN,
    ]);
    for (const d of dispositions) {
      expect(allowed.has(d)).toBe(true);
    }
    // Exactly one terminal (the probed one); the rest remain open + visible.
    expect(dispositions.filter((d) => d === BREAK_DISPOSITION.EXPECTED_VOLATILE)).toHaveLength(1);
    expect(dispositions.filter((d) => d === BREAK_DISPOSITION.INFO)).toHaveLength(1);
    expect(dispositions.filter((d) => d === BREAK_DISPOSITION.OPEN)).toHaveLength(2);
    if (result.status === 'reconciled') expect(result.expectedVolatileCount).toBe(1);
  });

  it('the run summary reports the expected_volatile count alongside expected_net_new', async () => {
    const diffItems = [
      volatileOnlyItem('di-v1', 'probed', '/a'),
      volatileOnlyItem('di-v2', 'endpoint_signal', '/b'),
    ];
    const { deps } = buildDeps({ diffItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');
    if (result.status === 'reconciled') {
      expect(result.expectedVolatileCount).toBe(2);
      // Displayed alongside the net_new count (no threshold / alert).
      expect(result.expectedNetNewCount).toBe(0);
    }
  });

  it('does not crash when a single auto-dispose PATCH fails (failure-isolated)', async () => {
    const diffItems = [volatileOnlyItem('di-vol', 'probed', '/a')];
    const patchBreak = jest.fn().mockRejectedValue(new Error('AMS PATCH down'));
    const { deps } = buildDeps({ diffItems, overrides: { patchReconciliationBreak: patchBreak } });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    // The reconcile still completes (the pass swallows the PATCH failure).
    expect(result.status).toBe('reconciled');
  });
});

describe('retroactive human-declared volatile paths (Group 4 / Q3)', () => {
  /** A still-open break carrying an untolerated value drift on a single path. */
  function openBreakWithValueDrift(
    id: string,
    operation: string,
    path: string,
  ): MigrationReconciliationBreak {
    return {
      id,
      run_id: RUN_ID,
      disposition_status: BREAK_DISPOSITION.OPEN,
      detail_json: {
        operation,
        body_classification: 'body_value_drift',
        body_diff_json: {
          entries: [{ path, kind: 'value_changed' }],
        },
      },
    };
  }

  it('retroactively re-dispositions an already-open break to expected_volatile when the surviving value path is declared', async () => {
    const breaks = [openBreakWithValueDrift('brk-1', 'GET /orders/123', '/createdAt')];
    const patchBreak = jest.fn().mockResolvedValue({});
    const { deps } = buildDeps({ diffItems: [], overrides: { patchReconciliationBreak: patchBreak } });

    const result = await declareVolatilePaths(
      {
        projectId: PROJECT_ID,
        operation: 'GET /orders/123',
        declaredPaths: ['/createdAt'],
        breaks,
      },
      deps,
    );

    expect(result.reEvaluated).toBe(1);
    expect(result.expectedVolatile).toBe(1);

    const patch = patchFor(patchBreak, 'brk-1');
    expect(patch?.disposition_status).toBe(BREAK_DISPOSITION.EXPECTED_VOLATILE);
    expect(patch?.needs_human).toBe(false);
    // The entry was re-tagged `declared` + the body re-classed body_match.
    const detail = (patch?.detail_json ?? {}) as Record<string, unknown>;
    expect(detail.body_classification).toBe('body_match');
    const bodyDiff = detail.body_diff_json as Record<string, unknown>;
    expect((bodyDiff.volatility_sources as string[])).toContain('declared');
  });

  it('does NOT re-dispose breaks on a DIFFERENT operation', async () => {
    const breaks = [
      openBreakWithValueDrift('brk-1', 'GET /orders/123', '/createdAt'),
      openBreakWithValueDrift('brk-2', 'GET /widgets/9', '/createdAt'),
    ];
    const patchBreak = jest.fn().mockResolvedValue({});
    const { deps } = buildDeps({ diffItems: [], overrides: { patchReconciliationBreak: patchBreak } });

    const result = await declareVolatilePaths(
      { projectId: PROJECT_ID, operation: 'GET /orders/123', declaredPaths: ['/createdAt'], breaks },
      deps,
    );

    expect(result.reEvaluated).toBe(1);
    // brk-2 (other operation) is never touched.
    expect(patchFor(patchBreak, 'brk-2')).toBeUndefined();
  });

  it('declaring a path that does NOT cover a SURVIVING non-volatile entry keeps the break open [G3]', async () => {
    // The break has TWO value drifts; only one is declared -> the other survives.
    const breaks: MigrationReconciliationBreak[] = [
      {
        id: 'brk-1',
        disposition_status: BREAK_DISPOSITION.OPEN,
        detail_json: {
          operation: 'GET /orders/123',
          body_classification: 'body_value_drift',
          body_diff_json: {
            entries: [
              { path: '/createdAt', kind: 'value_changed' },
              { path: '/total', kind: 'value_changed' },
            ],
          },
        },
      },
    ];
    const patchBreak = jest.fn().mockResolvedValue({});
    const { deps } = buildDeps({ diffItems: [], overrides: { patchReconciliationBreak: patchBreak } });

    const result = await declareVolatilePaths(
      { projectId: PROJECT_ID, operation: 'GET /orders/123', declaredPaths: ['/createdAt'], breaks },
      deps,
    );

    expect(result.reEvaluated).toBe(1);
    expect(result.expectedVolatile).toBe(0);
    const patch = patchFor(patchBreak, 'brk-1');
    // Re-tagged detail is persisted, but the disposition stays open (a real
    // /total regression survives).
    expect(patch?.disposition_status).toBeUndefined();
    expect((patch?.detail_json as Record<string, unknown>).body_classification).toBe('body_value_drift');
  });

  it('never re-touches an already-disposed (terminal) break', async () => {
    const breaks: MigrationReconciliationBreak[] = [
      {
        id: 'brk-1',
        disposition_status: BREAK_DISPOSITION.ACCEPTED,
        detail_json: {
          operation: 'GET /orders/123',
          body_classification: 'body_value_drift',
          body_diff_json: { entries: [{ path: '/createdAt', kind: 'value_changed' }] },
        },
      },
    ];
    const patchBreak = jest.fn().mockResolvedValue({});
    const { deps } = buildDeps({ diffItems: [], overrides: { patchReconciliationBreak: patchBreak } });

    const result = await declareVolatilePaths(
      { projectId: PROJECT_ID, operation: 'GET /orders/123', declaredPaths: ['/createdAt'], breaks },
      deps,
    );

    expect(result.reEvaluated).toBe(0);
    expect(patchFor(patchBreak, 'brk-1')).toBeUndefined();
  });
});

describe('human override back to open (existing PATCH path)', () => {
  it('disposeBreaks accepts expected_volatile and open as valid human dispositions', async () => {
    const patchBreak = jest.fn().mockResolvedValue({});
    const { deps } = buildDeps({ diffItems: [], overrides: { patchReconciliationBreak: patchBreak } });

    // A human re-opens an auto-recognised volatile break (the override-back-to-open
    // requirement: a wrong auto-recognition can be reversed with one action).
    const reopen = await disposeBreaks(
      { projectId: PROJECT_ID, breakIds: ['brk-1'], disposition: BREAK_DISPOSITION.OPEN },
      deps,
    );
    expect(reopen.status).toBe('disposed');
    const reopenPatch = patchFor(patchBreak, 'brk-1');
    expect(reopenPatch?.disposition_status).toBe(BREAK_DISPOSITION.OPEN);

    // A human can also manually MARK a break expected_volatile (the auto-pass missed).
    const markVolatile = await disposeBreaks(
      { projectId: PROJECT_ID, breakIds: ['brk-2'], disposition: BREAK_DISPOSITION.EXPECTED_VOLATILE },
      deps,
    );
    expect(markVolatile.status).toBe('disposed');
    expect(patchFor(patchBreak, 'brk-2')?.disposition_status).toBe(
      BREAK_DISPOSITION.EXPECTED_VOLATILE,
    );
  });
});
