/**
 * Target-side compensation brackets (Capture-State Discipline Spec 4).
 * Harness mirrors targetReplayRunner.test.ts (mocked AMS surface, scripted
 * executor) with the compensation seams pointed at the shared in-memory
 * fakes:
 *
 *   - a mutating replay's writes are UNDONE + verified (store byte-parity)
 *     while the state_delta_json still records what the call DID (the
 *     snapshot pair runs INSIDE the bracket, before the undo);
 *   - a mutating item with NO effect map is REFUSED â€” never sent;
 *   - sabotaged undo -> RESIDUE fails the whole run with the
 *     re-run-the-data-migration remedy.
 */

import { runTargetReplay } from '../services/targetReplayRunner';
import type { TargetReplayDeps } from '../services/targetReplayRunner';
import { RunManager } from '../services/runManager';
import { SecretsStore } from '../services/secretsStore';
import type {
  BaselineDto,
  BaselineItemDto,
  CaptureSessionDto,
} from '../services/archModelClient';
import type { SessionHttpExecutor } from '../services/httpExecutor';
import { buildCompensationMetadataIndex } from '../services/compensation/compensationMetadata';
import { FakeStore, fakeReadAdapter, fakeWriteAdapter } from './helpers/compensationFakes';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000ee';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';

const MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        {
          id: 'e-pets',
          name: 'pets',
          constraints_metadata: { primary_key: { name: 'pk', columns: ['id'] } },
        },
      ],
      physical_data_attributes: [
        { physical_entity_id: 'e-pets', name: 'id', is_identity: true, is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-pets', name: 'name', source_type: 'varchar', ordinal: 2 },
      ],
    },
  },
};

/** Wire model served to the runner's own fetchEffectScopeIndex (state deltas). */
const WIRE_MODEL = {
  metaModel: {
    entities: {
      endpoints: [{ id: 'ep1', path_or_address: '/pets', operation_verb: 'POST' }],
      physical_data_entities: [{ id: 't-pets', name: 'pets' }],
    },
    relationships: {
      endpoint_data_effects: [
        { endpoint_id: 'ep1', access_mode: 'write', data_entity_point_id: 'dep_phy_t-pets' },
      ],
    },
  },
};

function seededStore() {
  const store = new FakeStore();
  store.tables.set('pets', [
    { id: 1, name: 'rex' },
    { id: 2, name: 'ada' },
  ]);
  return store;
}

function buildSession(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'target-replay-comp',
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
    source_baseline_id: SOURCE_BASELINE_ID,
    created_at: now,
    updated_at: now,
  } as CaptureSessionDto;
}

function buildSourceBaseline(): BaselineDto {
  const now = new Date().toISOString();
  return {
    id: SOURCE_BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'source-session-id',
    name: 'source-baseline-1',
    status: 'active',
    accepted_capture_count: 1,
    operation_count: 1,
    notes: null,
    kind: 'current',
    paired_with_baseline_id: null,
    created_at: now,
    updated_at: now,
  };
}

function buildItem(i: number, method: string, path: string): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: `item-${i}`,
    baseline_id: SOURCE_BASELINE_ID,
    capture_id: `cap-${i}`,
    operation_id: `op-${i}`,
    scenario_id: `scen-${i}`,
    method,
    path,
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: { name: 'nemo' } },
    response_status: 201,
    response_json: { headers: {}, body: { id: 3 } },
    business_notes: null,
    created_at: now,
    updated_at: now,
  } as BaselineItemDto;
}

function buildArchClientMock(opts: {
  session: CaptureSessionDto;
  items: BaselineItemDto[];
}) {
  const state = {
    capturesCreated: [] as Array<{ body: Record<string, unknown> }>,
    baselineItemsCreated: [] as Array<{ body: Record<string, unknown> }>,
    sessionPatches: [] as Array<{ body: Record<string, unknown> }>,
    diagnosticsCreated: [] as Array<{ body: Record<string, unknown> }>,
  };
  let captureCount = 0;
  const mock = {
    listAllCaptureSessionsByStatus: jest.fn(async (status: string) =>
      status === 'running' ? [opts.session] : [],
    ),
    getCaptureSession: jest.fn(async () => opts.session),
    getBaseline: jest.fn(async () => buildSourceBaseline()),
    listBaselineItems: jest.fn(async () => opts.items),
    listCapturesBySession: jest.fn(async () => []),
    createBaseline: jest.fn(async (_p: string, body: Record<string, unknown>) => ({
      id: 'target-baseline-1',
      project_id: PROJECT_ID,
      architecture_id: ARCH_ID,
      session_id: SESSION_ID,
      name: (body.name as string) ?? null,
      status: 'draft',
      accepted_capture_count: 0,
      operation_count: 1,
      notes: null,
      kind: 'target',
      paired_with_baseline_id: SOURCE_BASELINE_ID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    patchBaseline: jest.fn(async () => ({} as never)),
    createCapture: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.capturesCreated.push({ body });
      captureCount += 1;
      return { id: `cap-row-${captureCount}` } as never;
    }),
    patchCapture: jest.fn(async () => ({} as never)),
    createBaselineItem: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.baselineItemsCreated.push({ body });
      return { id: `t-item-${state.baselineItemsCreated.length}` } as never;
    }),
    patchCaptureSession: jest.fn(async (_p: string, _id: string, body: Record<string, unknown>) => {
      state.sessionPatches.push({ body });
      return { ...opts.session, ...body } as never;
    }),
    createDiagnostic: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.diagnosticsCreated.push({ body });
      return { id: `diag-${state.diagnosticsCreated.length}` } as never;
    }),
  };
  return { mock, state };
}

function buildDeps(opts: {
  archMock: Record<string, unknown>;
  store: InstanceType<typeof FakeStore>;
  writeAdapter?: ReturnType<typeof fakeWriteAdapter>;
  effectScopeEntries?: Array<[string, string[]]>;
  /** Item #8 (2026-08-27): read-mapped side of the replay effect scope. */
  readScope?: { readMappedKeys?: string[]; readTables?: Array<[string, string[]]> };
  onRequest?: () => void;
}): { deps: TargetReplayDeps; writeAdapter: ReturnType<typeof fakeWriteAdapter> } {
  const secretsStore = new SecretsStore();
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext' },
    loadedAt: Date.now(),
  });
  const runManager = new RunManager();
  runManager.start({ sessionId: SESSION_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });

  const executorFactory: NonNullable<TargetReplayDeps['createHttpExecutor']> = () =>
    ({
      request: jest.fn(async () => {
        opts.onRequest?.();
        return {
          data: { id: 3, ok: true },
          status: 201,
          statusText: '',
          headers: { 'content-type': 'application/json' },
          config: {} as never,
        };
      }),
      requestWithAuthOverride: jest.fn(),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    }) as unknown as SessionHttpExecutor;

  const writeAdapter = opts.writeAdapter ?? fakeWriteAdapter(opts.store);
  const deps: TargetReplayDeps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: opts.archMock as any,
    secretsStore,
    runManager,
    createHttpExecutor: executorFactory,
    now: () => 1700000000000,
    dbAdapter: fakeReadAdapter(opts.store),
    targetDbConfig: {
      dbType: 'sybase',
      host: 'target-db.example.internal',
      port: 5000,
      database: 'migrated_db',
      schema: null,
      username: 'writer',
      password: 'write-secret',
    },
    compensationSeams: {
      metadataFetcher: async () => buildCompensationMetadataIndex(MODEL),
      effectScopeFetcher: async () => ({
        tablesByOperationKey: new Map(opts.effectScopeEntries ?? [['POST /pets', ['pets']]]),
        readMappedOperationKeys: new Set<string>(opts.readScope?.readMappedKeys ?? []),
        ...(opts.readScope?.readTables
          ? { readTablesByOperationKey: new Map(opts.readScope.readTables) }
          : {}),
      }),
      writeAdapterFactory: () => writeAdapter,
    },
  };
  return { deps, writeAdapter };
}

beforeEach(() => {
  // The runner's OWN state-delta effect scope reads the committed model over
  // HTTP â€” serve the wire model so deltas engage (the bracket scope comes
  // from the seams above, independently).
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => WIRE_MODEL,
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('bracketed mutating replay: writes undone to byte-parity, state_delta recorded INSIDE the bracket', async () => {
  const store = seededStore();
  const pristine = store.snapshotJson();
  const { mock, state } = buildArchClientMock({
    session: buildSession(),
    items: [buildItem(1, 'POST', '/pets')],
  });
  const { deps } = buildDeps({
    archMock: mock,
    store,
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 3, name: 'created-by-target' });
    },
  });

  const outcome = await runTargetReplay(SESSION_ID, deps);

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(1);
  expect(store.snapshotJson()).toBe(pristine);
  expect(store.reseeds.length).toBeGreaterThan(0);

  // The delta reflects what the call DID (pre vs post BEFORE the undo).
  const delta = state.capturesCreated[0].body.state_delta_json as {
    tables: Array<{ table: string; count_delta: number | null }>;
  };
  expect(delta).toBeTruthy();
  expect(delta.tables[0]).toMatchObject({ table: 'pets', count_delta: 1 });
  const itemDelta = state.baselineItemsCreated[0].body.state_delta_json;
  expect(itemDelta).toBeTruthy();
});

test('mutating item with NO effect map is REFUSED â€” never sent', async () => {
  const store = seededStore();
  const pristine = store.snapshotJson();
  let fired = 0;
  const { mock, state } = buildArchClientMock({
    session: buildSession(),
    items: [buildItem(1, 'POST', '/pets')],
  });
  const { deps } = buildDeps({
    archMock: mock,
    store,
    effectScopeEntries: [['PUT /other', ['other_table']]],
    onRequest: () => {
      fired += 1;
    },
  });

  const outcome = await runTargetReplay(SESSION_ID, deps);

  expect(fired).toBe(0);
  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsSkipped).toBe(1);
  expect(store.snapshotJson()).toBe(pristine);
  expect(
    state.diagnosticsCreated.some((d) => d.body.diagnostic_type === 'compensation_refused'),
  ).toBe(true);
});

test('Item #7 (re-pinned 2026-08-27): sabotaged undo -> residue is HEALED from the pre-rec snapshot and the replay CONTINUES', async () => {
  // Pre-heal this pinned "failed + re-run-the-data-migration" — the
  // overnight-stop problem. Now the pre-rec write-surface snapshot repairs
  // the drifted table (truncate + reload, unaffected by the DELETE
  // sabotage), the run finishes as completed_with_findings, and nobody is
  // woken up. The receipts are the state_healed diagnostic + the verified
  // END write-surface fingerprint.
  const store = seededStore();
  const pristine = store.snapshotJson();
  const { mock, state } = buildArchClientMock({
    session: buildSession(),
    items: [buildItem(1, 'POST', '/pets')],
  });
  const writeAdapter = fakeWriteAdapter(store, { dropMatching: /^DELETE FROM pets/ });
  const { deps } = buildDeps({
    archMock: mock,
    store,
    writeAdapter,
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 3, name: 'sticky' });
    },
  });

  const outcome = await runTargetReplay(SESSION_ID, deps);

  expect(outcome.finalStatus).toBe('completed_with_findings');
  expect(store.snapshotJson()).toBe(pristine);
  const healDiag = state.diagnosticsCreated.find(
    (d) => d.body.diagnostic_type === 'state_healed',
  );
  expect(healDiag).toBeTruthy();
  expect(String(healDiag!.body.message)).toContain('pets');
  const patch = state.sessionPatches.find(
    (p) => p.body.status === 'completed_with_findings',
  );
  expect(patch).toBeTruthy();
});

test('Item #7: an UNHEALABLE residue (no pre-rec snapshot) still fails with the re-run-data-migration remedy', async () => {
  // Force the snapshot to be unavailable by pointing the run's metadata at a
  // model whose tables cannot be counted... simplest honest lever: sabotage
  // BOTH the undo and the heal (TRUNCATE dropped too) — the heal claims
  // nothing it cannot do, the store stays wrong, and the END write-surface
  // receipt catches it: the run fails with the documented remedy.
  const store = seededStore();
  const { mock, state } = buildArchClientMock({
    session: buildSession(),
    items: [buildItem(1, 'POST', '/pets')],
  });
  const writeAdapter = fakeWriteAdapter(store, {
    dropMatching: /^(DELETE FROM pets|TRUNCATE TABLE pets|INSERT INTO pets)/,
  });
  const { deps } = buildDeps({
    archMock: mock,
    store,
    writeAdapter,
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 3, name: 'sticky' });
    },
  });

  const outcome = await runTargetReplay(SESSION_ID, deps);

  expect(outcome.finalStatus).toBe('failed');
  expect(outcome.errorMessage).toContain('Re-run the data migration');
  const failPatch = state.sessionPatches.find((p) => p.body.status === 'failed');
  expect(failPatch).toBeTruthy();
});

test('Item #8 (2026-08-27): a proven-read item WITH read tables replays under a defensive bracket — a mis-mined write against the target is reverted', async () => {
  // Pre-fix: seqProvenRead/itemProvenRead consulted the WRITE map only, so a
  // zero-write-map read-mapped item fired against the target with NO bracket
  // at all — asymmetric with the capture side.
  const store = seededStore();
  const pristine = store.snapshotJson();
  const { mock } = buildArchClientMock({
    session: buildSession(),
    items: [buildItem(1, 'POST', '/pets')],
  });
  const { deps } = buildDeps({
    archMock: mock,
    store,
    effectScopeEntries: [['PUT /other', ['other_table']]],
    readScope: {
      readMappedKeys: ['POST /pets'],
      readTables: [['POST /pets', ['pets']]],
    },
    onRequest: () => {
      // The mis-mined write: the map says READ, the target actually inserts.
      store.tables.get('pets')!.push({ id: 9, name: 'leaked-on-target' });
    },
  });

  const outcome = await runTargetReplay(SESSION_ID, deps);

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(1);
  // The defensive bracket's sweep deleted the leak — target back at its
  // freshly-migrated state.
  expect(store.snapshotJson()).toBe(pristine);
});
