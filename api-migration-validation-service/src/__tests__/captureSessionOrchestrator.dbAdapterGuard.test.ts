/**
 * Regression test for the orchestrator DB-adapter guard (2026-06-05 Fix 2).
 *
 * Bug: `orchestrateCaptureSession` built the optional DB adapter with
 * `createDbAdapter({ dbType: cfg.dbType, ... })` guarded ONLY on
 * host/port/database/username/password -- not on `dbType`. When the persisted
 * `db_config_redacted_json` had those fields but an absent / invalid `dbType`
 * (the field-name bug persisted the engine under `type`), `cfg.dbType` was
 * `undefined`, the factory threw `Unsupported dbType: undefined`, and that
 * throw escaped the orchestrator SETUP (before its internal try/catch) -- so
 * the session was never patched to `failed` and sat as a RUNNING zombie.
 *
 * Fix: DB sampling is OPTIONAL. The guard now also returns `null` (skip DB
 * sampling, no throw) unless `dbType` is one of the two supported engines.
 *
 * This test pins both halves:
 *   1. host/port/database/username present + password present, but `dbType`
 *      missing/invalid -> `createDbAdapter` is NOT called, the run proceeds
 *      with `dbAdapter = null`, and it does NOT throw.
 *   2. a valid `dbType: 'sybase'` config (with password) -> `createDbAdapter`
 *      IS called once with `dbType: 'sybase'`.
 *
 * Harness mirrors `captureSessionOrchestrator.scenarioRequest.test.ts`:
 * mocked LLM (one execute_http_request then a terminal record_capture_note),
 * a stubbed HTTP executor, and a captured AMS surface.
 */

import { orchestrateCaptureSession } from '../services/captureSessionOrchestrator';
import type { CaptureSessionDto, OperationDto } from '../services/archModelClient';
import { toCaptureSession } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import type { ParsedOasInventory } from '../types/oas';
import type { AssistantMessage } from '../types/llm';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSessionDto(
  dbConfig: Record<string, unknown> | null,
): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'db-adapter-guard-session',
    status: 'running',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: dbConfig,
    mutating_calls_confirmed: true,
    started_at: now,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
}

function buildOperationRow(): OperationDto {
  const now = new Date().toISOString();
  return {
    id: 'op-row-dbguard',
    session_id: SESSION_ID,
    operation_id: 'getPetById',
    method: 'GET',
    path: '/pets/{id}',
    summary: 'Fetch one pet',
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: { operationId: 'getPetById' } as unknown,
    created_at: now,
    updated_at: now,
  };
}

function buildInventory(): ParsedOasInventory {
  return {
    title: 'db-guard fixture',
    version: '1.0.0',
    operations: [
      {
        operationId: 'getPetById',
        method: 'get',
        path: '/pets/{id}',
        summary: 'Fetch one pet',
        description: null,
        requestSchema: null,
        responseSchema: null,
        oasOperation: { operationId: 'getPetById' } as never,
      },
    ],
  };
}

function buildArchClientMock(sessionDto: CaptureSessionDto) {
  return {
    createScenario: jest.fn(async (projectId: string, body: any) => ({
      id: 'scenario-1',
      session_id: body.session_id,
      operation_id: body.operation_id,
      scenario_name: body.scenario_name ?? null,
      scenario_type: body.scenario_type ?? null,
      status: body.status ?? 'draft',
      generation_source: body.generation_source ?? null,
      request_method: body.request_method ?? null,
      request_path: body.request_path ?? null,
      request_query_json: null,
      request_headers_redacted_json: null,
      request_body_json: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    createCapture: jest.fn(async () => ({ id: 'capture-1' })),
    createDiagnostic: jest.fn(async () => ({ id: 'diag-1' })),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => ({
      ...sessionDto,
      ...body,
      id: sessionId,
      project_id: projectId,
    })),
  };
}

function buildGatewayMock() {
  const messages: AssistantMessage[] = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-1',
          type: 'function',
          function: {
            name: 'execute_http_request',
            arguments: JSON.stringify({ operationId: 'getPetById', method: 'get', path: '/pets/{id}' }),
          },
        },
      ],
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'tc-2',
          type: 'function',
          function: {
            name: 'record_capture_note',
            arguments: JSON.stringify({ message: 'captured' }),
          },
        },
      ],
    },
  ];
  const queue = [...messages];
  return {
    callLlmToolLoop: jest.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('mock gateway: queue exhausted');
      return { message: next };
    }),
  };
}

beforeEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  jest.restoreAllMocks();
  // Stub the HTTP executor so no real network call is attempted.
  jest
    .spyOn(require('../services/httpExecutor'), 'createSessionHttpExecutor')
    .mockReturnValue({
      request: jest.fn(async () => ({
        status: 200,
        headers: {},
        data: { ok: true },
        config: {},
        statusText: 'OK',
      })),
      setAuth: jest.fn(),
      dispose: jest.fn(),
    });
});

afterEach(() => {
  secretsStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
  jest.restoreAllMocks();
});

test('skips DB sampling (createDbAdapter NOT called, no throw) when dbType is missing but a DB password is present', async () => {
  // Secrets include a DB password -> the OLD password guard would pass, so the
  // ONLY thing stopping the throw is the new dbType guard.
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    db: { password: 'db-secret' },
    loadedAt: Date.now(),
  });

  // Malformed config: looks complete EXCEPT dbType is absent (the exact shape
  // the field-name bug produced -- engine was under `type`, never read here).
  const sessionDto = buildSessionDto({
    host: 'sybase.example.internal',
    port: 5000,
    database: 'legacy_db',
    username: 'capture_ro',
    type: 'sybase', // wrong key on purpose -- must be ignored
  });
  const session = toCaptureSession(sessionDto);

  const dbAdapterSpy = jest.spyOn(
    require('../services/db/dbAdapterFactory'),
    'createDbAdapter',
  );

  const outcome = await orchestrateCaptureSession(session, {
    archModelClient: buildArchClientMock(sessionDto) as never,
    gatewayClient: buildGatewayMock() as never,
    oasInventory: buildInventory(),
    persistedOperations: [buildOperationRow()],
  });

  // The crux: no adapter was constructed, and the run did NOT throw.
  expect(dbAdapterSpy).not.toHaveBeenCalled();
  expect(outcome.finalStatus).toBe('completed');
});

test('builds the DB adapter (createDbAdapter called with dbType:"sybase") for a valid sybase config + password', async () => {
  secretsStore.set({
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'plaintext-token' },
    db: { password: 'db-secret' },
    loadedAt: Date.now(),
  });

  const sessionDto = buildSessionDto({
    dbType: 'sybase',
    host: 'sybase.example.internal',
    port: 5000,
    database: 'legacy_db',
    schema: 'dbo',
    username: 'capture_ro',
  });
  const session = toCaptureSession(sessionDto);

  // Return a no-op adapter so the factory does not actually open a pool. The
  // orchestrator only stashes the handle on the tool context; this run's LLM
  // script never calls a DB tool, so a stub adapter is sufficient.
  const fakeAdapter = {
    testConnection: jest.fn(async () => ({ success: true })),
    dispose: jest.fn(async () => undefined),
  };
  const dbAdapterSpy = jest
    .spyOn(require('../services/db/dbAdapterFactory'), 'createDbAdapter')
    .mockReturnValue(fakeAdapter as never);

  const outcome = await orchestrateCaptureSession(session, {
    archModelClient: buildArchClientMock(sessionDto) as never,
    gatewayClient: buildGatewayMock() as never,
    oasInventory: buildInventory(),
    persistedOperations: [buildOperationRow()],
  });

  expect(dbAdapterSpy).toHaveBeenCalledTimes(1);
  expect(dbAdapterSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      dbType: 'sybase',
      host: 'sybase.example.internal',
      port: 5000,
      database: 'legacy_db',
      username: 'capture_ro',
      password: 'db-secret',
    }),
  );
  expect(outcome.finalStatus).toBe('completed');
});
