/**
 * Log-replay round-2 CURRENT-side runner tests (Capture-State Discipline &
 * Log-Replay program, Spec 7, 2026-08-18): corpus items replay against the
 * live current system with full AMS plumbing (session -> operations ->
 * scenarios -> captures -> `log_replay` baseline), mutating items run inside
 * brackets (store byte-parity) or are SKIPPED without DB creds, and residue
 * fails the run with the guided-restore message.
 */

import {
  runLogReplayCurrentCapture,
  type LogReplayCorpusItemInput,
} from '../services/logReplayCaptureRunner';
import { buildCompensationMetadataIndex } from '../services/compensation/compensationMetadata';
import { FakeStore, fakeReadAdapter, fakeWriteAdapter } from './helpers/compensationFakes';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';

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

function seededStore() {
  const store = new FakeStore();
  store.tables.set('pets', [
    { id: 1, name: 'rex' },
    { id: 2, name: 'ada' },
  ]);
  return store;
}

function items(): LogReplayCorpusItemInput[] {
  return [
    {
      method: 'GET',
      path_template: '/pets/{id}',
      concrete_path: '/pets/1?depth=2',
      request_json: { query: { depth: '2' } },
      occurrence_count: 7,
    },
    {
      method: 'POST',
      path_template: '/pets',
      concrete_path: '/pets',
      request_json: { body: { name: 'nemo' } },
      occurrence_count: 2,
    },
  ];
}

function buildArchMock() {
  const state = {
    sessions: [] as Array<Record<string, unknown>>,
    sessionPatches: [] as Array<Record<string, unknown>>,
    operations: [] as Array<Record<string, unknown>>,
    scenarios: [] as Array<Record<string, unknown>>,
    captures: [] as Array<Record<string, unknown>>,
    baselines: [] as Array<Record<string, unknown>>,
    baselinePatches: [] as Array<Record<string, unknown>>,
    baselineItems: [] as Array<Record<string, unknown>>,
  };
  let n = 0;
  const id = (prefix: string) => `${prefix}-${++n}`;
  const mock = {
    createCaptureSession: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.sessions.push(body);
      return { id: id('session'), ...body };
    }),
    patchCaptureSession: jest.fn(async (_p: string, _id: string, body: Record<string, unknown>) => {
      state.sessionPatches.push(body);
      return body;
    }),
    createOperation: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.operations.push(body);
      return { id: id('op'), ...body };
    }),
    createScenario: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.scenarios.push(body);
      return { id: id('scen'), ...body };
    }),
    createCapture: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.captures.push(body);
      return { id: id('cap'), ...body };
    }),
    patchCapture: jest.fn(async () => ({})),
    createBaseline: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.baselines.push(body);
      return { id: id('baseline'), ...body };
    }),
    patchBaseline: jest.fn(async (_p: string, _id: string, body: Record<string, unknown>) => {
      state.baselinePatches.push(body);
      return body;
    }),
    createBaselineItem: jest.fn(async (_p: string, body: Record<string, unknown>) => {
      state.baselineItems.push(body);
      return { id: id('item'), ...body };
    }),
  };
  return { mock, state };
}

function executorFactory(onRequest?: (method: string) => void) {
  return () =>
    ({
      request: jest.fn(async (req: { method: string }) => {
        onRequest?.(req.method);
        return {
          data: { id: 3, ok: true },
          status: req.method === 'POST' ? 201 : 200,
          statusText: '',
          headers: { 'content-type': 'application/json' },
          config: {} as never,
        };
      }),
      requestWithAuthOverride: jest.fn(),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    }) as never;
}

function runArgs(store: FakeStore, opts?: {
  archMock?: ReturnType<typeof buildArchMock>['mock'];
  withDb?: boolean;
  writeAdapter?: ReturnType<typeof fakeWriteAdapter>;
  onRequest?: (method: string) => void;
}) {
  const arch = opts?.archMock ?? buildArchMock().mock;
  const writeAdapter = opts?.writeAdapter ?? fakeWriteAdapter(store);
  return {
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    corpusId: 'corpus-0001-abcd',
    items: items(),
    currentApi: {
      baseUrl: 'https://current.example.test',
      auth: { type: 'bearer' as const, bearerToken: 'x' },
    },
    currentDb: opts?.withDb
      ? {
          dbType: 'sybase' as const,
          host: 'db.example.internal',
          port: 5000,
          database: 'legacy_db',
          schema: null,
          username: 'writer',
          password: 'secret',
        }
      : null,
    deps: {
      archModelClient: arch as never,
      createHttpExecutor: executorFactory(opts?.onRequest) as never,
      createDbAdapterFn: (() => fakeReadAdapter(store)) as never,
      compensationSeams: {
        metadataFetcher: (async () => buildCompensationMetadataIndex(MODEL)) as never,
        effectScopeFetcher: (async () => ({
          tablesByOperationKey: new Map([['POST /pets', ['pets']]]), readMappedOperationKeys: new Set<string>(),
        })) as never,
        writeAdapterFactory: (() => writeAdapter) as never,
      },
    },
  };
}

test('with DB creds: reads replay, the mutating item runs bracketed to byte-parity, log_replay baseline finalised', async () => {
  const store = seededStore();
  const pristine = store.snapshotJson();
  const { mock, state } = buildArchMock();
  const fired: string[] = [];
  const outcome = await runLogReplayCurrentCapture(
    runArgs(store, {
      archMock: mock,
      withDb: true,
      onRequest: (method) => {
        fired.push(method);
        if (method === 'POST') store.tables.get('pets')!.push({ id: 3, name: 'nemo' });
      },
    }) as never,
  );

  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(2);
  expect(outcome.itemsSkipped).toBe(0);
  expect(fired.sort()).toEqual(['GET', 'POST']);
  expect(store.snapshotJson()).toBe(pristine); // the POST was undone + verified
  expect(state.baselines[0].kind).toBe('log_replay');
  expect(state.baselinePatches.some((p) => p.status === 'active')).toBe(true);
  expect(state.baselineItems).toHaveLength(2);
  expect(state.operations).toHaveLength(2); // one per distinct (method, template)
  const scenarioNames = state.baselineItems.map((i) => String(i.scenario_name));
  expect(scenarioNames.every((n) => n.startsWith('log:'))).toBe(true);
});

test('without DB creds: the mutating item is SKIPPED (never fired uncompensated); reads still replay', async () => {
  const store = seededStore();
  const fired: string[] = [];
  const outcome = await runLogReplayCurrentCapture(
    runArgs(store, { withDb: false, onRequest: (m) => fired.push(m) }) as never,
  );
  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.itemsReplayed).toBe(1);
  expect(outcome.itemsSkipped).toBe(1);
  expect(fired).toEqual(['GET']);
});

test('residue fails the run with the guided-restore message', async () => {
  const store = seededStore();
  const writeAdapter = fakeWriteAdapter(store, { dropMatching: /^DELETE FROM pets/ });
  const outcome = await runLogReplayCurrentCapture(
    runArgs(store, {
      withDb: true,
      writeAdapter,
      onRequest: (method) => {
        if (method === 'POST') store.tables.get('pets')!.push({ id: 3, name: 'sticky' });
      },
    }) as never,
  );
  expect(outcome.finalStatus).toBe('failed');
  expect(outcome.errorMessage).toContain('NO LONGER S0');
  expect(outcome.errorMessage).toContain('/api/s0-snapshot/restore');
});
