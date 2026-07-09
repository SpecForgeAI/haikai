/**
 * Mutating state-delta capture & comparison (Spec 2026-07-06-n — Code-Tier
 * Oracle Program).
 *
 * Pins (per the spec's verification ladder):
 *   SCOPE       — fetchEffectScopeIndex builds `${METHOD} ${path}` -> tables
 *                 from committed write edges only; effectTablesFor template-
 *                 matches concrete paths against `{param}` segments.
 *   GUARD       — snapshotEffectTables refuses unsafe identifiers (recorded
 *                 on the snapshot, never thrown) and only ever issues
 *                 SELECTs through the adapter's runReadonlySelect.
 *   DELTA       — computeStateDelta strategy tagging (counts vs counts+keyed)
 *                 and per-table count_delta arithmetic.
 *   FAIL-CLOSED — compareStateDeltas: either side missing => state_unverified;
 *                 count mismatch => state_drift; identical => state_match;
 *                 volatile columns (id/timestamps) excluded from keyed rows.
 *   WRITE       — execute_http_request wraps a MUTATING call in pre/post
 *                 snapshots and persists state_delta_json on the capture row;
 *                 no adapter => null (state_unverified downstream).
 *   REPLAY      — runTargetReplay with an injected dbAdapter persists
 *                 state_delta_json on the target capture AND baseline item.
 *   DIFF        — runDiff stamps state_classification into the persisted
 *                 diff item's body_diff_json when either side carries a
 *                 delta, and stays silent when neither does (zero
 *                 regression for read-only scenarios).
 */

import {
  compareStateDeltas,
  computeStateDelta,
  effectTablesFor,
  fetchEffectScopeIndex,
  keyHintFromResponse,
  snapshotEffectTables,
  type StateDeltaJson,
  type StateSnapshot,
} from '../services/stateDelta';
import { executeHttpRequestTool } from '../services/tools/execute_http_request';
import {
  type ArchModelToolWriteSurface,
  type ToolExecutionContext,
} from '../services/tools';
import { runManager } from '../services/runManager';
import { runTargetReplay, type TargetReplayDeps } from '../services/targetReplayRunner';
import { runDiff } from '../services/diffRunner';
import { RunManager } from '../services/runManager';
import { SecretsStore } from '../services/secretsStore';
import type { DbAdapter } from '../services/db/DbAdapter';
import type {
  BaselineDto,
  BaselineItemDto,
  CaptureSessionDto,
  OperationDto,
} from '../services/archModelClient';
import type { CaptureSession } from '../types/captureSession';
import type { SessionHttpExecutor } from '../services/httpExecutor';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Committed-model blob the AMS full-model read returns (write edges only
 * contribute; the read edge on pets must NOT surface). */
const MODEL_BLOB = {
  metaModel: {
    entities: {
      endpoints: [
        { id: 'ep-1', path_or_address: '/owners/{ownerId}/things', operation_verb: 'POST' },
        { id: 'ep-2', path_or_address: '/pets', operation_verb: 'GET' },
      ],
      physical_data_entities: [
        { id: 'pde-1', name: 'things' },
        { id: 'pde-2', name: 'pets' },
      ],
    },
    relationships: {
      endpoint_data_effects: [
        { endpoint_id: 'ep-1', access_mode: 'write', data_entity_point_id: 'dep_phy_pde-1' },
        { endpoint_id: 'ep-2', access_mode: 'read', data_entity_point_id: 'dep_phy_pde-2' },
      ],
    },
  },
};

function stubModelFetch(): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async () =>
    ({
      ok: true,
      json: async () => MODEL_BLOB,
    }) as unknown as Response,
  );
}

/**
 * Scripted fake adapter: each runReadonlySelect call shifts the next result
 * off the script. Records every (sql, params) pair for the GUARD pin.
 */
function buildFakeAdapter(
  script: Array<Array<Record<string, unknown>>>,
): DbAdapter & { calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let i = 0;
  return {
    calls,
    testConnection: jest.fn(async () => ({ success: true as const })),
    listMetadata: jest.fn(async () => []),
    runReadonlySelect: jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const rows = script[i] ?? script[script.length - 1] ?? [];
      i += 1;
      return { rows, rowCount: rows.length, truncated: false };
    }),
    sampleValues: jest.fn(async () => ({ rows: [], rowCount: 0, truncated: false })),
    dispose: jest.fn(async () => undefined),
  } as unknown as DbAdapter & { calls: Array<{ sql: string; params: unknown[] }> };
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// SCOPE — effect-scope index from committed write edges
// ---------------------------------------------------------------------------

test('SCOPE: fetchEffectScopeIndex maps write edges to tables; read edges excluded; template match', async () => {
  stubModelFetch();
  const index = await fetchEffectScopeIndex('proj-1', 'arch-1');
  expect(index).not.toBeNull();

  // POST /owners/{ownerId}/things (write edge) -> ['things']
  expect(effectTablesFor(index!, 'post', '/owners/42/things')).toEqual(['things']);
  // GET /pets carries only a READ edge -> no effect tables
  expect(effectTablesFor(index!, 'get', '/pets')).toEqual([]);
  // Unknown operation -> empty
  expect(effectTablesFor(index!, 'delete', '/nowhere')).toEqual([]);
});

test('SCOPE: fetchEffectScopeIndex returns null on a failed model read (degrade, not throw)', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(async () =>
    ({ ok: false, json: async () => ({}) }) as unknown as Response,
  );
  expect(await fetchEffectScopeIndex('proj-1', 'arch-1')).toBeNull();
});

// ---------------------------------------------------------------------------
// GUARD — snapshot ladder through runReadonlySelect only
// ---------------------------------------------------------------------------

test('GUARD: snapshotEffectTables counts via SELECT, refuses unsafe identifiers, keyed rung on hint', async () => {
  const adapter = buildFakeAdapter([
    [{ row_count: 7 }], // count for `things`
    [{ id: 42, name: 'thing-42' }], // keyed row for `things`
  ]);
  const snap = await snapshotEffectTables(
    adapter,
    ['things', 'bad;table--'],
    { column: 'id', value: '42' },
  );

  // Safe table: counted + keyed.
  expect(snap.tables[0]).toMatchObject({
    table: 'things',
    count: 7,
    keyed_row: { id: 42, name: 'thing-42' },
    key_column: 'id',
    key_value: '42',
    error: null,
  });
  // Unsafe identifier: REFUSED with a recorded error, never interpolated.
  expect(snap.tables[1].count).toBeNull();
  expect(snap.tables[1].error).toMatch(/unsafe table identifier/);
  // Only SELECTs, only for the safe table.
  expect(adapter.calls).toHaveLength(2);
  expect(adapter.calls[0].sql).toBe('SELECT COUNT(*) AS row_count FROM things');
  expect(adapter.calls[1].sql).toBe('SELECT * FROM things WHERE id = ?');
  expect(adapter.calls[1].params).toEqual(['42']);
});

test('GUARD: keyHintFromResponse extracts id-ish values, rejects non-id shapes', () => {
  expect(keyHintFromResponse({ id: 42 })).toEqual({ column: 'id', value: '42' });
  expect(keyHintFromResponse({ id: 'abc-1' })).toEqual({ column: 'id', value: 'abc-1' });
  expect(keyHintFromResponse({ name: 'x' })).toBeNull();
  expect(keyHintFromResponse([1, 2])).toBeNull();
  expect(keyHintFromResponse('text')).toBeNull();
});

// ---------------------------------------------------------------------------
// DELTA + FAIL-CLOSED — computeStateDelta / compareStateDeltas
// ---------------------------------------------------------------------------

function snap(count: number | null, keyed: Record<string, unknown> | null = null): StateSnapshot {
  return {
    tables: [
      {
        table: 'things',
        count,
        keyed_row: keyed,
        key_column: keyed ? 'id' : null,
        key_value: keyed ? '42' : null,
        error: null,
      },
    ],
  };
}

test('DELTA: computeStateDelta arithmetic + strategy tagging', () => {
  const counts = computeStateDelta(snap(5), snap(6));
  expect(counts.strategy).toBe('counts');
  expect(counts.tables[0]).toMatchObject({ count_before: 5, count_after: 6, count_delta: 1 });

  const keyed = computeStateDelta(snap(5), snap(6, { id: 42, status: 'NEW' }));
  expect(keyed.strategy).toBe('counts+keyed');
  expect(keyed.tables[0].keyed_row_after).toEqual({ id: 42, status: 'NEW' });
});

test('FAIL-CLOSED: compareStateDeltas verdicts', () => {
  const deltaPlus1 = computeStateDelta(snap(5), snap(6));
  const deltaPlus1Again = computeStateDelta(snap(10), snap(11));
  const deltaZero = computeStateDelta(snap(5), snap(5));

  // Identical per-table deltas => state_match (absolute counts may differ).
  expect(compareStateDeltas(deltaPlus1, deltaPlus1Again).classification).toBe('state_match');
  // Mismatched deltas => state_drift.
  expect(compareStateDeltas(deltaPlus1, deltaZero).classification).toBe('state_drift');
  // Either side missing => state_unverified (never a silent pass).
  expect(compareStateDeltas(deltaPlus1, null).classification).toBe('state_unverified');
  expect(compareStateDeltas(null, deltaPlus1).classification).toBe('state_unverified');
  // A table with a snapshot error on one side => state_unverified.
  const errored: StateDeltaJson = {
    strategy: 'counts',
    tables: [
      {
        table: 'things',
        count_before: null,
        count_after: null,
        count_delta: null,
        keyed_row_after: null,
        key_column: null,
        key_value: null,
        error: 'timeout',
      },
    ],
  };
  expect(compareStateDeltas(errored, deltaPlus1).classification).toBe('state_unverified');
});

test('FAIL-CLOSED: keyed-row comparison skips volatile columns, breaks on real columns', () => {
  const source = computeStateDelta(
    snap(5),
    snap(6, { id: 1, created_at: 'a', status: 'NEW' }),
  );
  const targetSameStatus = computeStateDelta(
    snap(5),
    snap(6, { id: 999, created_at: 'b', status: 'NEW' }),
  );
  const targetOtherStatus = computeStateDelta(
    snap(5),
    snap(6, { id: 999, created_at: 'b', status: 'CANCELLED' }),
  );

  // id/created_at differ but are volatile => still a match.
  expect(compareStateDeltas(source, targetSameStatus).classification).toBe('state_match');
  // A REAL column diverging => state_drift with the column named.
  const drift = compareStateDeltas(source, targetOtherStatus);
  expect(drift.classification).toBe('state_drift');
  expect(drift.detail.some((d) => d.kind === 'keyed_column_mismatch:status')).toBe(true);
});

// ---------------------------------------------------------------------------
// WRITE — capture-side hook in execute_http_request
// ---------------------------------------------------------------------------

const CAP_SESSION_ID = 'session-state-delta-1';
const CAP_PROJECT_ID = 'proj-sd-1';
const CAP_ARCH_ID = 'arch-sd-1';

function buildCaptureSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: CAP_SESSION_ID,
    projectId: CAP_PROJECT_ID,
    architectureId: CAP_ARCH_ID,
    name: 'sd-session',
    status: 'running',
    envName: 'non-prod',
    apiBaseUrl: 'https://api.example.test',
    authType: 'bearer',
    authConfigRedactedJson: null,
    defaultHeadersRedactedJson: null,
    oasSpecRefsJson: null,
    dbConfigRedactedJson: null,
    mutatingCallsConfirmed: true,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt: '2026-07-06T00:00:00Z',
    updatedAt: '2026-07-06T00:00:00Z',
    ...overrides,
  };
}

function buildMutatingOperation(): OperationDto {
  return {
    id: 'op-row-sd-1',
    session_id: CAP_SESSION_ID,
    operation_id: 'createThing',
    method: 'POST',
    path: '/owners/{ownerId}/things',
    summary: 'Create thing',
    description: null,
    included: true,
    safe_to_execute: false,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: {},
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
  };
}

function buildCaptureContext(
  overrides: Partial<ToolExecutionContext>,
): { ctx: ToolExecutionContext; createCapture: jest.Mock } {
  const createCapture = jest.fn(async () => ({ id: 'capture-sd-1' }));
  const arch: ArchModelToolWriteSurface = {
    createScenario: jest.fn(async () => ({ id: 'scen-x' })) as never,
    createDiagnostic: jest.fn(async () => ({ id: 'diag-x' })) as never,
    createCapture: createCapture as never,
  };
  const op = buildMutatingOperation();
  const httpExecutor = {
    request: jest.fn(async () => ({
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      data: { id: 42, ok: true },
    })),
    requestWithAuthOverride: jest.fn(),
    setAuth: jest.fn(),
    dispose: jest.fn(),
  } as unknown as SessionHttpExecutor;
  const ctx: ToolExecutionContext = {
    session: buildCaptureSession(),
    oasInventory: { title: 'Test', version: '1.0.0', operations: [] },
    operationsByOasId: new Map([[op.operation_id, op]]),
    secrets: { sessionId: CAP_SESSION_ID, api: { type: 'none' }, loadedAt: Date.now() },
    httpExecutor,
    dbAdapter: null,
    archModelClient: arch,
    currentScenarioId: 'scenario-sd-1',
    ...overrides,
  };
  return { ctx, createCapture };
}

function startCaptureRun(): void {
  if (runManager.has(CAP_SESSION_ID)) runManager.end(CAP_SESSION_ID);
  runManager.start({
    sessionId: CAP_SESSION_ID,
    projectId: CAP_PROJECT_ID,
    architectureId: CAP_ARCH_ID,
  });
}

test('WRITE: mutating capture with a DB adapter persists state_delta_json (pre/post snapshots)', async () => {
  stubModelFetch();
  startCaptureRun();
  // Script: pre count 5; post count 6 + keyed row for id=42.
  const adapter = buildFakeAdapter([
    [{ row_count: 5 }],
    [{ row_count: 6 }],
    [{ id: 42, ok: true }],
  ]);
  const { ctx, createCapture } = buildCaptureContext({ dbAdapter: adapter });

  await executeHttpRequestTool.handler(
    { operationId: 'createThing', method: 'post', path: '/owners/7/things', body: { ok: true } },
    ctx,
  );

  expect(createCapture).toHaveBeenCalledTimes(1);
  const body = createCapture.mock.calls[0][1] as Record<string, unknown>;
  const delta = body.state_delta_json as StateDeltaJson;
  expect(delta).not.toBeNull();
  expect(delta.strategy).toBe('counts+keyed');
  expect(delta.tables[0]).toMatchObject({
    table: 'things',
    count_before: 5,
    count_after: 6,
    count_delta: 1,
  });
  expect(delta.tables[0].keyed_row_after).toEqual({ id: 42, ok: true });
  runManager.end(CAP_SESSION_ID);
});

test('WRITE: no DB adapter => state_delta_json null on the capture row (state_unverified downstream)', async () => {
  stubModelFetch();
  startCaptureRun();
  const { ctx, createCapture } = buildCaptureContext({ dbAdapter: null });

  await executeHttpRequestTool.handler(
    { operationId: 'createThing', method: 'post', path: '/owners/7/things', body: { ok: true } },
    ctx,
  );

  const body = createCapture.mock.calls[0][1] as Record<string, unknown>;
  expect(body.state_delta_json).toBeNull();
  runManager.end(CAP_SESSION_ID);
});

// ---------------------------------------------------------------------------
// REPLAY — target-side snapshots via the injected optional dbAdapter
// ---------------------------------------------------------------------------

const RP_PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const RP_ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const RP_SESSION_ID = '00000000-0000-0000-0000-0000000000ce';
const RP_SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000df';

function buildReplaySession(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: RP_SESSION_ID,
    project_id: RP_PROJECT_ID,
    architecture_id: RP_ARCH_ID,
    name: 'target-replay-sd',
    status: 'running',
    env_name: 'target-uat',
    api_base_url: 'https://target.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    kind: 'target',
    source_baseline_id: RP_SOURCE_BASELINE_ID,
    created_at: now,
    updated_at: now,
  } as CaptureSessionDto;
}

test('REPLAY: injected dbAdapter wraps mutating replays; target capture + item carry state_delta_json', async () => {
  stubModelFetch();
  const now = new Date().toISOString();
  const sourceBaseline: BaselineDto = {
    id: RP_SOURCE_BASELINE_ID,
    project_id: RP_PROJECT_ID,
    architecture_id: RP_ARCH_ID,
    session_id: 'src-session',
    name: 'src',
    status: 'active',
    accepted_capture_count: 1,
    operation_count: 1,
    notes: null,
    kind: 'current',
    paired_with_baseline_id: null,
    created_at: now,
    updated_at: now,
  };
  const item: BaselineItemDto = {
    id: 'item-sd-1',
    baseline_id: RP_SOURCE_BASELINE_ID,
    capture_id: 'cap-sd-1',
    operation_id: 'op-sd-1',
    scenario_id: 'scen-sd-1',
    method: 'POST',
    path: '/owners/7/things',
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: { ok: true } },
    response_status: 201,
    response_json: { ok: true },
    business_notes: null,
    created_at: now,
    updated_at: now,
  } as BaselineItemDto;

  const capturesCreated: Array<Record<string, unknown>> = [];
  const itemsCreated: Array<Record<string, unknown>> = [];
  const archMock = {
    listAllCaptureSessionsByStatus: jest.fn(async () => [buildReplaySession()]),
    getBaseline: jest.fn(async () => sourceBaseline),
    listBaselineItems: jest.fn(async () => [item]),
    createBaseline: jest.fn(async (_p: string, body: Record<string, unknown>) => ({
      ...sourceBaseline,
      id: 'target-baseline-sd',
      kind: 'target',
      status: (body.status as 'draft') ?? 'draft',
    })),
    patchBaseline: jest.fn(async () => ({})),
    createCapture: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      capturesCreated.push(body);
      return { id: 'cap-row-sd', response_headers_redacted_json: {}, response_body_json: {} };
    }),
    patchCapture: jest.fn(async () => ({})),
    createBaselineItem: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      itemsCreated.push(body);
      return { id: 'target-item-sd', ...body };
    }),
    patchCaptureSession: jest.fn(async () => ({})),
    createDiagnostic: jest.fn(async () => ({})),
  };

  // Script: pre count 5; post count 6; keyed row (response exposes id 42).
  const adapter = buildFakeAdapter([
    [{ row_count: 5 }],
    [{ row_count: 6 }],
    [{ id: 42 }],
  ]);
  const secretsStore = new SecretsStore();
  secretsStore.set({
    sessionId: RP_SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext' },
    loadedAt: Date.now(),
  });
  const replayRunManager = new RunManager();
  replayRunManager.start({
    sessionId: RP_SESSION_ID,
    projectId: RP_PROJECT_ID,
    architectureId: RP_ARCH_ID,
  });
  const deps: TargetReplayDeps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: archMock as any,
    secretsStore,
    runManager: replayRunManager,
    createHttpExecutor: () =>
      ({
        request: jest.fn(async () => ({
          data: { id: 42, ok: true },
          status: 201,
          statusText: '',
          headers: { 'content-type': 'application/json' },
          config: {} as never,
        })),
        requestWithAuthOverride: jest.fn(),
        setAuth: jest.fn(),
        dispose: jest.fn(),
      }) as unknown as SessionHttpExecutor,
    now: () => 1700000000000,
    dbAdapter: adapter,
  };

  const outcome = await runTargetReplay(RP_SESSION_ID, deps);
  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(1);

  const captureDelta = capturesCreated[0].state_delta_json as StateDeltaJson;
  expect(captureDelta.tables[0]).toMatchObject({ table: 'things', count_delta: 1 });
  const itemDelta = itemsCreated[0].state_delta_json as StateDeltaJson;
  expect(itemDelta.tables[0]).toMatchObject({ table: 'things', count_delta: 1 });
});

// ---------------------------------------------------------------------------
// DIFF — state_classification threading into persisted diff items
// ---------------------------------------------------------------------------

test('DIFF: mismatched deltas stamp state_drift; delta-free items stay unstamped', async () => {
  // Waiver / model fetches fail soft in this test (no AMS): reject fetch.
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('no ams in test'));

  const DIFF_ID = 'diff-sd-1';
  const now = new Date().toISOString();
  const sourceDelta = computeStateDelta(snap(5), snap(6));
  const targetDelta = computeStateDelta(snap(5), snap(5)); // 0 vs +1 => drift

  const mkItem = (
    id: string,
    scenario: string,
    delta: StateDeltaJson | null,
  ): BaselineItemDto =>
    ({
      id,
      baseline_id: 'b',
      capture_id: 'c',
      operation_id: 'o',
      scenario_id: 's',
      method: 'POST',
      path: '/owners/7/things',
      scenario_name: scenario,
      request_json: {},
      response_status: 201,
      response_json: { ok: true },
      business_notes: null,
      state_delta_json: delta as unknown as Record<string, unknown> | null,
      created_at: now,
      updated_at: now,
    }) as unknown as BaselineItemDto;

  const sourceItems = [
    mkItem('s-1', 'mutating_scenario', sourceDelta),
    mkItem('s-2', 'read_only_scenario', null),
  ];
  const targetItems = [
    mkItem('t-1', 'mutating_scenario', targetDelta),
    mkItem('t-2', 'read_only_scenario', null),
  ];

  const diffItemsCreated: Array<Record<string, unknown>> = [];
  const archMock = {
    getDiff: jest.fn(async () => ({
      id: DIFF_ID,
      project_id: 'proj-diff-sd',
      architecture_id: 'arch-diff-sd',
      source_baseline_id: 'src-b',
      target_baseline_id: 'tgt-b',
      status: 'computing',
      comparison_profile: null,
    })),
    getBaseline: jest.fn(async (_p: string, id: string) => ({
      id,
      status: 'active',
      updated_at: now,
    })),
    getBaselineIntegrity: jest.fn(async () => ({
      content_hash: null,
      recomputed_hash: null,
      integrity_verified: false,
    })),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) =>
      baselineId === 'src-b' ? sourceItems : targetItems,
    ),
    createDiffItem: jest.fn(async (_p: string, _d: string, body: Record<string, unknown>) => {
      diffItemsCreated.push(body);
      return { id: `di-${diffItemsCreated.length}`, ...body };
    }),
    updateDiff: jest.fn(async () => ({})),
    deleteFindingsByApiBehaviourDiffId: jest.fn(async () => undefined),
    createDiffFinding: jest.fn(async () => ({})),
  };

  const diffRunManager = new RunManager();
  diffRunManager.start({
    sessionId: DIFF_ID,
    projectId: 'proj-diff-sd',
    architectureId: 'arch-diff-sd',
  });

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: archMock as any,
    runManager: diffRunManager,
    now: () => 1700000000000,
    classifyDiffItem: () => ({ shouldEmit: false }) as never,
  });

  expect(diffItemsCreated).toHaveLength(2);
  const mutating = diffItemsCreated.find((d) => d.scenario_name === 'mutating_scenario')!;
  const readOnly = diffItemsCreated.find((d) => d.scenario_name === 'read_only_scenario')!;

  const mutatingBlob = mutating.body_diff_json as Record<string, unknown>;
  expect(mutatingBlob.state_classification).toBe('state_drift');
  expect(Array.isArray(mutatingBlob.state_detail)).toBe(true);

  // Zero regression: a delta-free pairing must NOT grow a state key.
  const readOnlyBlob = (readOnly.body_diff_json ?? {}) as Record<string, unknown>;
  expect(readOnlyBlob.state_classification).toBeUndefined();
});

test('DIFF: source measured a delta but target did not => state_unverified (fail-closed)', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('no ams in test'));

  const DIFF_ID = 'diff-sd-2';
  const now = new Date().toISOString();
  const sourceDelta = computeStateDelta(snap(5), snap(6));

  const mkItem = (id: string, delta: StateDeltaJson | null): BaselineItemDto =>
    ({
      id,
      baseline_id: 'b',
      capture_id: 'c',
      operation_id: 'o',
      scenario_id: 's',
      method: 'POST',
      path: '/owners/7/things',
      scenario_name: 'mutating_scenario',
      request_json: {},
      response_status: 201,
      response_json: { ok: true },
      business_notes: null,
      state_delta_json: delta as unknown as Record<string, unknown> | null,
      created_at: now,
      updated_at: now,
    }) as unknown as BaselineItemDto;

  const diffItemsCreated: Array<Record<string, unknown>> = [];
  const archMock = {
    getDiff: jest.fn(async () => ({
      id: DIFF_ID,
      project_id: 'proj-diff-sd2',
      architecture_id: 'arch-diff-sd2',
      source_baseline_id: 'src-b',
      target_baseline_id: 'tgt-b',
      status: 'computing',
      comparison_profile: null,
    })),
    getBaseline: jest.fn(async (_p: string, id: string) => ({
      id,
      status: 'active',
      updated_at: now,
    })),
    getBaselineIntegrity: jest.fn(async () => ({
      content_hash: null,
      recomputed_hash: null,
      integrity_verified: false,
    })),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) =>
      baselineId === 'src-b' ? [mkItem('s-1', sourceDelta)] : [mkItem('t-1', null)],
    ),
    createDiffItem: jest.fn(async (_p: string, _d: string, body: Record<string, unknown>) => {
      diffItemsCreated.push(body);
      return { id: `di-${diffItemsCreated.length}`, ...body };
    }),
    updateDiff: jest.fn(async () => ({})),
    deleteFindingsByApiBehaviourDiffId: jest.fn(async () => undefined),
    createDiffFinding: jest.fn(async () => ({})),
  };

  const diffRunManager = new RunManager();
  diffRunManager.start({
    sessionId: DIFF_ID,
    projectId: 'proj-diff-sd2',
    architectureId: 'arch-diff-sd2',
  });

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: archMock as any,
    runManager: diffRunManager,
    now: () => 1700000000000,
    classifyDiffItem: () => ({ shouldEmit: false }) as never,
  });

  const blob = diffItemsCreated[0].body_diff_json as Record<string, unknown>;
  expect(blob.state_classification).toBe('state_unverified');
});
