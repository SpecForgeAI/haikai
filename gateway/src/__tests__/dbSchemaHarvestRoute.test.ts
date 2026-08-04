/**
 * Sybase schema harvest — route-surface tests (Spec 3, 2026-08-04).
 *
 * Covers ONLY the HTTP contract of the two new routes on
 * `/projects/:projectId/db-migration-packs`:
 *
 *   POST /structural-harvest      — 400 on missing required fields; 200 with
 *                                   the snake_case structured result for BOTH
 *                                   completed and failed stages (chain
 *                                   failures are data, not transport errors);
 *                                   orchestrator wiring receives the parsed
 *                                   connection + target binding.
 *   POST /test-source-connection  — thin discovery-service probe proxy with
 *                                   dbEngine DEFAULTED (not forced) to sybase;
 *                                   status + body pass through; 503 on
 *                                   unreachable upstream.
 *
 * Orchestration behaviour itself is covered in dbSchemaHarvest.test.ts.
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    mcpBaseUrl: 'http://localhost:8090',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockHarvest = jest.fn();
jest.mock('../services/dbSchemaHarvest', () => {
  const actual = jest.requireActual('../services/dbSchemaHarvest');
  return {
    ...actual,
    runStructuralHarvest: (...args: unknown[]) => mockHarvest(...args),
  };
});

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { dbMigrationPackRouter } from '../routes/dbMigrationPack';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/v1', dbMigrationPackRouter);
  return app;
}

const HARVEST_URL = '/api/v1/projects/p-1/db-migration-packs/structural-harvest';
const PROBE_URL = '/api/v1/projects/p-1/db-migration-packs/test-source-connection';

const VALID_BODY = {
  architecture_id: 'a-1',
  target_architecture_id: 't-1',
  host: 'sybase.internal',
  port: 5000,
  database_name: 'legacy_db',
  username: 'svc_reader',
  password: 'sekret-pw-123',
  sybase_driver: 'jconn4',
  include_schemas: ['dbo'],
  service_id: 'svc-9',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
});

describe('POST /structural-harvest — validation', () => {
  it('400s listing every missing required field, without invoking the orchestrator', async () => {
    const response = await request(createTestApp()).post(HARVEST_URL).send({});
    expect(response.status).toBe(400);
    const message = response.body.error.message as string;
    for (const field of ['architecture_id', 'host', 'port', 'database_name', 'username', 'password']) {
      expect(message).toContain(field);
    }
    expect(mockHarvest).not.toHaveBeenCalled();
  });

  it('400s on a non-numeric port', async () => {
    const response = await request(createTestApp())
      .post(HARVEST_URL)
      .send({ ...VALID_BODY, port: '5000' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('port');
    expect(mockHarvest).not.toHaveBeenCalled();
  });
});

describe('POST /structural-harvest — result envelope', () => {
  it('200s with the snake_case result and forwards the parsed request to the orchestrator', async () => {
    mockHarvest.mockResolvedValue({
      runId: 'run-1',
      runStatus: 'COMPLETED',
      savedBack: { entitiesCreated: 4, entitiesSkipped: 2, candidatesCommitted: 6 },
      packRegenerated: true,
      findings: [
        {
          key: 'no_primary_keys:dbo.orders',
          kind: 'no_primary_keys',
          subject: 'dbo.orders',
          message: 'no PKs captured',
          disposition: null,
          note: null,
          open: true,
        },
      ],
      stage: 'completed',
    });

    const response = await request(createTestApp()).post(HARVEST_URL).send(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      run_id: 'run-1',
      run_status: 'COMPLETED',
      saved_back: { entities_created: 4, entities_skipped: 2, candidates_committed: 6 },
      pack_regenerated: true,
      findings: [
        expect.objectContaining({ key: 'no_primary_keys:dbo.orders', open: true }),
      ],
      stage: 'completed',
      error: null,
    });

    expect(mockHarvest).toHaveBeenCalledWith({
      projectId: 'p-1',
      architectureId: 'a-1',
      targetArchitectureId: 't-1',
      serviceId: 'svc-9',
      connection: {
        host: 'sybase.internal',
        port: 5000,
        databaseName: 'legacy_db',
        username: 'svc_reader',
        password: 'sekret-pw-123',
        sybaseDriver: 'jconn4',
        includeSchemas: ['dbo'],
      },
    });
  });

  it('200s (NOT 5xx) for a scan_failed stage — chain failures are data', async () => {
    mockHarvest.mockResolvedValue({
      runId: 'run-1',
      runStatus: 'FAILED',
      savedBack: null,
      packRegenerated: false,
      findings: [],
      stage: 'scan_failed',
      error: 'Discovery run run-1 FAILED — check the run diagnostics for the engine error.',
    });
    const response = await request(createTestApp()).post(HARVEST_URL).send(VALID_BODY);
    expect(response.status).toBe(200);
    expect(response.body.stage).toBe('scan_failed');
    expect(response.body.saved_back).toBeNull();
    expect(response.body.error).toContain('FAILED');
  });

  it('500s only when the orchestrator itself throws (transport/programming error)', async () => {
    mockHarvest.mockRejectedValue(new Error('deps wiring broken'));
    const response = await request(createTestApp()).post(HARVEST_URL).send(VALID_BODY);
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe(500);
  });
});

describe('POST /test-source-connection — probe proxy', () => {
  it('forwards to discovery-service with dbEngine defaulted to sybase and proxies the response', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () =>
        JSON.stringify({ success: true, engine: 'sybase', serverVersion: '16.0' }),
    });

    const response = await request(createTestApp()).post(PROBE_URL).send({
      host: 'sybase.internal',
      port: 5000,
      databaseName: 'legacy_db',
      username: 'svc_reader',
      password: 'sekret-pw-123',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:8091/discovery/db/test-connection');
    const sent = JSON.parse((init as { body: string }).body);
    expect(sent.dbEngine).toBe('sybase');
    expect(sent.host).toBe('sybase.internal');
    expect(sent.password).toBe('sekret-pw-123');
  });

  it('lets an explicit dbEngine in the body win (default, not forced)', async () => {
    mockFetch.mockResolvedValue({
      status: 400,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ success: false }),
    });
    await request(createTestApp())
      .post(PROBE_URL)
      .send({ dbEngine: 'postgres', host: 'h', port: 5432, username: 'u', password: 'p' });
    const sent = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(sent.dbEngine).toBe('postgres');
  });

  it('proxies upstream 400 probe failures byte-for-byte', async () => {
    mockFetch.mockResolvedValue({
      status: 400,
      headers: { get: () => 'application/json' },
      text: async () =>
        JSON.stringify({
          success: false,
          engine: 'sybase',
          error: { code: 400, message: 'Login failed' },
        }),
    });
    const response = await request(createTestApp()).post(PROBE_URL).send({
      host: 'h',
      port: 5000,
      username: 'u',
      password: 'wrong',
    });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toBe('Login failed');
  });

  it('503s when discovery-service is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const response = await request(createTestApp()).post(PROBE_URL).send({
      host: 'h',
      port: 5000,
      username: 'u',
      password: 'p',
    });
    expect(response.status).toBe(503);
    expect(response.body.error.message).toBe('Discovery service unavailable');
  });
});
