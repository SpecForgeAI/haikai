/**
 * Cross-layer end-to-end tests for Reconcile Full-Response Fidelity & Distinct
 * Break Types (Spec 2026-06-17 -- Task Group 5).
 *
 * WHY THIS FILE EXISTS (the gap it fills): Task Groups 1-4 each test ONE layer
 * in isolation against a HAND-BUILT input:
 *   - TG2 `jsonShapeComparator.headersOrdering.test.ts` feeds `{ headers, body }`
 *     objects to `compareJsonShapes` and asserts the comparator outcome, and
 *     feeds a HAND-BUILT `ApiBehaviourDiffItemDto` to `classifyDiffItem`.
 *   - TG3 `migrationReconciliationHeaderOrderingBreaks.test.ts` (a separate npm
 *     package) feeds a HAND-CONSTRUCTED `body_diff_json.header_entries` /
 *     `volatility_sources` envelope to the gateway disposition pass.
 *
 * NOTHING proves the REAL comparator output, threaded through the REAL diff
 * runner, produces the EXACT persisted `body_diff_json` envelope shape the
 * gateway consumes (`header_entries[].{ kind, headerName, volatilitySource }`
 * + `volatility_sources`) AND the EXACT `header_classification` /
 * `body_classification` the gateway + classifier key off. If the comparator's
 * real entry shape drifted from the hand-built fixtures, every layer test would
 * still pass while production silently broke.
 *
 * These run the REAL `runDiff` (which calls the REAL `compareJsonShapes` and
 * builds the REAL persisted envelope) and then drive the REAL `classifyDiffItem`
 * over the persisted diff_item -- closing the comparator -> runner -> classifier
 * chain for the load-bearing invariants:
 *
 *   1. Allowlisted header VALUE change -> persisted `header_classification =
 *      header_value_drift`, `header_entries[].volatilitySource = 'declared'`,
 *      `volatility_sources = ['declared']` (the exact shape the gateway
 *      `headerHasSurvivingDrift` / `readBreakVolatility` tolerate) AND a
 *      break_type set of `['headers']`. (pure-volatile feed for the gateway pass)
 *   2. MIXED-stays-open: a volatile (allowlisted) header value change + a REAL
 *      non-volatile body value change -> persisted `body_classification =
 *      body_value_drift` (surviving) WITH a `declared` header tag -- so the
 *      gateway's no-override guard keeps it open. break_type set carries BOTH
 *      `headers` + `body-value`.
 *   3. Header presence/absence ALWAYS breaks: an allowlisted name (ETag)
 *      DISAPPEARING -> `header_presence_drift`, NO `declared` tag, NO
 *      `volatility_sources` -- the gateway treats it as a surviving break.
 *   4. Content-Type (NON-allowlisted) value change breaks: `header_value_drift`
 *      with NO `declared` tag and NO `volatility_sources`.
 *   5. Non-volatile array reorder -> `body_ordering_drift` (a single ordering
 *      marker, NOT a value cascade), break_type set `['ordering']`.
 *   6. No-regression: a status-only drift with NO header wrapper on the source
 *      -> `header_classification` stays NULL (graceful degrade, no false header
 *      break), body stays `body_match`, break_type set is exactly `['status']`.
 *
 * Harness mirrors `diffRunner.volatility.test.ts` (the real runner + a mocked
 * AMS client capturing the persisted diff_item + finding payloads). The REAL
 * `classifyDiffItem` runs so the break_type SET on the emitted finding's
 * `detail_json` is asserted end-to-end.
 */

import { runDiff } from '../services/diffRunner';
import { RunManager } from '../services/runManager';
import type {
  ApiBehaviourDiffDto,
  BaselineDto,
  BaselineItemDto,
} from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const DIFF_ID = '00000000-0000-0000-0000-0000000000cc';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';
const TARGET_BASELINE_ID = '00000000-0000-0000-0000-0000000000ee';

function buildDiff(): ApiBehaviourDiffDto {
  const now = new Date().toISOString();
  return {
    id: DIFF_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    source_baseline_id: SOURCE_BASELINE_ID,
    target_baseline_id: TARGET_BASELINE_ID,
    status: 'computing',
    matched_count: null,
    status_drift_count: null,
    body_shape_drift_count: null,
    body_value_drift_count: null,
    source_only_count: null,
    target_only_count: null,
    source_baseline_updated_at: null,
    target_baseline_updated_at: null,
    computed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
}

function buildBaseline(id: string, kind: 'current' | 'target'): BaselineDto {
  const now = new Date().toISOString();
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'session-x',
    name: `${kind}-baseline`,
    status: 'active',
    accepted_capture_count: null,
    operation_count: null,
    notes: null,
    kind,
    paired_with_baseline_id: kind === 'target' ? SOURCE_BASELINE_ID : null,
    created_at: now,
    updated_at: now,
  };
}

function buildItem(opts: {
  id: string;
  baselineId: string;
  responseJson: unknown;
  responseStatus?: number;
  volatilePathsJson?: Record<string, unknown> | null;
}): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    baseline_id: opts.baselineId,
    capture_id: `cap-${opts.id}`,
    operation_id: `op-${opts.id}`,
    scenario_id: `scen-${opts.id}`,
    method: 'GET',
    path: '/widget',
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: opts.responseStatus ?? 200,
    response_json: opts.responseJson,
    business_notes: null,
    volatile_paths_json: opts.volatilePathsJson ?? null,
    created_at: now,
    updated_at: now,
  };
}

interface State {
  diffItemsCreated: Array<Record<string, unknown>>;
  findingsCreated: Array<Record<string, unknown>>;
}

function buildArchMock(
  sourceItem: BaselineItemDto,
  targetItem: BaselineItemDto,
): { mock: Record<string, unknown>; state: State } {
  const state: State = { diffItemsCreated: [], findingsCreated: [] };
  const diff = buildDiff();
  const mock = {
    getDiff: jest.fn(async () => diff),
    getBaseline: jest.fn(async (_p: string, id: string) =>
      id === SOURCE_BASELINE_ID
        ? buildBaseline(SOURCE_BASELINE_ID, 'current')
        : buildBaseline(TARGET_BASELINE_ID, 'target'),
    ),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) =>
      baselineId === SOURCE_BASELINE_ID ? [sourceItem] : [targetItem],
    ),
    updateDiff: jest.fn(async (_p: string, _id: string, body: Record<string, unknown>) => ({
      ...diff,
      ...body,
    })),
    createDiffItem: jest.fn(
      async (_p: string, _id: string, body: Record<string, unknown>) => {
        const persisted = { id: `item-${state.diffItemsCreated.length + 1}`, ...body };
        state.diffItemsCreated.push(persisted);
        return persisted;
      },
    ),
    deleteFindingsByApiBehaviourDiffId: jest.fn(async () => undefined),
    // Capture the REAL classifier's emission so the break_type SET threaded onto
    // the finding's detail_json can be asserted end-to-end.
    createDiffFinding: jest.fn(
      async (_p: string, _id: string, body: Record<string, unknown>) => {
        state.findingsCreated.push(body);
        return body;
      },
    ),
  };
  return { mock, state };
}

function runManagerForDiff(): RunManager {
  const rm = new RunManager();
  rm.start({ sessionId: DIFF_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
  return rm;
}

/** Run the REAL runner (REAL comparator + REAL classifier) over one pair. */
async function runOnePair(
  sourceItem: BaselineItemDto,
  targetItem: BaselineItemDto,
): Promise<{ item: Record<string, unknown>; finding: Record<string, unknown> | undefined; state: State }> {
  const { mock, state } = buildArchMock(sourceItem, targetItem);
  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManagerForDiff(),
    now: () => 1700000000000,
    // NOTE: classifyDiffItem deliberately NOT overridden -> the REAL classifier
    // runs, so the emitted finding's detail_json.breakTypes is the genuine
    // derived per-dimension SET (the cross-layer assertion).
  });
  expect(state.diffItemsCreated).toHaveLength(1);
  return {
    item: state.diffItemsCreated[0],
    finding: state.findingsCreated[0],
    state,
  };
}

function headerEntries(item: Record<string, unknown>): Array<Record<string, unknown>> {
  const blob = item.body_diff_json as { header_entries?: unknown[] } | null;
  return (blob?.header_entries ?? []) as Array<Record<string, unknown>>;
}

function breakTypesOf(finding: Record<string, unknown> | undefined): string[] {
  const detail = (finding?.detail_json ?? {}) as Record<string, unknown>;
  return (detail.breakTypes ?? []) as string[];
}

// ===========================================================================
// 1. Allowlisted header VALUE change -> the exact gateway-consumed envelope.
// ===========================================================================
test('1. allowlisted header value change persists declared tag + volatility_sources the gateway tolerates (break_type [headers])', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: {
      headers: { Date: 'Mon, 16 Jun 2026 10:00:00 GMT', 'content-type': 'application/json' },
      body: { id: 1 },
    },
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: {
      headers: { date: 'Tue, 17 Jun 2026 11:30:00 GMT', 'content-type': 'application/json' },
      body: { id: 1 },
    },
  });

  const { item, finding } = await runOnePair(sourceItem, targetItem);

  // Persisted classifications (what the gateway isDiffItemABreak + classifier key off).
  expect(item.header_classification).toBe('header_value_drift');
  expect(item.body_classification).toBe('body_match');

  // The EXACT envelope shape the gateway's readBreakVolatility / headerHasSurvivingDrift
  // consume: a `value` entry with a `declared` volatilitySource, plus the distinct
  // volatility_sources set -- both auto-terminal, so the gateway disposes to
  // expected_volatile.
  const hEntries = headerEntries(item);
  const dateEntry = hEntries.find((e) => String(e.headerName).toLowerCase() === 'date');
  expect(dateEntry).toBeDefined();
  expect(dateEntry?.kind).toBe('value');
  expect(dateEntry?.volatilitySource).toBe('declared');
  const blob = item.body_diff_json as { volatility_sources?: unknown[] };
  expect(blob.volatility_sources).toEqual(['declared']);

  // Cross-layer: the REAL classifier derives a single-dimension [headers] set.
  expect(finding?.finding_type).toBe('api_behaviour_header_drift');
  expect(breakTypesOf(finding)).toEqual(['headers']);
});

// ===========================================================================
// 2. MIXED-stays-open: volatile header + REAL body value change.
// ===========================================================================
test('2. MIXED (allowlisted header value + REAL body value change) -> body_value_drift survives; break_type [headers, body-value]', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: {
      headers: { Date: 'Mon, 16 Jun 2026 10:00:00 GMT' },
      body: { id: 1, total: 100 },
    },
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: {
      headers: { date: 'Tue, 17 Jun 2026 11:30:00 GMT' },
      body: { id: 1, total: 200 }, // a REAL, non-volatile body value change
    },
  });

  const { item, finding } = await runOnePair(sourceItem, targetItem);

  // The real body change SURVIVES -> body_value_drift (the gateway's
  // bodyHasSurvivingDrift returns true -> MIXED -> the break STAYS OPEN even
  // though the Date header carried a `declared` tag).
  expect(item.body_classification).toBe('body_value_drift');
  expect(item.header_classification).toBe('header_value_drift');

  // The Date header is still tagged declared (the partial allowance the gateway
  // records on the audit note), but the surviving body drift keeps it open.
  const dateEntry = headerEntries(item).find(
    (e) => String(e.headerName).toLowerCase() === 'date',
  );
  expect(dateEntry?.volatilitySource).toBe('declared');

  // Cross-layer: BOTH drifted dimensions are in the derived set.
  expect([...breakTypesOf(finding)].sort()).toEqual(['body-value', 'headers'].sort());
});

// ===========================================================================
// 3. Presence/absence ALWAYS breaks (even an allowlisted name).
// ===========================================================================
test('3. allowlisted header (ETag) disappearing -> header_presence_drift, NO declared tag, NO volatility_sources', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: {
      headers: { ETag: 'W/"abc"', 'content-type': 'application/json' },
      body: { id: 1 },
    },
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: {
      headers: { 'content-type': 'application/json' }, // ETag gone
      body: { id: 1 },
    },
  });

  const { item, finding } = await runOnePair(sourceItem, targetItem);

  expect(item.header_classification).toBe('header_presence_drift');
  const etagEntry = headerEntries(item).find(
    (e) => String(e.headerName).toLowerCase() === 'etag',
  );
  expect(etagEntry?.kind).toBe('presence');
  // Presence is NEVER tolerated -> no declared tag -> the gateway treats it as a
  // surviving header break (stays open).
  expect(etagEntry?.volatilitySource).toBeUndefined();
  const blob = item.body_diff_json as { volatility_sources?: unknown[] };
  expect(blob.volatility_sources).toBeUndefined();

  expect(breakTypesOf(finding)).toEqual(['headers']);
});

// ===========================================================================
// 4. Content-Type (NON-allowlisted) value change breaks.
// ===========================================================================
test('4. Content-Type value change -> header_value_drift with NO declared tag (gateway keeps it open)', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: {
      headers: { 'content-type': 'application/json' },
      body: { id: 1 },
    },
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: {
      headers: { 'content-type': 'text/plain' },
      body: { id: 1 },
    },
  });

  const { item } = await runOnePair(sourceItem, targetItem);

  expect(item.header_classification).toBe('header_value_drift');
  const ctEntry = headerEntries(item).find(
    (e) => String(e.headerName).toLowerCase() === 'content-type',
  );
  expect(ctEntry?.kind).toBe('value');
  // NOT allowlisted -> no declared tag -> the gateway never auto-disposes it.
  expect(ctEntry?.volatilitySource).toBeUndefined();
  const blob = item.body_diff_json as { volatility_sources?: unknown[] };
  expect(blob.volatility_sources).toBeUndefined();
});

// ===========================================================================
// 5. Non-volatile array reorder -> body_ordering_drift (not a value cascade).
// ===========================================================================
test('5. non-volatile array reorder -> body_ordering_drift, single ordering marker, break_type [ordering]', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: { headers: {}, body: { items: ['a', 'b', 'c'] } },
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: { headers: {}, body: { items: ['c', 'a', 'b'] } },
  });

  const { item, finding } = await runOnePair(sourceItem, targetItem);

  expect(item.body_classification).toBe('body_ordering_drift');
  // A SINGLE ordering marker, not a per-element value cascade.
  const blob = item.body_diff_json as { entries?: Array<Record<string, unknown>> };
  const entries = blob.entries ?? [];
  expect(entries).toHaveLength(1);
  expect(entries[0].kind).toBe('ordering');
  expect(entries[0].path).toBe('/items');

  expect(finding?.finding_type).toBe('api_behaviour_ordering_drift');
  expect(breakTypesOf(finding)).toEqual(['ordering']);
});

// ===========================================================================
// 6. No-regression: status-only drift, source lacks a header wrapper.
// ===========================================================================
test('6. status drift with a wrapper-less source -> header dimension SKIPPED (null), break_type exactly [status]', async () => {
  // Source is an OLD baseline whose response_json is a RAW body (no { headers,
  // body } wrapper) -- the graceful-degrade path. Status differs (200 -> 500).
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseStatus: 200,
    responseJson: { id: 1 }, // raw body, no wrapper
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseStatus: 500,
    responseJson: { headers: { 'content-type': 'text/plain' }, body: { id: 1 } },
  });

  const { item, finding } = await runOnePair(sourceItem, targetItem);

  // Graceful degrade: NO source header wrapper -> header dimension skipped ->
  // header_classification stays NULL (no false header break). Body still
  // compares clean once the target unwrap is symmetric.
  expect(item.header_classification).toBeNull();
  expect(item.body_classification).toBe('body_match');
  expect(item.status_classification).toBe('status_drift');

  // Cross-layer no-regression: a status-only drift yields exactly [status]
  // (status-CLASS is the severity of the single status type, not a 6th member).
  expect(finding?.finding_type).toBe('api_behaviour_status_drift');
  expect(finding?.severity).toBe('critical'); // 2xx -> 5xx
  expect(breakTypesOf(finding)).toEqual(['status']);
});
