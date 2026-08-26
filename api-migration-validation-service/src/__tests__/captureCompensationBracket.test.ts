/**
 * Capture-side compensation brackets â€” orchestrator-level tests (Capture-State
 * Discipline Spec 3). The harness mirrors the dbAdapterGuard test (mocked LLM
 * script, stubbed HTTP executor whose "app" writes into the shared FakeStore,
 * captured AMS surface) with the compensation seams injected so the bracket
 * runs against the in-memory fakes:
 *
 *   - a mutating scenario's writes are UNDONE + verified (store byte-parity),
 *     identity reseeded, session completes;
 *   - a write endpoint with NO effect map is REFUSED (never fired) with the
 *     loud diagnostic + the session-start aggregate warning lists it;
 *   - sabotaged undo -> RESIDUE halts the session as FAILED with the guided
 *     restore message;
 *   - end-of-job S0 fingerprint: advisory when no snapshot is pinned; FAILED
 *     when the live DB diverged from a pinned S0.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const TMP_S0 = path.join(os.tmpdir(), `haikai-csd3-test-${process.pid}-${Date.now()}`);
process.env.S0_SNAPSHOT_DIR = TMP_S0;

/* eslint-disable @typescript-eslint/no-var-requires */
const { orchestrateCaptureSession } = require('../services/captureSessionOrchestrator');
const { toCaptureSession } = require('../services/archModelClient');
const { secretsStore } = require('../services/secretsStore');
const { runManager } = require('../services/runManager');
const {
  buildCompensationMetadataIndex,
} = require('../services/compensation/compensationMetadata');
const { runS0Snapshot } = require('../services/s0/snapshotRunner');
const { FakeStore, fakeReadAdapter, fakeWriteAdapter } = require('./helpers/compensationFakes');
/* eslint-enable @typescript-eslint/no-var-requires */

import type { CaptureSessionDto, OperationDto } from '../services/archModelClient';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000dd';

afterAll(() => {
  fs.rmSync(TMP_S0, { recursive: true, force: true });
});

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

function effectScopeWith(
  entries: Array<[string, string[]]>,
  readSide?: {
    readMappedKeys?: string[];
    readTables?: Array<[string, string[]]>;
  },
) {
  return {
    tablesByOperationKey: new Map(entries),
    readMappedOperationKeys: new Set<string>(readSide?.readMappedKeys ?? []),
    ...(readSide?.readTables
      ? { readTablesByOperationKey: new Map(readSide.readTables) }
      : {}),
  };
}

function buildSessionDto(): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'compensation-bracket-session',
    status: 'running',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: {
      dbType: 'sybase',
      host: 'sybase.example.internal',
      port: 5000,
      database: 'legacy_db',
      username: 'writer',
    },
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  } as CaptureSessionDto;
}

function buildMutatingOperation(
  operationId = 'createPet',
  method = 'POST',
  opPath = '/pets',
): OperationDto {
  const now = new Date().toISOString();
  return {
    id: `op-row-${operationId}`,
    session_id: SESSION_ID,
    operation_id: operationId,
    method,
    path: opPath,
    summary: 'mutating fixture op',
    description: null,
    included: true,
    safe_to_execute: false,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: { operationId } as unknown,
    created_at: now,
    updated_at: now,
  } as OperationDto;
}

function buildInventory(ops: OperationDto[]): ParsedOasInventory {
  return {
    title: 'compensation fixture',
    version: '1.0.0',
    operations: ops.map((op) => ({
      operationId: op.operation_id,
      method: op.method.toLowerCase() as never,
      path: op.path,
      summary: op.summary ?? null,
      description: null,
      requestSchema: null,
      responseSchema: null,
      oasOperation: { operationId: op.operation_id } as never,
    })),
  };
}

function buildArchClientMock(sessionDto: CaptureSessionDto) {
  const diagnostics: Array<{ diagnostic_type: string; message: string; detail_json?: unknown }> =
    [];
  return {
    diagnostics,
    createScenario: jest.fn(async (_projectId: string, body: Record<string, unknown>) => ({
      id: `scenario-${Math.random().toString(36).slice(2, 8)}`,
      session_id: body.session_id,
      operation_id: body.operation_id,
      scenario_name: body.scenario_name ?? null,
      scenario_type: body.scenario_type ?? null,
      status: 'draft',
      generation_source: 'llm_generated',
      request_method: body.request_method ?? null,
      request_path: body.request_path ?? null,
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    createCapture: jest.fn(async () => ({ id: `capture-${Math.random().toString(36).slice(2, 8)}` })),
    createDiagnostic: jest.fn(async (_projectId: string, body: Record<string, unknown>) => {
      diagnostics.push(body as never);
      return { id: 'diag-1' };
    }),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: Record<string, unknown>) => ({
      ...sessionDto,
      ...body,
      id: sessionId,
      project_id: projectId,
    })),
  };
}

/** Cyclic LLM script: execute_http_request then a terminal note, repeated. */
function buildGatewayMock(operationId: string, method: string, opPath: string) {
  const script = (): AssistantMessage[] => [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `tc-exec-${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: {
            name: 'execute_http_request',
            arguments: JSON.stringify({ operationId, method: method.toLowerCase(), path: opPath }),
          },
        },
      ],
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `tc-note-${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({ message: 'done' }),
          },
        },
      ],
    },
  ];
  let queue: AssistantMessage[] = [];
  return {
    callLlmToolLoop: jest.fn(async () => {
      if (queue.length === 0) queue = script();
      return { message: queue.shift() as AssistantMessage };
    }),
  };
}

interface HarnessArgs {
  store: InstanceType<typeof FakeStore>;
  effectScope: {
    tablesByOperationKey: Map<string, string[]>;
    readMappedOperationKeys: Set<string>;
    readTablesByOperationKey?: Map<string, string[]>;
  };
  operations?: OperationDto[];
  writeAdapter?: ReturnType<typeof fakeWriteAdapter>;
  /** Model override (defaults to the pets-only MODEL). */
  model?: unknown;
  /** What the "app" does when the LLM fires the request. */
  onRequest?: () => void;
}

async function runHarness(args: HarnessArgs) {
  const operations = args.operations ?? [buildMutatingOperation()];
  const sessionDto = buildSessionDto();
  const session = toCaptureSession(sessionDto);
  const archMock = buildArchClientMock(sessionDto);
  const gatewayMock = buildGatewayMock(
    operations[0].operation_id,
    operations[0].method,
    operations[0].path,
  );

  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    db: { password: 'write-secret' },
    loadedAt: Date.now(),
  });

  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({
      request: jest.fn(async () => {
        args.onRequest?.();
        return {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json' },
          data: { id: 3, ok: true },
          config: {},
        };
      }),
      requestWithAuthOverride: jest.fn(),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    });
  jest
    .spyOn(require('../services/db/dbAdapterFactory'), 'createDbAdapter')
    .mockReturnValue(fakeReadAdapter(args.store));

  const writeAdapter = args.writeAdapter ?? fakeWriteAdapter(args.store);
  const outcome = await orchestrateCaptureSession(session, {
    archModelClient: archMock as never,
    gatewayClient: gatewayMock as never,
    oasInventory: buildInventory(operations),
    persistedOperations: operations,
    compensationSeams: {
      metadataFetcher: async () => buildCompensationMetadataIndex(args.model ?? MODEL),
      effectScopeFetcher: async () => args.effectScope,
      writeAdapterFactory: () => writeAdapter,
      // Quiet-window guardrail (Oracle Nine item 5) runs BEFORE scenarios
      // with a 120s two-sweep gap by default — instant here; the guardrail
      // has its own dedicated coverage.
      quietCheckGapSeconds: 0,
      quietCheckSleep: async () => {},
    },
  });
  return { outcome, archMock, writeAdapter };
}

beforeEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  jest.restoreAllMocks();
});

afterEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  jest.restoreAllMocks();
});

test('bracketed mutating scenario: writes undone to byte-parity, reseed recorded, session completes', async () => {
  const store = seededStore();
  const pristine = store.snapshotJson();
  const { outcome, archMock } = await runHarness({
    store,
    effectScope: effectScopeWith([['POST /pets', ['pets']]]),
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 3, name: 'created-by-app' });
    },
  });

  expect(outcome.finalStatus).toBe('completed');
  expect(store.snapshotJson()).toBe(pristine);
  expect(store.reseeds.length).toBeGreaterThan(0);
  const types = archMock.diagnostics.map((d) => d.diagnostic_type);
  expect(types).not.toContain('compensation_refused');
  expect(types).not.toContain('compensation_residue');
  // No S0 snapshot pinned in the temp dir -> loud advisory, never silence.
  expect(types).toContain('s0_snapshot_missing');
});

test('write endpoint with NO effect map: aggregate warning + scenario refused, never fired', async () => {
  const store = seededStore();
  const pristine = store.snapshotJson();
  let fired = 0;
  const { outcome, archMock } = await runHarness({
    store,
    // Effect scope deliberately does NOT know POST /pets.
    effectScope: effectScopeWith([['PUT /other', ['other_table']]]),
    onRequest: () => {
      fired += 1;
    },
  });

  expect(fired).toBe(0);
  expect(store.snapshotJson()).toBe(pristine);
  expect(outcome.finalStatus).toBe('completed');
  expect(outcome.scenariosErrored).toBeGreaterThan(0);
  const byType = new Map(archMock.diagnostics.map((d) => [d.diagnostic_type, d]));
  expect(byType.has('compensation_no_effect_map')).toBe(true);
  expect(
    (byType.get('compensation_no_effect_map')?.detail_json as { endpoints: string[] }).endpoints,
  ).toContain('POST /pets');
  expect(byType.has('compensation_refused')).toBe(true);
});

test('sabotaged undo -> RESIDUE halts the session as FAILED with the guided-restore message', async () => {
  const store = seededStore();
  const writeAdapter = fakeWriteAdapter(store, { dropMatching: /^DELETE FROM pets/ });
  const { outcome, archMock } = await runHarness({
    store,
    effectScope: effectScopeWith([['POST /pets', ['pets']]]),
    writeAdapter,
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 3, name: 'sticky' });
    },
  });

  expect(outcome.finalStatus).toBe('failed');
  expect(outcome.errorMessage).toContain('NO LONGER S0');
  expect(outcome.errorMessage).toContain('/api/s0-snapshot/restore');
  expect(archMock.diagnostics.some((d) => d.diagnostic_type === 'compensation_residue')).toBe(
    true,
  );
});

test('end-of-job fingerprint FAILS the session when the DB diverged from a pinned S0', async () => {
  const store = seededStore();
  // Pin S0 from the pristine store...
  await runS0Snapshot({
    adapter: fakeReadAdapter(store),
    metadata: buildCompensationMetadataIndex(MODEL),
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
    sourceDbType: 'sybase',
    snapshotId: 's0-csd3-001',
  });
  // ...then wreck the DB OUTSIDE any bracket (out-of-band corruption).
  store.tables.get('pets')!.push({ id: 99, name: 'out-of-band' });

  const { outcome, archMock } = await runHarness({
    store,
    effectScope: effectScopeWith([['POST /pets', ['pets']]]),
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 100, name: 'created-by-app' });
    },
  });

  // Brackets restored their own writes (id=100 gone) but the out-of-band row
  // survives -> fingerprint mismatch -> FAILED with the restore remedy.
  expect(outcome.finalStatus).toBe('failed');
  expect(outcome.errorMessage).toContain('fingerprint MISMATCH');
  expect(
    archMock.diagnostics.some((d) => d.diagnostic_type === 's0_fingerprint_mismatch'),
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Defensive bracket scope (2026-08-26): the bracket snapshots the READ∪WRITE
// union, so a mis-mined write edge (read-then-write idiom whose INSERT the
// mining lost -> table marked READ on an op that writes it) is caught and
// reverted PER SCENARIO instead of leaking to the end-of-job fingerprint and
// discarding a multi-hour run.
// ---------------------------------------------------------------------------

const WIDENED_MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        {
          id: 'e-pets',
          name: 'pets',
          constraints_metadata: { primary_key: { name: 'pk', columns: ['id'] } },
        },
        {
          id: 'e-ftag',
          name: 'filter_tag',
          constraints_metadata: { primary_key: { name: 'pk_ft', columns: ['id'] } },
        },
      ],
      physical_data_attributes: [
        { physical_entity_id: 'e-pets', name: 'id', is_identity: true, is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-pets', name: 'name', source_type: 'varchar', ordinal: 2 },
        { physical_entity_id: 'e-ftag', name: 'id', is_primary_key: true, source_type: 'int', ordinal: 1 },
        { physical_entity_id: 'e-ftag', name: 'tag_name', source_type: 'varchar', ordinal: 2 },
      ],
    },
  },
};

function widenedStore() {
  const store = seededStore();
  store.tables.set('filter_tag', [{ id: 10, tag_name: 'starred' }]);
  return store;
}

test('union bracket: a stray write on a READ-mapped table is reverted (leak mode 2 closed)', async () => {
  const store = widenedStore();
  const pristine = store.snapshotJson();
  const { outcome } = await runHarness({
    store,
    model: WIDENED_MODEL,
    effectScope: effectScopeWith([['POST /pets', ['pets']]], {
      readTables: [['POST /pets', ['filter_tag']]],
    }),
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 3, name: 'created-by-app' });
      // The mis-mined write: the map says READ, the app actually inserts.
      store.tables.get('filter_tag')!.push({ id: 11, tag_name: 'fav-row' });
    },
  });

  expect(outcome.finalStatus).toBe('completed');
  // BOTH writes reverted -- the read-mapped table rode in the bracket scope.
  expect(store.snapshotJson()).toBe(pristine);
});

test('defensive read bracket: a proven-read op with read tables is bracketed, its stray write reverted (leak mode 1 closed)', async () => {
  const store = widenedStore();
  const pristine = store.snapshotJson();
  const { outcome, archMock } = await runHarness({
    store,
    model: WIDENED_MODEL,
    // NO write map at all; the op is corpus-proven read with a resolvable
    // read table. Previously this fired completely unbracketed.
    effectScope: effectScopeWith([], {
      readMappedKeys: ['POST /pets'],
      readTables: [['POST /pets', ['filter_tag']]],
    }),
    onRequest: () => {
      store.tables.get('filter_tag')!.push({ id: 12, tag_name: 'leaked' });
    },
  });

  expect(outcome.finalStatus).toBe('completed');
  expect(store.snapshotJson()).toBe(pristine);
  const proven = archMock.diagnostics.find((d) => d.diagnostic_type === 'proven_read_only');
  expect(proven).toBeDefined();
  expect(proven!.message).toContain('DEFENSIVE');
});

test('proven-read with NO resolvable read tables still fires unbracketed (unchanged)', async () => {
  const store = seededStore();
  const { outcome, archMock } = await runHarness({
    store,
    effectScope: effectScopeWith([], { readMappedKeys: ['POST /pets'] }),
  });

  expect(outcome.finalStatus).toBe('completed');
  const proven = archMock.diagnostics.find((d) => d.diagnostic_type === 'proven_read_only');
  expect(proven).toBeDefined();
  expect(proven!.message).toContain('WITHOUT a bracket');
});

test('keyless zero-delta guard: a genuinely-READ keyless table in the bracket scope is never recorded as keyless-written', async () => {
  const keylessModel = {
    metaModel: {
      entities: {
        physical_data_entities: [
          {
            id: 'e-pets',
            name: 'pets',
            constraints_metadata: { primary_key: { name: 'pk', columns: ['id'] } },
          },
          { id: 'e-sink', name: 'event_sink', constraints_metadata: { key_policy: 'keyless_multiset' } },
        ],
        physical_data_attributes: [
          { physical_entity_id: 'e-pets', name: 'id', is_identity: true, is_primary_key: true, source_type: 'int', ordinal: 1 },
          { physical_entity_id: 'e-pets', name: 'name', source_type: 'varchar', ordinal: 2 },
          { physical_entity_id: 'e-sink', name: 'detail', source_type: 'varchar', ordinal: 1 },
        ],
      },
    },
  };
  const store = seededStore();
  store.tables.set('event_sink', [{ detail: 'existing' }]);

  // Run 1: the app READS event_sink only (no write) -- zero count delta.
  const first = await runHarness({
    store,
    model: keylessModel,
    effectScope: effectScopeWith([['POST /pets', ['pets']]], {
      readTables: [['POST /pets', ['event_sink']]],
    }),
    onRequest: () => {
      store.tables.get('pets')!.push({ id: 3, name: 'created-by-app' });
    },
  });
  expect(first.outcome.finalStatus).toBe('completed');
  expect(
    first.archMock.diagnostics.some((d) => d.diagnostic_type === 'keyless_write_recorded'),
  ).toBe(false);

  // Run 2: the app actually WRITES the keyless table -- the observation is
  // still recorded (the guard skips only zero-delta reads).
  const second = await runHarness({
    store,
    model: keylessModel,
    effectScope: effectScopeWith([['POST /pets', ['pets']]], {
      readTables: [['POST /pets', ['event_sink']]],
    }),
    onRequest: () => {
      store.tables.get('event_sink')!.push({ detail: 'written-by-app' });
    },
  });
  expect(second.outcome.finalStatus).toBe('completed');
  expect(
    second.archMock.diagnostics.some((d) => d.diagnostic_type === 'keyless_write_recorded'),
  ).toBe(true);
});
